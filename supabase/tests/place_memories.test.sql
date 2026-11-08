-- Pamięć miejsc (migracja *_place_memories): wpis widzi uczestnik każdego wyjazdu z tym samym miejscem (nazwa
-- bez wielkości liter i ogonków, współrzędne ≤ 1 km), obcy i uczestnik wyjazdu z dalekim imiennikiem nie;
-- widz też ocenia; jeden wpis na osobę i miejsce; pisze się tylko przez set_place_memory. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'pamiec-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'pamiec-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000e3', 'pamiec-inny@test.local'),
  ('00000000-0000-4000-8000-0000000000e4', 'pamiec-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select is(public.place_key('Żółta  Łąka – Café'), 'zolta laka cafe', 'klucz nazwy jak plainName w core');

-- Wyjazd A (organizator e1, widz e2) i B (organizator e1, edytor e3): to samo Morskie Oko. Wyjazd C (e4): imiennik daleko.
select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000001', 'Pamięć A', '2025-07-01', '2025-07-03', 'Europe/Warsaw', 'PLN'),
  ('1e000000-0000-4000-8000-000000000002', 'Pamięć B', '2027-07-01', '2027-07-03', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1e000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', 'viewer'),
  ('1e000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e3', 'editor');
insert into public.travelers (id, trip_id, name, user_id) values
  ('2e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'Ola', '00000000-0000-4000-8000-0000000000e1');
insert into public.places (id, trip_id, ref, name, lat, lng) values
  ('3e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'oko', 'Morskie Oko', 49.2, 20.07),
  ('3e000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000002', 'oko', 'MORSKIE OKO', 49.2005, 20.0705);

select pg_temp.login('00000000-0000-4000-8000-0000000000e4');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000003', 'Pamięć C', '2025-07-01', '2025-07-03', 'Europe/Warsaw', 'PLN');
insert into public.places (id, trip_id, ref, name, lat, lng) values
  ('3e000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000003', 'oko', 'Morskie Oko', 45.0, 10.0);
select throws_ok($$ select public.set_place_memory('3e000000-0000-4000-8000-000000000001', 'worth', null) $$, '42501', null,
  'obcy nie ocenia miejsca z cudzego wyjazdu');
select throws_ok($$ insert into public.place_memories (user_id, author_name, name, name_key, verdict)
  values ('00000000-0000-4000-8000-0000000000e4', 'X', 'Morskie Oko', 'morskie oko', 'worth') $$, '42501', null,
  'bezpośredni zapis do tabeli zablokowany');
select lives_ok($$ select public.set_place_memory('3e000000-0000-4000-8000-000000000003', 'worth', 'inne Morskie Oko') $$,
  'obcy ocenia imiennika ze swojego wyjazdu');

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
select lives_ok($$ select public.set_place_memory('3e000000-0000-4000-8000-000000000001', 'not_worth', '  tłumy od 8:00  ') $$,
  'organizator ocenia miejsce');
select is((select author_name || '|' || note from public.place_memories where user_id = '00000000-0000-4000-8000-0000000000e1'),
  'Ola|tłumy od 8:00', 'autor to imię z wyjazdu, notatka przycięta');
select lives_ok($$ select public.set_place_memory('3e000000-0000-4000-8000-000000000002', 'worth', null) $$,
  'ocena z drugiego wyjazdu nadpisuje ten sam wpis');
select is((select count(*) || '|' || min(verdict) from public.place_memories where user_id = '00000000-0000-4000-8000-0000000000e1'),
  '1|worth', 'jeden wpis na osobę i miejsce');
select is((select count(*) from public.place_memories), 1::bigint, 'nie widać wpisu o dalekim imienniku');

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
select lives_ok($$ select public.set_place_memory('3e000000-0000-4000-8000-000000000001', 'not_worth', null) $$, 'widz też ocenia');
select is((select count(*) from public.place_memories), 2::bigint, 'widz wyjazdu A widzi oceny tego miejsca');

select pg_temp.login('00000000-0000-4000-8000-0000000000e3');
select is((select count(*) from public.place_memories), 2::bigint, 'edytor tylko wyjazdu B widzi oceny z wyjazdu A (to samo miejsce)');

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
select public.set_place_memory('3e000000-0000-4000-8000-000000000001', null, ' ');
select is((select count(*) from public.place_memories where user_id = '00000000-0000-4000-8000-0000000000e2'), 0::bigint,
  'pusta ocena i notatka usuwa wpis');

select pg_temp.login('00000000-0000-4000-8000-0000000000e4');
select is((select count(*) from public.place_memories), 1::bigint, 'obcy widzi tylko swój wpis');

select * from finish();
rollback;
