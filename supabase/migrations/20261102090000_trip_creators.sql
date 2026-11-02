-- Zakładanie wyjazdów tylko dla kont z flagą `trip_creator` w `app_metadata`. Tę część konta
-- zmienia wyłącznie serwer (klucz service role), więc użytkownik nie nada jej sobie sam.
-- Pozostali (np. konto założone przez Google bez zaproszenia) widzą tylko wyjazdy, do których
-- ich zaproszono — a bez zaproszenia nic. Dotyczy też `import_trip` (SECURITY INVOKER, RLS).

create function public.can_create_trips() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'trip_creator')::boolean, false)
$$;

revoke execute on function public.can_create_trips() from anon, public;
grant execute on function public.can_create_trips() to authenticated;

drop policy trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_trips());

-- Kto już ma swoje wyjazdy, zachowuje prawo zakładania (flaga trafi do tokenu przy jego odświeżeniu).
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"trip_creator": true}'::jsonb
where id in (select owner_id from public.trips);
