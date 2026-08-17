-- BEYNE - Session unique par compte (Supabase Free)
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run.

create table if not exists public.active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.active_sessions enable row level security;

grant select, insert, update, delete on table public.active_sessions to authenticated;

drop policy if exists "active_sessions_select_own" on public.active_sessions;
create policy "active_sessions_select_own"
on public.active_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "active_sessions_insert_own" on public.active_sessions;
create policy "active_sessions_insert_own"
on public.active_sessions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "active_sessions_update_own" on public.active_sessions;
create policy "active_sessions_update_own"
on public.active_sessions
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "active_sessions_delete_own" on public.active_sessions;
create policy "active_sessions_delete_own"
on public.active_sessions
for delete
to authenticated
using ((select auth.uid()) = user_id);
