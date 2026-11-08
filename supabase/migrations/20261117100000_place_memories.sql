-- Pamięć miejsc między wyjazdami (strona „Wszystkie miejsca”): każdy uczestnik ocenia miejsce „warto / nie warto”
-- i zostawia notatkę na przyszłość. Wpis nie należy do jednego wyjazdu, więc nie ma `trip_id` ani nie jest w
-- `TripDocument`: to samo miejsce w różnych wyjazdach łączy klucz nazwy (`place_key`, jak `plainName` w core)
-- i bliskie współrzędne (≤ 1 km, jak `SAME_NAME_M`; brak współrzędnych po którejś stronie = pasuje).
-- Lata wizyt nie są tu zapisane: liczą się z dat wyjazdów, w których miejsce było w planie (`placeVisitYears`).
--
-- Wpis widzi każdy uczestnik (dowolna rola) wyjazdu, w którym jest pasujące miejsce, i oczywiście autor.
-- Pisze się tylko przez `set_place_memory` (jeden wpis na osobę i miejsce, autor = imię z wyjazdu).

-- Klucz nazwy: małe litery, ł → l, bez znaków diakrytycznych, wszystko poza literami i cyframi = spacja.
create function public.place_key(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(normalize(replace(lower(p_name), 'ł', 'l'), NFD), '[̀-ͯ]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))
$$;

-- Odległość w metrach (haversine), jak `distanceM` w core.
create function public.distance_m(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns double precision
language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ))
$$;

create index places_place_key on public.places (public.place_key(name)) where deleted_at is null;

create table public.place_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Imię autora z wyjazdu, z którego pisał (ktoś z innego wyjazdu nie widzi jego profilu).
  author_name text not null check (char_length(author_name) between 1 and 120),
  -- Nazwa i współrzędne miejsca z chwili pierwszego wpisu; `name_key` = `place_key(name)`.
  name text not null check (char_length(name) between 1 and 300),
  name_key text not null check (name_key <> ''),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  verdict text check (verdict in ('worth', 'not_worth')),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verdict is not null or note is not null)
);
create index place_memories_key on public.place_memories (name_key);
create index place_memories_user on public.place_memories (user_id, name_key);
alter table public.place_memories enable row level security;

-- Czy mam (jako uczestnik dowolnej roli) wyjazd z miejscem o tym kluczu blisko tych współrzędnych.
create function public.can_see_place_memory(p_key text, p_lat double precision, p_lng double precision) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.trip_members m
      join public.trips t on t.id = m.trip_id and t.deleted_at is null
      join public.places p on p.trip_id = m.trip_id and p.deleted_at is null
     where m.user_id = auth.uid()
       and public.place_key(p.name) = p_key
       and (p_lat is null or p_lng is null or p.lat is null or p.lng is null
            or public.distance_m(p_lat, p_lng, p.lat, p.lng) <= 1000)
  )
$$;

create policy place_memories_select on public.place_memories for select to authenticated
  using (user_id = auth.uid() or public.can_see_place_memory(name_key, lat, lng));
revoke all on public.place_memories from anon;
revoke insert, update, delete on public.place_memories from authenticated;

-- Ocena i notatka dla miejsca `p_place` (dowolne jego wystąpienie w moim wyjeździe). Mój wcześniejszy wpis
-- o tym samym miejscu (klucz + bliskie współrzędne) jest nadpisywany; pusta ocena i notatka usuwa wpis.
create function public.set_place_memory(p_place uuid, p_verdict text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_place public.places;
  v_key text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_author text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Zaloguj się.' using errcode = '42501';
  end if;
  select * into v_place from public.places where id = p_place and deleted_at is null;
  if not found or not public.is_trip_member(v_place.trip_id) then
    raise exception 'Nie ma takiego miejsca w Twoich wyjazdach.' using errcode = '42501';
  end if;
  if p_verdict is not null and p_verdict not in ('worth', 'not_worth') then
    raise exception 'Nieznana ocena: %', p_verdict using errcode = '23514';
  end if;
  v_key := public.place_key(v_place.name);
  if v_key = '' then
    raise exception 'Miejsce bez nazwy.' using errcode = '23514';
  end if;

  select id into v_id from public.place_memories
   where user_id = auth.uid() and name_key = v_key
     and (lat is null or lng is null or v_place.lat is null or v_place.lng is null
          or public.distance_m(lat, lng, v_place.lat, v_place.lng) <= 1000)
   order by updated_at desc
   limit 1;

  if p_verdict is null and v_note is null then
    delete from public.place_memories where id = v_id;
    return null;
  end if;

  v_author := coalesce(
    (select name from public.travelers where trip_id = v_place.trip_id and user_id = auth.uid() and deleted_at is null order by created_at limit 1),
    (select display_name from public.profiles where id = auth.uid()),
    'Uczestnik');

  if v_id is null then
    insert into public.place_memories (user_id, author_name, name, name_key, lat, lng, verdict, note)
    values (auth.uid(), left(v_author, 120), v_place.name, v_key, v_place.lat, v_place.lng, p_verdict, v_note)
    returning id into v_id;
  else
    update public.place_memories
       set verdict = p_verdict, note = v_note, author_name = left(v_author, 120), updated_at = now(),
           lat = coalesce(lat, v_place.lat), lng = coalesce(lng, v_place.lng)
     where id = v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.set_place_memory(uuid, text, text) from public, anon;
grant execute on function public.set_place_memory(uuid, text, text) to authenticated;
revoke all on function public.can_see_place_memory(text, double precision, double precision) from public, anon;
grant execute on function public.can_see_place_memory(text, double precision, double precision) to authenticated;
