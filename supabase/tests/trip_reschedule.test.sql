-- Zmiana terminu (migracja *_trip_reschedule): organizator i edytor mogą, widz i obcy nie; nieaktualna
-- migawka i inna długość odrzucone bez zmian; cudzy wiersz nietknięty; przywrócenie z „Odłożonych”.
-- Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'termin-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000f2', 'termin-edytor@test.local'),
  ('00000000-0000-4000-8000-0000000000f3', 'termin-widz@test.local'),
  ('00000000-0000-4000-8000-0000000000f4', 'termin-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

-- Wywołanie z aktualną wersją wyjazdu; `sync_version` czyta się z tabeli jako superuser.
create function pg_temp.version(p_trip uuid) returns bigint language sql security definer as $$
  select sync_version from public.trips where id = p_trip
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency, status) values
  ('1f000000-0000-4000-8000-000000000001', 'Do przesunięcia', '2027-05-01', '2027-05-02', 'Europe/Warsaw', 'PLN', 'postponed'),
  ('1f000000-0000-4000-8000-000000000002', 'Inny wyjazd', '2027-05-01', '2027-05-02', 'Europe/Warsaw', 'PLN', 'planning');
insert into public.days (id, trip_id, date, tz) values
  ('1f000000-0000-4000-8000-0000000000d1', '1f000000-0000-4000-8000-000000000001', '2027-05-01', 'Europe/Warsaw'),
  ('1f000000-0000-4000-8000-0000000000d2', '1f000000-0000-4000-8000-000000000001', '2027-05-02', 'Europe/Warsaw'),
  ('1f000000-0000-4000-8000-0000000000d3', '1f000000-0000-4000-8000-000000000002', '2027-05-01', 'Europe/Warsaw');
insert into public.bookings (id, trip_id, kind, status, title, start_date, free_cancellation_until) values
  ('1f000000-0000-4000-8000-0000000000b1', '1f000000-0000-4000-8000-000000000001', 'lodging', 'candidate', 'Oferta', '2027-05-01', '2027-04-20');
insert into public.tasks (id, trip_id, kind, title, due) values
  ('1f000000-0000-4000-8000-0000000000a1', '1f000000-0000-4000-8000-000000000001', 'todo', 'Zadanie', '{"kind": "absolute", "date": "2027-04-01"}');
insert into public.variant_groups (id, trip_id, scope, title, condition_kind, decide_by) values
  ('1f000000-0000-4000-8000-0000000000c1', '1f000000-0000-4000-8000-000000000001', 'trip', 'Wybór', 'choice', '{"local": "2027-04-20T18:00", "tz": "Europe/Warsaw"}');
insert into public.trip_brief (id, trip_id, brief) values
  ('1f000000-0000-4000-8000-0000000000e1', '1f000000-0000-4000-8000-000000000001', '{"dates": {"kind": "fixed", "start": "2027-05-01", "end": "2027-05-02"}}');
reset role;
insert into public.trip_members (trip_id, user_id, role) values
  ('1f000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f2', 'editor'),
  ('1f000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f3', 'viewer');

create function pg_temp.call(p_start date, p_end date, p_restore boolean default false, p_version bigint default null) returns void language sql as $$
  select public.reschedule_trip('1f000000-0000-4000-8000-000000000001', coalesce(p_version, pg_temp.version('1f000000-0000-4000-8000-000000000001')), p_start, p_end, jsonb_build_object(
    'days', jsonb_build_array(
      jsonb_build_object('id', '1f000000-0000-4000-8000-0000000000d1', 'date', p_start),
      jsonb_build_object('id', '1f000000-0000-4000-8000-0000000000d2', 'date', p_end)),
    'bookings', jsonb_build_array(jsonb_build_object('id', '1f000000-0000-4000-8000-0000000000b1', 'start_date', p_start, 'end_date', null, 'free_cancellation_until', p_start - 11)),
    'tasks', jsonb_build_array(jsonb_build_object('id', '1f000000-0000-4000-8000-0000000000a1', 'due', jsonb_build_object('kind', 'absolute', 'date', p_start - 30))),
    'variant_groups', jsonb_build_array(jsonb_build_object('id', '1f000000-0000-4000-8000-0000000000c1', 'decide_by', jsonb_build_object('local', (p_start - 11)::text || 'T18:00', 'tz', 'Europe/Warsaw'))),
    'trip_brief', jsonb_build_array(jsonb_build_object('id', '1f000000-0000-4000-8000-0000000000e1', 'brief', jsonb_build_object('dates', jsonb_build_object('kind', 'fixed', 'start', p_start, 'end', p_end))))
  ), p_restore)
$$;

-- Widz i obcy
select pg_temp.login('00000000-0000-4000-8000-0000000000f3');
select throws_ok($$ select pg_temp.call('2027-06-01', '2027-06-02') $$, '42501', null, 'widz nie zmieni terminu');
select pg_temp.login('00000000-0000-4000-8000-0000000000f4');
select throws_ok($$ select pg_temp.call('2027-06-01', '2027-06-02') $$, '42501', null, 'obcy nie zmieni terminu');

-- Odrzucone zapisy nic nie zmieniają
select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
select throws_ok($$ select pg_temp.call('2027-06-01', '2027-06-05') $$, '22023', null, 'inna długość wyjazdu odrzucona');
select throws_ok($$ select pg_temp.call('2027-06-01', '2027-06-02', false, 1) $$, 'EP001', null, 'nieaktualna migawka odrzucona');
select is((select start_date from public.trips where id = '1f000000-0000-4000-8000-000000000001'), '2027-05-01'::date, 'po odrzuceniu termin bez zmian');

-- Organizator: wszystkie tabele w jednym wywołaniu, status zostaje
select set_config('test.before', pg_temp.version('1f000000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$ select pg_temp.call('2027-06-01', '2027-06-02') $$, 'organizator zmienia termin');
select is((select (start_date, end_date)::text from public.trips where id = '1f000000-0000-4000-8000-000000000001'), '(2027-06-01,2027-06-02)', 'wyjazd ma nowy termin');
select is((select array_agg(date order by date) from public.days where trip_id = '1f000000-0000-4000-8000-000000000001'), array['2027-06-01', '2027-06-02']::date[], 'dni przesunięte');
select is((select (start_date, free_cancellation_until)::text from public.bookings where id = '1f000000-0000-4000-8000-0000000000b1'), '(2027-06-01,2027-05-21)', 'rezerwacja przesunięta');
select is((select due ->> 'date' from public.tasks where id = '1f000000-0000-4000-8000-0000000000a1'), '2027-05-02', 'termin zadania przesunięty');
select is((select decide_by ->> 'local' from public.variant_groups where id = '1f000000-0000-4000-8000-0000000000c1'), '2027-05-21T18:00', 'termin decyzji przesunięty');
select is((select brief #>> '{dates,start}' from public.trip_brief where id = '1f000000-0000-4000-8000-0000000000e1'), '2027-06-01', 'brief przesunięty');
select is((select status from public.my_trips where id = '1f000000-0000-4000-8000-000000000001'), 'postponed', 'bez p_restore status zostaje');
select ok((select row_version from public.days where id = '1f000000-0000-4000-8000-0000000000d1') > current_setting('test.before')::bigint,
  'zmiana podbija wersję wiersza, więc telefon ją pobierze');

-- Edytor z przywróceniem
select pg_temp.login('00000000-0000-4000-8000-0000000000f2');
select lives_ok($$ select pg_temp.call('2027-07-01', '2027-07-02', true) $$, 'edytor zmienia termin i przywraca');
select is((select status from public.my_trips where id = '1f000000-0000-4000-8000-000000000001'), 'planning', 'p_restore wraca do planów');
select is((select start_date from public.trips where id = '1f000000-0000-4000-8000-000000000001'), '2027-07-01'::date, 'edytor ustawił termin');

-- Wiersz innego wyjazdu w `p_changes` nie zostaje ruszony
select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
select public.reschedule_trip('1f000000-0000-4000-8000-000000000001', pg_temp.version('1f000000-0000-4000-8000-000000000001'), '2027-08-01', '2027-08-02',
  '{"days": [{"id": "1f000000-0000-4000-8000-0000000000d3", "date": "2027-08-01"}]}');
select is((select date from public.days where id = '1f000000-0000-4000-8000-0000000000d3'), '2027-05-01'::date, 'dzień innego wyjazdu bez zmian');

-- Anonim nie ma funkcji
reset role;
set local role anon;
select throws_ok($$ select public.reschedule_trip('1f000000-0000-4000-8000-000000000001', 1, '2027-06-01', '2027-06-02', '{}') $$, '42501', null, 'anon bez dostępu');
reset role;

select * from finish();
rollback;
