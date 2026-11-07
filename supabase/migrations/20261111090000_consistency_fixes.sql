-- Porządki po przeglądzie spójności.

-- Linki dla człowieka to tylko http(s) (`HttpUrl` w schemacie): stare wpisy z innym schematem
-- zablokowałyby odczyt całego wyjazdu, a do `href` i tak nie powinny trafić.
create function pg_temp.http_links(links jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(l), '[]'::jsonb) from jsonb_array_elements(links) l where l ->> 'url' ~* '^https?://'
$$;
update public.places set website = null where website is not null and website !~* '^https?://';
update public.tracks set url = null where url is not null and url !~* '^https?://';
update public.sources set url = null where url is not null and url !~* '^https?://';
update public.places set links = pg_temp.http_links(links) where jsonb_typeof(links) = 'array' and links <> pg_temp.http_links(links);
update public.items set links = pg_temp.http_links(links) where jsonb_typeof(links) = 'array' and links <> pg_temp.http_links(links);
update public.bookings set links = pg_temp.http_links(links) where jsonb_typeof(links) = 'array' and links <> pg_temp.http_links(links);
update public.items set leg = jsonb_set(leg, '{links}', pg_temp.http_links(leg -> 'links'))
  where jsonb_typeof(leg -> 'links') = 'array' and leg -> 'links' <> pg_temp.http_links(leg -> 'links');
update public.legs set details = jsonb_set(details, '{links}', pg_temp.http_links(details -> 'links'))
  where jsonb_typeof(details -> 'links') = 'array' and details -> 'links' <> pg_temp.http_links(details -> 'links');

-- Tabele dodane po pętli z `mvp1_access`: ta sama druga warstwa co przy pozostałych (bez kasowania, bez anon).
revoke all on public.journal_entries from anon;
revoke delete on public.journal_entries from authenticated;
revoke all on public.packing_carriers from anon;
revoke delete on public.packing_carriers from authenticated;
revoke all on public.guide_library from anon;
revoke delete on public.guide_library from authenticated;

-- Ukryte koszty na publicznym linku: także ceny w polach jsonb (kaucja, cena za kilometr, ceny w knajpie,
-- cena przejazdu w punkcie, tabela porównania wariantów).
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
    tables := jsonb_set(tables, '{bookings}', coalesce((
      select jsonb_agg(b #- '{details,car,deposit}' #- '{details,car,extraKmPrice}') from jsonb_array_elements(tables -> 'bookings') b), '[]'));
    tables := jsonb_set(tables, '{items}', coalesce((
      select jsonb_agg((i - array['price', 'payment']) #- '{leg,price}' #- '{leg,alternative,price}') from jsonb_array_elements(tables -> 'items') i), '[]'));
    tables := jsonb_set(tables, '{legs}', coalesce((
      select jsonb_agg((l - 'price') #- '{details,alternative,price}') from jsonb_array_elements(tables -> 'legs') l), '[]'));
    tables := jsonb_set(tables, '{places}', coalesce((
      select jsonb_agg(p #- '{venue,prices}') from jsonb_array_elements(tables -> 'places') p), '[]'));
    tables := jsonb_set(tables, '{variant_groups}', coalesce((
      select jsonb_agg(g - 'comparison') from jsonb_array_elements(tables -> 'variant_groups') g), '[]'));
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

-- Zaproszenie imienne nie przypina konta do uczestnika usuniętego po wysłaniu zaproszenia.
create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  invite public.trip_invites;
begin
  if auth.uid() is null then
    raise exception 'Zaloguj się, żeby dołączyć' using errcode = '42501';
  end if;
  select * into invite from public.trip_invites
   where token_hash = public.token_digest(p_token)
   for update;
  if not found or invite.revoked_at is not null or invite.expires_at < now() or invite.used_count >= invite.max_uses then
    raise exception 'Zaproszenie jest nieważne' using errcode = 'P0002';
  end if;
  insert into public.trip_members (trip_id, user_id, role, invite_id)
  values (invite.trip_id, auth.uid(), invite.role, invite.id)
  on conflict (trip_id, user_id) do nothing;
  if found then
    update public.trip_invites set used_count = used_count + 1 where id = invite.id;
  end if;
  if invite.traveler_id is not null and not exists (
    select 1 from public.travelers where trip_id = invite.trip_id and user_id = auth.uid() and deleted_at is null
  ) then
    update public.travelers set user_id = auth.uid() where id = invite.traveler_id and user_id is null and deleted_at is null;
  end if;
  return invite.trip_id;
end $$;
