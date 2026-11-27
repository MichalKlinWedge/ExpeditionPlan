-- Integracja z Task Plannerem: `task_exports` (RLS) i webhook TP `taskplanner_webhook` (migracja *_taskplanner_exports).
-- Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'tp-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'tp-stranger@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

-- Podpisy liczone jak w pluginie Webhook TP, zanim zmieni się rola.
create temp table sig (name text primary key, body text, ts text, signature text);
grant select on sig to authenticated;
create function pg_temp.add_sig(p_name text, p_body text, p_ts text, p_secret text) returns void language sql as $$
  insert into sig values (p_name, p_body, p_ts,
    'sha256=' || encode(extensions.hmac(convert_to(p_ts || '.' || p_body, 'UTF8'), convert_to(p_secret, 'UTF8'), 'sha256'), 'hex'))
$$;
select pg_temp.add_sig('done', '{"event":"task.completed","events":["task.completed"],"task":{"id":"7d000000-0000-4000-8000-000000000001","status":"done"}}',
  floor(extract(epoch from now()))::text, 'sekret-testowy');
select pg_temp.add_sig('reopen', '{"event":"task.reopened","events":["task.reopened"],"task":{"id":"7d000000-0000-4000-8000-000000000001","status":"todo"}}',
  floor(extract(epoch from now()))::text, 'sekret-testowy');
select pg_temp.add_sig('deleted', '{"event":"task.deleted","events":["task.deleted"],"task":{"id":"7d000000-0000-4000-8000-000000000001","status":"todo"}}',
  floor(extract(epoch from now()))::text, 'sekret-testowy');
select pg_temp.add_sig('unknown', '{"event":"task.completed","events":["task.completed"],"task":{"id":"7d000000-0000-4000-8000-000000000099","status":"done"}}',
  floor(extract(epoch from now()))::text, 'sekret-testowy');
select pg_temp.add_sig('stale', '{"event":"task.completed","task":{"id":"7d000000-0000-4000-8000-000000000001","status":"done"}}',
  (floor(extract(epoch from now())) - 900)::text, 'sekret-testowy');
select pg_temp.add_sig('wrong', '{"event":"task.completed","task":{"id":"7d000000-0000-4000-8000-000000000001","status":"done"}}',
  floor(extract(epoch from now()))::text, 'inny-sekret');

delete from vault.secrets where name = 'taskplanner_webhook_secret';
select is(public.taskplanner_webhook((select body from sig where name = 'done'), (select ts from sig where name = 'done'), (select signature from sig where name = 'done')),
  'not_configured', 'bez sekretu w Vault webhook nic nie robi');
select vault.create_secret('sekret-testowy', 'taskplanner_webhook_secret');

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1d000000-0000-4000-8000-000000000001', 'Do Task Plannera', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.tasks (id, trip_id, ref, kind, title) values
  ('5d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', 'bilety', 'todo', 'Kupić bilety');

select lives_ok($$ insert into public.task_exports (task_id, trip_id, tp_task_id, tp_url, tp_status) values
  ('5d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', 'https://tp.example/?task=7d', 'todo') $$,
  'organizator zapisuje wysłane zadanie');
select is((select count(*)::int from public.task_exports), 1, 'wysyłający widzi swój wiersz');

select pg_temp.login('00000000-0000-4000-8000-0000000000d2');
select is((select count(*)::int from public.task_exports), 0, 'obcy nie widzi wysłanych zadań');
select throws_ok($$ insert into public.task_exports (task_id, trip_id, tp_task_id) values
  ('5d000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'obcy nie zapisze wysłania cudzego zadania');

-- Webhook woła trasa EP kluczem publicznym; tu obcy zalogowany — prawa do wyjazdu nie są potrzebne.
select ok(has_function_privilege('anon', 'public.taskplanner_webhook(text, text, text)', 'execute'), 'webhook dostępny bez logowania');
select is(public.taskplanner_webhook((select body from sig where name = 'wrong'), (select ts from sig where name = 'wrong'), (select signature from sig where name = 'wrong')),
  'bad_signature', 'zły podpis odrzucony');
select is(public.taskplanner_webhook((select body from sig where name = 'stale'), (select ts from sig where name = 'stale'), (select signature from sig where name = 'stale')),
  'stale', 'stary znacznik czasu odrzucony');
select is(public.taskplanner_webhook((select body from sig where name = 'unknown'), (select ts from sig where name = 'unknown'), (select signature from sig where name = 'unknown')),
  'unknown', 'nieznane zadanie TP pominięte');
select is(public.taskplanner_webhook((select body from sig where name = 'done'), (select ts from sig where name = 'done'), (select signature from sig where name = 'done')),
  'applied', 'ukończenie w TP zamyka zadanie');
select is(public.taskplanner_webhook((select body from sig where name = 'done'), (select ts from sig where name = 'done'), (select signature from sig where name = 'done')),
  'unchanged', 'powtórka nic nie zmienia');
select is(public.taskplanner_webhook((select body from sig where name = 'reopen'), (select ts from sig where name = 'reopen'), (select signature from sig where name = 'reopen')),
  'applied', 'ponowne otwarcie w TP otwiera zadanie');
select is(public.taskplanner_webhook((select body from sig where name = 'deleted'), (select ts from sig where name = 'deleted'), (select signature from sig where name = 'deleted')),
  'unchanged', 'kosz w TP nie zmienia statusu w EP');

select pg_temp.login('00000000-0000-4000-8000-0000000000d1');
select results_eq($$ select t.status, e.tp_status, e.tp_deleted from public.tasks t join public.task_exports e on e.task_id = t.id $$,
  $$ values ('open'::text, 'todo'::text, true) $$, 'stan po zdarzeniach: otwarte w EP, w TP w koszu');

select * from finish();
rollback;
