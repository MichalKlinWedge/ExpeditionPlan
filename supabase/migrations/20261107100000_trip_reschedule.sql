-- Zmiana terminu wyjazdu (`shiftTripDates` w packages/core liczy, co się przesuwa). `days` nie ma
-- unikalności daty, ale zapis obejmuje kilka tabel, a wyjazd z datami na pół przesuniętymi byłby
-- gorszy niż brak zmiany — stąd jedna transakcja. SECURITY INVOKER: działa RLS wywołującego, a pierwszy
-- warunek daje czytelny błąd zamiast cichego „0 wierszy”.
--
-- `p_version` to `sync_version` z migawki, na której policzono zmiany: elementu dodanego w międzyczasie
-- nie ma w `p_changes`, więc zostałby przy starej dacie. Długość wyjazdu się nie zmienia. Tylko te
-- kolumny da się tędy zmienić. `p_restore` = powrót z „Odłożonych” razem z nowym terminem.
create function public.reschedule_trip(p_trip uuid, p_version bigint, p_start date, p_end date, p_changes jsonb, p_restore boolean default false) returns void
language plpgsql set search_path = '' as $$
declare
  trip public.trips;
begin
  if not public.can_edit_trip(p_trip) then
    raise exception 'Brak uprawnień do zmiany terminu' using errcode = '42501';
  end if;
  select * into strict trip from public.trips where id = p_trip for update;
  if trip.sync_version <> p_version then
    raise exception 'Plan zmienił się w międzyczasie' using errcode = 'EP001';
  end if;
  if p_end - p_start <> trip.end_date - trip.start_date then
    raise exception 'Zmiana terminu nie zmienia długości wyjazdu' using errcode = '22023';
  end if;

  update public.days t set date = c.date
    from jsonb_to_recordset(coalesce(p_changes -> 'days', '[]')) c(id uuid, date date)
   where t.id = c.id and t.trip_id = p_trip;
  update public.bookings t set start_date = c.start_date, end_date = c.end_date, free_cancellation_until = c.free_cancellation_until
    from jsonb_to_recordset(coalesce(p_changes -> 'bookings', '[]')) c(id uuid, start_date date, end_date date, free_cancellation_until date)
   where t.id = c.id and t.trip_id = p_trip;
  update public.tasks t set due = c.due
    from jsonb_to_recordset(coalesce(p_changes -> 'tasks', '[]')) c(id uuid, due jsonb)
   where t.id = c.id and t.trip_id = p_trip;
  update public.variant_groups t set decide_by = c.decide_by
    from jsonb_to_recordset(coalesce(p_changes -> 'variant_groups', '[]')) c(id uuid, decide_by jsonb)
   where t.id = c.id and t.trip_id = p_trip;
  update public.trip_brief t set brief = c.brief
    from jsonb_to_recordset(coalesce(p_changes -> 'trip_brief', '[]')) c(id uuid, brief jsonb)
   where t.id = c.id and t.trip_id = p_trip;

  update public.trips
     set start_date = p_start, end_date = p_end, status = case when p_restore then 'planning' else status end
   where id = p_trip;
end $$;

revoke execute on function public.reschedule_trip(uuid, bigint, date, date, jsonb, boolean) from anon, public;
grant execute on function public.reschedule_trip(uuid, bigint, date, date, jsonb, boolean) to authenticated;
