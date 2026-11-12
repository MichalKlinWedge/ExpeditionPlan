-- Ankieta ogólna na stronie „Głosowanie” (np. „Gdzie jemy w sobotę?”): grupa wyborów `scope = 'poll'` bez związku
-- z planem — opcje to jej warianty, głosy idą do `trip_votes` jak przy wariantach planu.
alter table public.variant_groups drop constraint if exists variant_groups_scope_check;
alter table public.variant_groups add constraint variant_groups_scope_check check (scope in ('item', 'block', 'day', 'trip', 'booking', 'poll'));
