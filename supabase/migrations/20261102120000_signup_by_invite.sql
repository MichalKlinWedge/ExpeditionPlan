-- Konta tylko z zaproszenia: hook Auth „before user created” (włączany w panelu Supabase:
-- Authentication → Hooks → Before User Created → Postgres → public.before_user_created).
-- Nowe konto powstaje, gdy:
--   * zakłada je serwer kluczem service role z flagą `trip_creator` w app_metadata (seed, testy),
--   * albo logowanie niesie w user_metadata `invite` — token ważnego zaproszenia (web przekazuje
--     go przy linku e-mail z `/join/<token>`).
-- Google nie przenosi metadanych, więc pierwsze konto zaproszonej osoby powstaje z linku e-mail;
-- późniejsze logowanie przez Google z tym samym adresem dołącza się do tego konta.

-- Sprawdzenie tokenu z uprawnieniami właściciela funkcji: rola Auth nie dostaje dostępu do tabeli.
create function public.invite_token_valid(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_invites invite
    where invite.token_hash = public.token_digest(p_token)
      and invite.revoked_at is null
      and invite.expires_at > now()
      and invite.used_count < invite.max_uses
  )
$$;

create function public.before_user_created(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  token text := event -> 'user' -> 'user_metadata' ->> 'invite';
begin
  if (event -> 'user' -> 'app_metadata') ? 'trip_creator' then
    return '{}'::jsonb;
  end if;
  if token is not null and token <> '' and public.invite_token_valid(token) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Konto zakłada się z linku zaproszenia od organizatora wyjazdu (pierwsze logowanie: link na e-mail).'
  ));
end $$;

revoke execute on function public.invite_token_valid(text) from anon, authenticated, public;
revoke execute on function public.before_user_created(jsonb) from anon, authenticated, public;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.invite_token_valid(text) to supabase_auth_admin;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
