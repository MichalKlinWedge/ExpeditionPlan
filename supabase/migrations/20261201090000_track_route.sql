-- „Trasy” wyjazdu (`core/route-library.ts`): ślady piesze i trasy autem do podpinania w planie. Środek, końce
-- (nazwa i współrzędne) i „Jedź przez” trasy autem; linia jak dotąd w `geojson`.
alter table public.tracks add column if not exists route jsonb;
