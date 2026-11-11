-- CommonTab: "Who can find me by username" is now Everyone, or Only people in shared groups
-- (Brian's call, 2026-11-10). Replaces "Only my contacts".
--   • Only people in shared groups: someone can find you by username, and send you a contact
--     request, only if you're both in at least one group. People you're already connected to
--     (or have a request with) can still see you, as before.
--   • Anyone who had "Only my contacts" moves to "Only people in shared groups".
-- Safe to run again.
-- Run once in Supabase, after 20261110280000_payment_ai_check.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. The setting's values ------------------------------------------------------------------------

alter table public.profiles drop constraint if exists discoverable_by_valid;
update public.profiles set discoverable_by = 'groups' where discoverable_by = 'contacts';
alter table public.profiles add constraint discoverable_by_valid check (discoverable_by in ('everyone', 'groups'));

-- Are the signed-in person and this person in at least one group together?
create or replace function public.shares_group_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversation_members a
      join public.conversation_members b on b.conversation_id = a.conversation_id
      join public.conversations c on c.id = a.conversation_id and c.kind = 'group'
     where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- 2. Search by username: skips people who chose "Only people in shared groups", unless you share
--    a group or are already connected.
create or replace function public.search_profiles(q text)
returns table (
  id uuid, username text, first_name text, last_name text, avatar_url text,
  relation text,   -- contact | sent | received | none
  total bigint     -- how many matched in all (only the top 10 are returned)
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
       term as (select lower(regexp_replace(btrim(q), '^@', '')) as t)
  select p.id, p.username, p.first_name, p.last_name, p.avatar_url,
         case
           when c.status = 'accepted' then 'contact'
           when c.requester_id = me.uid then 'sent'
           when c.addressee_id = me.uid then 'received'
           else 'none'
         end,
         count(*) over ()
  from public.profiles p
  cross join me
  cross join term
  left join public.contacts c
    on (c.requester_id = me.uid and c.addressee_id = p.id)
    or (c.addressee_id = me.uid and c.requester_id = p.id)
  where me.uid is not null
    and char_length(term.t) >= 2
    and p.id <> me.uid
    and strpos(p.username, term.t) > 0
    and (p.discoverable_by = 'everyone' or c.id is not null or public.shares_group_with(p.id))
  order by
    case when p.username = term.t then 0
         when left(p.username, char_length(term.t)) = term.t then 1
         else 2 end,
    p.first_name, p.last_name
  limit 10;
$$;

-- 3. Send a contact request: the same rule.
create or replace function public.send_contact_request(target uuid)
returns text  -- the new relation: sent | contact
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing public.contacts;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if target = me then raise exception 'You can''t add yourself'; end if;

  select * into existing from public.contacts
   where (requester_id = me and addressee_id = target)
      or (requester_id = target and addressee_id = me);

  if found then
    if existing.status = 'accepted' then return 'contact'; end if;
    if existing.requester_id = me then return 'sent'; end if;
    update public.contacts set status = 'accepted', accepted_at = now() where id = existing.id;
    return 'contact';
  end if;

  if not exists (select 1 from public.profiles p
                  where p.id = target and (p.discoverable_by = 'everyone' or public.shares_group_with(target))) then
    raise exception 'User not found';
  end if;

  insert into public.contacts (requester_id, addressee_id) values (me, target);
  return 'sent';
end;
$$;

revoke all on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.shares_group_with(uuid) to authenticated;
