-- Wersjonowanie zmian (PoC-4, §6) na schemacie MVP-1. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'owner@test.local'),
  ('00000000-0000-4000-8000-000000000002', 'viewer@test.local'),
  ('00000000-0000-4000-8000-000000000003', 'obcy@test.local');

-- `p_creator`: konto z flagą `trip_creator` w app_metadata (może zakładać wyjazdy).
create function pg_temp.login(p_user uuid, p_creator boolean default false) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', p_creator))::text, true)
$$;

select is((select count(*) from public.profiles where id::text like '00000000-0000-4000-8000-00000000000_'), 3::bigint, 'konto dostaje profil');

-- ── Właściciel tworzy wyjazd ─────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000001', true);

insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency)
values ('10000000-0000-4000-8000-000000000001', 'Test', '2026-12-26', '2026-12-31', 'Africa/Casablanca', 'PLN');

select is((select role from public.trip_members where user_id = '00000000-0000-4000-8000-000000000001'),
  'owner', 'twórca wyjazdu zostaje właścicielem');
select is((select sync_version from public.trips), 1::bigint, 'nowy wyjazd ma wersję 1');

insert into public.days (id, trip_id, ref, date, tz)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'd1', '2026-12-26', 'Africa/Casablanca');
insert into public.items (id, trip_id, ref, day_id, sort_key, kind, title)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'i1',
        '20000000-0000-4000-8000-000000000001', '0010', 'visit', 'Bahia');

select is((select row_version from public.items), 3::bigint, 'punkt dostaje kolejną wersję wyjazdu');
select is((select plan_version from public.trips), 2::bigint, 'zmiany dnia i punktu podbijają plan_version');

insert into public.expenses (id, trip_id, amount_minor, currency, paid_at)
values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 4500, 'MAD', now());
select is((select (sync_version, plan_version)::text from public.trips), '(4,2)',
  'wydatek podbija sync_version, ale nie plan_version');

update public.items set duration_min = 90 where ref = 'i1';
select is((select row_version from public.items), 5::bigint, 'zmiana punktu stempluje go nową wersją');
select is((select row_version from public.trips), 1::bigint,
  'sam licznik nie oznacza wiersza wyjazdu jako zmienionego');
select is((select diff -> 'duration_min' from public.activity_log where entity = 'items' and action = 'update'),
  '[null, 90]'::jsonb, 'historia zmian zapisuje tylko zmienione pole');

select is(jsonb_array_length(public.pull_changes('10000000-0000-4000-8000-000000000001', 4) -> 'tables' -> 'items'), 1,
  'pull_changes po wersji 4 zwraca zmieniony punkt');
select is(jsonb_array_length(public.pull_changes('10000000-0000-4000-8000-000000000001', 5) -> 'tables' -> 'expenses'), 0,
  'pull_changes po wersji 5 nie zwraca starego wydatku');
select is(public.pull_changes('10000000-0000-4000-8000-000000000001', 5) -> 'trip', 'null'::jsonb,
  'niezmieniony wyjazd nie wraca w pobraniu przyrostowym');

insert into public.schedule_events (id, trip_id, item_id, kind, minutes, occurred_at)
values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 'delay', 30, now());
update public.schedule_events set minutes = 60;
select is((select minutes from public.schedule_events), 30, 'zdarzeń dnia nie da się zmieniać');
select throws_ok($$delete from public.items$$, '42501', null, 'twarde usuwanie jest zabronione');

update public.items set deleted_at = now() where ref = 'i1';
select is((select action from public.activity_log where entity = 'items' order by id desc limit 1), 'delete',
  'miękkie usunięcie trafia do historii jako usunięcie');
select is(jsonb_array_length(public.pull_changes('10000000-0000-4000-8000-000000000001', 0) -> 'tables' -> 'items'), 0,
  'pełna migawka pomija usunięte punkty');

insert into public.trip_members (trip_id, user_id, role)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'viewer');
update public.trip_members set can_add_expenses = true where user_id = '00000000-0000-4000-8000-000000000002';

-- ── Widz z prawem do wydatków ────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000002');

select lives_ok($$insert into public.expenses (id, trip_id, amount_minor, currency, paid_at)
  values ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 100, 'MAD', now())$$,
  'widz z prawem do wydatków dodaje własny');
select is((select sync_version from public.trips), 8::bigint,
  'wydatek widza podbija licznik wyjazdu mimo braku prawa do jego edycji');

select * from finish();
rollback;
