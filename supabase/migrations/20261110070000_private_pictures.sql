-- CommonTab: private group pictures and safe retries.
--   • Inviting adds people right away (no accept step). Only the owner and organizers can invite
--     (organizers invite members only; the owner can also invite organizers) and edit the group.
--     Inviting someone who's already in the group does nothing, so sending twice is safe.
--   • Group pictures become private: only the group's members can see them.
--   • Creating a group twice by accident (double-click, retry) returns the first group.
--   • Deleting a group twice (a retry) is not an error.
-- Already enforced by earlier files: one membership per person per group (unique key), nobody
-- can write to the group tables directly (every change goes through the checked functions),
-- only the owner can change roles, and nobody can make themselves an organizer.
-- Run once in Supabase, after 20261110060000_edit_group.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Private group pictures --------------------------------------------------------------
--    The database now stores the file's place in storage ("<group id>/<file>"), not a public link.
--    The app asks storage for a short-lived link when it shows the picture.

alter table public.conversations rename column picture_url to picture_path;
update public.conversations
   set picture_path = substring(picture_path from '/group-pictures/(.+)$')
 where picture_path like '%/group-pictures/%';

update storage.buckets set public = false where id = 'group-pictures';

-- Members can see their group's picture.
create or replace function public.can_see_group_picture(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
     where m.conversation_id::text = folder and m.user_id = auth.uid()
  );
$$;

revoke all on function public.can_see_group_picture(text) from public, anon;
grant execute on function public.can_see_group_picture(text) to authenticated;

drop policy if exists "Organizers can list their group's pictures" on storage.objects;
create policy "Members can see their group's pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'group-pictures' and public.can_see_group_picture((storage.foldername(name))[1]));

-- A picture must be a file in the group's own folder.
create or replace function public.is_group_picture_path(target uuid, path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select path ~ ('^' || target::text || '/[A-Za-z0-9_-]+\.(jpg|png|webp)$');
$$;

drop function if exists public.set_group_picture(uuid, text);
create function public.set_group_picture(target uuid, path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_group_organizer(target::text) then raise exception 'Only the owner and organizers can change the picture'; end if;
  if path is not null and not public.is_group_picture_path(target, path) then raise exception 'That picture upload isn''t valid'; end if;
  update public.conversations set picture_path = path where id = target and kind = 'group';
end;
$$;

revoke all on function public.set_group_picture(uuid, text) from public, anon;
grant execute on function public.set_group_picture(uuid, text) to authenticated;

create or replace function public.update_group(
  target uuid, group_name text, group_description text, picture text default null, change_picture boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean  text := btrim(coalesce(group_name, ''));
  about  text := nullif(btrim(coalesce(group_description, '')), '');
begin
  if not public.is_group_organizer(target::text) then raise exception 'Only the owner and organizers can edit the group'; end if;
  if char_length(clean) not between 1 and 40 then raise exception 'Group name must be 1 to 40 characters'; end if;
  if about is not null and char_length(about) > 200 then raise exception 'Description must be 200 characters or fewer'; end if;
  if change_picture and picture is not null and not public.is_group_picture_path(target, picture) then
    raise exception 'That picture upload isn''t valid';
  end if;

  update public.conversations
     set name = clean,
         description = about,
         picture_path = case when change_picture then picture else picture_path end
   where id = target and kind = 'group';
end;
$$;

-- 2. New group, safe to send twice. -------------------------------------------------------
--    The app sends a request id with each new-group form; sending it again returns the same group.

alter table public.conversations add column request_id uuid;
create unique index conversations_one_per_request
  on public.conversations (created_by, request_id) where request_id is not null;

drop function if exists public.create_group(text, text, uuid[], uuid[], smallint);
create function public.create_group(
  group_name text,
  group_description text,
  member_ids uuid[] default '{}',
  organizer_ids uuid[] default '{}',
  gradient smallint default null,
  client_request uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  clean   text := btrim(coalesce(group_name, ''));
  about   text := nullif(btrim(coalesce(group_description, '')), '');
  new_id  uuid;
  person  uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;

  -- Same form sent again (a double-click or a retry): hand back the group it already made.
  if client_request is not null then
    select c.id into new_id from public.conversations c where c.created_by = me and c.request_id = client_request;
    if new_id is not null then return new_id; end if;
  end if;

  if char_length(clean) not between 1 and 40 then raise exception 'Group name must be 1 to 40 characters'; end if;
  if about is not null and char_length(about) > 200 then raise exception 'Description must be 200 characters or fewer'; end if;
  if cardinality(coalesce(organizer_ids, '{}')) > 0 and not (organizer_ids <@ coalesce(member_ids, '{}')) then
    raise exception 'Organizers must also be invited';
  end if;
  foreach person in array coalesce(member_ids, '{}') loop
    if person = me then continue; end if;
    if not public.is_my_contact(person) then raise exception 'You can only invite your contacts'; end if;
  end loop;

  -- One function call = one transaction: the group and every membership are created together.
  insert into public.conversations (kind, name, description, avatar_gradient, created_by, request_id)
  values ('group', clean, about,
          case when gradient between 0 and 7 then gradient else floor(random() * 8)::smallint end,
          me, client_request)
  on conflict (created_by, request_id) where request_id is not null do nothing
  returning id into new_id;

  if new_id is null then
    -- The same request finished a moment earlier in another call.
    select c.id into new_id from public.conversations c where c.created_by = me and c.request_id = client_request;
    return new_id;
  end if;

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

revoke all on function public.create_group(text, text, uuid[], uuid[], smallint, uuid) from public, anon;
grant execute on function public.create_group(text, text, uuid[], uuid[], smallint, uuid) to authenticated;

-- 3. Deleting a group twice (a retry) is not an error. --------------------------------------

create or replace function public.delete_group(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.conversations where id = target) then return; end if;
  if public.my_group_role(target) is distinct from 'owner' then raise exception 'Only the owner can delete the group'; end if;
  delete from public.conversations where id = target and kind = 'group';
end;
$$;

-- 4. The conversation list returns picture_path instead of a public link. ------------------

drop function if exists public.my_conversations();
create function public.my_conversations()
returns table (
  id               uuid,
  kind             text,
  name             text,
  description      text,
  picture_path     text,
  avatar_gradient  smallint,
  created_by       uuid,
  created_at       timestamptz,
  members          jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.name, c.description, c.picture_path, c.avatar_gradient, c.created_by, c.created_at,
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

revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;
