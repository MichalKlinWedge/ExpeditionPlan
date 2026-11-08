-- Pokaz z lektorem pod publicznym linkiem (`/p/<token>/show`): osobna zgoda właściciela (`public_shares.show`), bo tekst
-- i głos lektora mogą zawierać imiona i kwoty, a zdjęcia z dziennika — twarze; ukrywanie z `hide` ich nie obejmuje.
-- Przy włączonej zgodzie link daje scenariusz (`public_show`), nagrania z `show_audio` i zdjęcia dziennika z `journal`
-- tego wyjazdu (podpisane URL-e tworzy serwer strony jako anon). Wyłączenie linku albo zgody odcina wszystko naraz.

alter table public.public_shares add column show boolean not null default false;

-- Bez RLS `public_shares` (anon go nie czyta): czy wyjazd ma włączony link z pokazem.
create function public.show_is_public(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.public_shares where trip_id = p_trip and enabled and show)
$$;
grant execute on function public.show_is_public(uuid) to anon, authenticated;

-- Czy pod tym linkiem jest pokaz (zakładka w nagłówku publicznego linku).
create function public.public_show_on(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.public_shares where token_hash = public.token_digest(p_token) and enabled and show)
$$;
grant execute on function public.public_show_on(text) to anon, authenticated;

-- Scenariusz pokazu i zdjęcia dziennika (bez treści wpisów); `null`, gdy link albo pokaz wyłączony.
create function public.public_show(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  share public.public_shares;
begin
  select * into share from public.public_shares where token_hash = public.token_digest(p_token) and enabled and show;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'content', coalesce((select content from public.trip_shows where trip_id = share.trip_id), '{}'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('day_id', day_id, 'photo_path', photo_path, 'taken_at', taken_at) order by taken_at)
      from public.journal_entries
      where trip_id = share.trip_id and deleted_at is null and photo_path is not null
    ), '[]'::jsonb)
  );
end $$;
grant execute on function public.public_show(text) to anon, authenticated;

-- Właściciel włącza i wyłącza pokaz pod linkiem; link musi już istnieć.
create function public.set_public_show(p_trip uuid, p_show boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Pokaz pod publicznym linkiem włącza tylko właściciel wyjazdu.' using errcode = '42501';
  end if;
  update public.public_shares set show = p_show, updated_at = now() where trip_id = p_trip;
  return found;
end $$;
grant execute on function public.set_public_show(uuid, boolean) to authenticated;

create policy show_audio_public on storage.objects for select to anon, authenticated
  using (bucket_id = 'show_audio' and public.show_is_public(public.storage_trip(name)));
create policy journal_public_show on storage.objects for select to anon, authenticated
  using (bucket_id = 'journal' and public.show_is_public(public.storage_trip(name)));
