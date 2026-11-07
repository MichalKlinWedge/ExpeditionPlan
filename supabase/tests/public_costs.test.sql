-- Publiczny link z ukrytymi kosztami nie podaje cen także w polach jsonb. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'koszty-organizator@test.local');
insert into public.trips (id, owner_id, title, start_date, end_date, primary_tz, base_currency) values
  ('1c000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'Koszty', '2026-12-26', '2026-12-28', 'Europe/Warsaw', 'PLN');
insert into public.places (id, trip_id, name, venue) values
  ('2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'Knajpa',
   '{"points": ["Dobra zupa"], "prices": [{"name": "Zupa", "minMinor": 1800, "maxMinor": 1800, "currency": "PLN"}]}');
insert into public.bookings (id, trip_id, kind, title, status, details) values
  ('3c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'car_rental', 'Auto', 'booked',
   '{"car": {"model": "Yaris", "deposit": {"kind": "fixed", "amountMinor": 100000, "currency": "PLN"}}}');
insert into public.public_shares (trip_id, token_hash, hide) values
  ('1c000000-0000-4000-8000-000000000001', public.token_digest('token-koszty'), '{"costs": true}');

select set_config('role', 'anon', true);
select is(public.public_trip('token-koszty') -> 'tables' -> 'bookings' -> 0 -> 'details' -> 'car' -> 'deposit', null, 'bez kaucji');
select is(public.public_trip('token-koszty') -> 'tables' -> 'bookings' -> 0 -> 'details' -> 'car' ->> 'model', 'Yaris', 'reszta danych auta zostaje');
select is(public.public_trip('token-koszty') -> 'tables' -> 'places' -> 0 -> 'venue' -> 'prices', null, 'bez cen w knajpie');
select is(public.public_trip('token-koszty') -> 'tables' -> 'places' -> 0 -> 'venue' -> 'points' ->> 0, 'Dobra zupa', 'opis knajpy zostaje');
reset role;

update public.public_shares set hide = '{"costs": false}' where trip_id = '1c000000-0000-4000-8000-000000000001';
select set_config('role', 'anon', true);
select isnt(public.public_trip('token-koszty') -> 'tables' -> 'places' -> 0 -> 'venue' -> 'prices', null, 'koszty pokazane: ceny są');
reset role;

select * from finish();
rollback;
