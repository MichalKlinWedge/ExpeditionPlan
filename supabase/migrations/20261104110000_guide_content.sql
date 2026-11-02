-- Przewodnik po punkcie (M8, etap 1): treść w postaci danych — opis, ciekawostki, historia,
-- wskazówki, zdjęcia z Commons (z licencją i autorem) i artykuł źródłowy. `text` zostaje do czytania
-- na głos (etap audio). Zgodność z `GuideContent` (packages/core) pilnuje aplikacja.
alter table public.audio_guides add column content jsonb not null default '{}'::jsonb;
