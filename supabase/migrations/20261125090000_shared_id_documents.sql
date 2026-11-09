-- Ważność paszportu i dowodu idzie za kontem: osoba połączona z kontem (`travelers.user_id`) ma te same
-- dokumenty w każdym wyjeździe. Wpisana data uzupełnia PUSTE pola tej osoby w innych wyjazdach (nigdy
-- nie nadpisuje wpisanej), a uczestnik świeżo połączony z kontem dostaje brakujące daty z innych wyjazdów.
-- Wyzwalacze są `security definer`, bo inne wyjazdy mogą mieć innego organizatora; zmiana trafia tam
-- zwykłą drogą (wersje wierszy, „co nowego”). Link publiczny i tak tych dat nie pokazuje (`public_trip`).

-- Przed zapisem: uczestnik z nowym kontem (albo nowy z kontem) bierze brakujące daty z innych wyjazdów
-- tej osoby — najświeżej zmienione.
create function public.fill_id_documents() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then
    return new;
  end if;
  if new.passport_until is null then
    select t.passport_until into new.passport_until from public.travelers t
     where t.user_id = new.user_id and t.id <> new.id and t.deleted_at is null and t.passport_until is not null
     order by t.updated_at desc limit 1;
  end if;
  if new.id_card_until is null then
    select t.id_card_until into new.id_card_until from public.travelers t
     where t.user_id = new.user_id and t.id <> new.id and t.deleted_at is null and t.id_card_until is not null
     order by t.updated_at desc limit 1;
  end if;
  return new;
end $$;

-- Po zapisie: wpisane daty trafiają do pustych pól tej osoby w innych wyjazdach. Tylko z pierwszego
-- poziomu (te aktualizacje same niczego dalej nie rozsyłają).
create function public.share_id_documents() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 or new.user_id is null or new.deleted_at is not null then
    return null;
  end if;
  if new.passport_until is not null and (tg_op = 'INSERT' or new.passport_until is distinct from old.passport_until or new.user_id is distinct from old.user_id) then
    update public.travelers set passport_until = new.passport_until
     where user_id = new.user_id and id <> new.id and deleted_at is null and passport_until is null;
  end if;
  if new.id_card_until is not null and (tg_op = 'INSERT' or new.id_card_until is distinct from old.id_card_until or new.user_id is distinct from old.user_id) then
    update public.travelers set id_card_until = new.id_card_until
     where user_id = new.user_id and id <> new.id and deleted_at is null and id_card_until is null;
  end if;
  return null;
end $$;

create trigger travelers_documents_fill before insert or update of user_id on public.travelers
  for each row execute function public.fill_id_documents();
create trigger travelers_documents_share after insert or update of passport_until, id_card_until, user_id on public.travelers
  for each row execute function public.share_id_documents();

-- Osoby już połączone z kontem: jednorazowo uzupełnij puste daty z ich innych wyjazdów.
update public.travelers t set
  passport_until = coalesce(t.passport_until, (select o.passport_until from public.travelers o
    where o.user_id = t.user_id and o.id <> t.id and o.deleted_at is null and o.passport_until is not null order by o.updated_at desc limit 1)),
  id_card_until = coalesce(t.id_card_until, (select o.id_card_until from public.travelers o
    where o.user_id = t.user_id and o.id <> t.id and o.deleted_at is null and o.id_card_until is not null order by o.updated_at desc limit 1))
where t.user_id is not null and t.deleted_at is null and (t.passport_until is null or t.id_card_until is null)
  and exists (select 1 from public.travelers o where o.user_id = t.user_id and o.id <> t.id and o.deleted_at is null
    and (o.passport_until is not null or o.id_card_until is not null));
