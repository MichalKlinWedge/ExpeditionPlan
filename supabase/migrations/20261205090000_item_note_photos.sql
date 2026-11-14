-- Zdjęcia przy uwagach punktu planu (`DocItem.notePhotos`): adres pliku, podpis i autor.
-- Pliki leżą w publicznym bucketcie `guide_photos` (`<wyjazd>/<uuid>.jpg`), jak własne zdjęcia opisów
-- miejsc: telefon trzyma je offline po adresie. Wgrywa i usuwa organizator albo edytor (polityki bucketu).
alter table public.items add column if not exists note_photos jsonb;
