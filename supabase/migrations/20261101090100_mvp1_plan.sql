-- MVP-1, część 2: plan wyjazdu (SPECYFIKACJA §5 „Tabele — rdzeń” i „Tabele — plan”).
--
-- Każda kolekcja `TripDocument` (packages/core/src/schemas/trip-document.ts) ma swoją tabelę,
-- a `ref` dokumentu zostaje kolumną obok `id` (unikalny w wyjeździe). Odwołania z pierwszego
-- poziomu dokumentu są kluczami obcymi (uuid), odwołania wewnątrz pól jsonb (`leg`, `activity`,
-- `due`, `comparison`) zostają kluczami `ref` — rozwiązuje je `packages/sync/src/document.ts`.
-- Kolumny wspólne (`row_version`, `created_at`, `updated_at`, `updated_by`, `deleted_at`),
-- triggery i RLS dokłada migracja `mvp1_access`.

create table public.trip_brief (
  id uuid primary key,
  trip_id uuid not null unique references public.trips (id),
  -- `TripBrief` z packages/core (formularz kreatora) — całość, bo Zod jest źródłem prawdy.
  brief jsonb not null
);

create table public.travelers (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  -- Uczestnik może mieć konto (członek wyjazdu), ale nie musi (dziecko, znajomy bez aplikacji).
  user_id uuid references auth.users (id),
  name text not null,
  nickname text,
  age integer check (age between 0 and 120),
  household text,
  guardian_id uuid references public.travelers (id),
  is_driver boolean,
  height_cm integer check (height_cm > 0),
  diet text,
  notes text,
  sort_key text
);

-- Miejsca wyjazdu. Wspólna pamięć podręczna miejsc między wyjazdami (§5) przychodzi z Geoapify
-- w MVP-2 — wtedy `provider_id` wskaże wpis w niej; do tego czasu miejsca są per wyjazd.
create table public.places (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  provider text not null default 'unknown' check (provider in ('osm', 'geoapify', 'user', 'unknown')),
  provider_id text,
  name text not null,
  -- Nazwa do wyszukania w źródle (lokalna albo angielska) — OSM nie zna polskich egzonimów.
  search_name text,
  category text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  address text,
  opening_hours text,
  opening_hours_parsed jsonb,
  elevation_m integer,
  website text,
  links jsonb not null default '[]'::jsonb,
  notes text,
  raw jsonb,
  fetched_at timestamptz,
  sort_key text
);

create table public.variant_groups (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  scope text not null check (scope in ('item', 'block', 'day', 'trip', 'booking')),
  day_id uuid,
  title text not null,
  condition_kind text not null check (condition_kind in ('choice', 'weather', 'closure', 'schedule_slip', 'availability', 'wellbeing')),
  condition_text text,
  -- Termin decyzji: {local, tz} albo {time} (godzina dnia `day_id`).
  decide_by jsonb,
  chosen_variant_id uuid,
  rationale text,
  -- Tabela porównania: {columns, rows: [{variantRef, values}]}.
  comparison jsonb,
  sort_key text
);

create table public.variants (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  group_id uuid not null references public.variant_groups (id),
  label text not null,
  summary text,
  recommended boolean,
  pros text[] not null default '{}',
  cons text[] not null default '{}',
  metrics jsonb,
  -- Punkty, które wariant wyrzuca z planu (PoC-0, A9).
  excludes_item_ids uuid[] not null default '{}',
  sort_key text
);

alter table public.variant_groups
  add foreign key (chosen_variant_id) references public.variants (id);

create table public.bookings (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  kind text not null check (kind in ('flight', 'train', 'bus', 'ferry', 'lodging', 'car_rental', 'transfer', 'driver_hire',
    'activity', 'package', 'ticket', 'transit_pass', 'insurance', 'esim', 'luggage', 'other')),
  status text not null check (status in ('idea', 'candidate', 'to_book', 'booked', 'paid', 'cancelled', 'unknown', 'not_required')),
  -- Grupa porównania kandydatów (`scope = booking`) i wariant, który tego kandydata reprezentuje.
  variant_group_id uuid references public.variant_groups (id),
  variant_id uuid references public.variants (id),
  recommended boolean,
  provider text,
  title text not null,
  confirmation_code text,
  -- Początek i koniec: data zawsze, godzina nie (PoC-0, A5).
  start_date date,
  start_time public.local_time,
  start_precision text check (start_precision in ('exact', 'approx')),
  start_tz text,
  end_date date,
  end_time public.local_time,
  end_precision text check (end_precision in ('exact', 'approx')),
  end_tz text,
  start_place_id uuid references public.places (id),
  end_place_id uuid references public.places (id),
  check_in_from public.local_time,
  check_out_until public.local_time,
  price jsonb,
  paid_minor bigint check (paid_minor >= 0),
  paid_currency public.currency_code,
  paid_on date,
  paid_by_traveler_id uuid references public.travelers (id),
  payment_method text check (payment_method in ('cash', 'card', 'credit_card_only', 'online')),
  pay_when text check (pay_when in ('prepaid', 'on_site', 'before_arrival')),
  refundable boolean,
  free_cancellation_until date,
  party jsonb,
  includes text[] not null default '{}',
  addons jsonb not null default '[]'::jsonb,
  language text,
  -- Szczegóły per rodzaj: {flight} | {car} | {lodging}.
  details jsonb not null default '{}'::jsonb,
  pros text[] not null default '{}',
  cons text[] not null default '{}',
  rating jsonb,
  links jsonb not null default '[]'::jsonb,
  notes text[] not null default '{}',
  raw jsonb,
  sort_key text
);

create table public.days (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  date date not null,
  tz text not null,
  title text,
  summary text,
  base_place_id uuid references public.places (id),
  -- Nocleg tej nocy: rezerwacja albo grupa kandydatów (dzień pokazuje wybranego) — PoC-0, A7.
  lodging_booking_id uuid references public.bookings (id),
  lodging_group_id uuid references public.variant_groups (id),
  anchor_time public.local_time,
  day_start public.local_time,
  day_end public.local_time,
  stated_driving jsonb,
  check (lodging_booking_id is null or lodging_group_id is null)
);

alter table public.variant_groups
  add foreign key (day_id) references public.days (id);

create table public.tracks (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  name text not null,
  gpx_path text,
  geojson jsonb,
  distance_km double precision check (distance_km >= 0),
  ascent_m integer,
  descent_m integer,
  duration_min integer,
  duration_max_min integer,
  difficulty text,
  waymarking text,
  route_notes text,
  url text,
  offline boolean not null default false,
  sort_key text
);

create table public.ai_runs (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  stage text not null,
  provider text not null,
  model text not null,
  input jsonb,
  output jsonb,
  status text not null default 'pending' check (status in ('pending', 'ok', 'invalid', 'failed', 'accepted', 'rejected')),
  validation_errors jsonb,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10, 4),
  duration_ms integer,
  parent_run_id uuid references public.ai_runs (id),
  created_by uuid not null default auth.uid() references auth.users (id)
);

create table public.items (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  -- Brak dnia = punkt w puli.
  day_id uuid references public.days (id),
  sort_key text,
  area text,
  kind text not null check (kind in ('visit', 'activity', 'meal', 'transport', 'lodging', 'errand', 'meetup', 'free', 'decision')),
  plan_status text not null default 'scheduled' check (plan_status in ('scheduled', 'candidate', 'alternative', 'does_not_fit', 'rejected')),
  replaces_item_ids uuid[] not null default '{}',
  -- Warianty, w których punkt występuje; pusto = we wszystkich (A9).
  variant_ids uuid[] not null default '{}',
  -- Blok z podpunktami równoległymi (PoC-5).
  parent_id uuid references public.items (id),
  title text not null,
  description text,
  place_id uuid references public.places (id),
  -- Godzina z precyzją z planu (`ItemTime`).
  time_precision text check (time_precision in ('exact', 'approx', 'range', 'part_of_day', 'day', 'relative')),
  start_time public.local_time,
  end_time public.local_time,
  part_of_day text check (part_of_day in ('morning', 'midday', 'afternoon', 'evening', 'night')),
  offset_min integer,
  relative_from text check (relative_from in ('anchor', 'previous')),
  time_tz text,
  -- Przejazd z godziną (`kind = transport`, A4): tryb, linia, odcinki, alternatywa, karnet.
  leg jsonb,
  duration_min integer check (duration_min >= 0),
  duration_max_min integer check (duration_max_min >= 0),
  buffer_after_min integer check (buffer_after_min >= 0),
  is_fixed boolean,
  priority text check (priority in ('must', 'should', 'optional')),
  cut_rank integer check (cut_rank > 0),
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  price jsonb,
  payment text check (payment in ('cash_only', 'card', 'prepaid', 'included', 'free')),
  booking_id uuid references public.bookings (id),
  booking_group_id uuid references public.variant_groups (id),
  weather text check (weather in ('outdoor', 'indoor', 'any')),
  activity jsonb,
  -- Uczestnicy punktu (travelers.id); null = cała grupa. Tablica zamiast tabeli `item_participants`
  -- z §5 — jeden wiersz na punkt, prościej w synchronizacji.
  participant_ids uuid[],
  links jsonb not null default '[]'::jsonb,
  notes text[] not null default '{}',
  source text not null default 'user' check (source in ('ai', 'user', 'import')),
  ai_run_id uuid references public.ai_runs (id),
  user_locked boolean not null default false,
  check (day_id is null or sort_key is not null),
  check (booking_id is null or booking_group_id is null),
  check (leg is null or kind = 'transport')
);

-- Przejścia niejawne między punktami albo miejscami (bez własnego wiersza w osi dnia).
create table public.legs (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  from_item_id uuid references public.items (id),
  from_place_id uuid references public.places (id),
  to_item_id uuid references public.items (id),
  to_place_id uuid references public.places (id),
  mode text not null,
  duration_min integer,
  duration_max_min integer,
  distance_km double precision,
  instructions text,
  line text,
  frequency_min integer,
  ticket_booking_id uuid references public.bookings (id),
  price jsonb,
  -- Reszta szczegółów przejazdu: {segments, alternative, roundTrip, links}.
  details jsonb not null default '{}'::jsonb,
  polyline text,
  source text not null default 'document' check (source in ('document', 'routing', 'estimate', 'manual')),
  computed_at timestamptz,
  sort_key text,
  check (num_nonnulls(from_item_id, from_place_id) = 1),
  check (num_nonnulls(to_item_id, to_place_id) = 1)
);

create table public.constraints (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref public.doc_ref,
  kind text not null check (kind in ('arrive_before', 'depart_before', 'finish_before_sunset', 'no_driving_after_dark',
    'latest_start', 'min_time_at', 'must_be_open', 'office_open_at', 'other')),
  day_id uuid references public.days (id),
  item_id uuid references public.items (id),
  booking_id uuid references public.bookings (id),
  time public.local_time,
  tz text,
  minutes integer,
  severity text not null default 'hard' check (severity in ('hard', 'soft')),
  reason text,
  sort_key text
);

-- Tylko dopisywane: opóźnienia, pominięcia, odhaczenia z telefonu. Id nadaje klient (UUIDv7),
-- więc ponowna wysyłka z outboxa po przerwanym połączeniu niczego nie dubluje.
create table public.schedule_events (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  day_id uuid references public.days (id),
  item_id uuid references public.items (id),
  kind text not null check (kind in ('delay', 'skip', 'done', 'choose_variant', 'pull_from_pool')),
  minutes integer,
  payload jsonb not null default '{}'::jsonb,
  device_id text,
  occurred_at timestamptz not null,
  created_by uuid default auth.uid()
);

create table public.plan_snapshots (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  label text not null,
  snapshot jsonb not null,
  created_by uuid not null default auth.uid() references auth.users (id)
);
