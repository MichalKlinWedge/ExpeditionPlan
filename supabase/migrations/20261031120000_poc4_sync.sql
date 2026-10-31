-- PoC-4: minimalne tabele do sprawdzenia synchronizacji Supabase ↔ SQLite (PLAN_ETAPOWY, PoC-4).
--
-- Skrót PoC: dzień i punkt trzymają pola dokumentu (`DocDay`, `DocItem` bez ref/dayRef/sortKey)
-- w `content jsonb`, a reszta dokumentu (miejsca, warianty, rezerwacje, ograniczenia) siedzi
-- w `trips.doc_rest`. Pełny podział na kolumny z SPECYFIKACJA §5 przychodzi w MVP-1.
--
-- Wersjonowanie zmian: każdy zapis do tabeli wyjazdu podbija `trips.sync_version` i stempluje
-- wiersz tą wartością (`row_version`). UPDATE na wierszu wyjazdu bierze blokadę wiersza do końca
-- transakcji, więc zapisy w jednym wyjeździe dostają wersje w kolejności zatwierdzania — klient
-- pobiera „wszystko o wersji > ostatnia”, a jedno zapytanie (`pull_changes`) to jedna migawka.

create table public.trips (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id),
  title text not null,
  start_date date not null,
  end_date date not null,
  primary_tz text not null,
  doc_rest jsonb not null default '{}'::jsonb,
  plan_version bigint not null default 0,
  sync_version bigint not null default 0,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz
);

create table public.trip_members (
  trip_id uuid not null references public.trips (id),
  user_id uuid not null references auth.users (id),
  role text not null check (role in ('owner', 'editor', 'viewer')),
  can_add_expenses boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table public.days (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref text not null,
  date date not null,
  content jsonb not null default '{}'::jsonb,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz,
  unique (trip_id, ref)
);

create table public.items (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  ref text not null,
  day_id uuid references public.days (id),
  sort_key text,
  content jsonb not null default '{}'::jsonb,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz,
  unique (trip_id, ref),
  check (day_id is null or sort_key is not null)
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
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.expenses (
  id uuid primary key,
  trip_id uuid not null references public.trips (id),
  payer_ref text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  category text not null default 'other',
  item_id uuid references public.items (id),
  paid_at timestamptz not null,
  note text,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz
);

create index days_trip_version on public.days (trip_id, row_version);
create index items_trip_version on public.items (trip_id, row_version);
create index schedule_events_trip_version on public.schedule_events (trip_id, row_version);
create index expenses_trip_version on public.expenses (trip_id, row_version);
create index trip_members_user on public.trip_members (user_id);

-- ── Wersje ───────────────────────────────────────────────────────────────────────────────────

-- Stempel wiersza tabeli wyjazdu. SECURITY DEFINER, bo widz dodający wydatek nie ma prawa
-- zmieniać wiersza wyjazdu, a licznik i tak musi się podbić.
create function public.stamp_row_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_plan boolean := tg_table_name in ('days', 'items');
begin
  update public.trips
     set sync_version = sync_version + 1,
         plan_version = plan_version + case when is_plan then 1 else 0 end
   where id = new.trip_id
  returning sync_version into new.row_version;
  if new.row_version is null then
    raise exception 'Brak wyjazdu %', new.trip_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Wiersz wyjazdu: licznik podbija się przy każdej zmianie, ale `row_version` (czyli „wyjazd
-- trzeba pobrać jeszcze raz”) tylko wtedy, gdy zmieniło się coś poza licznikami.
create function public.stamp_trip_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.sync_version := 1;
    new.row_version := 1;
    return new;
  end if;
  if (to_jsonb(new) - array['sync_version', 'plan_version', 'row_version', 'updated_at'])
     is distinct from (to_jsonb(old) - array['sync_version', 'plan_version', 'row_version', 'updated_at']) then
    new.sync_version := old.sync_version + 1;
    new.row_version := new.sync_version;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger trips_version before insert or update on public.trips
  for each row execute function public.stamp_trip_version();
create trigger days_version before insert or update on public.days
  for each row execute function public.stamp_row_version();
create trigger items_version before insert or update on public.items
  for each row execute function public.stamp_row_version();
create trigger schedule_events_version before insert or update on public.schedule_events
  for each row execute function public.stamp_row_version();
create trigger expenses_version before insert or update on public.expenses
  for each row execute function public.stamp_row_version();

-- Twórca wyjazdu zostaje jego właścicielem w `trip_members`.
create function public.add_trip_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_members (trip_id, user_id, role, can_add_expenses)
  values (new.id, new.owner_id, 'owner', true);
  return new;
end $$;

create trigger trips_owner after insert on public.trips
  for each row execute function public.add_trip_owner();

-- Zdarzenia dnia są tylko dopisywane: poprawka to nowe zdarzenie, nie zmiana starego.
create function public.forbid_update() returns trigger
language plpgsql as $$
begin
  raise exception 'Tabela % jest tylko do dopisywania', tg_table_name;
end $$;

create trigger schedule_events_append_only before update on public.schedule_events
  for each row execute function public.forbid_update();

-- ── Uprawnienia ──────────────────────────────────────────────────────────────────────────────

create function public.trip_role(p_trip uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.trip_members where trip_id = p_trip and user_id = auth.uid()
$$;

create function public.can_edit_trip(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.trip_role(p_trip) in ('owner', 'editor'), false)
$$;

create function public.can_add_expense(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members
     where trip_id = p_trip and user_id = auth.uid()
       and (role in ('owner', 'editor') or can_add_expenses)
  )
$$;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.days enable row level security;
alter table public.items enable row level security;
alter table public.schedule_events enable row level security;
alter table public.expenses enable row level security;

-- `owner_id` osobno: przy INSERT … RETURNING wiersza w `trip_members` jeszcze nie ma.
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.trip_role(id) is not null);
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));

create policy members_select on public.trip_members for select to authenticated
  using (public.trip_role(trip_id) is not null);
create policy members_write on public.trip_members for all to authenticated
  using (public.trip_role(trip_id) = 'owner') with check (public.trip_role(trip_id) = 'owner');

create policy days_select on public.days for select to authenticated
  using (public.trip_role(trip_id) is not null);
create policy days_insert on public.days for insert to authenticated
  with check (public.can_edit_trip(trip_id));
create policy days_update on public.days for update to authenticated
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));

create policy items_select on public.items for select to authenticated
  using (public.trip_role(trip_id) is not null);
create policy items_insert on public.items for insert to authenticated
  with check (public.can_edit_trip(trip_id));
create policy items_update on public.items for update to authenticated
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));

create policy events_select on public.schedule_events for select to authenticated
  using (public.trip_role(trip_id) is not null);
create policy events_insert on public.schedule_events for insert to authenticated
  with check (public.can_edit_trip(trip_id) and created_by = auth.uid());

create policy expenses_select on public.expenses for select to authenticated
  using (public.trip_role(trip_id) is not null);
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.can_add_expense(trip_id) and created_by = auth.uid());
-- Edytor poprawia każdy wydatek, widz z prawem dodawania — tylko własne.
create policy expenses_update on public.expenses for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and created_by = auth.uid()))
  with check (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and created_by = auth.uid()));

-- Usuwanie tylko miękkie (`deleted_at`) — twarde DELETE zgubiłoby się w synchronizacji.
revoke delete on public.trips, public.days, public.items, public.schedule_events, public.expenses
  from anon, authenticated;
revoke all on public.trips, public.trip_members, public.days, public.items, public.schedule_events,
  public.expenses from anon;

-- ── Pobieranie zmian ─────────────────────────────────────────────────────────────────────────

-- Wszystko, co zmieniło się w wyjeździe po wersji `p_since`, w jednej migawce i jednym żądaniu.
-- SECURITY INVOKER: RLS działa jak przy zwykłym SELECT. `p_since = 0` to pełna migawka bez
-- usuniętych wierszy.
create function public.pull_changes(p_trip uuid, p_since bigint default 0) returns jsonb
language sql stable set search_path = '' as $$
  with trip as (select * from public.trips where id = p_trip)
  select case when not exists (select 1 from trip) then null else jsonb_build_object(
    'version', (select sync_version from trip),
    'planVersion', (select plan_version from trip),
    'trip', (select to_jsonb(t) - array['sync_version', 'plan_version'] from trip t where t.row_version > p_since),
    'days', coalesce((select jsonb_agg(to_jsonb(d) order by d.row_version) from public.days d
      where d.trip_id = p_trip and d.row_version > p_since and (p_since > 0 or d.deleted_at is null)), '[]'),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.row_version) from public.items i
      where i.trip_id = p_trip and i.row_version > p_since and (p_since > 0 or i.deleted_at is null)), '[]'),
    'scheduleEvents', coalesce((select jsonb_agg(to_jsonb(e) order by e.row_version) from public.schedule_events e
      where e.trip_id = p_trip and e.row_version > p_since and (p_since > 0 or e.deleted_at is null)), '[]'),
    'expenses', coalesce((select jsonb_agg(to_jsonb(x) order by x.row_version) from public.expenses x
      where x.trip_id = p_trip and x.row_version > p_since and (p_since > 0 or x.deleted_at is null)), '[]')
  ) end
$$;

revoke execute on function public.pull_changes(uuid, bigint) from anon, public;
grant execute on function public.pull_changes(uuid, bigint) to authenticated;

-- Telefon słucha tylko wiersza swojego wyjazdu: każda zmiana podbija `sync_version`, a klient
-- reaguje pobraniem przyrostowym (prościej i odporniej niż stosowanie payloadów z Realtime).
alter publication supabase_realtime add table public.trips;
