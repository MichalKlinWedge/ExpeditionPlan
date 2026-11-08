-- Ważność paszportu i dowodu przy osobie: link publiczny jej nie pokazuje. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f1', 'dokumenty-organizator@test.local');
insert into public.trips (id, owner_id, title, start_date, end_date, primary_tz, base_currency) values
  ('1f000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1', 'Dokumenty', '2027-01-10', '2027-01-20', 'Europe/Warsaw', 'PLN');
insert into public.travelers (id, trip_id, name, passport_until, id_card_until) values
  ('7f000000-0000-4000-8000-000000000001', '1f000000-0000-4000-8000-000000000001', 'Ola', '2027-03-01', '2030-05-05');
insert into public.public_shares (trip_id, token_hash) values
  ('1f000000-0000-4000-8000-000000000001', public.token_digest('token-dokumenty'));

select is((select passport_until from public.travelers where id = '7f000000-0000-4000-8000-000000000001'), '2027-03-01'::date, 'data ważności paszportu zapisana przy osobie');
select set_config('role', 'anon', true);
select is(
  (select count(*) from jsonb_array_elements(public.public_trip('token-dokumenty') -> 'tables' -> 'travelers') p where p ? 'passport_until' or p ? 'id_card_until'),
  0::bigint, 'link publiczny bez dat ważności dokumentów');
reset role;

select * from finish();
rollback;
