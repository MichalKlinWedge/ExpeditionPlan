-- Postoje i przerwy w trakcie punktu: wydłużają go ponad czas drogi lub trwania. Osobno od `leg`,
-- żeby przeliczenie trasy ich nie kasowało, i od `buffer_after_min`, który leży już po punkcie.

alter table public.items add column stops_min integer check (stops_min >= 0);
