-- Usuwanie wyjazdu i wyjście z wyjazdu. Usunięcie jest miękkie (`trips.deleted_at`, bez twardych
-- DELETE — §5 „Konwencje”): wiersze zostają w bazie, ale nikt — także właściciel — już ich nie
-- widzi. `pull_changes` dla usuniętego wyjazdu zwraca `null` jak przy braku dostępu, więc telefon
-- traktuje go jak wyjazd, z którego go usunięto.

-- Rola w usuniętym wyjeździe nie istnieje: wszystkie polityki RLS (członek czyta, edytor pisze)
-- stoją na `trip_role`, więc jedna zmiana odcina cały wyjazd — plan, logistykę, zapisy z telefonu.
create or replace function public.trip_role(p_trip uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.trip_members m
    join public.trips t on t.id = m.trip_id
   where m.trip_id = p_trip and m.user_id = auth.uid() and t.deleted_at is null
$$;

-- Właściciel widział wyjazd także po `owner_id` (INSERT … RETURNING) — tu też bez usuniętych.
drop policy trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.is_trip_member(id)));

-- Tylko właściciel. Zaproszenia i link publiczny gasną razem z wyjazdem.
create function public.delete_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Tylko właściciel usuwa wyjazd' using errcode = '42501';
  end if;
  update public.trips set deleted_at = now() where id = p_trip;
  update public.trip_invites set revoked_at = now() where trip_id = p_trip and revoked_at is null;
  update public.public_shares set enabled = false, updated_at = now() where trip_id = p_trip;
end $$;

-- Edytor i widz wychodzą sami (to samo pozwala polityka `members_delete`, ale tu z komunikatem
-- zamiast cichego „0 wierszy”). Właściciel nie wychodzi — wyjazd bez właściciela nie ma kto prowadzić.
create function public.leave_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  my_role text := public.trip_role(p_trip);
begin
  if my_role is null then
    raise exception 'Nie jesteś w tym wyjeździe' using errcode = 'P0002';
  end if;
  if my_role = 'owner' then
    raise exception 'Właściciel nie opuszcza wyjazdu — może go usunąć' using errcode = '42501';
  end if;
  delete from public.trip_members where trip_id = p_trip and user_id = auth.uid();
end $$;

revoke execute on function public.delete_trip(uuid) from anon, public;
revoke execute on function public.leave_trip(uuid) from anon, public;
grant execute on function public.delete_trip(uuid) to authenticated;
grant execute on function public.leave_trip(uuid) to authenticated;
