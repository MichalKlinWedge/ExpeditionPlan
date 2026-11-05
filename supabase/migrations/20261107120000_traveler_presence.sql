-- Uczestnik, który się waha, i uczestnik tylko na część wyjazdu. Brak dat = cały wyjazd, sama data
-- `from_date` albo `to_date` = dołącza później albo wyjeżdża wcześniej. Uwagi to istniejące `notes`.
alter table public.travelers
  add column tentative boolean,
  add column from_date date,
  add column to_date date,
  add constraint travelers_presence_order check (from_date is null or to_date is null or from_date <= to_date);

-- Daty obecności idą za zmianą terminu wyjazdu.
create or replace function public.reschedule_trip(p_trip uuid, p_version bigint, p_start date, p_end date, p_changes jsonb, p_restore boolean default false) returns void
language plpgsql set search_path = '' as $$
declare
  trip public.trips;
begin
  if not public.can_edit_trip(p_trip) then
    raise exception 'Brak uprawnień do zmiany terminu' using errcode = '42501';
  end if;
  select * into strict trip from public.trips where id = p_trip for update;
  if trip.sync_version <> p_version then
    raise exception 'Plan zmienił się w międzyczasie' using errcode = 'EP001';
  end if;
  if p_end - p_start <> trip.end_date - trip.start_date then
    raise exception 'Zmiana terminu nie zmienia długości wyjazdu' using errcode = '22023';
  end if;

  update public.days t set date = c.date
    from jsonb_to_recordset(coalesce(p_changes -> 'days', '[]')) c(id uuid, date date)
   where t.id = c.id and t.trip_id = p_trip;
  update public.bookings t set start_date = c.start_date, end_date = c.end_date, free_cancellation_until = c.free_cancellation_until
    from jsonb_to_recordset(coalesce(p_changes -> 'bookings', '[]')) c(id uuid, start_date date, end_date date, free_cancellation_until date)
   where t.id = c.id and t.trip_id = p_trip;
  update public.tasks t set due = c.due
    from jsonb_to_recordset(coalesce(p_changes -> 'tasks', '[]')) c(id uuid, due jsonb)
   where t.id = c.id and t.trip_id = p_trip;
  update public.variant_groups t set decide_by = c.decide_by
    from jsonb_to_recordset(coalesce(p_changes -> 'variant_groups', '[]')) c(id uuid, decide_by jsonb)
   where t.id = c.id and t.trip_id = p_trip;
  update public.travelers t set from_date = c.from_date, to_date = c.to_date
    from jsonb_to_recordset(coalesce(p_changes -> 'travelers', '[]')) c(id uuid, from_date date, to_date date)
   where t.id = c.id and t.trip_id = p_trip;
  update public.trip_brief t set brief = c.brief
    from jsonb_to_recordset(coalesce(p_changes -> 'trip_brief', '[]')) c(id uuid, brief jsonb)
   where t.id = c.id and t.trip_id = p_trip;

  update public.trips
     set start_date = p_start, end_date = p_end, status = case when p_restore then 'planning' else status end
   where id = p_trip;
end $$;


-- Wahanie i obecność to sprawa grupy: publiczny link ich nie pokazuje.
create or replace function public.public_trip(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  share public.public_shares;
  trip public.trips;
  tables jsonb := '{}'::jsonb;
  rows jsonb;
  t text;
  costs boolean;
  lodging uuid[];
begin
  select * into share from public.public_shares where token_hash = public.token_digest(p_token) and enabled;
  if not found then
    return null;
  end if;
  select * into trip from public.trips where id = share.trip_id and deleted_at is null;
  if not found then
    return null;
  end if;
  costs := coalesce((share.hide ->> 'costs')::boolean, true);

  foreach t in array array['travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items', 'legs', 'constraints', 'notes', 'sources'] loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(r) - array[''created_by'', ''updated_by''] order by r.row_version), ''[]'') from public.%I r
        where r.trip_id = $1 and r.deleted_at is null', t)
      into rows using trip.id;
    tables := tables || jsonb_build_object(t, rows);
  end loop;

  -- Rezerwacje: bez kodów, linków (bywa w nich dostęp do zarządzania) i notatek; ceny według `hide.costs`.
  tables := jsonb_set(tables, '{bookings}', coalesce((
    select jsonb_agg(b - array['confirmation_code', 'links', 'notes', 'party', 'payment_method', 'pay_when']
      - case when costs then array['price', 'paid_minor', 'paid_currency', 'paid_on', 'addons'] else array[]::text[] end)
    from jsonb_array_elements(tables -> 'bookings') b), '[]'));
  if costs then
    tables := jsonb_set(tables, '{items}', coalesce((select jsonb_agg(i - array['price', 'payment']) from jsonb_array_elements(tables -> 'items') i), '[]'));
    tables := jsonb_set(tables, '{legs}', coalesce((select jsonb_agg(l - 'price') from jsonb_array_elements(tables -> 'legs') l), '[]'));
  end if;

  -- Osoby: bez notatek, wzrostu, powiązania z kontem, wahania i dat obecności; imiona zastąpione przy `hide.names`.
  tables := jsonb_set(tables, '{travelers}', coalesce((
    select jsonb_agg(
      case when coalesce((share.hide ->> 'names')::boolean, false)
        then (p - array['notes', 'height_cm', 'user_id', 'nickname', 'tentative', 'from_date', 'to_date']) || jsonb_build_object('name', 'Osoba ' || ord)
        else p - array['notes', 'height_cm', 'user_id', 'tentative', 'from_date', 'to_date'] end)
    from jsonb_array_elements(tables -> 'travelers') with ordinality as x(p, ord)), '[]'));

  -- Adresy noclegów: baza dnia i miejsca rezerwacji noclegu.
  if coalesce((share.hide ->> 'lodgingAddress')::boolean, true) then
    select array_agg(distinct id) into lodging from (
      select base_place_id as id from public.days where trip_id = trip.id and base_place_id is not null
      union select start_place_id from public.bookings where trip_id = trip.id and kind = 'lodging' and start_place_id is not null
    ) ids;
    tables := jsonb_set(tables, '{places}', coalesce((
      select jsonb_agg(case when (p ->> 'id')::uuid = any(coalesce(lodging, array[]::uuid[])) then p - 'address' else p end)
      from jsonb_array_elements(tables -> 'places') p), '[]'));
  end if;

  -- Źródła bez powiązań — wskazywałyby też pominięte elementy (kontakty, zadania, budżet).
  tables := jsonb_set(tables, '{sources}', coalesce((
    select jsonb_agg(src || jsonb_build_object('applies_to_ids', '[]'::jsonb)) from jsonb_array_elements(tables -> 'sources') src), '[]'));

  -- Notatki planu (bez audytu zapasu i uzasadnień AI).
  tables := jsonb_set(tables, '{notes}', coalesce((
    select jsonb_agg(n) from jsonb_array_elements(tables -> 'notes') n
    where n ->> 'scope' in ('trip', 'day', 'item', 'booking', 'variant_group') and n ->> 'kind' not in ('slack_audit', 'rationale')), '[]'));

  return jsonb_build_object(
    'version', trip.sync_version,
    'planVersion', trip.plan_version,
    'trip', to_jsonb(trip) - array['sync_version', 'plan_version', 'owner_id', 'fx'],
    'tables', tables,
    'hide', share.hide
  );
end $$;

