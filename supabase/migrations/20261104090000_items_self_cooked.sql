-- Posiłek, który grupa przygotowuje sama (chatka, ognisko, kuchnia w kwaterze) — z tego liczą
-- się porcje i lista zakupów. Brak wartości = nie wiadomo (plan tego nie mówi).
alter table public.items add column self_cooked boolean;
