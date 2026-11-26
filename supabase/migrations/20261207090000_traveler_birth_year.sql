-- Uczestnik: rok urodzenia zamiast wieku. Wiek liczy aplikacja na początek wyjazdu (`core/traveler-age.ts`),
-- więc nie starzeje się przy planach na kolejne lata ani przy zmianie terminu.

alter table public.travelers add column birth_year integer check (birth_year between 1900 and 2100);

-- Dotychczasowy wiek odnosił się do wyjazdu: rok jego początku minus wiek.
update public.travelers t
   set birth_year = extract(year from tr.start_date)::integer - t.age
  from public.trips tr
 where tr.id = t.trip_id and t.age is not null and tr.start_date is not null;

alter table public.travelers drop column age;
