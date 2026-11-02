-- Sejf dokumentów (MVP-3, SPECYFIKACJA §8): prywatny bucket `documents`, pliki pod
-- `<trip_id>/<document_id>/<nazwa>`. Kto widzi plik, decyduje wiersz `public.documents`
-- (widoczność: wszyscy / wybrane osoby / właściciel) przez `can_see_document` — ta sama reguła
-- co dla wiersza, więc zmiana widoczności od razu obejmuje plik. Pobieranie: krótkie podpisane URL-e.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20 * 1024 * 1024,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'])
on conflict (id) do nothing;

-- Pierwszy człon ścieżki jako id wyjazdu; śmieci zamiast uuid = brak wyjazdu (polityka odmawia).
create function public.storage_trip(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;

-- Odczyt: jest nieusunięty wiersz dokumentu z tą ścieżką, widoczny dla mnie, i ścieżka leży
-- w katalogu TEGO wyjazdu — wiersz w wyjeździe A nie otworzy pliku z wyjazdu B.
create policy documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
       where d.storage_path = name
         and d.deleted_at is null
         and d.trip_id = public.storage_trip(name)
         and public.can_see_document(d.trip_id, d.visibility, d.visible_to)
    )
  );

-- Wgrywanie i usuwanie: organizator i edytor, tylko we własnym katalogu wyjazdu.
create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_edit_trip(public.storage_trip(name)));

create policy documents_remove on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_edit_trip(public.storage_trip(name)));
