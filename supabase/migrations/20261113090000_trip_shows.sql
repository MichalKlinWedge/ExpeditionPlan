-- Pokaz z lektorem (`/trips/[id]/show`, `core/trip-show.ts`): zapisany jest tylko tekst lektora scen i jego nagrania,
-- obraz liczy się z planu. Jeden scenariusz na wyjazd. Tylko web: tabela nie jest w `synced_tables()`, telefon jej nie pobiera.
-- Nagrania (WAV z Gemini TTS) w prywatnym buckecie `show_audio` pod `<trip_id>/<odcisk>.wav`: słuchają uczestnicy
-- wyjazdu (podpisane URL-e), nagrywają i usuwają organizator i edytor.

create table public.trip_shows (
  trip_id uuid primary key references public.trips (id),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.trip_shows enable row level security;

create policy trip_shows_select on public.trip_shows for select to authenticated
  using (public.is_trip_member(trip_id));
create policy trip_shows_insert on public.trip_shows for insert to authenticated
  with check (public.can_edit_trip(trip_id));
create policy trip_shows_update on public.trip_shows for update to authenticated
  using (public.can_edit_trip(trip_id))
  with check (public.can_edit_trip(trip_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('show_audio', 'show_audio', false, 20 * 1024 * 1024, array['audio/wav'])
on conflict (id) do nothing;

create policy show_audio_read on storage.objects for select to authenticated
  using (bucket_id = 'show_audio' and public.is_trip_member(public.storage_trip(name)));
create policy show_audio_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'show_audio' and public.can_edit_trip(public.storage_trip(name)));
create policy show_audio_remove on storage.objects for delete to authenticated
  using (bucket_id = 'show_audio' and public.can_edit_trip(public.storage_trip(name)));
