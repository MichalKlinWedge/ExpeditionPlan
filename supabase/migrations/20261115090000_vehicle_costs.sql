-- Podział na auta: tabela `vehicles` (kierowca, miejsca, pasażerowie) wchodzi do dokumentu wyjazdu.
-- Paliwo i winiety dzielą się na osoby jednego auta: pozycja budżetu i wydatek mogą wskazać auto.
-- Klucze odroczalne jak pozostałe: `import_trip` wstawia pozycje budżetu przed autami.

-- Jak inne tabele dokumentu: klucz dokumentu (unikalny w wyjeździe) i kolejność.
alter table public.vehicles
  add column ref public.doc_ref,
  add column sort_key text;
create unique index vehicles_trip_ref on public.vehicles (trip_id, ref) where ref is not null;

alter table public.budget_lines
  add column vehicle_id uuid references public.vehicles (id) deferrable initially immediate;

alter table public.expenses
  add column vehicle_id uuid references public.vehicles (id) deferrable initially immediate;

comment on column public.budget_lines.vehicle_id is 'Koszt jednego auta (paliwo, winiety): dzieli się na kierowcę i pasażerów tego auta.';
comment on column public.expenses.vehicle_id is 'Wydatek jednego auta: bez własnego podziału (`expense_splits`) dzieli się na kierowcę i pasażerów tego auta.';
