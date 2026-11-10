-- CommonTab: group owner + who can add, remove and change roles.
--   Owner (whoever created the group): add or remove anyone, make people members or
--     organizers, and hand ownership to another member (becoming an organizer themselves).
--   Organizer: add their contacts as members, and remove only the people they added.
--   Member: can't add or remove anyone.
-- Run once in Supabase, after 20261110030000_groups.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. A third role, "owner": exactly one per group. -----------------------------------------

alter table public.conversation_members drop constraint conversation_members_role_check;
alter table public.conversation_members
  add constraint conversation_members_role_check check (role in ('owner', 'organizer', 'member'));

-- Groups made before this file: their creator becomes the owner.
update public.conversation_members m
   set role = 'owner'
  from public.conversations c
 where c.id = m.conversation_id and c.kind = 'group' and m.user_id = c.created_by;

create unique index conversation_members_one_owner
  on public.conversation_members (conversation_id) where role = 'owner';

-- 2. Helpers ----------------------------------------------------------------------------

-- Your role in a group, or null if you're not in it.
create or replace function public.my_group_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
   where m.conversation_id = target and m.user_id = auth.uid() and c.kind = 'group';
$$;

revoke all on function public.my_group_role(uuid) from public, anon;
grant execute on function public.my_group_role(uuid) to authenticated;

-- Owners count as organizers for the group-picture storage rules.
create or replace function public.is_group_organizer(target text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
     where m.conversation_id::text = target and m.user_id = auth.uid() and m.role in ('owner', 'organizer')
  );
$$;

-- 3. New group: the creator is the owner. -------------------------------------------------

create or replace function public.create_group(
  group_name text, group_description text, member_ids uuid[], organizer_ids uuid[] default '{}', gradient smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := auth.uid();
  clean    text := btrim(coalesce(group_name, ''));
  about    text := nullif(btrim(coalesce(group_description, '')), '');
  new_id   uuid;
  person   uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if char_length(clean) not between 1 and 40 then raise exception 'Group name must be 1 to 40 characters'; end if;
  if about is not null and char_length(about) > 200 then raise exception 'Description must be 200 characters or fewer'; end if;

  foreach person in array coalesce(member_ids, '{}') loop
    if person = me then continue; end if;
    if not public.is_my_contact(person) then raise exception 'You can only add your contacts'; end if;
  end loop;

  -- One function call = one transaction: the group and every membership are created together.
  insert into public.conversations (kind, name, description, avatar_gradient, created_by)
  values ('group', clean, about,
          case when gradient between 0 and 7 then gradient else floor(random() * 8)::smallint end,
          me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (new_id, me, 'owner', me);

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  select distinct new_id, p,
         case when p = any(coalesce(organizer_ids, '{}')) then 'organizer' else 'member' end,
         me
    from unnest(coalesce(member_ids, '{}')) as p
   where p <> me;

  return new_id;
end;
$$;

-- 4. Add contacts: owner (as members or organizers) or organizer (as members only). ------

create or replace function public.add_group_members(target uuid, member_ids uuid[], organizer_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  mine    text := public.my_group_role(target);
  person  uuid;
begin
  if mine is null or mine = 'member' then raise exception 'Only the owner and organizers can add people'; end if;
  if cardinality(coalesce(organizer_ids, '{}')) > 0 and mine <> 'owner' then
    raise exception 'Only the owner can add organizers';
  end if;

  foreach person in array coalesce(member_ids, '{}') loop
    if not public.is_my_contact(person) then raise exception 'You can only add your contacts'; end if;
  end loop;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  select distinct target, p,
         case when p = any(coalesce(organizer_ids, '{}')) then 'organizer' else 'member' end,
         me
    from unnest(coalesce(member_ids, '{}')) as p
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

-- 5. Remove someone: the owner can remove anyone else; an organizer only people they added.

create or replace function public.remove_group_member(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := auth.uid();
  mine     text := public.my_group_role(target);
  theirs   text;
  adder    uuid;
begin
  select m.role, m.added_by into theirs, adder
    from public.conversation_members m
   where m.conversation_id = target and m.user_id = member;

  if theirs is null then raise exception 'That person isn''t in this group'; end if;
  if member = me then raise exception 'You can''t remove yourself'; end if;
  if theirs = 'owner' then raise exception 'The owner can''t be removed'; end if;
  if not (mine = 'owner' or (mine = 'organizer' and adder = me)) then
    raise exception 'Organizers can only remove people they added';
  end if;

  delete from public.conversation_members where conversation_id = target and user_id = member;
end;
$$;

-- 6. Make someone a member or an organizer (owner only). ----------------------------------

create or replace function public.set_member_role(target uuid, member uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new_role not in ('member', 'organizer') then raise exception 'Role must be member or organizer'; end if;
  if public.my_group_role(target) is distinct from 'owner' then raise exception 'Only the owner can change roles'; end if;

  update public.conversation_members
     set role = new_role
   where conversation_id = target and user_id = member and role <> 'owner';
  if not found then raise exception 'That person isn''t a member or organizer of this group'; end if;
end;
$$;

-- 7. Hand ownership to another person in the group. The old owner becomes an organizer. ---

create or replace function public.transfer_group_ownership(target uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
begin
  if public.my_group_role(target) is distinct from 'owner' then raise exception 'Only the owner can hand over the group'; end if;
  if new_owner = me then raise exception 'You''re already the owner'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = target and user_id = new_owner) then
    raise exception 'That person isn''t in this group';
  end if;

  -- Step down first (only one owner is allowed at a time), then promote.
  update public.conversation_members set role = 'organizer' where conversation_id = target and user_id = me;
  update public.conversation_members set role = 'owner' where conversation_id = target and user_id = new_owner;
end;
$$;

-- The creator-only "make organizer" from the previous file is replaced by set_member_role.
drop function if exists public.make_organizer(uuid, uuid);

revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.transfer_group_ownership(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;

-- 8. The conversation list now also says who added each person (organizers may only
--    remove the people they added). ------------------------------------------------------

create or replace function public.my_conversations()
returns table (
  id           uuid,
  kind         text,
  name         text,
  description  text,
  picture_url  text,
  avatar_gradient smallint,
  created_by   uuid,
  created_at   timestamptz,
  members      jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.name, c.description, c.picture_url, c.avatar_gradient, c.created_by, c.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'user_id', p.id,
                    'username', p.username,
                    'first_name', p.first_name,
                    'last_name', p.last_name,
                    'avatar_url', p.avatar_url,
                    'role', m.role,
                    'added_by', m.added_by,
                    'venmo_username', case when c.kind = 'dm' then p.venmo_username end,
                    'paypal_username', case when c.kind = 'dm' then p.paypal_username end,
                    'zelle_contact', case when c.kind = 'dm' then p.zelle_contact end,
                    'preferred_handle', case when c.kind = 'dm' then p.preferred_handle end)
                  order by m.joined_at, p.first_name)
             from public.conversation_members m
             join public.profiles p on p.id = m.user_id
            where m.conversation_id = c.id), '[]'::jsonb)
    from public.conversation_members mine
    join public.conversations c on c.id = mine.conversation_id
   where mine.user_id = auth.uid()
   order by c.created_at desc;
$$;
