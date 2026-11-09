-- Znane konta (migracja *_known_accounts): organizator widzi tylko osoby ze swoich wyjazdów i dodaje
-- je do kolejnego bez linku; obcy i edytor nie. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'znane-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'znane-ania@test.local'),
  ('00000000-0000-4000-8000-0000000000e3', 'znane-obcy@test.local'),
  ('00000000-0000-4000-8000-0000000000e4', 'znane-cudzy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

-- Stary wyjazd organizatora z Anią; nowy wyjazd bez niej; wyjazd obcego z kimś, kogo organizator nie zna.
select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000001', 'Stary', '2025-07-01', '2025-07-10', 'Europe/Warsaw', 'PLN'),
  ('1e000000-0000-4000-8000-000000000002', 'Nowy', '2027-07-01', '2027-07-10', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name) values ('7e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000002', 'Ania');
reset role;
insert into public.trip_members (trip_id, user_id, role) values ('1e000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', 'viewer');

select pg_temp.login('00000000-0000-4000-8000-0000000000e3');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000003', 'Obcy', '2026-07-01', '2026-07-10', 'Europe/Warsaw', 'PLN');
reset role;
insert into public.trip_members (trip_id, user_id, role) values ('1e000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000e4', 'viewer');

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
select is((select jsonb_agg(a ->> 'email') from jsonb_array_elements(public.known_accounts('1e000000-0000-4000-8000-000000000002')) a),
  '["znane-ania@test.local"]'::jsonb, 'organizator widzi tylko osoby ze swoich wyjazdów, bez siebie');
select is((select (a ->> 'last_trip') from jsonb_array_elements(public.known_accounts('1e000000-0000-4000-8000-000000000002')) a), 'Stary', 'przy koncie ostatni wspólny wyjazd');
select throws_ok($$ select public.add_known_member('1e000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e4', 'viewer') $$,
  'P0002', null, 'konta spoza moich wyjazdów nie dodam');
select throws_ok($$ select public.add_known_member('1e000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e2', 'owner') $$,
  '22023', null, 'rola tylko edytor albo widz');
select is(public.add_known_member('1e000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e2', 'editor', '7e000000-0000-4000-8000-000000000001'),
  'znane-ania@test.local', 'dodanie zwraca e-mail do wiadomości o dostępie');
select is((select role from public.trip_members where trip_id = '1e000000-0000-4000-8000-000000000002' and user_id = '00000000-0000-4000-8000-0000000000e2'), 'editor', 'Ania jest edytorem nowego wyjazdu');
select is((select user_id from public.travelers where id = '7e000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-0000000000e2'::uuid, 'i jest przypisana do uczestnika');
select is(jsonb_array_length(public.known_accounts('1e000000-0000-4000-8000-000000000002')), 0, 'dodane konto znika z listy znanych');
select throws_ok($$ select public.add_known_member('1e000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e2', 'viewer') $$,
  '23505', null, 'drugi raz nie dodam');

-- Ania (edytor) nie widzi kont organizatora ani nikogo nie dodaje.
select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
select throws_ok($$ select public.known_accounts('1e000000-0000-4000-8000-000000000002') $$, '42501', null, 'edytor nie widzi znanych kont');
select throws_ok($$ select public.add_known_member('1e000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e1', 'viewer') $$,
  '42501', null, 'edytor nikogo nie dodaje');

select * from finish();
rollback;
