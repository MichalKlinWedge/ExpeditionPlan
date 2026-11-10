-- Ustawienia konta (migracja *_user_settings): każdy czyta i zapisuje tylko swoje. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ustawienia-ania@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'ustawienia-bartek@test.local');

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000a1');
insert into public.user_settings (eatery_search) values ('{"radiusM": 2000}')
  on conflict (user_id) do update set eatery_search = excluded.eatery_search, updated_at = now();
select is((select eatery_search ->> 'radiusM' from public.user_settings), '2000', 'zapis bez podawania user_id trafia do mnie');
insert into public.user_settings (eatery_search) values ('{"radiusM": 500}')
  on conflict (user_id) do update set eatery_search = excluded.eatery_search, updated_at = now();
select is((select count(*)::int from public.user_settings), 1, 'drugi zapis nadpisuje ten sam wiersz');
select throws_ok($$ insert into public.user_settings (user_id, eatery_search) values ('00000000-0000-4000-8000-0000000000a2', '{}') $$, '42501', null, 'cudzego wiersza nie założę');
select throws_ok($$ insert into public.user_settings (eatery_search) values ('[]') on conflict (user_id) do update set eatery_search = excluded.eatery_search $$, '23514', null, 'tylko obiekt');

select pg_temp.login('00000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from public.user_settings), 0, 'cudzych ustawień nie widzę');
update public.user_settings set eatery_search = '{}' where user_id = '00000000-0000-4000-8000-0000000000a1';
reset role;
select is((select eatery_search ->> 'radiusM' from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000a1'), '500', 'cudzych nie zmienię');

select * from finish();
rollback;
