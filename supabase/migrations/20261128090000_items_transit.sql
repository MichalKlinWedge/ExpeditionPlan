-- Znacznik „Dojazd lub powrót” także dla punktów innych niż przejazd (zbiórka na lotnisku, odprawa).
-- Przejazd ma go dalej w `leg.transit`. Brak wartości = samo rozpoznanie (lot, droga od 250 km).
alter table public.items add column transit boolean;
