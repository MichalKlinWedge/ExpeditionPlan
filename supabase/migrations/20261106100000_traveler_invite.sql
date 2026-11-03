-- Zaproszenie dla konkretnego uczestnika planu („Zaproś” przy osobie bez konta): link jednorazowy,
-- a po dołączeniu konto samo zostaje przypisane do tego uczestnika (`travelers.user_id`) — o ile
-- uczestnik nie ma już konta, a dołączający nie jest już kimś innym w tym wyjeździe.

alter table public.trip_invites add column traveler_id uuid references public.travelers (id);

drop function public.create_invite(uuid, text, integer, integer);
create function public.create_invite(p_trip uuid, p_role text default 'viewer', p_days integer default 14, p_max_uses integer default 1, p_traveler uuid default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  token text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Tylko właściciel zaprasza do wyjazdu' using errcode = '42501';
  end if;
  if p_traveler is not null and not exists (select 1 from public.travelers where id = p_traveler and trip_id = p_trip and deleted_at is null) then
    raise exception 'Nie ma takiego uczestnika w wyjeździe' using errcode = 'P0002';
  end if;
  insert into public.trip_invites (trip_id, role, token_hash, expires_at, max_uses, traveler_id)
  values (p_trip, p_role, public.token_digest(token), now() + make_interval(days => p_days), case when p_traveler is null then p_max_uses else 1 end, p_traveler);
  return token;
end $$;

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  invite public.trip_invites;
begin
  if auth.uid() is null then
    raise exception 'Zaloguj się, żeby dołączyć' using errcode = '42501';
  end if;
  select * into invite from public.trip_invites
   where token_hash = public.token_digest(p_token)
   for update;
  if not found or invite.revoked_at is not null or invite.expires_at < now() or invite.used_count >= invite.max_uses then
    raise exception 'Zaproszenie jest nieważne' using errcode = 'P0002';
  end if;
  insert into public.trip_members (trip_id, user_id, role, invite_id)
  values (invite.trip_id, auth.uid(), invite.role, invite.id)
  on conflict (trip_id, user_id) do nothing;
  if found then
    update public.trip_invites set used_count = used_count + 1 where id = invite.id;
  end if;
  if invite.traveler_id is not null and not exists (
    select 1 from public.travelers where trip_id = invite.trip_id and user_id = auth.uid() and deleted_at is null
  ) then
    update public.travelers set user_id = auth.uid() where id = invite.traveler_id and user_id is null;
  end if;
  return invite.trip_id;
end $$;

revoke execute on function public.create_invite(uuid, text, integer, integer, uuid) from anon, public;
grant execute on function public.create_invite(uuid, text, integer, integer, uuid) to authenticated;
