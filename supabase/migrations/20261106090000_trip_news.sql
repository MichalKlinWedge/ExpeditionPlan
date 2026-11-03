-- „Co nowego od ostatniej wizyty”: zmiany innych osób w wyjeździe od chwili, od której członek je zna
-- (`seen_changes_at`). Nowa wizyta (przerwa ponad godzinę, web albo telefon) przesuwa ją na koniec
-- poprzedniej; „Przejrzane” — na teraz. Wspólna dla webu i telefonu.

alter table public.trip_members add column seen_changes_at timestamptz;

create or replace function public.touch_trip(p_trip uuid, p_client text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Koniec poprzedniej wizyty = ostatnio widziany gdziekolwiek, gdy od tego minęła ponad godzina.
  update public.trip_members
     set seen_changes_at = greatest(seen_changes_at, last_seen_web_at, last_seen_phone_at)
   where trip_id = p_trip and user_id = auth.uid()
     and greatest(last_seen_web_at, last_seen_phone_at) < now() - interval '1 hour';
  if p_client = 'web' then
    update public.trip_members set last_seen_web_at = now()
     where trip_id = p_trip and user_id = auth.uid() and (last_seen_web_at is null or last_seen_web_at < now() - interval '10 minutes');
  elsif p_client = 'phone' then
    update public.trip_members set last_seen_phone_at = now()
     where trip_id = p_trip and user_id = auth.uid() and (last_seen_phone_at is null or last_seen_phone_at < now() - interval '10 minutes');
  end if;
end $$;

-- „Przejrzane”: od teraz nowe są tylko późniejsze zmiany.
create function public.mark_changes_seen(p_trip uuid) returns void
language sql security definer set search_path = '' as $$
  update public.trip_members set seen_changes_at = now() where trip_id = p_trip and user_id = auth.uid();
$$;

-- Zmiany innych od `seen_changes_at` (nowy członek — od dołączenia), najnowsze pierwsze, najwyżej p_limit.
-- Pola zmiany bez wartości (same nazwy kolumn) — treść pokazuje aktualny wiersz. RLS activity_log zostaje.
create function public.trip_news(p_trip uuid, p_limit int default 300) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (
    select coalesce(m.seen_changes_at, m.created_at) as since
      from public.trip_members m where m.trip_id = p_trip and m.user_id = auth.uid()
  )
  select jsonb_build_object(
    'since', (select since from me),
    'entries', coalesce((
      select jsonb_agg(e order by e.at desc) from (
        select a.entity, a.entity_id, a.action, a.actor_id, p.display_name as actor_name, a.created_at as at,
               coalesce((select jsonb_agg(k) from jsonb_object_keys(a.diff) k), '[]'::jsonb) as fields
          from public.activity_log a
          left join public.profiles p on p.id = a.actor_id
         where a.trip_id = p_trip and a.created_at > (select since from me)
           and a.actor_id is distinct from auth.uid()
         order by a.created_at desc
         limit p_limit
      ) e
    ), '[]'::jsonb)
  )
  where exists (select 1 from me);
$$;

revoke execute on function public.mark_changes_seen(uuid) from anon, public;
revoke execute on function public.trip_news(uuid, int) from anon, public;
grant execute on function public.mark_changes_seen(uuid) to authenticated;
grant execute on function public.trip_news(uuid, int) to authenticated;
