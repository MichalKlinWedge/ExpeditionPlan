-- Podgląd zaproszenia przed zalogowaniem: strona logowania z `/join/<token>` pokazuje, do jakiego
-- wyjazdu i w jakiej roli prowadzi link. Kto ma token, i tak może dołączyć — podgląd zdradza tylko
-- nazwę, daty, rolę i imię zapraszającego, a nieważny token nie zwraca nic.
create function public.invite_preview(p_token text)
returns table (title text, start_date date, end_date date, role text, invited_by text)
language sql stable security definer set search_path = '' as $$
  select trip.title, trip.start_date, trip.end_date, invite.role, profile.display_name
  from public.trip_invites invite
  join public.trips trip on trip.id = invite.trip_id and trip.deleted_at is null
  left join public.profiles profile on profile.id = invite.created_by
  where invite.token_hash = public.token_digest(p_token)
    and invite.revoked_at is null
    and invite.expires_at > now()
    and invite.used_count < invite.max_uses
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
