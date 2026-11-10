-- CommonTab: groups and direct messages (creating them, members, organizers) + live updates.
-- Messages come in a later step; this file only covers the conversations themselves.
-- Run once in Supabase, after the earlier files:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Tables -------------------------------------------------------------------------------

-- A group or a one-on-one DM.
create table public.conversations (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('group', 'dm')),
  name         text check (name is null or char_length(name) between 1 and 40),  -- groups only
  description  text check (description is null or char_length(description) <= 200),
  picture_url  text,
  -- Groups without a picture show their initials on one of 8 color gradients, picked at random.
  avatar_gradient  smallint check (avatar_gradient between 0 and 7),
  -- DMs: "<smaller user id>:<larger user id>", so two people only ever have one DM.
  dm_key       text unique,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint conversations_shape check (
    (kind = 'group' and name is not null and dm_key is null) or
    (kind = 'dm' and name is null and dm_key is not null)
  )
);

-- Who is in each conversation. The creator of a group is an organizer; the people they add
-- join as members or organizers. (Its own id, not the pair, so a Realtime removal notice reveals nothing.)
create table public.conversation_members (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             text not null default 'member' check (role in ('organizer', 'member')),
  added_by         uuid references public.profiles (id) on delete set null,
  joined_at        timestamptz not null default now(),
  unique (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

-- 2. Helpers (security definer, so policies can use them without looping) ---------------

create or replace function public.is_conversation_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
     where m.conversation_id = target and m.user_id = auth.uid()
  );
$$;

-- Organizer check by the conversation id as text (used by the group-picture storage rules).
create or replace function public.is_group_organizer(target text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
     where m.conversation_id::text = target and m.user_id = auth.uid() and m.role = 'organizer'
  );
$$;

-- True when the signed-in person and `other` are accepted contacts.
create or replace function public.is_my_contact(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contacts c
     where c.status = 'accepted'
       and least(c.requester_id, c.addressee_id) = least(auth.uid(), other)
       and greatest(c.requester_id, c.addressee_id) = greatest(auth.uid(), other)
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon;
revoke all on function public.is_group_organizer(text) from public, anon;
revoke all on function public.is_my_contact(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.is_group_organizer(text) to authenticated;
grant execute on function public.is_my_contact(uuid) to authenticated;

-- 3. Row-level security: you only see conversations you're in. -------------------------
--    Nobody writes to these tables directly; every change goes through the functions below.

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;

create policy "Members can see their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

create policy "Members can see who else is in their conversations"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- 4. New group: you become an organizer. Each contact you pick joins as a member, or as an
--    organizer if you chose that for them (organizer_ids is a subset of member_ids).

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

  -- One statement block = one transaction: the group and every membership are created
  -- together, or (on any error) none of them are.
  insert into public.conversations (kind, name, description, avatar_gradient, created_by)
  values ('group', clean, about,
          case when gradient between 0 and 7 then gradient else floor(random() * 8)::smallint end,
          me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (new_id, me, 'organizer', me);

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  select distinct new_id, p,
         case when p = any(coalesce(organizer_ids, '{}')) then 'organizer' else 'member' end,
         me
    from unnest(coalesce(member_ids, '{}')) as p
   where p <> me;

  return new_id;
end;
$$;

-- 5. New DM with a contact. Returns the existing DM if you already have one. --------------

create or replace function public.start_dm(other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  pair    text;
  dm_id   uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other is null or other = me then raise exception 'Pick someone else to message'; end if;
  if not public.is_my_contact(other) then raise exception 'You can only message your contacts'; end if;

  pair := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  select id into dm_id from public.conversations where dm_key = pair;
  if dm_id is not null then return dm_id; end if;

  insert into public.conversations (kind, dm_key, created_by)
  values ('dm', pair, me)
  on conflict (dm_key) do nothing
  returning id into dm_id;

  if dm_id is null then  -- the other person started it at the same moment
    select id into dm_id from public.conversations where dm_key = pair;
    return dm_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (dm_id, me, 'member', me), (dm_id, other, 'member', me);
  return dm_id;
end;
$$;

-- 6. Add more contacts to a group (organizers only). They join as members; the group's
--    creator may also add them straight in as organizers (organizer_ids ⊆ member_ids).

create or replace function public.add_group_members(target uuid, member_ids uuid[], organizer_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  person  uuid;
begin
  if not exists (
    select 1 from public.conversation_members m
      join public.conversations c on c.id = m.conversation_id
     where m.conversation_id = target and m.user_id = me and m.role = 'organizer' and c.kind = 'group'
  ) then
    raise exception 'Only organizers can add people';
  end if;

  if cardinality(coalesce(organizer_ids, '{}')) > 0 and not exists (
    select 1 from public.conversations c where c.id = target and c.created_by = me
  ) then
    raise exception 'Only the group''s creator can add organizers';
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

-- 7. Make a member an organizer (only the person who created the group). ----------------

create or replace function public.make_organizer(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations c
     where c.id = target and c.kind = 'group' and c.created_by = auth.uid()
  ) then
    raise exception 'Only the group''s creator can make organizers';
  end if;

  update public.conversation_members
     set role = 'organizer'
   where conversation_id = target and user_id = member and role = 'member';
  if not found then raise exception 'That person isn''t a member of this group'; end if;
end;
$$;

-- 8. Group picture (organizers only). The file is uploaded to group-pictures/<group id>/ first.

create or replace function public.set_group_picture(target uuid, url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_group_organizer(target::text) then raise exception 'Only organizers can change the picture'; end if;
  if url is not null and url not like '%/storage/v1/object/public/group-pictures/' || target::text || '/%' then
    raise exception 'That picture upload isn''t valid';
  end if;
  update public.conversations set picture_url = url where id = target and kind = 'group';
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-pictures', 'group-pictures', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Organizers can upload their group's picture"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'group-pictures' and public.is_group_organizer((storage.foldername(name))[1]));

create policy "Organizers can delete their group's picture"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-pictures' and public.is_group_organizer((storage.foldername(name))[1]));

-- 9. Your conversations, newest first, with everyone in them. ----------------------------
--    Payment handles are included only for the other person in a DM (always a contact).
--    Birthdays and phone numbers are never included.

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

revoke all on function public.create_group(text, text, uuid[], uuid[], smallint) from public, anon;
revoke all on function public.start_dm(uuid) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.make_organizer(uuid, uuid) from public, anon;
revoke all on function public.set_group_picture(uuid, text) from public, anon;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.create_group(text, text, uuid[], uuid[], smallint) to authenticated;
grant execute on function public.start_dm(uuid) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.make_organizer(uuid, uuid) to authenticated;
grant execute on function public.set_group_picture(uuid, text) to authenticated;
grant execute on function public.my_conversations() to authenticated;

-- 10. Live updates: being added to a group or DM, new organizers, picture changes. --------
--     Each person only receives rows the policies in step 3 let them see.

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.conversation_members;
