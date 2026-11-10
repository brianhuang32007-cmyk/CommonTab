-- CommonTab: document requests (Step 12).
--   • Anyone in a group or DM can ask one or more of its members for a document (a receipt,
--     an invoice, spending records…), with a type, instructions and an optional due date.
--     It's posted in the chat as a card and tags everyone asked.
--   • Each person asked uploads up to 5 files (any common document type, 15 MB each) into
--     CommonTab's private storage. Only the requester and that person can ever open them;
--     the rest of the group sees the request and each person's status, never the files.
--   • Status for each person: requested → submitted (ready to review) → accepted, or
--     rejected (with a reason; they upload again), or can't provide (with a reason).
--     The request is complete when everyone is accepted or can't provide.
--   • AI Verify (Step 13) runs only when someone clicks it. Each person sees only the AI
--     checks they ran themselves, so nobody can show the other side a made-up result.
--   • Nobody writes to these tables directly: every change goes through the checked
--     functions below, and the app makes the ids so a retry can't create two of anything.
-- Safe to run again.
-- Run once in Supabase, after 20261110210000_payment_search.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Tables -------------------------------------------------------------------------------

create table if not exists public.document_requests (
  id               uuid primary key,  -- made by the app
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  title            text not null check (char_length(title) between 1 and 80),
  doc_type         text not null check (doc_type in
                     ('receipt', 'invoice', 'spending_records', 'form', 'ticket', 'proof_of_payment', 'other')),
  doc_type_other   text check (doc_type_other is null or char_length(doc_type_other) between 1 and 40),
  instructions     text check (instructions is null or char_length(instructions) <= 500),
  due_date         date,
  status           text not null default 'open' check (status in ('open', 'complete', 'cancelled')),
  created_at       timestamptz not null default now()
);
create index if not exists document_requests_conversation_idx on public.document_requests (conversation_id, created_at desc);

create table if not exists public.document_recipients (
  request_id  uuid not null references public.document_requests (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'requested'
                check (status in ('requested', 'submitted', 'accepted', 'rejected', 'cant_provide')),
  updated_at  timestamptz not null default now(),
  primary key (request_id, user_id)
);
create index if not exists document_recipients_user_idx on public.document_recipients (user_id);

-- One upload = the files someone sends at once. A draft is only theirs until they submit it.
create table if not exists public.document_uploads (
  id            uuid primary key,  -- made by the app
  request_id    uuid not null references public.document_requests (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  note          text check (note is null or char_length(note) <= 500),
  status        text not null default 'draft' check (status in ('draft', 'submitted', 'replaced', 'accepted', 'rejected')),
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  review_note   text check (review_note is null or char_length(review_note) <= 300)
);
create index if not exists document_uploads_request_idx on public.document_uploads (request_id, user_id, created_at desc);

create table if not exists public.document_files (
  id          uuid primary key default gen_random_uuid(),
  upload_id   uuid not null references public.document_uploads (id) on delete cascade,
  path        text not null unique,  -- "<request>/<person>/<upload>/<file>" in request-documents
  name        text not null check (char_length(name) between 1 and 200),
  mime_type   text not null,
  size_bytes  bigint not null check (size_bytes >= 0),
  position    smallint not null
);
create index if not exists document_files_upload_idx on public.document_files (upload_id, position);

-- AI Verify results: one per upload per person who ran it, seen only by that person.
create table if not exists public.document_ai_checks (
  upload_id   uuid not null references public.document_uploads (id) on delete cascade,
  checked_by  uuid not null references public.profiles (id) on delete cascade,
  result      jsonb not null check (jsonb_typeof(result) = 'object' and length(result::text) <= 20000),
  model       text check (model is null or char_length(model) <= 100),
  created_at  timestamptz not null default now(),
  primary key (upload_id, checked_by)
);

-- What happened to each person's part (Activity, and Recent updates on Alerts & Reminders).
create table if not exists public.document_events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.document_requests (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,  -- whose part
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('submitted', 'accepted', 'rejected', 'cant_provide', 'cancelled')),
  note        text check (note is null or char_length(note) <= 300),  -- a rejection or can't-provide reason
  created_at  timestamptz not null default now()
);
create index if not exists document_events_request_idx on public.document_events (request_id, created_at desc);

-- The chat card: a message that points at its document request.
alter table public.messages
  add column if not exists document_request_id uuid references public.document_requests (id) on delete set null;

-- 2. Who can see what ----------------------------------------------------------------------

-- Can the signed-in person see this upload? The uploader always; the requester once it's sent.
create or replace function public.can_see_document_upload(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_uploads u
      join public.document_requests r on r.id = u.request_id
     where u.id = target
       and public.is_conversation_member(r.conversation_id)
       and (u.user_id = auth.uid() or (r.created_by = auth.uid() and u.status <> 'draft'))
  );
$$;

alter table public.document_requests   enable row level security;
alter table public.document_recipients enable row level security;
alter table public.document_uploads    enable row level security;
alter table public.document_files      enable row level security;
alter table public.document_ai_checks  enable row level security;
alter table public.document_events     enable row level security;

drop policy if exists "Members can see their chat's document requests" on public.document_requests;
create policy "Members can see their chat's document requests"
  on public.document_requests for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can see who was asked and where they stand" on public.document_recipients;
create policy "Members can see who was asked and where they stand"
  on public.document_recipients for select to authenticated
  using (exists (select 1 from public.document_requests r
                  where r.id = request_id and public.is_conversation_member(r.conversation_id)));

drop policy if exists "Only the requester and uploader see an upload" on public.document_uploads;
create policy "Only the requester and uploader see an upload"
  on public.document_uploads for select to authenticated
  using (public.can_see_document_upload(id));

drop policy if exists "Only the requester and uploader see its files" on public.document_files;
create policy "Only the requester and uploader see its files"
  on public.document_files for select to authenticated
  using (public.can_see_document_upload(upload_id));

drop policy if exists "You see your own AI checks" on public.document_ai_checks;
create policy "You see your own AI checks"
  on public.document_ai_checks for select to authenticated
  using (checked_by = auth.uid());

drop policy if exists "The requester and that person see a part's history" on public.document_events;
create policy "The requester and that person see a part's history"
  on public.document_events for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.document_requests r where r.id = request_id and r.created_by = auth.uid()));

-- 3. Private file storage --------------------------------------------------------------------
--    Paths: "<request id>/<uploader id>/<upload id>/<file name>".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-documents', 'request-documents', false, 15728640, array[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf', 'text/csv', 'text/plain'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the signed-in person upload into this request? (They were asked, and it's still open.)
create or replace function public.can_upload_document(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_recipients d
      join public.document_requests r on r.id = d.request_id
     where r.id::text = folder and d.user_id = auth.uid() and r.status = 'open'
       and d.status <> 'accepted' and public.is_conversation_member(r.conversation_id)
  );
$$;

-- May the signed-in person open this stored file? Its uploader, or the requester once it's sent.
create or replace function public.can_open_document_file(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(file_path))[2] = auth.uid()::text
         or exists (select 1 from public.document_files f
                      join public.document_uploads u on u.id = f.upload_id
                      join public.document_requests r on r.id = u.request_id
                     where f.path = file_path and u.status <> 'draft' and r.created_by = auth.uid()
                       and public.is_conversation_member(r.conversation_id));
$$;

-- Is this file part of a sent upload? (Then it can't be deleted.)
create or replace function public.is_sent_document_file(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.document_files f join public.document_uploads u on u.id = f.upload_id
                  where f.path = file_path and u.status <> 'draft');
$$;

drop policy if exists "People asked can upload request documents" on storage.objects;
create policy "People asked can upload request documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-documents'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_upload_document((storage.foldername(name))[1])
  );

drop policy if exists "Only the requester and uploader can open request documents" on storage.objects;
create policy "Only the requester and uploader can open request documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'request-documents' and public.can_open_document_file(name));

drop policy if exists "Uploaders can delete unsent request documents" on storage.objects;
create policy "Uploaders can delete unsent request documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'request-documents' and owner_id = auth.uid()::text and not public.is_sent_document_file(name));

-- 4. A request as the signed-in person sees it (chat cards, lists) ------------------------------

create or replace function public.document_request_view(req uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', r.id,
           'conversation_id', r.conversation_id,
           'title', r.title,
           'doc_type', r.doc_type,
           'doc_type_other', r.doc_type_other,
           'instructions', r.instructions,
           'due_date', r.due_date,
           'status', r.status,
           'created_by', r.created_by,
           'created_at', r.created_at,
           'my_status', (select d.status from public.document_recipients d where d.request_id = r.id and d.user_id = auth.uid()),
           'recipients', coalesce((
             select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'status', d.status) order by p.first_name, p.last_name)
               from public.document_recipients d join public.profiles p on p.id = d.user_id
              where d.request_id = r.id), '[]'::jsonb),
           'recipient_count', (select count(*)::integer from public.document_recipients d where d.request_id = r.id),
           'accepted_count', (select count(*)::integer from public.document_recipients d
                               where d.request_id = r.id and d.status = 'accepted'),
           'waiting_count', (select count(*)::integer from public.document_recipients d
                              where d.request_id = r.id and d.status = 'submitted'))
    from public.document_requests r
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;

-- Messages now carry their document request too (the chat card).
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
             select jsonb_agg(mm.user_id) from public.message_mentions mm where mm.message_id = m.id), '[]'::jsonb),
           'payment_request', case when m.payment_request_id is null then null
                                   else public.payment_request_view(m.payment_request_id) end,
           'document_request', case when m.document_request_id is null then null
                                    else public.document_request_view(m.document_request_id) end)
    from public.messages m
   where m.id = msg_id and public.is_conversation_member(m.conversation_id);
$$;

-- 5. Making a request ------------------------------------------------------------------------

create or replace function public.create_document_request(
  req_id uuid,
  target uuid,
  request_title text,
  type_key text,
  type_other text default null,
  request_instructions text default null,
  due date default null,
  recipient_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  clean  text := btrim(coalesce(request_title, ''));
  other  text := nullif(btrim(coalesce(type_other, '')), '');
  notes  text := nullif(btrim(coalesce(request_instructions, '')), '');
  people uuid[];
  label  text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if req_id is null then raise exception 'Missing request id'; end if;

  -- Sent before (a retry after a lost reply): hand back what was saved.
  if exists (select 1 from public.document_requests r where r.id = req_id) then
    if exists (select 1 from public.document_requests r where r.id = req_id and r.created_by = me and r.conversation_id = target) then
      return public.document_request_view(req_id);
    end if;
    raise exception 'That request id is already used';
  end if;

  if not public.is_conversation_member(target) then raise exception 'You''re not in this chat'; end if;
  if char_length(clean) not between 1 and 80 then raise exception 'The title must be 1 to 80 characters'; end if;
  if type_key is null or type_key not in ('receipt', 'invoice', 'spending_records', 'form', 'ticket', 'proof_of_payment', 'other') then
    raise exception 'Pick a document type';
  end if;
  if type_key = 'other' and (other is null or char_length(other) > 40) then raise exception 'Name the document type (40 characters max)'; end if;
  if type_key <> 'other' then other := null; end if;
  if notes is not null and char_length(notes) > 500 then raise exception 'Instructions can be up to 500 characters'; end if;
  if due is not null and due < current_date then raise exception 'The due date can''t be in the past'; end if;

  select coalesce(array_agg(distinct u), '{}') into people from unnest(coalesce(recipient_ids, '{}')) as u where u <> me;
  if coalesce(array_length(people, 1), 0) = 0 then raise exception 'Pick at least one person to send it'; end if;
  if array_length(people, 1) > 50 then raise exception 'Too many people'; end if;
  if exists (select 1 from unnest(people) p
              where not exists (select 1 from public.conversation_members m where m.conversation_id = target and m.user_id = p)) then
    raise exception 'Everyone you ask must be in this chat';
  end if;

  insert into public.document_requests (id, conversation_id, created_by, title, doc_type, doc_type_other, instructions, due_date)
  values (req_id, target, me, clean, type_key, other, notes, due);

  insert into public.document_recipients (request_id, user_id)
  select req_id, p from unnest(people) as p;

  -- Post the card in the chat and tag everyone asked (alerts and "@ You" follow).
  label := 'Document request: ' || clean;
  with card as (
    insert into public.messages (id, conversation_id, sender_id, body, document_request_id)
    values (gen_random_uuid(), target, me, label, req_id)
    returning id
  )
  insert into public.message_mentions (message_id, conversation_id, user_id)
  select card.id, target, p from card, unnest(people) as p;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (target, me, now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();

  return public.document_request_view(req_id);
end;
$$;

-- 6. Uploading -------------------------------------------------------------------------------
--    Files go to storage first; then save_document_draft records them (type and size come from
--    storage, not the app), and submit_document_upload sends them to the requester.
--    files: [{ "path": "<request>/<me>/<upload>/<file>", "name": "records.pdf" }, …] (1 to 5).

create or replace function public.save_document_draft(upload_id uuid, req uuid, upload_note text default null, files jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  list   jsonb := coalesce(files, '[]'::jsonb);
  clean  text := nullif(btrim(coalesce(upload_note, '')), '');
  f      jsonb;
  obj    record;
  pos    integer := 0;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if upload_id is null then raise exception 'Missing upload id'; end if;
  if not exists (select 1 from public.document_recipients d join public.document_requests r on r.id = d.request_id
                  where d.request_id = req and d.user_id = me and r.status = 'open' and d.status <> 'accepted') then
    raise exception 'You can''t upload to this request';
  end if;
  if jsonb_typeof(list) <> 'array' or jsonb_array_length(list) not between 1 and 5 then raise exception 'Add 1 to 5 files'; end if;
  if clean is not null and char_length(clean) > 500 then raise exception 'The note can be up to 500 characters'; end if;

  if exists (select 1 from public.document_uploads u where u.id = upload_id) then
    if not exists (select 1 from public.document_uploads u
                    where u.id = upload_id and u.user_id = me and u.request_id = req and u.status = 'draft') then
      raise exception 'That upload was already sent';
    end if;
    update public.document_uploads u set note = clean where u.id = upload_id;
    delete from public.document_files df where df.upload_id = save_document_draft.upload_id;
  else
    insert into public.document_uploads (id, request_id, user_id, note) values (upload_id, req, me, clean);
  end if;

  for f in select value from jsonb_array_elements(list) loop
    if coalesce(f->>'path', '') not like req::text || '/' || me::text || '/' || upload_id::text || '/%' then
      raise exception 'That file upload isn''t valid';
    end if;
    select o.metadata into obj
      from storage.objects o
     where o.bucket_id = 'request-documents' and o.name = f->>'path' and o.owner_id = me::text;
    if not found then raise exception 'A file didn''t finish uploading. Try again.'; end if;
    insert into public.document_files (upload_id, path, name, mime_type, size_bytes, position)
    values (upload_id, f->>'path', left(coalesce(nullif(btrim(f->>'name'), ''), 'file'), 200),
            coalesce(obj.metadata->>'mimetype', 'application/octet-stream'), coalesce((obj.metadata->>'size')::bigint, 0), pos);
    pos := pos + 1;
  end loop;

  return upload_id;
end;
$$;

create or replace function public.submit_document_upload(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  up   public.document_uploads%rowtype;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into up from public.document_uploads u where u.id = target and u.user_id = me;
  if not found then raise exception 'Upload not found'; end if;
  if up.status <> 'draft' then return public.document_request_view(up.request_id); end if;  -- sent already (a retry)
  if not exists (select 1 from public.document_files f where f.upload_id = target) then raise exception 'Add a file first'; end if;
  if not exists (select 1 from public.document_recipients d join public.document_requests r on r.id = d.request_id
                  where d.request_id = up.request_id and d.user_id = me and r.status = 'open' and d.status <> 'accepted') then
    raise exception 'This request isn''t taking uploads any more';
  end if;

  -- A newer upload replaces one still waiting for review.
  update public.document_uploads u set status = 'replaced'
   where u.request_id = up.request_id and u.user_id = me and u.status = 'submitted';
  update public.document_uploads u set status = 'submitted', submitted_at = now() where u.id = target;
  update public.document_recipients d set status = 'submitted', updated_at = now()
   where d.request_id = up.request_id and d.user_id = me;
  insert into public.document_events (request_id, user_id, actor_id, kind) values (up.request_id, me, me, 'submitted');

  return public.document_request_view(up.request_id);
end;
$$;

-- Closes the request when everyone is accepted or can't provide it.
create or replace function public.close_document_request_if_done(req uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.document_requests r set status = 'complete'
   where r.id = req and r.status = 'open'
     and not exists (select 1 from public.document_recipients d
                      where d.request_id = req and d.status not in ('accepted', 'cant_provide'));
$$;

-- 7. Reviewing (the requester) ----------------------------------------------------------------

create or replace function public.review_document_upload(target uuid, decision text, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  up     public.document_uploads%rowtype;
  clean  text := nullif(btrim(coalesce(reason, '')), '');
begin
  if me is null then raise exception 'Not signed in'; end if;
  if decision not in ('accept', 'reject') then raise exception 'Unknown decision'; end if;
  select u.* into up from public.document_uploads u join public.document_requests r on r.id = u.request_id
   where u.id = target and r.created_by = me and r.status = 'open';
  if not found then raise exception 'Only the requester can review this, while the request is open'; end if;
  if up.status <> 'submitted' then raise exception 'This upload was already reviewed or replaced'; end if;

  if decision = 'accept' then
    update public.document_uploads u set status = 'accepted', reviewed_at = now() where u.id = target;
    update public.document_recipients d set status = 'accepted', updated_at = now()
     where d.request_id = up.request_id and d.user_id = up.user_id;
    insert into public.document_events (request_id, user_id, actor_id, kind) values (up.request_id, up.user_id, me, 'accepted');
    perform public.close_document_request_if_done(up.request_id);
  else
    if clean is null or char_length(clean) > 300 then raise exception 'Say why (300 characters max)'; end if;
    update public.document_uploads u set status = 'rejected', reviewed_at = now(), review_note = clean where u.id = target;
    update public.document_recipients d set status = 'rejected', updated_at = now()
     where d.request_id = up.request_id and d.user_id = up.user_id;
    insert into public.document_events (request_id, user_id, actor_id, kind, note) values (up.request_id, up.user_id, me, 'rejected', clean);
  end if;

  return public.document_request_view(up.request_id);
end;
$$;

-- 8. Can't provide (the person asked), and canceling (the requester) -----------------------------

create or replace function public.cant_provide_document(req uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  clean  text := nullif(btrim(coalesce(reason, '')), '');
begin
  if me is null then raise exception 'Not signed in'; end if;
  if clean is null or char_length(clean) > 300 then raise exception 'Say why (300 characters max)'; end if;
  if not exists (select 1 from public.document_recipients d join public.document_requests r on r.id = d.request_id
                  where d.request_id = req and d.user_id = me and r.status = 'open' and d.status in ('requested', 'rejected')) then
    raise exception 'You can only do this before sending a document, or after one was rejected';
  end if;
  update public.document_recipients d set status = 'cant_provide', updated_at = now() where d.request_id = req and d.user_id = me;
  insert into public.document_events (request_id, user_id, actor_id, kind, note) values (req, me, me, 'cant_provide', clean);
  perform public.close_document_request_if_done(req);
  return public.document_request_view(req);
end;
$$;

create or replace function public.cancel_document_request(req uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.document_requests r where r.id = req and r.created_by = me) then
    raise exception 'Only the requester can cancel this request';
  end if;
  if exists (select 1 from public.document_requests r where r.id = req and r.status <> 'open') then
    return public.document_request_view(req);
  end if;
  update public.document_requests r set status = 'cancelled' where r.id = req;
  insert into public.document_events (request_id, user_id, actor_id, kind)
  select req, d.user_id, me, 'cancelled' from public.document_recipients d
   where d.request_id = req and d.status not in ('accepted', 'cant_provide');
  return public.document_request_view(req);
end;
$$;

-- 9. The request's page ---------------------------------------------------------------------------
--    Everyone in the chat: the request, who was asked and each status, and Activity (without
--    reasons). The requester and each person asked also get their uploads, files, reasons and
--    their own AI checks.

create or replace function public.document_request_details(req uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.document_request_view(r.id)
           || jsonb_build_object(
                'conversation_name', c.name,
                'conversation_kind', c.kind,
                'creator', (select jsonb_build_object('user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
                                                      'username', p.username, 'avatar_url', p.avatar_url)
                              from public.profiles p where p.id = r.created_by),
                'people', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'user_id', d.user_id, 'first_name', p.first_name, 'last_name', p.last_name,
                           'username', p.username, 'avatar_url', p.avatar_url,
                           'status', d.status, 'updated_at', d.updated_at,
                           'reason', case when r.created_by = auth.uid() or d.user_id = auth.uid() then
                                       (select e.note from public.document_events e
                                         where e.request_id = r.id and e.user_id = d.user_id and e.kind in ('rejected', 'cant_provide')
                                         order by e.created_at desc, e.id desc limit 1)
                                     end)
                           order by p.first_name, p.last_name)
                    from public.document_recipients d join public.profiles p on p.id = d.user_id
                   where d.request_id = r.id), '[]'::jsonb),
                'uploads', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'id', u.id, 'user_id', u.user_id, 'status', u.status, 'note', u.note,
                           'created_at', u.created_at, 'submitted_at', u.submitted_at,
                           'reviewed_at', u.reviewed_at, 'review_note', u.review_note,
                           'files', coalesce((select jsonb_agg(jsonb_build_object(
                                                'id', f.id, 'path', f.path, 'name', f.name, 'mime_type', f.mime_type,
                                                'size_bytes', f.size_bytes, 'position', f.position) order by f.position)
                                                from public.document_files f where f.upload_id = u.id), '[]'::jsonb),
                           'ai_check', (select jsonb_build_object('result', a.result, 'model', a.model, 'created_at', a.created_at)
                                          from public.document_ai_checks a where a.upload_id = u.id and a.checked_by = auth.uid()))
                           order by u.created_at desc)
                    from public.document_uploads u
                   where u.request_id = r.id
                     and (u.user_id = auth.uid() or (r.created_by = auth.uid() and u.status <> 'draft'))), '[]'::jsonb),
                'events', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'id', e.id, 'user_id', e.user_id, 'actor_id', e.actor_id, 'kind', e.kind,
                           'first_name', p.first_name, 'created_at', e.created_at,
                           'note', case when r.created_by = auth.uid() or e.user_id = auth.uid() then e.note end)
                           order by e.created_at, e.id)
                    from public.document_events e join public.profiles p on p.id = e.user_id
                   where e.request_id = r.id), '[]'::jsonb))
    from public.document_requests r
    join public.conversations c on c.id = r.conversation_id
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;

-- One file, for the file viewer page (only the requester and the uploader).
create or replace function public.document_file_info(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', f.id, 'path', f.path, 'name', f.name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
           'position', f.position,
           'upload_id', u.id, 'upload_status', u.status, 'uploaded_at', coalesce(u.submitted_at, u.created_at),
           'uploader', jsonb_build_object('user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name),
           'request_id', r.id, 'request_title', r.title, 'conversation_id', r.conversation_id,
           'siblings', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.position)
                                   from public.document_files s where s.upload_id = u.id), '[]'::jsonb))
    from public.document_files f
    join public.document_uploads u on u.id = f.upload_id
    join public.document_requests r on r.id = u.request_id
    left join public.profiles p on p.id = u.user_id
   where f.id = target and public.can_see_document_upload(u.id);
$$;

-- 10. Lists and alerts ----------------------------------------------------------------------------

-- Open document requests you sent or were asked for (Requests tab, Action needed).
create or replace function public.my_document_requests(target uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.document_request_view(r.id)
           || jsonb_build_object(
                'direction', case when r.created_by = auth.uid() then 'sent' else 'received' end,
                'conversation_name', c.name,
                'conversation_kind', c.kind,
                'requester_first_name', p.first_name,
                'requester_last_name', p.last_name)
    from public.document_requests r
    join public.conversations c on c.id = r.conversation_id
    left join public.profiles p on p.id = r.created_by
   where r.status = 'open'
     and (target is null or r.conversation_id = target)
     and public.is_conversation_member(r.conversation_id)
     and (r.created_by = auth.uid()
          or exists (select 1 from public.document_recipients d where d.request_id = r.id and d.user_id = auth.uid()))
   order by r.due_date asc nulls last, r.created_at desc
   limit 200;
$$;

-- What others did on document requests you're part of (Recent updates), shaped like
-- my_request_events so alerts treat both the same. Your own actions are left out.
create or replace function public.my_document_events(max_rows integer default 50)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'source', 'document',
           'id', e.id,
           'request_id', r.id,
           'conversation_id', r.conversation_id,
           'title', r.title,
           'conversation_name', c.name,
           'conversation_kind', c.kind,
           'kind', e.kind,
           'user_id', e.user_id,
           'actor_id', e.actor_id,
           'user_first_name', u.first_name,
           'actor_first_name', a.first_name,
           'amount_cents', null,
           'previous_cents', null,
           'note', e.note,
           'created_at', e.created_at,
           'i_am_requester', r.created_by = auth.uid())
    from public.document_events e
    join public.document_requests r on r.id = e.request_id
    join public.conversations c on c.id = r.conversation_id
    left join public.profiles u on u.id = e.user_id
    left join public.profiles a on a.id = e.actor_id
   where public.is_conversation_member(r.conversation_id)
     and (r.created_by = auth.uid() or e.user_id = auth.uid())
     and e.actor_id is distinct from auth.uid()
     and e.created_at > now() - interval '30 days'
   order by e.created_at desc, e.id desc
   limit least(greatest(coalesce(max_rows, 50), 1), 100);
$$;

-- 11. AI Verify (Step 13) ---------------------------------------------------------------------------

-- What the AI route needs to check an upload, if you may see it.
create or replace function public.document_for_ai(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'upload_id', u.id, 'status', u.status, 'note', u.note,
           'title', r.title, 'doc_type', r.doc_type, 'doc_type_other', r.doc_type_other, 'instructions', r.instructions,
           'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'name', f.name,
                                                                  'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.position)
                                from public.document_files f where f.upload_id = u.id), '[]'::jsonb))
    from public.document_uploads u
    join public.document_requests r on r.id = u.request_id
   where u.id = target and public.can_see_document_upload(u.id);
$$;

create or replace function public.save_document_ai_check(target uuid, check_result jsonb, model_used text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.can_see_document_upload(target) then raise exception 'Upload not found'; end if;
  if check_result is null or jsonb_typeof(check_result) <> 'object' or length(check_result::text) > 20000 then
    raise exception 'That check result isn''t valid';
  end if;
  insert into public.document_ai_checks (upload_id, checked_by, result, model)
  values (target, me, check_result, left(model_used, 100))
  on conflict (upload_id, checked_by) do update set result = excluded.result, model = excluded.model, created_at = now();
end;
$$;

-- AI Verify has its own daily limit: 20 per person in any 24 hours.
alter table public.ai_calls drop constraint if exists ai_calls_feature_check;
alter table public.ai_calls add constraint ai_calls_feature_check check (feature in ('chat', 'receipt', 'document'));

create or replace function public.ai_daily_limit(feature_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case feature_name when 'chat' then 30 when 'receipt' then 20 when 'document' then 20 else 0 end;
$$;

-- 12. Permissions ----------------------------------------------------------------------------------

revoke all on function public.can_see_document_upload(uuid) from public, anon;
revoke all on function public.can_upload_document(text) from public, anon;
revoke all on function public.can_open_document_file(text) from public, anon;
revoke all on function public.is_sent_document_file(text) from public, anon;
revoke all on function public.document_request_view(uuid) from public, anon;
revoke all on function public.create_document_request(uuid, uuid, text, text, text, text, date, uuid[]) from public, anon;
revoke all on function public.save_document_draft(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.submit_document_upload(uuid) from public, anon;
revoke all on function public.close_document_request_if_done(uuid) from public, anon, authenticated;
revoke all on function public.review_document_upload(uuid, text, text) from public, anon;
revoke all on function public.cant_provide_document(uuid, text) from public, anon;
revoke all on function public.cancel_document_request(uuid) from public, anon;
revoke all on function public.document_request_details(uuid) from public, anon;
revoke all on function public.document_file_info(uuid) from public, anon;
revoke all on function public.my_document_requests(uuid) from public, anon;
revoke all on function public.my_document_events(integer) from public, anon;
revoke all on function public.document_for_ai(uuid) from public, anon;
revoke all on function public.save_document_ai_check(uuid, jsonb, text) from public, anon;

grant execute on function public.can_see_document_upload(uuid) to authenticated;
grant execute on function public.can_upload_document(text) to authenticated;
grant execute on function public.can_open_document_file(text) to authenticated;
grant execute on function public.is_sent_document_file(text) to authenticated;
grant execute on function public.document_request_view(uuid) to authenticated;
grant execute on function public.create_document_request(uuid, uuid, text, text, text, text, date, uuid[]) to authenticated;
grant execute on function public.save_document_draft(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.submit_document_upload(uuid) to authenticated;
grant execute on function public.review_document_upload(uuid, text, text) to authenticated;
grant execute on function public.cant_provide_document(uuid, text) to authenticated;
grant execute on function public.cancel_document_request(uuid) to authenticated;
grant execute on function public.document_request_details(uuid) to authenticated;
grant execute on function public.document_file_info(uuid) to authenticated;
grant execute on function public.my_document_requests(uuid) to authenticated;
grant execute on function public.my_document_events(integer) to authenticated;
grant execute on function public.document_for_ai(uuid) to authenticated;
grant execute on function public.save_document_ai_check(uuid, jsonb, text) to authenticated;

-- 13. Live updates: cards, lists and alerts change when a request or someone's part changes. ----

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'document_requests') then
    alter publication supabase_realtime add table public.document_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'document_recipients') then
    alter publication supabase_realtime add table public.document_recipients;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'document_events') then
    alter publication supabase_realtime add table public.document_events;
  end if;
end;
$$;
