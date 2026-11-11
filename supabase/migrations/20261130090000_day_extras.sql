-- „Po drodze i w pobliżu”: atrakcje przy trasie i punktach dnia (`DocDay.extras`, core/day-extras.ts),
-- z OpenStreetMap (ODbL, podpis przy liście) albo z puli, wybrane i opisane przez AI na kliknięcie.
alter table public.days add column if not exists extras jsonb;
