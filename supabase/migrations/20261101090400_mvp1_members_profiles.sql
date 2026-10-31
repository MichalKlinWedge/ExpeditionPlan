-- MVP-1, ekrany: lista członków wyjazdu z imionami. PostgREST łączy tabele po kluczach obcych,
-- a `trip_members.user_id` wskazywał tylko `auth.users` (niewidoczne przez API). Profil powstaje
-- razem z kontem (`create_profile`), więc klucz do `profiles` jest zawsze spełniony.
insert into public.profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

alter table public.trip_members
  add constraint trip_members_profile_fkey foreign key (user_id) references public.profiles (id)
  deferrable initially immediate;

-- Moje wyjazdy z moją rolą — jedna lista dla webu i telefonu.
create view public.my_trips with (security_invoker = true) as
  select t.id, t.title, t.subtitle, t.status, t.start_date, t.end_date, t.primary_tz, t.base_currency,
         m.role, m.can_add_expenses, t.updated_at
    from public.trips t
    join public.trip_members m on m.trip_id = t.id and m.user_id = auth.uid()
   where t.deleted_at is null;

revoke all on public.my_trips from anon;
grant select on public.my_trips to authenticated;
