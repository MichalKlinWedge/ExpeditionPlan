-- Pokaz pod publicznym linkiem (migracja *_public_show): bez zgody właściciela anon nie dostaje scenariusza ani nagrań,
-- po zgodzie dostaje; zgodę daje tylko właściciel, a wyłączony link odcina wszystko. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'pokaz-pub-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'pokaz-pub-editor@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;
create function pg_temp.anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000001', 'Pokaz publiczny', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1e000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', 'editor');
insert into public.trip_shows (trip_id, content) values ('1e000000-0000-4000-8000-000000000001', '{"voice":"Sulafat","scenes":[]}');
insert into storage.objects (bucket_id, name) values ('show_audio', '1e000000-0000-4000-8000-000000000001/abc.wav');

select is(public.set_public_show('1e000000-0000-4000-8000-000000000001', true), false, 'bez linku nie ma czego włączyć');
create temp table tok as select public.create_public_share('1e000000-0000-4000-8000-000000000001') as token;
grant select on tok to anon, authenticated;

select pg_temp.anon();
select is(public.public_show((select token from tok)), null, 'bez zgody link nie daje pokazu');
select is(public.public_show_on((select token from tok)), false, 'bez zgody nie ma zakładki');
select is((select count(*) from storage.objects where bucket_id = 'show_audio'), 0::bigint, 'bez zgody anon nie słyszy nagrań');

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
select throws_ok($$ select public.set_public_show('1e000000-0000-4000-8000-000000000001', true) $$, '42501', null, 'edytor nie udostępnia pokazu');

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
select is(public.set_public_show('1e000000-0000-4000-8000-000000000001', true), true, 'właściciel udostępnia pokaz');

select pg_temp.anon();
select is(public.public_show((select token from tok)) -> 'content' ->> 'voice', 'Sulafat', 'po zgodzie link daje scenariusz');
select is(public.public_show_on((select token from tok)), true, 'po zgodzie jest zakładka');
select is((select count(*) from storage.objects where bucket_id = 'show_audio'), 1::bigint, 'po zgodzie anon słyszy nagranie');

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
select public.disable_public_share('1e000000-0000-4000-8000-000000000001');

select pg_temp.anon();
select is(public.public_show((select token from tok)), null, 'wyłączony link nie daje pokazu');
select is((select count(*) from storage.objects where bucket_id = 'show_audio'), 0::bigint, 'wyłączony link odcina nagrania');

select * from finish();
rollback;
