-- Kto ma dostęp i czy korzysta (strona „Uczestnicy i dostęp”, tylko organizator): z którego zaproszenia
-- ktoś dołączył, kiedy ostatnio otworzył wyjazd na webie i w telefonie, ostatnie logowanie, zmiany w planie
-- i — gdy organizator to wskaże — który uczestnik planu to to konto (`travelers.user_id`).

alter table public.trip_members
  add column invite_id uuid references public.trip_invites (id),
  add column last_seen_web_at timestamptz,
  add column last_seen_phone_at timestamptz;

-- Dołączenie z zaproszenia zapisuje, z którego (statystyka linku).
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
  return invite.trip_id;
end $$;

-- „Ostatnio widziany”: web przy otwarciu wyjazdu, telefon po synchronizacji. Najwyżej raz na 10 minut,
-- bez podbijania wersji wyjazdu (trip_members nie jest tabelą synchronizowaną).
create function public.touch_trip(p_trip uuid, p_client text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_client = 'web' then
    update public.trip_members set last_seen_web_at = now()
     where trip_id = p_trip and user_id = auth.uid() and (last_seen_web_at is null or last_seen_web_at < now() - interval '10 minutes');
  elsif p_client = 'phone' then
    update public.trip_members set last_seen_phone_at = now()
     where trip_id = p_trip and user_id = auth.uid() and (last_seen_phone_at is null or last_seen_phone_at < now() - interval '10 minutes');
  end if;
end $$;

-- Statystyki członków wyjazdu — tylko dla organizatora (e-maile i daty logowania są z auth.users).
create function public.trip_member_stats(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Statystyki dostępu widzi tylko organizator' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'email', u.email,
      'display_name', p.display_name,
      'role', m.role,
      'can_add_expenses', m.can_add_expenses,
      'joined_at', m.created_at,
      'account_created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'last_seen_web_at', m.last_seen_web_at,
      'last_seen_phone_at', m.last_seen_phone_at,
      'invite_id', m.invite_id,
      'changes', (select count(*) from public.activity_log a where a.trip_id = p_trip and a.actor_id = m.user_id),
      'last_change_at', (select max(a.created_at) from public.activity_log a where a.trip_id = p_trip and a.actor_id = m.user_id),
      'travelers', coalesce((select jsonb_agg(t.id) from public.travelers t where t.trip_id = p_trip and t.user_id = m.user_id and t.deleted_at is null), '[]'::jsonb)
    ) order by m.created_at)
    from public.trip_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.trip_id = p_trip
  ), '[]'::jsonb);
end $$;

-- Przypisanie konta do uczestnika planu (albo odpięcie: p_user = null) — organizator, tylko członkowie wyjazdu.
create function public.link_traveler_account(p_trip uuid, p_traveler uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_owner(p_trip) then
    raise exception 'Konto do uczestnika przypisuje organizator' using errcode = '42501';
  end if;
  if p_user is not null and not exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_user) then
    raise exception 'To konto nie ma dostępu do wyjazdu' using errcode = 'P0002';
  end if;
  -- Jedno konto = jeden uczestnik: poprzednie przypisanie tego konta znika.
  if p_user is not null then
    update public.travelers set user_id = null where trip_id = p_trip and user_id = p_user and id <> p_traveler;
  end if;
  update public.travelers set user_id = p_user where trip_id = p_trip and id = p_traveler;
end $$;

revoke execute on function public.touch_trip(uuid, text) from anon, public;
revoke execute on function public.trip_member_stats(uuid) from anon, public;
revoke execute on function public.link_traveler_account(uuid, uuid, uuid) from anon, public;
grant execute on function public.touch_trip(uuid, text) to authenticated;
grant execute on function public.trip_member_stats(uuid) to authenticated;
grant execute on function public.link_traveler_account(uuid, uuid, uuid) to authenticated;
