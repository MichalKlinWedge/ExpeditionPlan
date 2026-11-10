-- Własne zdjęcia w opisach miejsc (obok zdjęć z Commons). Bucket publiczny: opis jest też pod
-- publicznym linkiem, w pokazie (eksport wideo potrzebuje CORS) i offline na telefonie, który
-- trzyma zdjęcia po adresie. Ścieżka `<wyjazd>/<uuid>.jpg` — adresu nie da się zgadnąć.
-- Wgrywa i usuwa tylko organizator albo edytor wyjazdu.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide_photos', 'guide_photos', true, 5 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do nothing;

create policy guide_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'guide_photos' and public.can_edit_trip(public.storage_trip(name)));
create policy guide_photos_remove on storage.objects for delete to authenticated
  using (bucket_id = 'guide_photos' and public.can_edit_trip(public.storage_trip(name)));
