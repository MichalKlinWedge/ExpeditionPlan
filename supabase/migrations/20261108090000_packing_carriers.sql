-- Sprzęt: kto zabiera rzecz wspólną i ile waży, żeby nie dublować i dzielić obciążenie.
-- Rzecz wspólną może nieść kilka osób („Namiot × 3”, „Woda 28 l”), a widz ma móc sam powiedzieć
-- „biorę”, więc to osobne wiersze z prawami jak `packing_checks` (swoje i swoich dzieci), także
-- offline przez outbox. `quantity = 0` to „nie biorę”: jawnie zdejmuje też osobę wskazaną w planie
-- (`packing_items.assignee_traveler_id`), której widz nie może zmienić.

alter table public.packing_items add column weight_g integer check (weight_g > 0);

create table public.packing_carriers (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  packing_item_id uuid not null references public.packing_items (id),
  traveler_id uuid not null references public.travelers (id),
  quantity numeric not null check (quantity >= 0),
  unique (packing_item_id, traveler_id)
);

-- Kolumny wspólne, wersje i historia — jak pętle w *_mvp1_access dla tabel trasy.
alter table public.packing_carriers
  add column row_version bigint not null default 0,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid default auth.uid(),
  add column deleted_at timestamptz;
create index packing_carriers_trip_version on public.packing_carriers (trip_id, row_version);
alter table public.packing_carriers enable row level security;
create trigger packing_carriers_version before insert or update on public.packing_carriers
  for each row execute function public.stamp_row_version('trip');
create trigger packing_carriers_activity after insert or update on public.packing_carriers
  for each row execute function public.log_activity();

create policy packing_carriers_select on public.packing_carriers for select to authenticated
  using (public.is_trip_member(trip_id));
create policy packing_carriers_insert on public.packing_carriers for insert to authenticated
  with check (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)));
create policy packing_carriers_update on public.packing_carriers for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)))
  with check (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)));

-- Telefon pobiera podział razem z resztą wyjazdu.
create or replace function public.synced_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items', 'legs',
    'constraints', 'contacts', 'budget_lines', 'tasks', 'packing_items', 'notes', 'sources', 'vehicles', 'audio_guides',
    'schedule_events', 'documents', 'expenses', 'expense_splits', 'settlements', 'packing_checks', 'weather_snapshots',
    'journal_entries', 'packing_carriers']
$$;
