-- Dzień bez scenariuszy optymistyczny / pesymistyczny: false = liczy się tylko krótszy czas punktów,
-- a plan nie pokazuje przełącznika. NULL = scenariusze są (jak dotąd).
alter table public.days add column scenarios boolean;
