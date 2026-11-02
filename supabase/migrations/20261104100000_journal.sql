-- Dziennik wyjazdu: krótkie wpisy i zdjęcia z trasy (telefon, offline przez outbox), po powrocie
-- relacja dzień po dniu na webie. Jak wydatek to zdarzenie z trasy, nie część planu: tabela
-- „trasy” (podbija tylko `sync_version`), bez `ref`. Wpis dodaje każdy uczestnik (także widz),
-- poprawia autor albo organizator i edytor. Zdjęcia w prywatnym buckecie `journal` pod
-- `<trip_id>/<entry_id>/<plik>` — widzą je uczestnicy wyjazdu (podpisane URL-e).

create table public.journal_entries (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  day_id uuid references public.days (id),
  item_id uuid references public.items (id),
  body text not null default '' check (length(body) <= 4000),
  photo_path text check (photo_path is null or coalesce(public.storage_trip(photo_path) = trip_id, false)),
  taken_at timestamptz not null,
  created_by uuid default auth.uid()
);

-- Kolumny wspólne, wersje i historia — jak pętle w *_mvp1_access dla tabel trasy.
alter table public.journal_entries
  add column row_version bigint not null default 0,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid default auth.uid(),
  add column deleted_at timestamptz;
create index journal_entries_trip_version on public.journal_entries (trip_id, row_version);
alter table public.journal_entries enable row level security;
create trigger journal_entries_version before insert or update on public.journal_entries
  for each row execute function public.stamp_row_version('trip');
create trigger journal_entries_activity after insert or update on public.journal_entries
  for each row execute function public.log_activity();

create policy journal_select on public.journal_entries for select to authenticated
  using (public.is_trip_member(trip_id));
create policy journal_insert on public.journal_entries for insert to authenticated
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
create policy journal_update on public.journal_entries for update to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.can_edit_trip(trip_id)))
  with check (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.can_edit_trip(trip_id)));

-- Telefon pobiera dziennik razem z resztą wyjazdu.
create or replace function public.synced_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items', 'legs',
    'constraints', 'contacts', 'budget_lines', 'tasks', 'packing_items', 'notes', 'sources', 'vehicles', 'audio_guides',
    'schedule_events', 'documents', 'expenses', 'expense_splits', 'settlements', 'packing_checks', 'weather_snapshots',
    'journal_entries']
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal', 'journal', false, 15 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

-- Zdjęcia: uczestnicy wyjazdu oglądają i wgrywają w katalogu swojego wyjazdu; usuwa autor pliku
-- albo organizator i edytor.
create policy journal_read on storage.objects for select to authenticated
  using (bucket_id = 'journal' and public.is_trip_member(public.storage_trip(name)));
create policy journal_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'journal' and public.is_trip_member(public.storage_trip(name)));
create policy journal_remove on storage.objects for delete to authenticated
  using (bucket_id = 'journal' and (owner_id = auth.uid()::text or public.can_edit_trip(public.storage_trip(name))));
