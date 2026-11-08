-- Głosowanie (migracja *_trip_votes): każdy głosuje za siebie i swoje dziecko, organizator też za osobę bez
-- konta, widz nie głosuje za innych, obcy niczego nie widzi; wariant musi należeć do grupy wyjazdu,
-- a ankietę terminu zmienia tylko organizator lub edytor. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'glos-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'glos-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000d3', 'glos-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1d000000-0000-4000-8000-000000000001', 'Głos A', '2027-01-15', '2027-01-17', 'Europe/Warsaw', 'PLN'),
  ('1d000000-0000-4000-8000-000000000002', 'Głos B', '2027-02-15', '2027-02-17', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1d000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d2', 'viewer');
insert into public.travelers (id, trip_id, name, user_id, guardian_id) values
  ('2d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'Ola', '00000000-0000-4000-8000-0000000000d1', null),
  ('2d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000001', 'Kuba', '00000000-0000-4000-8000-0000000000d2', null),
  ('2d000000-0000-4000-8000-000000000003', '1d000000-0000-4000-8000-000000000001', 'Zosia', null, '2d000000-0000-4000-8000-000000000002'),
  ('2d000000-0000-4000-8000-000000000004', '1d000000-0000-4000-8000-000000000001', 'Babcia', null, null),
  ('2d000000-0000-4000-8000-000000000005', '1d000000-0000-4000-8000-000000000002', 'Obca osoba', null, null);
insert into public.variant_groups (id, trip_id, scope, title, condition_kind) values
  ('3d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'trip', 'Gdzie śpimy', 'choice'),
  ('3d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000002', 'trip', 'Obce', 'choice');
insert into public.variants (id, trip_id, group_id, label) values
  ('4d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001', 'A'),
  ('4d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001', 'B'),
  ('4d000000-0000-4000-8000-000000000003', '1d000000-0000-4000-8000-000000000002', '3d000000-0000-4000-8000-000000000002', 'X');

select lives_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, variant_group_id, variant_id) values
  ('5d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000004',
   '3d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001') $$, 'organizator wpisuje głos osoby bez konta');
select throws_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, variant_group_id, variant_id) values
  ('5d000000-0000-4000-8000-000000000002', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000003') $$, '23514', null, 'wariant z innej grupy odrzucony');
select throws_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, variant_group_id) values
  ('5d000000-0000-4000-8000-000000000003', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000005',
   '3d000000-0000-4000-8000-000000000001') $$, '23514', null, 'osoba z innego wyjazdu odrzucona');
select throws_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, variant_group_id, day, answer) values
  ('5d000000-0000-4000-8000-000000000004', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001',
   '3d000000-0000-4000-8000-000000000001', '2027-01-15', 'yes') $$, '23514', null, 'wiersz jest głosem na wariant albo na dzień, nie oba');
select lives_ok($$ update public.trips set date_poll = '{"from":"2027-01-01","to":"2027-02-28"}' where id = '1d000000-0000-4000-8000-000000000001' $$,
  'organizator zakłada ankietę terminu');

select pg_temp.login('00000000-0000-4000-8000-0000000000d2');
select lives_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, variant_group_id, variant_id) values
  ('5d000000-0000-4000-8000-000000000005', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000002',
   '3d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000002') $$, 'widz głosuje za siebie');
select lives_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, day, answer) values
  ('5d000000-0000-4000-8000-000000000006', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000003', '2027-01-20', 'maybe') $$,
  'widz podaje dostępność swojego dziecka');
select throws_ok($$ insert into public.trip_votes (id, trip_id, traveler_id, day, answer) values
  ('5d000000-0000-4000-8000-000000000007', '1d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', '2027-01-20', 'no') $$,
  '42501', null, 'widz nie głosuje za organizatora');
update public.trip_votes set variant_id = '4d000000-0000-4000-8000-000000000002' where id = '5d000000-0000-4000-8000-000000000001';
select is((select count(*) from public.trip_votes), 3::bigint, 'widz widzi wszystkie głosy wyjazdu');
update public.trips set date_poll = null where id = '1d000000-0000-4000-8000-000000000001';

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
select is((select variant_id from public.trip_votes where id = '5d000000-0000-4000-8000-000000000001'), '4d000000-0000-4000-8000-000000000001'::uuid,
  'widz nie zmienia cudzego głosu');
select is((select date_poll ->> 'to' from public.trips where id = '1d000000-0000-4000-8000-000000000001'), '2027-02-28', 'widz nie zmienia ankiety terminu');

select pg_temp.login('00000000-0000-4000-8000-0000000000d3');
select is((select count(*) from public.trip_votes), 0::bigint, 'obcy nie widzi głosów');

select * from finish();
rollback;
