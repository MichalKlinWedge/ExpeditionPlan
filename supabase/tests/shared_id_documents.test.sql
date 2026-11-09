-- Ważność paszportu i dowodu idzie za kontem (migracja *_shared_id_documents): wpisana data uzupełnia
-- puste pola tej osoby w innych wyjazdach, nie nadpisuje wpisanych; świeżo połączony uczestnik dostaje
-- brakujące daty. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'dok-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000f2', 'dok-ania@test.local'),
  ('00000000-0000-4000-8000-0000000000f3', 'dok-inny-owner@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

-- Ania jest w trzech wyjazdach: A i B organizatora, C innego organizatora (tam ma już swój dowód).
select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1f000000-0000-4000-8000-00000000000a', 'A', '2027-01-01', '2027-01-05', 'Europe/Warsaw', 'PLN'),
  ('1f000000-0000-4000-8000-00000000000b', 'B', '2027-02-01', '2027-02-05', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name) values
  ('7f000000-0000-4000-8000-00000000000a', '1f000000-0000-4000-8000-00000000000a', 'Ania'),
  ('7f000000-0000-4000-8000-00000000000b', '1f000000-0000-4000-8000-00000000000b', 'Ania');
select pg_temp.login('00000000-0000-4000-8000-0000000000f3');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1f000000-0000-4000-8000-00000000000c', 'C', '2027-03-01', '2027-03-05', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name, id_card_until) values
  ('7f000000-0000-4000-8000-00000000000c', '1f000000-0000-4000-8000-00000000000c', 'Ania', '2031-05-05');
reset role;
insert into public.trip_members (trip_id, user_id, role) values
  ('1f000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000f2', 'viewer'),
  ('1f000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000f2', 'viewer');
update public.travelers set user_id = '00000000-0000-4000-8000-0000000000f2'
 where id in ('7f000000-0000-4000-8000-00000000000a', '7f000000-0000-4000-8000-00000000000c');

select is((select id_card_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000a'), '2031-05-05'::date,
  'połączenie z kontem bierze brakujący dowód z innego wyjazdu');

-- Organizator A wpisuje paszport i dowód: C ma już swój dowód, więc tylko paszport się tam pojawia.
select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
update public.travelers set passport_until = '2030-01-10', id_card_until = '2032-02-02' where id = '7f000000-0000-4000-8000-00000000000a';
reset role;
select is((select passport_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000c'), '2030-01-10'::date,
  'paszport trafia do pustego pola w wyjeździe innego organizatora');
select is((select id_card_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000c'), '2031-05-05'::date,
  'wpisany dowód w innym wyjeździe zostaje');
select is((select passport_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000b'), null::date,
  'uczestnik bez konta (to samo imię) niczego nie dostaje');

-- B łączy Anię z kontem później: dostaje paszport z A i dowód (najświeższy) z A.
update public.travelers set user_id = '00000000-0000-4000-8000-0000000000f2' where id = '7f000000-0000-4000-8000-00000000000b';
select is((select passport_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000b'), '2030-01-10'::date, 'nowo połączony dostaje paszport');
select ok((select id_card_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000b') is not null, 'i dowód');

-- Zmiana daty w jednym wyjeździe nie nadpisuje już wpisanych w innych.
update public.travelers set passport_until = '2035-12-31' where id = '7f000000-0000-4000-8000-00000000000c';
select is((select passport_until from public.travelers where id = '7f000000-0000-4000-8000-00000000000a'), '2030-01-10'::date, 'wpisanego paszportu nie nadpisuje');

select * from finish();
rollback;
