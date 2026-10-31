-- MVP-1, część 1: typy, wersjonowanie, konta, wyjazdy, członkowie, zaproszenia (SPECYFIKACJA §5).
--
-- Konwencje (§5): id z klienta (UUIDv7), `trip_id` w każdej tabeli wyjazdu, miękkie usuwanie,
-- `row_version` stemplowany triggerem z `trips.sync_version` (§6, PoC-4). Kolumny wspólne tabel
-- wyjazdu, triggery i polityki RLS dokłada pętla w migracji `mvp1_access` — tu tylko to, co
-- specyficzne dla tabeli.

-- ── Typy wspólne ─────────────────────────────────────────────────────────────────────────────

-- Godzina lokalna planu tak, jak w Zod (`LocalTime`): tekst „09:45”, bez sekund i bez strefy.
create domain public.local_time as text check (value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
create domain public.currency_code as text check (value ~ '^[A-Z]{3}$');
-- Klucz elementu dokumentu („d1”, „lot-tam”) — unikalny w wyjeździe, na nim stoją importy i łatki AI.
create domain public.doc_ref as text check (value ~ '^[a-z0-9][a-z0-9-]*$');

-- ── Wersje ───────────────────────────────────────────────────────────────────────────────────

-- Stempel wiersza tabeli wyjazdu. SECURITY DEFINER, bo widz dodający wydatek nie ma prawa
-- zmieniać wiersza wyjazdu, a licznik i tak musi się podbić. TG_ARGV[0] = 'plan' podbija też
-- `plan_version` (zmiana planu, nie zdarzenie z trasy).
create function public.stamp_row_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.trips
     set sync_version = sync_version + 1,
         plan_version = plan_version + case when tg_argv[0] = 'plan' then 1 else 0 end
   where id = new.trip_id
  returning sync_version into new.row_version;
  if new.row_version is null then
    raise exception 'Brak wyjazdu %', new.trip_id;
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
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
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;

-- Tabele tylko do dopisywania: poprawka to nowy wiersz, nie zmiana starego.
create function public.forbid_update() returns trigger
language plpgsql as $$
begin
  raise exception 'Tabela % jest tylko do dopisywania', tg_table_name;
end $$;

-- ── Konta ────────────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'pl',
  home_currency public.currency_code not null default 'PLN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profil powstaje razem z kontem (Google albo magic link) — nazwa z metadanych dostawcy.
create function public.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger users_profile after insert on auth.users
  for each row execute function public.create_profile();

-- ── Wyjazdy ──────────────────────────────────────────────────────────────────────────────────

create table public.trips (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id),
  title text not null,
  subtitle text,
  -- Założenia: po co ten wyjazd i co w nim najważniejsze.
  goal text,
  summary text,
  status text not null default 'planning' check (status in ('planning', 'ready', 'ongoing', 'done', 'archived')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  primary_tz text not null,
  home_tz text not null default 'Europe/Warsaw',
  base_currency public.currency_code not null,
  -- Kursy przyjęte w planie: [{currency, rateToBase, date}].
  fx jsonb not null default '[]'::jsonb,
  -- Numer wersji z dokumentu źródłowego („v4”).
  doc_version text,
  cover_path text,
  plan_version bigint not null default 0,
  sync_version bigint not null default 0,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz
);

create trigger trips_version before insert or update on public.trips
  for each row execute function public.stamp_trip_version();

create table public.trip_members (
  trip_id uuid not null references public.trips (id),
  user_id uuid not null references auth.users (id),
  role text not null check (role in ('owner', 'editor', 'viewer')),
  can_add_expenses boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index trip_members_user on public.trip_members (user_id);

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

-- ── Uprawnienia: funkcje pomocnicze ──────────────────────────────────────────────────────────

create function public.trip_role(p_trip uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.trip_members where trip_id = p_trip and user_id = auth.uid()
$$;

create function public.is_trip_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.trip_role(p_trip) is not null
$$;

create function public.can_edit_trip(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.trip_role(p_trip) in ('owner', 'editor'), false)
$$;

create function public.is_trip_owner(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.trip_role(p_trip) = 'owner', false)
$$;

create function public.can_add_expense(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members
     where trip_id = p_trip and user_id = auth.uid()
       and (role in ('owner', 'editor') or can_add_expenses)
  )
$$;

-- ── Zaproszenia i link publiczny ─────────────────────────────────────────────────────────────

-- W bazie tylko hasz tokena (jak skrytka FormaSync): wyciek tabeli nie daje wejścia do wyjazdu.
create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id),
  role text not null check (role in ('editor', 'viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index trip_invites_trip on public.trip_invites (trip_id);

create table public.public_shares (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips (id),
  token_hash text not null unique,
  -- Co ukryć w widoku publicznym: {costs, vault, lodgingAddress, names}.
  hide jsonb not null default '{"costs": true, "vault": true, "lodgingAddress": true, "names": false}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.token_digest(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$$;

-- Właściciel tworzy zaproszenie; token wraca raz, do linku, w bazie zostaje tylko hasz.
create function public.create_invite(p_trip uuid, p_role text default 'viewer', p_days integer default 14, p_max_uses integer default 1)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  token text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Tylko właściciel zaprasza do wyjazdu' using errcode = '42501';
  end if;
  insert into public.trip_invites (trip_id, role, token_hash, expires_at, max_uses)
  values (p_trip, p_role, public.token_digest(token), now() + make_interval(days => p_days), p_max_uses);
  return token;
end $$;

-- Dołączenie z linku. Kto już jest członkiem, zostaje ze swoją rolą (zaproszenie widza nie
-- odbierze edytorowi prawa zapisu). Zwraca id wyjazdu.
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  invite public.trip_invites;
begin
  if auth.uid() is null then
    raise exception 'Zaloguj się, żeby dołączyć' using errcode = '42501';
  end if;
  select * into invite from public.trip_invites
   where token_hash = public.token_digest(p_token)
   for update;
  if not found or invite.revoked_at is not null or invite.expires_at < now() or invite.used_count >= invite.max_uses then
    raise exception 'Zaproszenie jest nieważne' using errcode = 'P0002';
  end if;
  insert into public.trip_members (trip_id, user_id, role)
  values (invite.trip_id, auth.uid(), invite.role)
  on conflict (trip_id, user_id) do nothing;
  if found then
    update public.trip_invites set used_count = used_count + 1 where id = invite.id;
  end if;
  return invite.trip_id;
end $$;

revoke execute on function public.create_invite(uuid, text, integer, integer) from anon, public;
revoke execute on function public.accept_invite(text) from anon, public;
grant execute on function public.create_invite(uuid, text, integer, integer) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
