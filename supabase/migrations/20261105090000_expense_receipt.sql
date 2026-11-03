-- Zdjęcie paragonu przy wydatku (Etap 9). Plik leży w prywatnym buckecie `journal` (zdjęcia z trasy:
-- dziennik i paragony) pod `<trip_id>/receipt-<expense_id>/paragon.<ext>` — te same zasady dostępu
-- (uczestnicy czytają i wgrywają, usuwa autor albo organizator/edytor) i ta sama kolejka wysyłki
-- na telefonie. Ścieżka musi wskazywać katalog tego wyjazdu.

alter table public.expenses
  add column receipt_path text check (receipt_path is null or coalesce(public.storage_trip(receipt_path) = trip_id, false));

comment on column public.expenses.receipt_path is 'Zdjęcie paragonu w buckecie journal: <trip_id>/receipt-<expense_id>/paragon.<ext>.';
