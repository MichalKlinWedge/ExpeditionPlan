-- Daty ważności dokumentów z telefonu (karta „Dokumenty podróży”, outbox `travelers`): tylko paszport,
-- dowód i EKUZ, nic więcej z wiersza uczestnika. Organizator i edytor zmieniają każdemu, a uczestnik
-- połączony z kontem — sobie i swoim dzieciom (`is_my_traveler`), także jako widz, bo to jego dane,
-- nie plan. Reszta jak przy zapisie z webu: wersje wierszy, „co nowego”, daty idą za kontem
-- (`share_id_documents`).
create function public.set_traveler_documents(p_traveler uuid, p_passport date, p_id_card date, p_ekuz date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  trip uuid;
begin
  select t.trip_id into trip from public.travelers t where t.id = p_traveler and t.deleted_at is null;
  if trip is null then
    raise exception 'Nie ma takiego uczestnika' using errcode = '22023';
  end if;
  if not (public.can_edit_trip(trip) or (public.is_trip_member(trip) and public.is_my_traveler(p_traveler))) then
    raise exception 'Brak uprawnień do zmiany dokumentów tej osoby' using errcode = '42501';
  end if;
  update public.travelers set passport_until = p_passport, id_card_until = p_id_card, ekuz_until = p_ekuz where id = p_traveler;
end $$;

revoke all on function public.set_traveler_documents(uuid, date, date, date) from public, anon;
grant execute on function public.set_traveler_documents(uuid, date, date, date) to authenticated;
