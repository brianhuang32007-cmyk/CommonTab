-- CommonTab: chat messages, attachments, @mentions and read positions.
--   • Only a conversation's members can read its messages, files and mentions, or post in it.
--   • The app makes each message's id. Sending the same id again (a retry) returns the saved
--     message instead of posting twice.
--   • Files go to a private bucket, in "<conversation id>/<message id>/<file>". A message is only
--     saved if every file it lists was really uploaded by the sender; nothing goes missing silently.
--   • Mentions store the person's id, and must be people in the conversation. A mention never
--     creates a payment or document request.
--   • Each person's read position drives the "@ You" badge for unread mentions.
-- Run once in Supabase, after 20261110070000_private_pictures.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Tables -------------------------------------------------------------------------------

create table public.messages (
  id               uuid primary key,  -- made by the app, so a retry can't post twice
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null,
  body             text not null default '' check (char_length(body) <= 4000),
  -- Order of arrival. Breaks ties when two messages have the same time.
  seq              bigint generated always as identity unique,
  created_at       timestamptz not null default now()
);
create index messages_conversation_seq_idx on public.messages (conversation_id, seq desc);

create table public.message_attachments (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  path             text not null unique,
  name             text not null check (char_length(name) between 1 and 200),
  mime_type        text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes       integer not null check (size_bytes between 1 and 10485760),
  position         smallint not null check (position between 0 and 4)
);
create index message_attachments_message_idx on public.message_attachments (message_id);

create table public.message_mentions (
  message_id       uuid not null references public.messages (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  primary key (message_id, user_id)
);
create index message_mentions_user_idx on public.message_mentions (user_id, conversation_id);

-- How far each person has read in each conversation.
create table public.conversation_reads (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- 2. Row-level security: members read; nobody writes directly. ----------------------------

alter table public.messages            enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_mentions    enable row level security;
alter table public.conversation_reads  enable row level security;

create policy "Members can read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "Members can see attachments"
  on public.message_attachments for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "Members can see mentions"
  on public.message_mentions for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "You can see your own read positions"
  on public.conversation_reads for select to authenticated
  using (user_id = auth.uid());

-- 3. Private file storage --------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Is the signed-in person in the conversation this storage folder belongs to?
create or replace function public.is_folder_member(folder text)
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

-- Is this file already part of a sent message? (Then nobody can delete it on its own.)
create or replace function public.is_attached_file(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.message_attachments a where a.path = file_path);
$$;

revoke all on function public.is_folder_member(text) from public, anon;
revoke all on function public.is_attached_file(text) from public, anon;
grant execute on function public.is_folder_member(text) to authenticated;
grant execute on function public.is_attached_file(text) to authenticated;

create policy "Members can upload chat files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-files'
    and array_length(storage.foldername(name), 1) = 2
    and public.is_folder_member((storage.foldername(name))[1])
  );

create policy "Members can open chat files"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.is_folder_member((storage.foldername(name))[1]));

-- The uploader can delete a file that was never sent (removed from the draft, or a failed message).
create policy "Uploaders can delete unsent chat files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-files' and owner_id = auth.uid()::text and not public.is_attached_file(name));

-- 4. Reading messages ------------------------------------------------------------------------

-- One message with its files and mentions, if you're in its conversation.
create or replace function public.get_message(msg_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', m.id,
           'conversation_id', m.conversation_id,
           'sender_id', m.sender_id,
           'body', m.body,
           'seq', m.seq,
           'created_at', m.created_at,
           'attachments', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', a.id, 'path', a.path, 'name', a.name, 'mime_type', a.mime_type,
                      'size_bytes', a.size_bytes, 'position', a.position) order by a.position)
               from public.message_attachments a where a.message_id = m.id), '[]'::jsonb),
           'mentions', coalesce((
             select jsonb_agg(mm.user_id) from public.message_mentions mm where mm.message_id = m.id), '[]'::jsonb))
    from public.messages m
   where m.id = msg_id and public.is_conversation_member(m.conversation_id);
$$;

-- A page of messages, newest first. Pass the oldest seq you have to get the page before it.
create or replace function public.conversation_messages(target uuid, before_seq bigint default null, page_size integer default 30)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_message(m.id)
    from public.messages m
   where m.conversation_id = target
     and public.is_conversation_member(target)
     and (before_seq is null or m.seq < before_seq)
   order by m.seq desc
   limit least(greatest(coalesce(page_size, 30), 1), 100);
$$;

-- 5. Sending ---------------------------------------------------------------------------------
--    files: [{ "path": "<conversation>/<message>/<file>", "name": "receipt.pdf" }, …] (up to 5).
--    The file type and size come from storage itself, not from the app.

create or replace function public.send_message(
  msg_id uuid, target uuid, msg_body text default '', mention_ids uuid[] default '{}', files jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  clean  text := coalesce(msg_body, '');
  list   jsonb := coalesce(files, '[]'::jsonb);
  f      jsonb;
  obj    record;
  pos    integer := 0;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if msg_id is null then raise exception 'Missing message id'; end if;

  -- Sent before (e.g. the reply was lost and the app retried): hand back what was saved.
  if exists (select 1 from public.messages m where m.id = msg_id) then
    if exists (select 1 from public.messages m where m.id = msg_id and m.sender_id = me and m.conversation_id = target) then
      return public.get_message(msg_id);
    end if;
    raise exception 'That message id is already used';
  end if;

  if not public.is_conversation_member(target) then raise exception 'You''re not in this conversation'; end if;

  -- Blank lines at the start and spaces at the end go; everything in between stays as typed.
  clean := regexp_replace(regexp_replace(clean, '^([ \t]*\r?\n)+', ''), '\s+$', '');
  if char_length(clean) > 4000 then raise exception 'Messages can be up to 4,000 characters'; end if;
  if jsonb_typeof(list) <> 'array' then raise exception 'Files must be a list'; end if;
  if jsonb_array_length(list) > 5 then raise exception 'You can attach up to 5 files per message'; end if;
  if clean = '' and jsonb_array_length(list) = 0 then raise exception 'Write a message or attach a file'; end if;
  if exists (
    select 1 from unnest(coalesce(mention_ids, '{}')) as u
     where not exists (select 1 from public.conversation_members m where m.conversation_id = target and m.user_id = u)
  ) then
    raise exception 'You can only mention people in this conversation';
  end if;

  begin
    insert into public.messages (id, conversation_id, sender_id, body) values (msg_id, target, me, clean);
  exception when unique_violation then
    -- The same message arrived twice at the same moment; the first one won.
    if exists (select 1 from public.messages m where m.id = msg_id and m.sender_id = me and m.conversation_id = target) then
      return public.get_message(msg_id);
    end if;
    raise exception 'That message id is already used';
  end;

  for f in select value from jsonb_array_elements(list) loop
    if coalesce(f->>'path', '') not like target::text || '/' || msg_id::text || '/%' then
      raise exception 'That file upload isn''t valid';
    end if;
    -- Every file must already be uploaded, by you.
    select o.metadata into obj
      from storage.objects o
     where o.bucket_id = 'chat-files' and o.name = f->>'path' and o.owner_id = me::text;
    if not found then raise exception 'A file didn''t finish uploading. Try again.'; end if;

    insert into public.message_attachments (message_id, conversation_id, path, name, mime_type, size_bytes, position)
    values (msg_id, target, f->>'path',
            left(coalesce(nullif(btrim(f->>'name'), ''), 'file'), 200),
            obj.metadata->>'mimetype', (obj.metadata->>'size')::integer, pos);
    pos := pos + 1;
  end loop;

  insert into public.message_mentions (message_id, conversation_id, user_id)
  select distinct msg_id, target, u from unnest(coalesce(mention_ids, '{}')) as u where u <> me;

  -- Your own message counts as read.
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (target, me, now())
  on conflict (conversation_id, user_id) do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);

  return public.get_message(msg_id);
end;
$$;

-- 6. Read positions --------------------------------------------------------------------------

create or replace function public.mark_conversation_read(target uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  select target, auth.uid(), now()
   where public.is_conversation_member(target)
  on conflict (conversation_id, user_id) do update set last_read_at = now();
$$;

revoke all on function public.get_message(uuid) from public, anon;
revoke all on function public.conversation_messages(uuid, bigint, integer) from public, anon;
revoke all on function public.send_message(uuid, uuid, text, uuid[], jsonb) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.get_message(uuid) to authenticated;
grant execute on function public.conversation_messages(uuid, bigint, integer) to authenticated;
grant execute on function public.send_message(uuid, uuid, text, uuid[], jsonb) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- 7. The conversation list also counts unread mentions of you (for the "@ You" badge). -------

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
  members          jsonb,
  unread_mentions  integer
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
            where m.conversation_id = c.id), '[]'::jsonb),
         (select count(*)::integer
            from public.message_mentions mm
            join public.messages msg on msg.id = mm.message_id
           where mm.conversation_id = c.id
             and mm.user_id = auth.uid()
             and msg.sender_id is distinct from auth.uid()
             and msg.created_at > coalesce(
                   (select r.last_read_at from public.conversation_reads r
                     where r.conversation_id = c.id and r.user_id = auth.uid()),
                   '-infinity'::timestamptz))
    from public.conversation_members mine
    join public.conversations c on c.id = mine.conversation_id
   where mine.user_id = auth.uid()
   order by c.created_at desc;
$$;

revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- 8. Live updates: new messages reach the conversation's members right away. ---------------

alter publication supabase_realtime add table public.messages;
