-- Biblioteka opisów (migracja *_guide_library): czyta każdy zalogowany, zapisuje tylko konto, które
-- może zakładać wyjazdy, a bez logowania nie ma dostępu. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'biblioteka-organizator@test.local'),
  ('00000000-0000-4000-8000-0000000000f2', 'biblioteka-gosc@test.local');

create function pg_temp.login(p_user uuid, p_creator boolean) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
           'app_metadata', json_build_object('trip_creator', p_creator))::text, true)
$$;

select pg_temp.login('00000000-0000-4000-8000-0000000000f1', true);
select lives_ok(
  $$insert into public.guide_library (site, lang, article_title, content) values ('wikipedia', 'pl', 'Artykuł testowy biblioteki', '{"summary":"a"}')$$,
  'organizator dodaje opis');
select lives_ok(
  $$update public.guide_library set content = '{"summary":"b"}' where article_title = 'Artykuł testowy biblioteki'$$,
  'organizator odświeża opis');

select pg_temp.login('00000000-0000-4000-8000-0000000000f2', false);
select is((select content ->> 'summary' from public.guide_library where article_title = 'Artykuł testowy biblioteki'), 'b', 'inne konto czyta opis');
select throws_ok(
  $$insert into public.guide_library (site, lang, article_title, content) values ('wikipedia', 'pl', 'Inny', '{}')$$,
  '42501', null, 'konto bez prawa zakładania wyjazdów nie dodaje opisu');
update public.guide_library set content = '{"summary":"zły"}' where article_title = 'Artykuł testowy biblioteki';
reset role;
select is((select content ->> 'summary' from public.guide_library where article_title = 'Artykuł testowy biblioteki'), 'b', 'ani go nie podmienia');

select set_config('role', 'anon', true);
select throws_ok('select count(*) from public.guide_library', '42501', null, 'bez logowania nie ma dostępu');
reset role;

select * from finish();
rollback;
