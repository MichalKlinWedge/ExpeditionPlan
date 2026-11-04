-- Status „odłożony” (migracja *_trip_postponed): zmienia organizator, widz nie; widoczny w `my_trips`;
-- nieznany status odrzucony. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'odlozony-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'odlozony-widz@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000001', 'Kiedyś', '2027-05-01', '2027-05-05', 'Europe/Warsaw', 'PLN');
reset role;
insert into public.trip_members (trip_id, user_id, role) values
  ('1e000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', 'viewer');

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
update public.trips set status = 'postponed' where id = '1e000000-0000-4000-8000-000000000001';
select is((select status from public.my_trips where id = '1e000000-0000-4000-8000-000000000001'), 'postponed', 'organizator odkłada wyjazd, a my_trips to pokazuje');
select throws_ok($$ update public.trips set status = 'kiedys' where id = '1e000000-0000-4000-8000-000000000001' $$, '23514', null, 'nieznany status odrzucony');

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
update public.trips set status = 'planning' where id = '1e000000-0000-4000-8000-000000000001';
select is((select status from public.my_trips where id = '1e000000-0000-4000-8000-000000000001'), 'postponed', 'widz nie przywróci wyjazdu');

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
update public.trips set status = 'planning' where id = '1e000000-0000-4000-8000-000000000001';
select is((select status from public.my_trips where id = '1e000000-0000-4000-8000-000000000001'), 'planning', 'organizator przywraca wyjazd');

select * from finish();
rollback;
