-- Znane konta: organizator dodaje do nowego wyjazdu osoby, które już są w jego innych wyjazdach,
-- bez wysyłania linku zaproszenia (web „Uczestnicy i dostęp” → „Dodaj z moich wyjazdów”).
-- Widzi tylko konta z wyjazdów, których jest właścicielem (sam je kiedyś zaprosił), nigdy całą bazę.

-- Konta z moich (właściciel) nieusuniętych wyjazdów, których jeszcze nie ma w `p_trip`; bez mnie.
-- Przy koncie: e-mail, nazwa, ostatni wspólny wyjazd i liczba wspólnych wyjazdów.
create function public.known_accounts(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Konta z innych wyjazdów widzi tylko organizator' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_data order by last_start desc nulls last, label)
    from (
      select
        jsonb_build_object(
          'user_id', m.user_id,
          'email', u.email,
          'display_name', p.display_name,
          'trips', count(distinct t.id),
          'last_trip', (array_agg(t.title order by t.start_date desc nulls last))[1]
        ) as row_data,
        max(t.start_date) as last_start,
        coalesce(p.display_name, u.email) as label
      from public.trip_members m
      join public.trips t on t.id = m.trip_id and t.owner_id = auth.uid() and t.deleted_at is null
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.user_id <> auth.uid()
        and not exists (select 1 from public.trip_members x where x.trip_id = p_trip and x.user_id = m.user_id)
      group by m.user_id, u.email, p.display_name
    ) known
  ), '[]'::jsonb);
end $$;

-- Dodanie znanego konta do wyjazdu (rola edytor albo widz) i opcjonalnie przypisanie do uczestnika
-- bez konta. Konto musi być w innym wyjeździe tego organizatora. Zwraca e-mail konta (do wiadomości
-- o dostępie). Już dodane konto: bez zmiany roli, błąd z komunikatem.
create function public.add_known_member(p_trip uuid, p_user uuid, p_role text, p_traveler uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  address text;
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Osoby do wyjazdu dodaje organizator' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'Rola: edytor albo widz' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.trip_members m
      join public.trips t on t.id = m.trip_id and t.owner_id = auth.uid() and t.deleted_at is null
     where m.user_id = p_user and m.user_id <> auth.uid() and m.trip_id <> p_trip
  ) then
    raise exception 'To konto nie jest w żadnym Twoim wyjeździe' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_user) then
    raise exception 'To konto już ma dostęp do tego wyjazdu' using errcode = '23505';
  end if;
  insert into public.trip_members (trip_id, user_id, role) values (p_trip, p_user, p_role);
  if p_traveler is not null then
    update public.travelers set user_id = p_user
     where id = p_traveler and trip_id = p_trip and user_id is null and deleted_at is null;
  end if;
  select email into address from auth.users where id = p_user;
  return address;
end $$;

revoke execute on function public.known_accounts(uuid) from anon, public;
revoke execute on function public.add_known_member(uuid, uuid, text, uuid) from anon, public;
grant execute on function public.known_accounts(uuid) to authenticated;
grant execute on function public.add_known_member(uuid, uuid, text, uuid) to authenticated;
