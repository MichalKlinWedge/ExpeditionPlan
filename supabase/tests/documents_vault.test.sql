-- Sejf: kto widzi i kto wgrywa pliki w buckecie `documents` (migracja *_documents_vault).
-- Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'sejf-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'sejf-editor@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'sejf-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000a4', 'sejf-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;
create function pg_temp.files() returns setof text language sql as $$
  select name from storage.objects where bucket_id = 'documents' order by name
$$;

-- Dwa wyjazdy właściciela; w pierwszym edytor i widz.
select pg_temp.login('00000000-0000-4000-8000-0000000000a1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1a000000-0000-4000-8000-000000000001', 'Sejf A', '2026-12-26', '2026-12-31', 'Africa/Casablanca', 'PLN'),
  ('1a000000-0000-4000-8000-000000000002', 'Sejf B', '2027-01-10', '2027-01-12', 'Europe/Warsaw', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('1a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'editor'),
  ('1a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'viewer');
insert into public.documents (id, trip_id, storage_path, file_name, visibility, visible_to) values
  ('7a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001/d1/bilet.pdf', 'bilet.pdf', 'all', '{}'),
  ('7a000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001/d2/paszport.jpg', 'paszport.jpg', 'owner', '{}'),
  ('7a000000-0000-4000-8000-000000000003', '1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001/d3/voucher.pdf', 'voucher.pdf', 'members', '{00000000-0000-4000-8000-0000000000a3}'),
  -- Wiersz w A wskazuje plik z B: nie może go otworzyć.
  ('7a000000-0000-4000-8000-000000000004', '1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002/d5/cudzy.pdf', 'cudzy.pdf', 'all', '{}'),
  ('7a000000-0000-4000-8000-000000000005', '1a000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000002/d5/cudzy.pdf', 'cudzy.pdf', 'owner', '{}');

select lives_ok($$ insert into storage.objects (bucket_id, name) values ('documents', '1a000000-0000-4000-8000-000000000001/d1/bilet.pdf') $$,
  'właściciel wgrywa plik do swojego wyjazdu');

-- Pliki wgrane z pominięciem polityk (jak przez serwis), żeby sprawdzić sam odczyt.
reset role;
insert into storage.objects (bucket_id, name) values
  ('documents', '1a000000-0000-4000-8000-000000000001/d2/paszport.jpg'),
  ('documents', '1a000000-0000-4000-8000-000000000001/d3/voucher.pdf'),
  ('documents', '1a000000-0000-4000-8000-000000000001/d9/bez-wiersza.pdf'),
  ('documents', '1a000000-0000-4000-8000-000000000002/d5/cudzy.pdf');

select pg_temp.login('00000000-0000-4000-8000-0000000000a1');
select is((select count(*) from pg_temp.files() f where f like '1a000000-0000-4000-8000-000000000001/%'), 3::bigint,
  'właściciel widzi pliki A z wierszami (bez pliku bez wiersza)');
select is((select count(*) from pg_temp.files() f where f like '1a000000-0000-4000-8000-000000000002/%'), 1::bigint,
  'właściciel B widzi plik B przez wiersz B');

select pg_temp.login('00000000-0000-4000-8000-0000000000a3');
select set_eq('select pg_temp.files()',
  array['1a000000-0000-4000-8000-000000000001/d1/bilet.pdf', '1a000000-0000-4000-8000-000000000001/d3/voucher.pdf'],
  'widz: bilet dla wszystkich i voucher dla niego; bez paszportu właściciela');
select ok(not exists (select 1 from pg_temp.files() f where f like '1a000000-0000-4000-8000-000000000002/%'),
  'wiersz w A wskazujący plik z B nie otwiera go widzowi A');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', '1a000000-0000-4000-8000-000000000001/x/od-widza.pdf') $$,
  '42501', null, 'widz nie wgrywa plików');

select pg_temp.login('00000000-0000-4000-8000-0000000000a2');
select set_eq('select pg_temp.files()', array['1a000000-0000-4000-8000-000000000001/d1/bilet.pdf'],
  'edytor: tylko pliki dla wszystkich (voucher jest dla widza, paszport właściciela)');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('documents', '1a000000-0000-4000-8000-000000000001/d6/od-edytora.pdf') $$,
  'edytor wgrywa do wyjazdu, w którym edytuje');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', '1a000000-0000-4000-8000-000000000002/d7/obcy.pdf') $$,
  '42501', null, 'edytor A nie wgrywa do wyjazdu B');

select pg_temp.login('00000000-0000-4000-8000-0000000000a4');
select is((select count(*) from pg_temp.files()), 0::bigint, 'obcy nie widzi żadnego pliku');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'nie-uuid/plik.pdf') $$,
  '42501', null, 'ścieżka bez wyjazdu — odmowa');

-- Usunięty (miękko) dokument zamyka plik.
select pg_temp.login('00000000-0000-4000-8000-0000000000a1');
update public.documents set deleted_at = now() where id = '7a000000-0000-4000-8000-000000000001';
select pg_temp.login('00000000-0000-4000-8000-0000000000a3');
select set_eq('select pg_temp.files()', array['1a000000-0000-4000-8000-000000000001/d3/voucher.pdf'],
  'po usunięciu dokumentu jego plik znika z widoku');

select * from finish();
rollback;
