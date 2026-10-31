-- PoC-4: wersjonowanie zmian i RLS (owner / viewer / obcy). Uruchomienie: npm run supabase -- test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'owner@test.local'),
  ('00000000-0000-4000-8000-000000000002', 'viewer@test.local'),
  ('00000000-0000-4000-8000-000000000003', 'obcy@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ── Właściciel tworzy wyjazd ─────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000001');

insert into public.trips (id, title, start_date, end_date, primary_tz)
values ('10000000-0000-4000-8000-000000000001', 'Test', '2026-12-26', '2026-12-31', 'Africa/Casablanca');

select is((select role from public.trip_members where user_id = '00000000-0000-4000-8000-000000000001'),
  'owner', 'twórca wyjazdu zostaje właścicielem');
select is((select sync_version from public.trips), 1::bigint, 'nowy wyjazd ma wersję 1');

insert into public.days (id, trip_id, ref, date, content)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'd1', '2026-12-26',
        '{"tz": "Africa/Casablanca"}');
insert into public.items (id, trip_id, ref, day_id, sort_key, content)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'i1',
        '20000000-0000-4000-8000-000000000001', '0010', '{"kind": "visit", "title": "Bahia"}');

select is((select row_version from public.items), 3::bigint, 'punkt dostaje kolejną wersję wyjazdu');
select is((select plan_version from public.trips), 2::bigint, 'zmiany dnia i punktu podbijają plan_version');

insert into public.expenses (id, trip_id, amount_minor, currency, paid_at)
values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 4500, 'MAD', now());
select is((select (sync_version, plan_version)::text from public.trips), '(4,2)',
  'wydatek podbija sync_version, ale nie plan_version');

update public.items set content = content || '{"durationMin": 90}' where ref = 'i1';
select is((select row_version from public.items), 5::bigint, 'zmiana punktu stempluje go nową wersją');
select is((select row_version from public.trips), 1::bigint,
  'sam licznik nie oznacza wiersza wyjazdu jako zmienionego');

select is(jsonb_array_length(public.pull_changes('10000000-0000-4000-8000-000000000001', 4) -> 'items'), 1,
  'pull_changes po wersji 4 zwraca zmieniony punkt');
select is(jsonb_array_length(public.pull_changes('10000000-0000-4000-8000-000000000001', 5) -> 'expenses'), 0,
  'pull_changes po wersji 5 nie zwraca starego wydatku');
select is(public.pull_changes('10000000-0000-4000-8000-000000000001', 5) -> 'trip', 'null'::jsonb,
  'niezmieniony wyjazd nie wraca w pobraniu przyrostowym');

insert into public.schedule_events (id, trip_id, item_id, kind, minutes, occurred_at)
values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 'delay', 30, now());
update public.schedule_events set minutes = 60;
select is((select minutes from public.schedule_events), 30, 'zdarzeń dnia nie da się zmieniać');
select throws_ok($$delete from public.items$$, '42501', null, 'twarde usuwanie jest zabronione');

insert into public.trip_members (trip_id, user_id, role)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'viewer');

-- ── Widz ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000002');

select is((select count(*) from public.items), 1::bigint, 'widz widzi punkty');
update public.items set content = '{}' where ref = 'i1';
select is((select content ->> 'title' from public.items), 'Bahia', 'widz nie zmieni punktu');
select throws_ok($$insert into public.schedule_events (id, trip_id, kind, minutes, occurred_at)
  values ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'delay', 10, now())$$,
  '42501', null, 'widz nie przesuwa harmonogramu');
select throws_ok($$insert into public.expenses (id, trip_id, amount_minor, currency, paid_at)
  values ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 100, 'MAD', now())$$,
  '42501', null, 'widz bez prawa do wydatków ich nie dodaje');

select pg_temp.login('00000000-0000-4000-8000-000000000001');
update public.trip_members set can_add_expenses = true where user_id = '00000000-0000-4000-8000-000000000002';
select pg_temp.login('00000000-0000-4000-8000-000000000002');

select lives_ok($$insert into public.expenses (id, trip_id, amount_minor, currency, paid_at)
  values ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 100, 'MAD', now())$$,
  'widz z prawem do wydatków dodaje własny');
update public.expenses set amount_minor = 1 where id = '40000000-0000-4000-8000-000000000001';
select is((select amount_minor from public.expenses where id = '40000000-0000-4000-8000-000000000001'), 4500::bigint,
  'widz nie poprawia cudzego wydatku');
select is((select sync_version from public.trips), 7::bigint,
  'wydatek widza podbija licznik wyjazdu mimo braku prawa do jego edycji');

-- ── Obcy ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000003');

select is((select count(*) from public.trips), 0::bigint, 'obcy nie widzi wyjazdu');
select is(public.pull_changes('10000000-0000-4000-8000-000000000001', 0), null::jsonb, 'obcy nic nie pobierze');
select throws_ok($$insert into public.items (id, trip_id, ref, content)
  values ('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'x', '{}')$$,
  '42501', null, 'obcy nie dopisze punktu');

select * from finish();
rollback;
