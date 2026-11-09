-- Pokaz z lektorem (migracja *_trip_shows): scenariusz i nagrania widzą uczestnicy, zapisują organizator i edytor,
-- obcy nie widzi niczego. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'pokaz-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000c2', 'pokaz-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'pokaz-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000c1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1c000000-0000-4000-8000-000000000001', 'Pokaz A', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1c000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', 'viewer');
select lives_ok($$ insert into public.trip_shows (trip_id, content) values
  ('1c000000-0000-4000-8000-000000000001', '{"voice":"Sulafat","scenes":[]}') $$, 'organizator zapisuje scenariusz');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('show_audio', '1c000000-0000-4000-8000-000000000001/abc.wav') $$, 'organizator wgrywa nagranie');

select pg_temp.login('00000000-0000-4000-8000-0000000000c2');
select is((select content ->> 'voice' from public.trip_shows), 'Sulafat', 'widz widzi scenariusz');
select is((select count(*) from storage.objects where bucket_id = 'show_audio' and name like '1c000000-%'), 1::bigint, 'widz słyszy nagranie');
update public.trip_shows set content = '{"voice":"Charon"}';
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('show_audio', '1c000000-0000-4000-8000-000000000001/zly.wav') $$, '42501', null, 'widz nie wgrywa nagrania');

select pg_temp.login('00000000-0000-4000-8000-0000000000c1');
select is((select content ->> 'voice' from public.trip_shows), 'Sulafat', 'widz nie zmienia scenariusza');

select pg_temp.login('00000000-0000-4000-8000-0000000000c3');
select is((select count(*) from public.trip_shows), 0::bigint, 'obcy nie widzi scenariusza');
select is((select count(*) from storage.objects where bucket_id = 'show_audio' and name like '1c000000-%'), 0::bigint, 'obcy nie słyszy nagrań');
select throws_ok($$ insert into public.trip_shows (trip_id) values ('1c000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'obcy nie zakłada scenariusza');

select * from finish();
rollback;
