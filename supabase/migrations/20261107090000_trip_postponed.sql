-- Status „odłożony” (`postponed`): wyjazd bez pewnego terminu — do zaplanowania kiedyś albo taki,
-- który nie wypalił. Daty zostają jako orientacyjne (dni planu są z nimi związane), a listy pokazują
-- go w osobnej sekcji, nie w „Archiwum”. Zmienia go, jak inne pola wyjazdu, organizator lub edytor.

alter table public.trips drop constraint trips_status_check;
alter table public.trips add constraint trips_status_check check (status in ('planning', 'ready', 'ongoing', 'done', 'archived', 'postponed'));
