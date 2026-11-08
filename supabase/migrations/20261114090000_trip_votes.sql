-- Głosowanie grupy: nad wariantami (grupy `variant_groups`, także kandydaci noclegu `scope = booking`)
-- i nad terminem (wspólny kalendarz dostępności). Głos to nie decyzja: wybór (`chosen_ref`, nowy termin)
-- robi organizator albo edytor. Osobne wiersze poza dokumentem planu, z prawami jak `packing_carriers`:
-- każdy głosuje za siebie i swoje dzieci (`is_my_traveler`), organizator i edytor mogą wpisać głos osoby
-- bez konta. Telefon pobiera głosy z wyjazdem i głosuje offline przez outbox. Wycofanie = `deleted_at`.
--
-- Wiersz jest jednym z dwóch rodzajów:
--   wariant: `variant_group_id` + `variant_id` (null = „wszystko mi jedno”),
--   termin:  `day` + `answer` (mogę / może / nie mogę) dla jednego dnia z okna `trips.date_poll`.

create table public.trip_votes (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  traveler_id uuid not null references public.travelers (id),
  variant_group_id uuid references public.variant_groups (id),
  variant_id uuid references public.variants (id),
  day date,
  answer text check (answer in ('yes', 'maybe', 'no')),
  note text check (char_length(note) <= 300),
  check (
    (variant_group_id is not null and day is null and answer is null)
    or (variant_group_id is null and variant_id is null and day is not null and answer is not null)
  ),
  unique (traveler_id, variant_group_id),
  unique (traveler_id, day)
);

alter table public.trip_votes
  add column row_version bigint not null default 0,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid default auth.uid(),
  add column deleted_at timestamptz;
create index trip_votes_trip_version on public.trip_votes (trip_id, row_version);
alter table public.trip_votes enable row level security;
create trigger trip_votes_version before insert or update on public.trip_votes
  for each row execute function public.stamp_row_version('trip');
create trigger trip_votes_activity after insert or update on public.trip_votes
  for each row execute function public.log_activity();

create policy trip_votes_select on public.trip_votes for select to authenticated
  using (public.is_trip_member(trip_id));
create policy trip_votes_insert on public.trip_votes for insert to authenticated
  with check (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)));
create policy trip_votes_update on public.trip_votes for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)))
  with check (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)));
revoke all on public.trip_votes from anon;
revoke delete on public.trip_votes from authenticated;

-- Wariant musi należeć do grupy, a grupa i osoba do tego wyjazdu (klient podaje id).
create function public.check_trip_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.travelers where id = new.traveler_id and trip_id = new.trip_id) then
    raise exception 'Osoba spoza tego wyjazdu.' using errcode = '23514';
  end if;
  if new.variant_group_id is not null and not exists (select 1 from public.variant_groups where id = new.variant_group_id and trip_id = new.trip_id) then
    raise exception 'Głosowanie spoza tego wyjazdu.' using errcode = '23514';
  end if;
  if new.variant_id is not null and not exists (select 1 from public.variants where id = new.variant_id and group_id = new.variant_group_id) then
    raise exception 'Wariant nie należy do tego głosowania.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trip_votes_check before insert or update on public.trip_votes
  for each row execute function public.check_trip_vote();

-- Ankieta terminu: okno, w którym szukamy dni (`{"from":"2027-01-10","to":"2027-02-28","closesOn":"2026-12-01"}`).
-- Długość szukanego terminu to długość wyjazdu; `null` = brak ankiety. Zmienia ją organizator i edytor (`trips_update`).
alter table public.trips add column date_poll jsonb check (
  date_poll is null or (jsonb_typeof(date_poll) = 'object' and date_poll ? 'from' and date_poll ? 'to')
);

-- Telefon pobiera głosy razem z resztą wyjazdu.
create or replace function public.synced_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items', 'legs',
    'constraints', 'contacts', 'budget_lines', 'tasks', 'packing_items', 'notes', 'sources', 'vehicles', 'audio_guides',
    'schedule_events', 'documents', 'expenses', 'expense_splits', 'settlements', 'packing_checks', 'weather_snapshots',
    'journal_entries', 'packing_carriers', 'trip_votes']
$$;
