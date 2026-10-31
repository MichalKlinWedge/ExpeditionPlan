-- Macierz uprawnień z SPECYFIKACJA §5 („Uprawnienia (RLS)”) i zaproszenia linkiem (MVP-1).
-- Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'owner@test.local'),
  ('00000000-0000-4000-8000-000000000002', 'editor@test.local'),
  ('00000000-0000-4000-8000-000000000003', 'viewer@test.local'),
  ('00000000-0000-4000-8000-000000000004', 'obcy@test.local'),
  ('00000000-0000-4000-8000-000000000005', 'drugi-z-linku@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ── Właściciel: wyjazd, uczestnicy, plan, sejf ───────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000001');

insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency)
values ('10000000-0000-4000-8000-000000000001', 'Maroko', '2026-12-26', '2026-12-31', 'Africa/Casablanca', 'PLN');
insert into public.trip_members (trip_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'editor');

-- Widz jest rodzicem: jego uczestnik i dziecko pod jego opieką.
insert into public.travelers (id, trip_id, ref, name, user_id, guardian_id) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'tata', 'Tata', '00000000-0000-4000-8000-000000000003', null),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'dziecko', 'Dziecko', null, '60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'ciocia', 'Ciocia', null, null);
insert into public.days (id, trip_id, ref, date, tz)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'd1', '2026-12-26', 'Africa/Casablanca');
insert into public.items (id, trip_id, ref, day_id, sort_key, kind, title)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'i1',
        '20000000-0000-4000-8000-000000000001', '0010', 'visit', 'Bahia');
insert into public.documents (id, trip_id, storage_path, file_name, visibility, visible_to) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'x/bilet.pdf', 'bilet.pdf', 'all', '{}'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'x/paszport.pdf', 'paszport.pdf', 'owner', '{}'),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'x/voucher.pdf', 'voucher.pdf', 'members',
   '{00000000-0000-4000-8000-000000000003}');
insert into public.tasks (id, trip_id, ref, kind, title, assignee_ids) values
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 't1', 'todo', 'Wymienić gotówkę',
   '{60000000-0000-4000-8000-000000000001}'),
  ('80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 't2', 'todo', 'Kupić eSIM',
   '{60000000-0000-4000-8000-000000000003}');
insert into public.packing_items (id, trip_id, ref, category, title, scope)
values ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'czolowka', 'sprzęt', 'Czołówka', 'personal');
insert into public.ai_runs (id, trip_id, stage, provider, model)
values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'skeleton', 'CLAUDE', 'claude-haiku-5-5');

select is((select count(*) from public.documents), 3::bigint, 'właściciel widzi wszystkie dokumenty');

-- ── Zaproszenie linkiem ──────────────────────────────────────────────────────────────────────
create temp table invite (token text);
grant all on invite to authenticated;
insert into invite select public.create_invite('10000000-0000-4000-8000-000000000001', 'viewer', 14, 1);
select is((select count(*) from public.trip_invites where token_hash = (select public.token_digest(token) from invite)), 1::bigint,
  'w bazie leży hasz tokena');
select is((select count(*) from public.trip_invites where token_hash = (select token from invite)), 0::bigint,
  'sam token nie jest zapisany');

select pg_temp.login('00000000-0000-4000-8000-000000000002');
select throws_ok($$select public.create_invite('10000000-0000-4000-8000-000000000001', 'editor')$$, '42501', null,
  'edytor nie zaprasza');

select pg_temp.login('00000000-0000-4000-8000-000000000003');
select is(public.accept_invite((select token from invite)), '10000000-0000-4000-8000-000000000001'::uuid,
  'druga osoba dołącza z linku');
select is((select role from public.trip_members where user_id = '00000000-0000-4000-8000-000000000003'), 'viewer',
  'dołącza jako widz');

select pg_temp.login('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.accept_invite((select token from invite))$$, 'P0002', null,
  'jednorazowy link nie wpuści drugiej osoby');
select throws_ok($$select public.accept_invite('zmyslony-token')$$, 'P0002', null, 'zmyślony token nic nie daje');

-- ── Widz ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000003');

select is((select count(*) from public.trips), 1::bigint, 'widz widzi wyjazd');
select is((select count(*) from public.items), 1::bigint, 'widz widzi plan');
update public.items set title = 'Zmienione' where ref = 'i1';
select is((select title from public.items), 'Bahia', 'widz nie zmieni punktu');
update public.trips set title = 'Zmienione';
select is((select title from public.trips), 'Maroko', 'widz nie zmieni wyjazdu');
select throws_ok($$insert into public.items (id, trip_id, ref, kind, title, plan_status)
  values ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'i2', 'visit', 'X', 'candidate')$$,
  '42501', null, 'widz nie doda punktu');
select throws_ok($$insert into public.schedule_events (id, trip_id, kind, minutes, occurred_at)
  values ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'delay', 10, now())$$,
  '42501', null, 'widz nie przesuwa harmonogramu');
select throws_ok($$insert into public.expenses (id, trip_id, amount_minor, currency, paid_at)
  values ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 100, 'MAD', now())$$,
  '42501', null, 'widz bez prawa do wydatków ich nie dodaje');
select is((select count(*) from public.trip_invites), 0::bigint, 'widz nie widzi zaproszeń');
select is((select count(*) from public.ai_runs), 0::bigint, 'widz nie widzi przebiegów AI');
select is((select array_agg(file_name order by file_name) from public.documents), array['bilet.pdf', 'voucher.pdf'],
  'widz widzi dokumenty dla wszystkich i te, na których jest, ale nie dokument właściciela');

update public.tasks set status = 'done' where ref = 't1';
select is((select status from public.tasks where ref = 't1'), 'done', 'widz odhacza zadanie przypisane do siebie');
update public.tasks set status = 'done' where ref = 't2';
select is((select status from public.tasks where ref = 't2'), 'open', 'widz nie odhaczy cudzego zadania');
select throws_ok($$update public.tasks set title = 'Inne' where ref = 't1'$$, '42501', null,
  'widz nie zmienia treści swojego zadania');

select lives_ok($$insert into public.packing_checks (id, trip_id, packing_item_id, traveler_id)
  values ('91000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          '90000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001')$$,
  'widz odhacza własne pakowanie');
select lives_ok($$insert into public.packing_checks (id, trip_id, packing_item_id, traveler_id)
  values ('91000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
          '90000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002')$$,
  'widz odhacza pakowanie swojego dziecka');
select throws_ok($$insert into public.packing_checks (id, trip_id, packing_item_id, traveler_id)
  values ('91000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
          '90000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'widz nie odhacza pakowania innych');

-- ── Edytor ───────────────────────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000002');

update public.items set title = 'Pałac Bahia' where ref = 'i1';
select is((select title from public.items), 'Pałac Bahia', 'edytor zmienia plan');
select is((select count(*) from public.ai_runs), 1::bigint, 'edytor widzi przebiegi AI');
select is((select count(*) from public.documents), 1::bigint,
  'edytor nie widzi dokumentu właściciela ani dokumentu, na którym go nie ma');
update public.trip_members set role = 'owner' where user_id = '00000000-0000-4000-8000-000000000002';
select is((select role from public.trip_members where user_id = '00000000-0000-4000-8000-000000000002'), 'editor',
  'edytor nie zmienia ról');

-- ── Obcy ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000004');

select is((select count(*) from public.trips), 0::bigint, 'obcy nie widzi wyjazdu');
select is((select count(*) from public.travelers), 0::bigint, 'obcy nie widzi uczestników');
select is((select count(*) from public.documents), 0::bigint, 'obcy nie widzi dokumentów');
select is(public.pull_changes('10000000-0000-4000-8000-000000000001', 0), null::jsonb, 'obcy nic nie pobierze');
select throws_ok($$insert into public.items (id, trip_id, ref, kind, title, plan_status)
  values ('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'x', 'visit', 'X', 'candidate')$$,
  '42501', null, 'obcy nie dopisze punktu');

-- ── Wyjście z wyjazdu ────────────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-4000-8000-000000000003');
delete from public.trip_members where user_id = '00000000-0000-4000-8000-000000000003';
select is((select count(*) from public.trips), 0::bigint, 'widz może sam wyjść z wyjazdu');

select * from finish();
rollback;
