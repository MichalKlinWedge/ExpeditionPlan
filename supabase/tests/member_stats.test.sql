-- Statystyki dostępu (migracja *_member_stats): tylko organizator, zaproszenie zapisane przy dołączeniu,
-- „ostatnio widziany”, przypisanie konta do uczestnika. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'statystyki-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'statystyki-gosc@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1d000000-0000-4000-8000-000000000001', 'Statystyki', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name) values ('7d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'Gość');
-- Token zaproszenia: create_invite zwraca go tylko raz — tu tworzymy znany token ręcznie.
insert into public.trip_invites (id, trip_id, role, token_hash) values
  ('9d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'viewer', public.token_digest('znany-token'));

select pg_temp.login('00000000-0000-4000-8000-0000000000d2');
select lives_ok($$ select public.accept_invite('znany-token') $$, 'gość dołącza z linku');
select throws_ok($$ select public.trip_member_stats('1d000000-0000-4000-8000-000000000001') $$, '42501', null, 'gość nie widzi statystyk');
select lives_ok($$ select public.touch_trip('1d000000-0000-4000-8000-000000000001', 'phone') $$, 'telefon zapisuje „ostatnio widziany”');
select throws_ok($$ select public.link_traveler_account('1d000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d2') $$,
  '42501', null, 'gość nie przypisuje kont');

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
select is(jsonb_array_length(public.trip_member_stats('1d000000-0000-4000-8000-000000000001')), 2, 'organizator widzi obu członków');
select is((select s ->> 'invite_id' from jsonb_array_elements(public.trip_member_stats('1d000000-0000-4000-8000-000000000001')) s where s ->> 'email' = 'statystyki-gosc@test.local'),
  '9d000000-0000-4000-8000-000000000001', 'zapisane, z którego zaproszenia dołączył');
select ok((select s ->> 'last_seen_phone_at' from jsonb_array_elements(public.trip_member_stats('1d000000-0000-4000-8000-000000000001')) s where s ->> 'email' = 'statystyki-gosc@test.local') is not null,
  'widać, kiedy gość był w aplikacji na telefonie');
select public.link_traveler_account('1d000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d2');
select is((select user_id from public.travelers where id = '7d000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-0000000000d2'::uuid,
  'organizator przypisuje konto do uczestnika');

select * from finish();
rollback;
