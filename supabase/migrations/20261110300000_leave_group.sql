-- CommonTab: anyone can leave a group (Brian's call, 2026-11-10). Leave Group is in the
-- group's Details window.
--   • Members and organizers just leave.
--   • When the owner leaves, ownership goes to the organizer who was added first; if there are
--     no organizers, to the member who was added first.
--   • The last person in a group can't leave it (it would be left with nobody): they delete the
--     group instead.
--   • Leaving removes you from the group's chat and its member list. Past messages and requests
--     stay for everyone else.
-- Safe to run again.
-- Run once in Supabase, after 20261110290000_privacy_shared_groups.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.leave_group(target uuid)
returns uuid  -- the new owner, if ownership moved (otherwise null)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me         uuid := auth.uid();
  mine       text;
  successor  uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.conversations c where c.id = target and c.kind = 'group') then
    raise exception 'That group doesn''t exist';
  end if;
  select m.role into mine from public.conversation_members m where m.conversation_id = target and m.user_id = me;
  if mine is null then raise exception 'You''re not in this group'; end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = target and m.user_id <> me) then
    raise exception 'You''re the only one in this group. Delete the group instead.';
  end if;

  if mine = 'owner' then
    -- The organizer added first, or else the member added first.
    select m.user_id into successor
      from public.conversation_members m
     where m.conversation_id = target and m.user_id <> me
     order by (m.role = 'organizer') desc, m.joined_at, m.id
     limit 1;
  end if;

  -- Leave first (only one owner is allowed at a time), then hand over ownership.
  delete from public.conversation_members where conversation_id = target and user_id = me;
  if successor is not null then
    update public.conversation_members set role = 'owner' where conversation_id = target and user_id = successor;
  end if;
  return successor;
end;
$$;

revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;
