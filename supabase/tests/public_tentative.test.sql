-- Publiczny link podaje liczbę osób, które się wahają, a nie to, kto się waha. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'wahajacy-organizator@test.local');
insert into public.trips (id, owner_id, title, start_date, end_date, primary_tz, base_currency) values
  ('1e000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'Wahający się', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name, tentative, deleted_at) values
  ('7e000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'Pewna', null, null),
  ('7e000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001', 'Pewny', false, null),
  ('7e000000-0000-4000-8000-000000000003', '1e000000-0000-4000-8000-000000000001', 'Waha się', true, null),
  ('7e000000-0000-4000-8000-000000000004', '1e000000-0000-4000-8000-000000000001', 'Usunięty', true, now());
insert into public.public_shares (trip_id, token_hash) values
  ('1e000000-0000-4000-8000-000000000001', public.token_digest('token-wahajacy'));

select set_config('role', 'anon', true);
select is((public.public_trip('token-wahajacy') ->> 'tentative')::int, 1, 'liczy tylko żywe osoby, które się wahają');
select is(jsonb_array_length(public.public_trip('token-wahajacy') -> 'tables' -> 'travelers'), 3, 'lista osób bez usuniętych');
select is(
  (select count(*) from jsonb_array_elements(public.public_trip('token-wahajacy') -> 'tables' -> 'travelers') p where p ? 'tentative'),
  0::bigint, 'przy osobie nie ma informacji, że się waha');
reset role;

update public.travelers set tentative = false where id = '7e000000-0000-4000-8000-000000000003';
select is((public.public_trip('token-wahajacy') ->> 'tentative')::int, 0, 'nikt się nie waha: zero');

select * from finish();
rollback;
