-- Wspólna biblioteka opisów miejsc: gotowy przewodnik z artykułu Wikipedii albo Wikivoyage, żeby ten sam
-- artykuł nie szedł do AI w każdym wyjeździe. Treść jest kopiowana do `audio_guides` wyjazdu (telefon działa
-- offline na danych wyjazdu), więc odświeżenie tutaj nie zmienia opisów w innych wyjazdach.
-- Bez wskazówek organizatora: tekst powstaje wyłącznie z artykułu, a licencja CC BY-SA pozwala go dzielić.
create table public.guide_library (
  site text not null check (site in ('wikipedia', 'wikivoyage')),
  lang text not null,
  article_title text not null,
  content jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (site, lang, article_title)
);

alter table public.guide_library enable row level security;

-- Czytają zalogowani. Zapisują konta, które mogą zakładać wyjazdy: klucza serwisowego w aplikacji nie ma.
create policy guide_library_select on public.guide_library for select to authenticated using (true);
create policy guide_library_insert on public.guide_library for insert to authenticated with check (public.can_create_trips());
create policy guide_library_update on public.guide_library for update to authenticated using (public.can_create_trips()) with check (public.can_create_trips());
