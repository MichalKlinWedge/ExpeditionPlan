-- Drugi pokaz z lektorem: „Film z wyjazdu” (`/trips/[id]/film`) obok zapowiedzi (`/trips/[id]/show`). Każdy ma własny
-- scenariusz (tekst, głos, nagrania, podkład), więc `trip_shows` ma teraz wiersz na wyjazd i rodzaj (`kind`).
-- Pod publicznym linkiem każdy rodzaj ma osobną zgodę właściciela: `public_shares.show` (zapowiedź), `public_shares.film`.
-- Nagrania obu leżą w `show_audio/<trip_id>/`; anon podpisuje je, gdy którykolwiek pokaz jest pod linkiem
-- (`show_is_public`), ale ścieżki zna tylko z scenariusza pokazu, który właściciel udostępnił.

alter table public.trip_shows add column kind text not null default 'preview' check (kind in ('preview', 'film'));
alter table public.trip_shows drop constraint trip_shows_pkey;
alter table public.trip_shows add primary key (trip_id, kind);

alter table public.public_shares add column film boolean not null default false;

create or replace function public.show_is_public(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.public_shares where trip_id = p_trip and enabled and (show or film))
$$;

-- Rodzaj pokazu jako parametr (domyślnie zapowiedź, jak dotąd).
drop function public.public_show_on(text);
create function public.public_show_on(p_token text, p_kind text default 'preview') returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.public_shares
    where token_hash = public.token_digest(p_token) and enabled and case p_kind when 'film' then film else show end
  )
$$;
grant execute on function public.public_show_on(text, text) to anon, authenticated;

drop function public.public_show(text);
create function public.public_show(p_token text, p_kind text default 'preview') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  share public.public_shares;
begin
  select * into share from public.public_shares
  where token_hash = public.token_digest(p_token) and enabled and case p_kind when 'film' then film else show end;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'content', coalesce((select content from public.trip_shows where trip_id = share.trip_id and kind = case p_kind when 'film' then 'film' else 'preview' end), '{}'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('day_id', day_id, 'photo_path', photo_path, 'taken_at', taken_at) order by taken_at)
      from public.journal_entries
      where trip_id = share.trip_id and deleted_at is null and photo_path is not null
    ), '[]'::jsonb)
  );
end $$;
grant execute on function public.public_show(text, text) to anon, authenticated;

drop function public.set_public_show(uuid, boolean);
create function public.set_public_show(p_trip uuid, p_show boolean, p_kind text default 'preview') returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Pokaz pod publicznym linkiem włącza tylko właściciel wyjazdu.' using errcode = '42501';
  end if;
  if p_kind = 'film' then
    update public.public_shares set film = p_show, updated_at = now() where trip_id = p_trip;
  else
    update public.public_shares set show = p_show, updated_at = now() where trip_id = p_trip;
  end if;
  return found;
end $$;
grant execute on function public.set_public_show(uuid, boolean, text) to authenticated;
