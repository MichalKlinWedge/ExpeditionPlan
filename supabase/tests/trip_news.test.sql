-- „Co nowego” (migracja *_trip_news): tylko cudze zmiany od dołączenia / poprzedniej wizyty,
-- „Przejrzane” zeruje listę, obcy nic nie widzi. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'nowosci-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'nowosci-gosc@test.local'),
  ('00000000-0000-4000-8000-0000000000e3', 'nowosci-obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000001', 'Nowości', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.trip_invites (id, trip_id, role, token_hash) values
  ('9e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'editor', public.token_digest('token-nowosci'));
insert into public.travelers (id, trip_id, name) values ('7e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'Przed dołączeniem');

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
select public.accept_invite('token-nowosci');
-- Dołączenie „godzinę temu” — w transakcji now() stoi, więc daty przesuwamy ręcznie (jako postgres).
reset role;
update public.trip_members set created_at = now() - interval '2 hours' where user_id = '00000000-0000-4000-8000-0000000000e2';
update public.activity_log set created_at = now() - interval '3 hours' where trip_id = '1e000000-0000-4000-8000-000000000001';

select pg_temp.login('00000000-0000-4000-8000-0000000000e1');
insert into public.travelers (id, trip_id, name) values ('7e000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001', 'Nowy');

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
insert into public.travelers (id, trip_id, name) values ('7e000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001', 'Mój');
select is(jsonb_array_length(public.trip_news('1e000000-0000-4000-8000-000000000001') -> 'entries'), 1, 'gość widzi jedną cudzą zmianę po dołączeniu (bez własnej i wcześniejszych)');
select is(public.trip_news('1e000000-0000-4000-8000-000000000001') -> 'entries' -> 0 ->> 'entity_id', '7e000000-0000-4000-8000-000000000002', 'to dodanie „Nowy”');

select public.mark_changes_seen('1e000000-0000-4000-8000-000000000001');
reset role;
update public.trip_members set seen_changes_at = now() - interval '90 minutes', last_seen_web_at = now() - interval '80 minutes'
 where user_id = '00000000-0000-4000-8000-0000000000e2';
update public.activity_log set created_at = now() - interval '85 minutes' where entity_id = '7e000000-0000-4000-8000-000000000002';

select pg_temp.login('00000000-0000-4000-8000-0000000000e2');
select is(jsonb_array_length(public.trip_news('1e000000-0000-4000-8000-000000000001') -> 'entries'), 1, 'przed nową wizytą zmiana sprzed końca poprzedniej jeszcze jest');
select public.touch_trip('1e000000-0000-4000-8000-000000000001', 'web');
select is(jsonb_array_length(public.trip_news('1e000000-0000-4000-8000-000000000001') -> 'entries'), 0, 'nowa wizyta: nowe tylko od końca poprzedniej');

select public.mark_changes_seen('1e000000-0000-4000-8000-000000000001');
select is((select seen_changes_at from public.trip_members where user_id = '00000000-0000-4000-8000-0000000000e2'), now(), '„Przejrzane” ustawia teraz');

select pg_temp.login('00000000-0000-4000-8000-0000000000e3');
select is(public.trip_news('1e000000-0000-4000-8000-000000000001'), null, 'obcy nie dostaje nic');
select lives_ok($$ select public.mark_changes_seen('1e000000-0000-4000-8000-000000000001') $$, 'u obcego „Przejrzane” nic nie robi');

select * from finish();
rollback;
