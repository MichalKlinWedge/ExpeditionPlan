-- MVP-1, część 4: kolumny wspólne, wersje, historia zmian, RLS i pobieranie zmian
-- (SPECYFIKACJA §5 „Konwencje” i „Uprawnienia”, §6).

-- ── Kolumny wspólne i wersje ─────────────────────────────────────────────────────────────────

-- Tabele planu: zmiana podbija `sync_version` (telefon pobiera) i `plan_version` (plan się zmienił).
-- Tabele trasy: tylko `sync_version` — opóźnienie czy wydatek to nie zmiana planu.
-- Tabele AI i migawki: kolumny wspólne bez stempla — nie jadą na telefon.
do $$
declare
  plan_tables text[] := array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks',
    'items', 'legs', 'constraints', 'contacts', 'budget_lines', 'tasks', 'packing_items', 'notes', 'sources', 'vehicles',
    'audio_guides'];
  trip_tables text[] := array['schedule_events', 'documents', 'expenses', 'expense_splits', 'settlements', 'packing_checks',
    'weather_snapshots'];
  unstamped text[] := array['ai_runs', 'ai_messages', 'plan_snapshots'];
  t text;
begin
  foreach t in array plan_tables || trip_tables || unstamped loop
    execute format($f$
      alter table public.%1$I
        add column row_version bigint not null default 0,
        add column created_at timestamptz not null default now(),
        add column updated_at timestamptz not null default now(),
        add column updated_by uuid default auth.uid(),
        add column deleted_at timestamptz;
      create index %1$s_trip_version on public.%1$I (trip_id, row_version);
      alter table public.%1$I enable row level security;
    $f$, t);
  end loop;
  foreach t in array plan_tables loop
    execute format('create trigger %1$s_version before insert or update on public.%1$I
      for each row execute function public.stamp_row_version(%2$L)', t, 'plan');
  end loop;
  foreach t in array trip_tables loop
    execute format('create trigger %1$s_version before insert or update on public.%1$I
      for each row execute function public.stamp_row_version(%2$L)', t, 'trip');
  end loop;
  -- Klucz dokumentu unikalny w wyjeździe (tam, gdzie tabela go ma).
  foreach t in array plan_tables loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'ref') then
      execute format('create unique index %1$s_trip_ref on public.%1$I (trip_id, ref) where ref is not null', t);
    end if;
  end loop;
end $$;

create index items_day on public.items (day_id, sort_key) where deleted_at is null;
-- Kolejność w dniu jednoznaczna (PoC-0, A3) — tylko wśród punktów nieusuniętych.
create unique index items_day_sort on public.items (day_id, sort_key) where day_id is not null and deleted_at is null;

create trigger schedule_events_append_only before update on public.schedule_events
  for each row execute function public.forbid_update();

-- ── Historia zmian ───────────────────────────────────────────────────────────────────────────

-- „Kto co zmienił” (§5 `activity_log`): wstawienie bez różnic, zmiana — tylko zmienione pola,
-- miękkie usunięcie jako `delete`. Kolumny techniczne pomijane, żeby historia nie puchła.
create function public.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ignored text[] := array['row_version', 'updated_at', 'updated_by', 'created_at'];
  before_row jsonb;
  after_row jsonb;
  changes jsonb;
  action text;
begin
  if tg_op = 'INSERT' then
    action := 'insert';
  else
    before_row := to_jsonb(old) - ignored;
    after_row := to_jsonb(new) - ignored;
    select jsonb_object_agg(key, jsonb_build_array(before_row -> key, value))
      into changes
      from jsonb_each(after_row)
     where after_row -> key is distinct from before_row -> key;
    if changes is null then
      return new;
    end if;
    action := case when old.deleted_at is null and new.deleted_at is not null then 'delete' else 'update' end;
  end if;
  insert into public.activity_log (trip_id, actor_id, action, entity, entity_id, diff)
  values (new.trip_id, auth.uid(), action, tg_table_name, new.id, changes);
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items',
    'legs', 'constraints', 'contacts', 'budget_lines', 'tasks', 'packing_items', 'notes', 'sources', 'vehicles', 'documents',
    'expenses', 'settlements'] loop
    execute format('create trigger %1$s_activity after insert or update on public.%1$I
      for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- ── Uprawnienia ──────────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.public_shares enable row level security;
alter table public.activity_log enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.trip_members mine join public.trip_members theirs using (trip_id)
     where mine.user_id = auth.uid() and theirs.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- `owner_id` osobno: przy INSERT … RETURNING wiersza w `trip_members` jeszcze nie ma.
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));

create policy members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy members_insert on public.trip_members for insert to authenticated
  with check (public.is_trip_owner(trip_id));
create policy members_update on public.trip_members for update to authenticated
  using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));
-- Właściciel usuwa członków, każdy może wyjść sam; właściciela nie da się usunąć.
create policy members_delete on public.trip_members for delete to authenticated
  using (role <> 'owner' and (public.is_trip_owner(trip_id) or user_id = auth.uid()));

create policy invites_owner on public.trip_invites for all to authenticated
  using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

create policy shares_select on public.public_shares for select to authenticated
  using (public.is_trip_member(trip_id));
create policy shares_write on public.public_shares for all to authenticated
  using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

create policy activity_select on public.activity_log for select to authenticated
  using (public.is_trip_member(trip_id));

-- Plan i logistyka: każdy członek czyta, owner i editor piszą (§5, macierz uprawnień).
do $$
declare
  t text;
begin
  foreach t in array array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items',
    'legs', 'constraints', 'contacts', 'budget_lines', 'packing_items', 'notes', 'sources', 'vehicles', 'audio_guides',
    'weather_snapshots', 'settlements', 'plan_snapshots'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (public.is_trip_member(trip_id));
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_edit_trip(trip_id));
      create policy %1$s_update on public.%1$I for update to authenticated
        using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
    $f$, t);
  end loop;
  -- AI: tylko owner i editor, także do odczytu.
  foreach t in array array['ai_runs', 'ai_messages'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (public.can_edit_trip(trip_id));
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_edit_trip(trip_id));
      create policy %1$s_update on public.%1$I for update to authenticated
        using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
    $f$, t);
  end loop;
end $$;

-- Zdarzenia dnia: S „widz może przesuwać” przyjdzie jako uprawnienie członka; na MVP owner i editor.
create policy events_select on public.schedule_events for select to authenticated
  using (public.is_trip_member(trip_id));
create policy events_insert on public.schedule_events for insert to authenticated
  with check (public.can_edit_trip(trip_id) and created_by = auth.uid());

create policy expenses_select on public.expenses for select to authenticated
  using (public.is_trip_member(trip_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.can_add_expense(trip_id) and created_by = auth.uid());
-- Edytor poprawia każdy wydatek, widz z prawem dodawania — tylko własne.
create policy expenses_update on public.expenses for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and created_by = auth.uid()))
  with check (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and created_by = auth.uid()));

create function public.owns_expense(p_expense uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.expenses where id = p_expense and created_by = auth.uid())
$$;

create policy splits_select on public.expense_splits for select to authenticated
  using (public.is_trip_member(trip_id));
create policy splits_insert on public.expense_splits for insert to authenticated
  with check (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and public.owns_expense(expense_id)));
create policy splits_update on public.expense_splits for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and public.owns_expense(expense_id)))
  with check (public.can_edit_trip(trip_id) or (public.can_add_expense(trip_id) and public.owns_expense(expense_id)));

-- Dokumenty w sejfie: właściciel widzi wszystko; reszta wg `visibility` (§5, M11).
create function public.can_see_document(p_trip uuid, p_visibility text, p_visible_to uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_trip_owner(p_trip)
      or (public.is_trip_member(p_trip)
          and (p_visibility = 'all' or (p_visibility = 'members' and auth.uid() = any (p_visible_to))))
$$;

create policy documents_select on public.documents for select to authenticated
  using (public.can_see_document(trip_id, visibility, visible_to));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_edit_trip(trip_id) and public.can_see_document(trip_id, visibility, visible_to));
create policy documents_update on public.documents for update to authenticated
  using (public.can_edit_trip(trip_id) and public.can_see_document(trip_id, visibility, visible_to))
  with check (public.can_edit_trip(trip_id) and public.can_see_document(trip_id, visibility, visible_to));

-- Uczestnik „mój”: przypisany do mojego konta albo moje dziecko (opiekun z moim kontem).
create function public.is_my_traveler(p_traveler uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.travelers t
      left join public.travelers guardian on guardian.id = t.guardian_id
     where t.id = p_traveler and auth.uid() in (t.user_id, guardian.user_id)
  )
$$;

-- Zadania: widz odhacza tylko przypisane do siebie, i nic poza statusem (trigger niżej).
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_trip_member(trip_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_edit_trip(trip_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id)
    and exists (select 1 from unnest(assignee_ids) assignee where public.is_my_traveler(assignee))))
  with check (public.is_trip_member(trip_id));

-- RLS nie ogranicza kolumn — ten trigger pilnuje, żeby widz zmienił w zadaniu tylko status.
create function public.guard_viewer_task() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.can_edit_trip(new.trip_id)
     and (to_jsonb(new) - array['status', 'row_version', 'updated_at', 'updated_by'])
         is distinct from (to_jsonb(old) - array['status', 'row_version', 'updated_at', 'updated_by']) then
    raise exception 'Widz może tylko odhaczyć zadanie' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tasks_viewer_guard before update on public.tasks
  for each row execute function public.guard_viewer_task();

-- Pakowanie: widz odhacza własne pozycje i swoich dzieci.
create policy packing_checks_select on public.packing_checks for select to authenticated
  using (public.is_trip_member(trip_id));
create policy packing_checks_insert on public.packing_checks for insert to authenticated
  with check (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)));
create policy packing_checks_update on public.packing_checks for update to authenticated
  using (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)))
  with check (public.can_edit_trip(trip_id) or (public.is_trip_member(trip_id) and public.is_my_traveler(traveler_id)));

-- Usuwanie tylko miękkie (`deleted_at`) — twarde DELETE zgubiłoby się w synchronizacji.
-- Wyjątek: członkostwo (usunięcie członka nie jest danymi wyjazdu).
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on public.%I from anon', t.tablename);
    if t.tablename <> 'trip_members' then
      execute format('revoke delete on public.%I from authenticated', t.tablename);
    end if;
  end loop;
end $$;
revoke insert, update on public.activity_log from authenticated;

-- ── Pobieranie zmian ─────────────────────────────────────────────────────────────────────────

-- Tabele, które jadą na telefon (§6): plan, logistyka i zdarzenia z trasy. Bez AI, migawek
-- i historii zmian.
create function public.synced_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['trip_brief', 'travelers', 'places', 'variant_groups', 'variants', 'bookings', 'days', 'tracks', 'items', 'legs',
    'constraints', 'contacts', 'budget_lines', 'tasks', 'packing_items', 'notes', 'sources', 'vehicles', 'audio_guides',
    'schedule_events', 'documents', 'expenses', 'expense_splits', 'settlements', 'packing_checks', 'weather_snapshots']
$$;

-- Wszystko, co zmieniło się w wyjeździe po wersji `p_since`, w jednej migawce i jednym żądaniu.
-- SECURITY INVOKER: RLS działa jak przy zwykłym SELECT (widz nie dostanie cudzego dokumentu
-- `owner`). `p_since = 0` to pełna migawka bez usuniętych wierszy.
create function public.pull_changes(p_trip uuid, p_since bigint default 0) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  trip public.trips;
  tables jsonb := '{}'::jsonb;
  rows jsonb;
  t text;
begin
  select * into trip from public.trips where id = p_trip;
  if not found then
    return null;
  end if;
  foreach t in array public.synced_tables() loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(r) order by r.row_version), ''[]'') from public.%I r
        where r.trip_id = $1 and r.row_version > $2 and ($2 > 0 or r.deleted_at is null)', t)
      into rows using p_trip, p_since;
    tables := tables || jsonb_build_object(t, rows);
  end loop;
  return jsonb_build_object(
    'version', trip.sync_version,
    'planVersion', trip.plan_version,
    'trip', case when trip.row_version > p_since then to_jsonb(trip) - array['sync_version', 'plan_version'] end,
    'tables', tables
  );
end $$;

revoke execute on function public.pull_changes(uuid, bigint) from anon, public;
grant execute on function public.pull_changes(uuid, bigint) to authenticated;

-- ── Zapis całego dokumentu ───────────────────────────────────────────────────────────────────

-- Odwołania w dokumencie bywają w kółko (grupa wariantów → dzień → grupa kandydatów noclegu,
-- uczestnik → opiekun, punkt → blok), więc klucze obce sprawdzają się na końcu transakcji.
do $$
declare
  c record;
begin
  for c in select conrelid::regclass as tbl, conname from pg_constraint
            where contype = 'f' and connamespace = 'public'::regnamespace loop
    execute format('alter table %s alter constraint %I deferrable initially immediate', c.tbl, c.conname);
  end loop;
end $$;

-- Nowy wyjazd z wierszy dokumentu (`rowsFromDocument` w packages/sync) w jednej transakcji:
-- import planu, seed i testy. SECURITY INVOKER — wstawia wywołujący, z jego RLS (twórca zostaje
-- właścicielem). Wiersz wstawiany tylko z podanymi kolumnami, więc domyślne wartości działają.
create function public.import_trip(p_trip jsonb, p_tables jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  t text;
  r jsonb;
  cols text;
begin
  set constraints all deferred;
  select string_agg(quote_ident(key), ', ') into cols from jsonb_object_keys(p_trip) key;
  execute format('insert into public.trips (%1$s) select %1$s from jsonb_populate_record(null::public.trips, $1)', cols)
    using p_trip;
  foreach t in array public.synced_tables() loop
    for r in select value from jsonb_array_elements(coalesce(p_tables -> t, '[]')) loop
      select string_agg(quote_ident(key), ', ') into cols from jsonb_object_keys(r) key;
      execute format('insert into public.%2$I (%1$s) select %1$s from jsonb_populate_record(null::public.%2$I, $1)', cols, t)
        using r;
    end loop;
  end loop;
  return (p_trip ->> 'id')::uuid;
end $$;

revoke execute on function public.import_trip(jsonb, jsonb) from anon, public;
grant execute on function public.import_trip(jsonb, jsonb) to authenticated;

-- Telefon słucha tylko wiersza swojego wyjazdu: każda zmiana podbija `sync_version`, a klient
-- reaguje pobraniem przyrostowym (prościej i odporniej niż stosowanie payloadów z Realtime).
alter publication supabase_realtime add table public.trips;
