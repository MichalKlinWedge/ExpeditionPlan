-- Dopłata po zadatku: termin zapłaty reszty pozycji budżetu i zadanie „Dopłata: …” powiązane z pozycją
-- (`core/budget-balance.ts`). Termin to warunek umowy, więc nie przesuwa się ze zmianą terminu wyjazdu.
-- Pozycje budżetu nie trafiają do `public_trip`; zadania też nie.
alter table public.budget_lines add column balance_due date;
alter table public.tasks add column budget_line_id uuid references public.budget_lines (id) deferrable initially immediate;
