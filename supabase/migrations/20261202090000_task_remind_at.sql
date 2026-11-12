-- Własne przypomnienie zadania: konkretna data i godzina (`{date, time}`, czas lokalny strefy dnia wyjazdu
-- z tą datą, inaczej strefy domowej). Telefon przypomina o nim zamiast o domyślnej godzinie z terminu,
-- póki zadanie jest otwarte. Przesuwa się ze zmianą terminu wyjazdu jak termin `absolute`.
alter table public.tasks add column if not exists remind_at jsonb;

create or replace function public.reschedule_trip(p_trip uuid, p_version bigint, p_start date, p_end date, p_changes jsonb, p_restore boolean default false) returns void
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
  update public.tasks t set due = c.due, remind_at = c.remind_at
    from jsonb_to_recordset(coalesce(p_changes -> 'tasks', '[]')) c(id uuid, due jsonb, remind_at jsonb)
   where t.id = c.id and t.trip_id = p_trip;
  update public.variant_groups t set decide_by = c.decide_by
    from jsonb_to_recordset(coalesce(p_changes -> 'variant_groups', '[]')) c(id uuid, decide_by jsonb)
   where t.id = c.id and t.trip_id = p_trip;
  update public.travelers t set from_date = c.from_date, to_date = c.to_date
    from jsonb_to_recordset(coalesce(p_changes -> 'travelers', '[]')) c(id uuid, from_date date, to_date date)
   where t.id = c.id and t.trip_id = p_trip;
  update public.trip_brief t set brief = c.brief
    from jsonb_to_recordset(coalesce(p_changes -> 'trip_brief', '[]')) c(id uuid, brief jsonb)
   where t.id = c.id and t.trip_id = p_trip;

  update public.trips
     set start_date = p_start, end_date = p_end, status = case when p_restore then 'planning' else status end
   where id = p_trip;
end $$;
