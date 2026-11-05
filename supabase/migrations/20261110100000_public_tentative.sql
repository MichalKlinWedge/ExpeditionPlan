-- Publiczny link podaje, ile osób się waha, do opisu wyprawy. Tylko liczba: kto się waha, zostaje poza linkiem.
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

  foreach t in array array['travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items', 'legs', 'constraints', 'notes', 'sources', 'audio_guides'] loop
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

  -- Osoby: bez notatek, wzrostu, powiązania z kontem, wahania, dat obecności i miejsc startu i końca; imiona zastąpione przy `hide.names`.
  tables := jsonb_set(tables, '{travelers}', coalesce((
    select jsonb_agg(
      case when coalesce((share.hide ->> 'names')::boolean, false)
        then (p - array['notes', 'height_cm', 'user_id', 'nickname', 'tentative', 'from_date', 'to_date', 'start_place_id', 'end_place_id']) || jsonb_build_object('name', 'Osoba ' || ord)
        else p - array['notes', 'height_cm', 'user_id', 'tentative', 'from_date', 'to_date', 'start_place_id', 'end_place_id'] end)
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

  -- Opisy miejsc: treść z Wikipedii i Commons, bez wskazówki organizatora dla AI i danych do czytania na głos.
  tables := jsonb_set(tables, '{audio_guides}', coalesce((
    select jsonb_agg((g - array['text', 'sources', 'audio_path', 'voice', 'duration_s']) || jsonb_build_object('content', (g -> 'content') - 'hint'))
    from jsonb_array_elements(tables -> 'audio_guides') g), '[]'));

  return jsonb_build_object(
    'version', trip.sync_version,
    'planVersion', trip.plan_version,
    'trip', to_jsonb(trip) - array['sync_version', 'plan_version', 'owner_id', 'fx'],
    'tables', tables,
    'hide', share.hide,
    'tentative', (select count(*) from public.travelers where trip_id = trip.id and deleted_at is null and tentative is true)
  );
end $$;
