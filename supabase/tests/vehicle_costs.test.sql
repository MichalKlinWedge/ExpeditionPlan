-- Podział na auta (migracja *_vehicle_costs): auta zapisują organizator i edytor, pozycja budżetu i wydatek
-- mogą wskazać auto, a klucz do auta jest odroczalny (import wstawia budżet przed autami). Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'auta-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'auta-viewer@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1d000000-0000-4000-8000-000000000001', 'Auta A', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1d000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d2', 'viewer');
insert into public.travelers (id, trip_id, name) values
  ('1d000000-0000-4000-8000-0000000000a1', '1d000000-0000-4000-8000-000000000001', 'Kierowca'),
  ('1d000000-0000-4000-8000-0000000000a2', '1d000000-0000-4000-8000-000000000001', 'Pasażer');

select lives_ok($$
  set constraints all deferred;
  insert into public.budget_lines (id, trip_id, category, title, status, low_minor, high_minor, currency, vehicle_id) values
    ('1d000000-0000-4000-8000-0000000000b1', '1d000000-0000-4000-8000-000000000001', 'transport', 'Paliwo', 'estimate', 40000, 50000, 'PLN',
     '1d000000-0000-4000-8000-0000000000c1');
  insert into public.vehicles (id, trip_id, label, driver_traveler_id, seats, passenger_ids) values
    ('1d000000-0000-4000-8000-0000000000c1', '1d000000-0000-4000-8000-000000000001', 'Skoda', '1d000000-0000-4000-8000-0000000000a1', 5,
     array['1d000000-0000-4000-8000-0000000000a2']::uuid[]);
  set constraints all immediate;
$$, 'organizator zapisuje auto i pozycję budżetu auta (klucz odroczony)');
select lives_ok($$ insert into public.expenses (id, trip_id, payer_traveler_id, amount_minor, currency, paid_at, category, vehicle_id) values
  ('1d000000-0000-4000-8000-0000000000e1', '1d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-0000000000a1', 30000, 'PLN', now(), 'transport',
   '1d000000-0000-4000-8000-0000000000c1') $$, 'wydatek wskazuje auto');
select throws_ok($$ update public.expenses set vehicle_id = '1d000000-0000-4000-8000-0000000000ff' $$, '23503', null, 'auto musi istnieć');

select pg_temp.login('00000000-0000-4000-8000-0000000000d2');
select is((select passenger_ids from public.vehicles), array['1d000000-0000-4000-8000-0000000000a2']::uuid[], 'widz widzi, kto z kim jedzie');
update public.vehicles set seats = 2;
update public.expenses set vehicle_id = null;

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
select is((select seats from public.vehicles), 5, 'widz nie zmienia auta');
select isnt((select vehicle_id from public.expenses), null, 'widz nie zmienia wydatku auta');

select * from finish();
rollback;
