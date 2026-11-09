-- Zadatek zapłacony na poczet pozycji budżetu (zaliczka na nocleg, atrakcję): część kwoty już zapłacona,
-- reszta zostaje do wydania. Kwota łączna w walucie pozycji, także przy pozycji „na osobę”.
-- Pozycje budżetu nie trafiają do `public_trip`, więc link publiczny bez zmian.
alter table public.budget_lines add column deposit_minor bigint check (deposit_minor >= 0);
