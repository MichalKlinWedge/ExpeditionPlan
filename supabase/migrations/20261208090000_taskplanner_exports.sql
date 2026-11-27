-- Integracja z Task Plannerem (docs/INTEGRACJA_TP.md): które zadania wyjazdu wysłano do TP i odbiór webhooka TP.
-- Poza `TripDocument` i `synced_tables()` (jak `place_memories`): telefon tego nie potrzebuje.

create table public.task_exports (
  task_id uuid primary key references public.tasks (id),
  trip_id uuid not null references public.trips (id),
  -- Kto wysłał (konto EP z dostępem do TP); tylko on widzi wiersz.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tp_task_id uuid not null unique,
  tp_url text,
  tp_status text check (tp_status in ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  -- Zadanie trafiło w TP do kosza (zdarzenie `task.deleted`); status w EP zostaje.
  tp_deleted boolean not null default false,
  sent_at timestamptz not null default now(),
  -- Ostatnie zdarzenie z webhooka TP.
  tp_event_at timestamptz
);
create index task_exports_trip on public.task_exports (trip_id);

alter table public.task_exports enable row level security;

create policy task_exports_select on public.task_exports for select to authenticated
  using (user_id = auth.uid() and public.can_edit_trip(trip_id));
create policy task_exports_insert on public.task_exports for insert to authenticated
  with check (
    user_id = auth.uid() and public.can_edit_trip(trip_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.trip_id = task_exports.trip_id and t.deleted_at is null)
  );
create policy task_exports_update on public.task_exports for update to authenticated
  using (user_id = auth.uid() and public.can_edit_trip(trip_id))
  with check (
    user_id = auth.uid() and public.can_edit_trip(trip_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.trip_id = task_exports.trip_id)
  );

revoke all on public.task_exports from anon;
revoke delete on public.task_exports from authenticated;
grant select, insert, update on public.task_exports to authenticated;

-- Webhook TP (plugin Webhook, `_shared/plugins/webhook.ts` w TP): podpis `sha256=HMAC(sekret, "<timestamp>.<treść>")`.
-- Sekret jest w Vault (`taskplanner_webhook_secret`), więc trasa EP `/api/taskplanner` woła to RPC kluczem
-- publicznym bez żadnego klucza serwisowego. Zmienia tylko zadania z `task_exports`:
--   task.completed (TP: done) → done; task.reopened / task.restored (TP: otwarte), gdy w EP done → open;
--   task.deleted → tylko `tp_deleted`. Bez zmiany stanu powtórka nic nie robi (idempotentnie po stanie).
-- Wynik: applied / unchanged / unknown / not_configured / stale / bad_signature / bad_request.
create function public.taskplanner_webhook(p_body text, p_timestamp text, p_signature text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
  v_payload jsonb;
  v_events text[];
  v_tp_id text;
  v_status text;
  v_export public.task_exports%rowtype;
  v_current text;
  v_target text;
begin
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'taskplanner_webhook_secret' limit 1;
  if v_secret is null or v_secret = '' then
    return 'not_configured';
  end if;
  if p_timestamp is null or p_timestamp !~ '^\d{1,12}$' or abs(extract(epoch from now()) - p_timestamp::bigint) > 300 then
    return 'stale';
  end if;
  if p_signature is distinct from
     'sha256=' || encode(extensions.hmac(convert_to(p_timestamp || '.' || coalesce(p_body, ''), 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') then
    return 'bad_signature';
  end if;

  begin
    v_payload := p_body::jsonb;
  exception when others then
    return 'bad_request';
  end;
  if jsonb_typeof(v_payload) is distinct from 'object' or jsonb_typeof(v_payload -> 'task') is distinct from 'object' then
    return 'bad_request';
  end if;
  v_events := array(
    select jsonb_array_elements_text(case when jsonb_typeof(v_payload -> 'events') = 'array' then v_payload -> 'events' else jsonb_build_array(v_payload ->> 'event') end)
  );
  v_tp_id := v_payload #>> '{task,id}';
  v_status := v_payload #>> '{task,status}';
  if v_tp_id is null or v_tp_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'bad_request';
  end if;

  select e.* into v_export from public.task_exports e where e.tp_task_id = v_tp_id::uuid;
  if not found then
    return 'unknown';
  end if;
  select t.status into v_current
    from public.tasks t join public.trips tr on tr.id = t.trip_id
   where t.id = v_export.task_id and t.deleted_at is null and tr.deleted_at is null;
  if not found then
    return 'unknown';
  end if;

  update public.task_exports
     set tp_status = case when v_status in ('todo', 'in_progress', 'waiting', 'done', 'cancelled') then v_status else task_exports.tp_status end,
         tp_deleted = case when 'task.deleted' = any (v_events) then true when 'task.restored' = any (v_events) then false else task_exports.tp_deleted end,
         tp_event_at = now()
   where task_id = v_export.task_id;

  if 'task.completed' = any (v_events) and v_status = 'done' then
    v_target := 'done';
  elsif ('task.reopened' = any (v_events) or 'task.restored' = any (v_events))
        and v_status in ('todo', 'in_progress', 'waiting') and v_current = 'done' then
    v_target := 'open';
  end if;
  if v_target is null or v_target = v_current then
    return 'unchanged';
  end if;
  update public.tasks set status = v_target where id = v_export.task_id;
  return 'applied';
end $$;

revoke all on function public.taskplanner_webhook(text, text, text) from public;
grant execute on function public.taskplanner_webhook(text, text, text) to anon, authenticated;
