-- Punkt wspólny dla wariantów może być postojem w trasie w każdym z nich: `parent_id` to pierwszy przejazd,
-- tu są przejazdy z pozostałych wariantów. Tablica jak `variant_ids`, bez kluczy obcych.
alter table public.items add column route_parent_ids uuid[] not null default '{}';
