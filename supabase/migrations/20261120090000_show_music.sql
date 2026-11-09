-- Podkład muzyczny pokazu z lektorem (`ShowScript.music`, `core/trip-show.ts`): własny plik organizatora w buckecie
-- `show_audio` pod `<trip_id>/muzyka-<znacznik>.<rozszerzenie>`. Prawa i polityki jak nagrania lektora (wgrywa i usuwa
-- organizator albo edytor, słuchają uczestnicy, pod publicznym linkiem tylko po zgodzie `show_is_public`), więc bucket
-- przyjmuje teraz także MP3, M4A, AAC i OGG.

update storage.buckets
set allowed_mime_types = array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg']
where id = 'show_audio';
