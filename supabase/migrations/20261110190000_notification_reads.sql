-- CommonTab: remember which alerts and reminders you've read, one by one.
--   • Opening a reminder's destination (e.g. a payment request's page) marks that reminder as
--     read: its green dot goes away. The task itself stays in "Action needed" until it's done.
--   • "Mark all as read" still uses the existing mark_notifications_read (everything up to now).
--   • Each person sees and writes only their own read marks. Nothing here changes a payment,
--     a share or a document.
-- Safe to run again.
-- Run once in Supabase, after 20261110180000_reminder_details.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.notification_reads (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  item_key  text not null check (char_length(item_key) between 1 and 200),  -- e.g. 'payment:<request id>'
  read_at   timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.notification_reads enable row level security;
drop policy if exists "You see your own read marks" on public.notification_reads;
create policy "You see your own read marks"
  on public.notification_reads for select to authenticated
  using (user_id = auth.uid());

create or replace function public.mark_notification_read(item text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me    uuid := auth.uid();
  clean text := btrim(coalesce(item, ''));
  t     timestamptz := now();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if char_length(clean) not between 1 and 200 then raise exception 'Unknown alert'; end if;
  insert into public.notification_reads (user_id, item_key, read_at)
  values (me, clean, t)
  on conflict (user_id, item_key) do update set read_at = excluded.read_at;
  return t;
end;
$$;

revoke all on function public.mark_notification_read(text) from public, anon;
grant execute on function public.mark_notification_read(text) to authenticated;
