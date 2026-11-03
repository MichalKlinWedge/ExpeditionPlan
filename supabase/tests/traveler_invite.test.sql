-- Zaproszenie dla uczestnika (migracja *_traveler_invite): jednorazowe, po dołączeniu konto
-- przypisane do uczestnika; obcy uczestnik odrzucony. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'zapro-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000f2', 'zapro-gosc@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1f000000-0000-4000-8000-000000000001', 'Zaproszenia', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN'),
  ('1f000000-0000-4000-8000-000000000002', 'Inny', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name) values
  ('7f000000-0000-4000-8000-000000000001', '1f000000-0000-4000-8000-000000000001', 'Ola'),
  ('7f000000-0000-4000-8000-000000000002', '1f000000-0000-4000-8000-000000000002', 'Z innego wyjazdu');

select throws_ok($$ select public.create_invite('1f000000-0000-4000-8000-000000000001', 'viewer', 14, 1, '7f000000-0000-4000-8000-000000000002') $$,
  'P0002', null, 'uczestnik z innego wyjazdu odrzucony');
create temp table invite_token on commit drop as
  select public.create_invite('1f000000-0000-4000-8000-000000000001', 'viewer', 14, 5, '7f000000-0000-4000-8000-000000000001') as token;
grant select on invite_token to authenticated;
select is((select max_uses from public.trip_invites where traveler_id = '7f000000-0000-4000-8000-000000000001'), 1, 'link dla uczestnika jest jednorazowy');

select pg_temp.login('00000000-0000-4000-8000-0000000000f2');
select lives_ok($$ select public.accept_invite((select token from invite_token)) $$, 'gość dołącza');
select is((select user_id from public.travelers where id = '7f000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-0000000000f2'::uuid,
  'konto gościa przypisane do uczestnika „Ola”');
select is((select invite_id is not null from public.trip_members where user_id = '00000000-0000-4000-8000-0000000000f2'), true, 'zapisane, z którego zaproszenia');

select * from finish();
rollback;
