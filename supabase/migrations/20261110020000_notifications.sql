-- CommonTab: notification bell. Remembers when each person last opened their notifications,
-- so anything newer counts as unread (on every device).
-- Run once in Supabase, after the earlier files:
-- Dashboard → SQL Editor → New query → paste → Run.

alter table public.profiles
  add column if not exists notifications_seen_at timestamptz;

-- Mark everything as read (uses the database clock, so devices with a wrong clock don't matter).
create or replace function public.mark_notifications_read()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set notifications_seen_at = now()
   where id = auth.uid()
  returning notifications_seen_at;
$$;

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;
