-- Dziennik wyjazdu: kto dodaje i poprawia wpisy, kto widzi zdjęcia (migracja *_journal).
-- Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'dziennik-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'dziennik-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000b3', 'dziennik-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000b1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1b000000-0000-4000-8000-000000000001', 'Dziennik A', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1b000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b2', 'viewer');
insert into public.journal_entries (id, trip_id, body, taken_at) values
  ('7b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000001', 'Właściciel: dotarliśmy', now());

select pg_temp.login('00000000-0000-4000-8000-0000000000b2');
select lives_ok($$ insert into public.journal_entries (id, trip_id, body, taken_at, photo_path) values
  ('7b000000-0000-4000-8000-000000000002', '1b000000-0000-4000-8000-000000000001', 'Widz: zachód słońca', now(),
   '1b000000-0000-4000-8000-000000000001/7b000000-0000-4000-8000-000000000002/foto.jpg') $$,
  'widz dodaje własny wpis ze zdjęciem');
select throws_ok($$ insert into public.journal_entries (id, trip_id, body, taken_at, photo_path) values
  ('7b000000-0000-4000-8000-000000000003', '1b000000-0000-4000-8000-000000000001', 'zła ścieżka', now(), 'inny-wyjazd/x.jpg') $$,
  '23514', null, 'zdjęcie tylko z katalogu tego wyjazdu');
select is((select count(*) from public.journal_entries), 2::bigint, 'widz widzi wpisy wyjazdu');
update public.journal_entries set body = 'zmienione' where id = '7b000000-0000-4000-8000-000000000001';
select is((select body from public.journal_entries where id = '7b000000-0000-4000-8000-000000000001'), 'Właściciel: dotarliśmy',
  'widz nie poprawia cudzego wpisu');
select lives_ok($$ update public.journal_entries set body = 'Widz: zachód słońca nad morzem' where id = '7b000000-0000-4000-8000-000000000002' $$,
  'widz poprawia swój wpis');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('journal', '1b000000-0000-4000-8000-000000000001/7b000000-0000-4000-8000-000000000002/foto.jpg') $$,
  'widz wgrywa zdjęcie do katalogu wyjazdu');

select pg_temp.login('00000000-0000-4000-8000-0000000000b3');
select is((select count(*) from public.journal_entries), 0::bigint, 'obcy nie widzi wpisów');
select is((select count(*) from storage.objects where bucket_id = 'journal'), 0::bigint, 'obcy nie widzi zdjęć');
select throws_ok($$ insert into public.journal_entries (id, trip_id, body, taken_at) values
  ('7b000000-0000-4000-8000-000000000004', '1b000000-0000-4000-8000-000000000001', 'obcy', now()) $$,
  '42501', null, 'obcy nie dodaje wpisu');

select pg_temp.login('00000000-0000-4000-8000-0000000000b1');
select is((select count(*) from storage.objects where bucket_id = 'journal'), 1::bigint, 'właściciel widzi zdjęcie widza');

select * from finish();
rollback;
