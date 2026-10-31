-- MVP-1, część 3: logistyka, pieniądze, organizacja, audio, AI, historia (SPECYFIKACJA §5).
-- Schemat od razu pełny (PLAN_ETAPOWY, MVP), nawet jeśli UI przychodzi w późniejszych etapach.

create table public.documents (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  booking_id uuid references public.bookings (id),
  item_id uuid references public.items (id),
  -- Prywatny bucket, ścieżka `trip_id/…`.
  storage_path text not null,
  file_name text not null,
  mime text,
  size bigint,
  sha256 text,
  -- all = każdy członek; members = tylko `visible_to` (user_id); owner = tylko właściciel.
  visibility text not null default 'all' check (visibility in ('all', 'members', 'owner')),
  visible_to uuid[] not null default '{}',
  offline boolean not null default true,
  code_payload text,
  code_format text
);

create table public.contacts (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  booking_id uuid references public.bookings (id),
  name text not null,
  role text not null check (role in ('host', 'operator', 'rental', 'guide', 'emergency', 'venue', 'other')),
  phone text,
  email text,
  messenger text,
  notes text,
  sort_key text
);

create table public.budget_lines (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  category text not null check (category in ('flights', 'lodging', 'car', 'fuel', 'tolls_parking', 'tickets', 'activities',
    'food', 'luggage', 'insurance', 'transport', 'other')),
  title text not null,
  booking_id uuid references public.bookings (id),
  item_id uuid references public.items (id),
  status text not null check (status in ('estimate', 'committed', 'paid')),
  -- Scenariusz oszczędny / wygodny; przy kwocie pewnej obie równe.
  low_minor bigint not null check (low_minor >= 0),
  high_minor bigint not null,
  currency public.currency_code not null,
  fx_rate numeric,
  fx_date date,
  base_low_minor bigint,
  base_high_minor bigint,
  per_person boolean not null default false,
  note text,
  -- Pozycja wyliczona z rezerwacji albo punktu (nie wpisana ręcznie).
  auto boolean not null default false,
  sort_key text,
  check (low_minor <= high_minor)
);

create table public.expenses (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  payer_traveler_id uuid references public.travelers (id),
  amount_minor bigint not null check (amount_minor >= 0),
  currency public.currency_code not null,
  fx_rate numeric,
  fx_source text,
  base_amount_minor bigint,
  category text not null default 'other',
  item_id uuid references public.items (id),
  booking_id uuid references public.bookings (id),
  budget_line_id uuid references public.budget_lines (id),
  paid_at timestamptz not null,
  note text,
  receipt_document_id uuid references public.documents (id),
  split_mode text not null default 'equal' check (split_mode in ('equal', 'shares', 'exact', 'households')),
  created_by uuid default auth.uid()
);

create table public.expense_splits (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  expense_id uuid not null references public.expenses (id),
  traveler_id uuid references public.travelers (id),
  household text,
  weight numeric,
  amount_minor bigint,
  check (num_nonnulls(traveler_id, household) = 1)
);

create table public.settlements (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  from_traveler_id uuid not null references public.travelers (id),
  to_traveler_id uuid not null references public.travelers (id),
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency_code not null,
  settled_at timestamptz
);

create table public.tasks (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  kind text not null check (kind in ('todo', 'question', 'decision')),
  title text not null,
  body text,
  answer text,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  -- Termin (`TaskDue`): absolute / before_trip / before_item / before_booking / on_trip.
  due jsonb,
  assignee_ids uuid[] not null default '{}',
  booking_id uuid references public.bookings (id),
  item_id uuid references public.items (id),
  variant_group_id uuid references public.variant_groups (id),
  priority text check (priority in ('high', 'normal', 'low')),
  source text not null default 'user' check (source in ('user', 'ai', 'check', 'import')),
  sort_key text
);

create table public.packing_items (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  category text not null,
  title text not null,
  note text,
  scope text not null check (scope in ('personal', 'shared')),
  quantity numeric check (quantity > 0),
  unit text,
  assignee_traveler_id uuid references public.travelers (id),
  sort_key text
);

-- Odhaczanie per osoba; jeden wiersz na (pozycja, uczestnik).
create table public.packing_checks (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  packing_item_id uuid not null references public.packing_items (id),
  traveler_id uuid not null references public.travelers (id),
  packed boolean not null default true,
  checked_at timestamptz not null default now(),
  unique (packing_item_id, traveler_id)
);

create table public.notes (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  scope text not null check (scope in ('trip', 'day', 'item', 'booking', 'variant_group')),
  -- Element, którego dotyczy notatka (tabela wg `scope`); null przy `scope = trip`.
  entity_id uuid,
  kind text not null check (kind in ('info', 'tip', 'warning', 'safety', 'rationale', 'slack_audit', 'practical')),
  topic text check (topic in ('weather', 'documents', 'money', 'health', 'safety', 'culture', 'transport', 'rules', 'packing', 'time', 'other')),
  title text,
  body text not null,
  slack text check (slack in ('large', 'small', 'none', 'negative')),
  sort_key text,
  check ((scope = 'trip') = (entity_id is null))
);

create table public.sources (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  title text not null,
  url text,
  checked_at date,
  note text,
  -- Elementy, których dotyczy źródło (id z dowolnej tabeli wyjazdu) — zamiast `source_links` z §5.
  applies_to_ids uuid[] not null default '{}',
  sort_key text
);

create table public.vehicles (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  booking_id uuid references public.bookings (id),
  label text not null,
  driver_traveler_id uuid references public.travelers (id),
  seats integer,
  passenger_ids uuid[] not null default '{}',
  notes text
);

create table public.audio_guides (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  item_id uuid references public.items (id),
  place_id uuid references public.places (id),
  lang text not null default 'pl',
  audience text not null default 'adult' check (audience in ('adult', 'child')),
  title text not null,
  text text not null,
  sources jsonb not null default '[]'::jsonb,
  license text,
  audio_path text,
  voice text,
  duration_s integer,
  trigger_radius_m integer not null default 100,
  status text not null default 'draft' check (status in ('draft', 'ready', 'failed'))
);

create table public.ai_messages (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  ai_run_id uuid references public.ai_runs (id),
  created_by uuid default auth.uid()
);

create table public.weather_snapshots (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  day_id uuid references public.days (id),
  lat double precision not null,
  lng double precision not null,
  forecast jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Historia zmian („kto co zmienił”). Pisze ją wyłącznie trigger; klient tylko czyta.
create table public.activity_log (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips (id),
  actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id uuid not null,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_trip on public.activity_log (trip_id, created_at desc);
