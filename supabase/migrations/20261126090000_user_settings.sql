-- Ustawienia konta, które idą za zalogowanym na webie i telefonie. Na razie jedno: ostatnie wybory
-- w „Knajpy w pobliżu” (rodzaje, promień, dieta, filtry, kuchnie; kształt `EaterySearchPrefs` w
-- `packages/core/src/eat-out.ts`). Osobna tabela, bo `profiles` widzą współuczestnicy wyjazdów, a tego
-- nikt poza właścicielem widzieć nie musi.
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  eatery_search jsonb not null default '{}'::jsonb check (jsonb_typeof(eatery_search) = 'object' and pg_column_size(eatery_search) <= 4000),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy user_settings_select on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy user_settings_insert on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy user_settings_update on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_settings from anon;
grant select, insert, update on public.user_settings to authenticated;
