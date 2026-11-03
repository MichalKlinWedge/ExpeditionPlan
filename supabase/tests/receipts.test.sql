-- Zdjęcie paragonu przy wydatku: ścieżka tylko w katalogu wyjazdu, plik w buckecie `journal` (migracja *_expense_receipt).
-- Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'paragon-owner@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', true))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000c1');
insert into public.trips (id, title, start_date, end_date, primary_tz, base_currency) values
  ('1c000000-0000-4000-8000-000000000001', 'Paragony', '2026-12-26', '2026-12-31', 'Europe/Warsaw', 'PLN');

select lives_ok($$ insert into public.expenses (id, trip_id, amount_minor, currency, paid_at, receipt_path) values
  ('7c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 14000, 'MAD', now(),
   '1c000000-0000-4000-8000-000000000001/receipt-7c000000-0000-4000-8000-000000000001/paragon.jpg') $$,
  'wydatek ze zdjęciem paragonu w katalogu wyjazdu');
select throws_ok($$ insert into public.expenses (id, trip_id, amount_minor, currency, paid_at, receipt_path) values
  ('7c000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000001', 100, 'PLN', now(), 'inny-wyjazd/paragon.jpg') $$,
  '23514', null, 'paragon tylko z katalogu tego wyjazdu');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('journal', '1c000000-0000-4000-8000-000000000001/receipt-7c000000-0000-4000-8000-000000000001/paragon.jpg') $$,
  'uczestnik wgrywa zdjęcie paragonu do katalogu wyjazdu');

select * from finish();
rollback;
