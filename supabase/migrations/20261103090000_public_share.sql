-- Publiczny link „tylko do podglądu” (rodzina, znajomi bez konta): `/p/<token>` na webie.
-- Właściciel tworzy link (`create_public_share` — token wraca raz, w bazie tylko skrót) i może go
-- wyłączyć. `public_trip` zwraca dokument w kształcie `pull_changes`, ale tylko z tabel planu
-- i bez danych prywatnych — filtrowanie jest TU, bo token daje dostęp do RPC także poza stroną.
--
-- Zawsze pomijane: kontakty, budżet, zadania, pakowanie, brief, wydatki, dokumenty, zdarzenia.
-- Zawsze czyszczone: kody rezerwacji, linki i notatki rezerwacji, notatki osób, `created_by`.
-- `hide.costs` — ceny i płatności; `hide.names` — imiona osób; `hide.lodgingAddress` — adresy noclegów.

create function public.create_public_share(p_trip uuid, p_hide jsonb default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  token text := encode(extensions.gen_random_bytes(24), 'base64');
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Publiczny link tworzy tylko właściciel wyjazdu.' using errcode = '42501';
  end if;
  token := translate(token, '+/=', '-_');
  insert into public.public_shares (trip_id, token_hash, hide, enabled)
  values (p_trip, public.token_digest(token), coalesce(p_hide, '{"costs": true, "vault": true, "lodgingAddress": true, "names": false}'::jsonb), true)
  on conflict (trip_id) do update
    set token_hash = excluded.token_hash, hide = excluded.hide, enabled = true, updated_at = now();
  return token;
end $$;

create function public.disable_public_share(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Publiczny link wyłącza tylko właściciel wyjazdu.' using errcode = '42501';
  end if;
  update public.public_shares set enabled = false, updated_at = now() where trip_id = p_trip;
end $$;

create function public.public_trip(p_token text) returns jsonb
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

  -- Osoby: bez notatek, wzrostu i powiązania z kontem; imiona zastąpione przy `hide.names`.
  tables := jsonb_set(tables, '{travelers}', coalesce((
    select jsonb_agg(
      case when coalesce((share.hide ->> 'names')::boolean, false)
        then (p - array['notes', 'height_cm', 'user_id', 'nickname']) || jsonb_build_object('name', 'Osoba ' || ord)
        else p - array['notes', 'height_cm', 'user_id'] end)
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

revoke execute on function public.create_public_share(uuid, jsonb) from anon, public;
revoke execute on function public.disable_public_share(uuid) from anon, public;
grant execute on function public.create_public_share(uuid, jsonb) to authenticated;
grant execute on function public.disable_public_share(uuid) to authenticated;
revoke execute on function public.public_trip(text) from public;
grant execute on function public.public_trip(text) to anon, authenticated;
