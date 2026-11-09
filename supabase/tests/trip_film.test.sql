-- Film z wyjazdu (migracja *_trip_film): zapowiedź i film to osobne scenariusze tego samego wyjazdu, a pod publicznym
-- linkiem każdy ma własną zgodę właściciela. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f1', 'film-owner@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;
create function pg_temp.anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000f1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1f000000-0000-4000-8000-000000000001', 'Film', '2026-01-02', '2026-01-05', 'Europe/Warsaw', 'PLN');
insert into public.trip_shows (trip_id, content) values ('1f000000-0000-4000-8000-000000000001', '{"voice":"Sulafat","scenes":[]}');
select lives_ok($$ insert into public.trip_shows (trip_id, kind, content) values ('1f000000-0000-4000-8000-000000000001', 'film', '{"voice":"Charon","scenes":[]}') $$, 'film obok zapowiedzi');
select throws_ok($$ insert into public.trip_shows (trip_id, kind, content) values ('1f000000-0000-4000-8000-000000000001', 'film', '{}') $$, '23505', null, 'jeden film na wyjazd');
select throws_ok($$ insert into public.trip_shows (trip_id, kind, content) values ('1f000000-0000-4000-8000-000000000001', 'inny', '{}') $$, '23514', null, 'tylko znane rodzaje');
insert into storage.objects (bucket_id, name) values ('show_audio', '1f000000-0000-4000-8000-000000000001/film-abc.wav');

create temp table tok as select public.create_public_share('1f000000-0000-4000-8000-000000000001') as token;
grant select on tok to anon, authenticated;
select is(public.set_public_show('1f000000-0000-4000-8000-000000000001', true, 'film'), true, 'właściciel udostępnia film');

select pg_temp.anon();
select is(public.public_show((select token from tok), 'film') -> 'content' ->> 'voice', 'Charon', 'link daje scenariusz filmu');
select is(public.public_show((select token from tok)), null, 'zapowiedź bez własnej zgody zostaje ukryta');
select is(public.public_show_on((select token from tok), 'film'), true, 'zakładka filmu');
select is(public.public_show_on((select token from tok)), false, 'bez zakładki zapowiedzi');
select is((select count(*) from storage.objects where bucket_id = 'show_audio' and name like '1f000000-%'), 1::bigint, 'nagrania filmu słychać pod linkiem');

select * from finish();
rollback;
