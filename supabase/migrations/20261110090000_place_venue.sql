-- Dane lokalu (restauracja, kawiarnia): opis, przykładowe ceny i ocena odczytane z tekstu wklejonego przez użytkownika.
-- Kształt: `Venue` w packages/core/src/schemas/trip-document.ts.
alter table public.places add column venue jsonb;
