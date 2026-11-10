-- „Dokładnie do” (`ItemTime.precision = 'by'`, np. przejazd na lotnisko na 11:00): zapisana jest tylko
-- godzina końca (`end_time`), a początek liczy silnik planu wstecz od czasu trwania punktu.
-- Stare ograniczenie listy wartości usuwamy po treści, nie po nazwie (nazwa nadana automatycznie).
do $$
declare
  existing record;
begin
  for existing in
    select conname from pg_constraint
    where conrelid = 'public.items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%time_precision%'
  loop
    execute format('alter table public.items drop constraint %I', existing.conname);
  end loop;
end $$;

alter table public.items
  add constraint items_time_precision_check
  check (time_precision in ('exact', 'approx', 'range', 'part_of_day', 'day', 'relative', 'by'));
