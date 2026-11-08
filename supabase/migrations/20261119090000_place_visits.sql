-- Pamięć miejsc: ocenić „warto / nie warto” można tylko miejsce, w którym już byliśmy. Wizyta = punkt planu
-- (zaplanowany, nie z puli) w tym miejscu albo z przejazdem do niego, w wyjeździe, w którym jestem uczestnikiem
-- (bez odłożonych), a data i godzina punktu z planu już minęły. Bez godziny w planie (część dnia, „+1:20”,
-- cały dzień) liczy się koniec dnia. Notatkę na przyszłość można zostawić zawsze.
-- Lata wizyt („byliśmy w 2025”) liczą się z tych samych wierszy (`my_visited_places`, `placeVisitYears` w core).

-- Moje odwiedzone miejsca: wystąpienie miejsca w moim wyjeździe i dzień pierwszej minionej wizyty.
create function public.my_visited_places()
returns table (place_id uuid, trip_id uuid, name text, lat double precision, lng double precision, visited_on date)
language sql stable security definer set search_path = '' as $$
  select p.id, p.trip_id, p.name, p.lat, p.lng, min(d.date)
    from public.trip_members m
    join public.trips t on t.id = m.trip_id and t.deleted_at is null and t.status <> 'postponed'
    join public.places p on p.trip_id = m.trip_id and p.deleted_at is null
    join public.items i on i.trip_id = p.trip_id and i.deleted_at is null and i.plan_status = 'scheduled'
         and (i.place_id = p.id or i.leg ->> 'toPlaceRef' = p.ref)
    join public.days d on d.id = i.day_id and d.deleted_at is null
   where m.user_id = auth.uid()
     and ((d.date + coalesce(i.start_time, '23:59')::time) at time zone coalesce(i.time_tz, d.tz)) <= now()
   group by p.id, p.trip_id, p.name, p.lat, p.lng
$$;

revoke all on function public.my_visited_places() from public, anon;
grant execute on function public.my_visited_places() to authenticated;

-- Czy byłem w miejscu o tym kluczu blisko tych współrzędnych (dowolny mój wyjazd, jak `can_see_place_memory`).
create function public.place_visited(p_key text, p_lat double precision, p_lng double precision) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.my_visited_places() v
     where public.place_key(v.name) = p_key
       and (p_lat is null or p_lng is null or v.lat is null or v.lng is null
            or public.distance_m(p_lat, p_lng, v.lat, v.lng) <= 1000)
  )
$$;

revoke all on function public.place_visited(text, double precision, double precision) from public, anon;
grant execute on function public.place_visited(text, double precision, double precision) to authenticated;

-- Ocena tylko po wizycie; cofnięcie oceny i notatka bez warunku.
create or replace function public.set_place_memory(p_place uuid, p_verdict text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_place public.places;
  v_key text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_author text;
  v_id uuid;
  v_old text;
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

  select id, verdict into v_id, v_old from public.place_memories
   where user_id = auth.uid() and name_key = v_key
     and (lat is null or lng is null or v_place.lat is null or v_place.lng is null
          or public.distance_m(lat, lng, v_place.lat, v_place.lng) <= 1000)
   order by updated_at desc
   limit 1;

  -- Wcześniejszą ocenę można zostawić bez zmian (np. przy zapisie samej notatki), nową tylko po wizycie.
  if p_verdict is not null and p_verdict is distinct from v_old and not public.place_visited(v_key, v_place.lat, v_place.lng) then
    raise exception 'Ocenić można tylko miejsce, w którym już byliście: punkt planu z tym miejscem, którego data i godzina minęły.'
      using errcode = '23514';
  end if;

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
