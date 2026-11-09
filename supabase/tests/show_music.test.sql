-- Podkład muzyczny pokazu (migracja *_show_music): bucket `show_audio` przyjmuje formaty muzyki obok WAV z lektora,
-- a limit rozmiaru zostaje. Uruchomienie: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select ok((select 'audio/mpeg' = any (allowed_mime_types) from storage.buckets where id = 'show_audio'), 'MP3 przechodzi');
select ok((select 'audio/wav' = any (allowed_mime_types) from storage.buckets where id = 'show_audio'), 'WAV lektora dalej przechodzi');
select is((select file_size_limit from storage.buckets where id = 'show_audio'), 20 * 1024 * 1024::bigint, 'limit 20 MB bez zmian');

select * from finish();
rollback;
