-- CommonTab: Document Drafting (Step 15): Fill Out a Form, and Build a Spreadsheet.
--   • Drafts: each form or spreadsheet you start is saved as you go ("My drafts"), only for you.
--   • Forms: you upload an empty form (PDF, Word or a photo) to your own private storage. AI turns
--     it into simple questions and pre-fills what it knows (your profile, answers you chose to
--     remember, the chat it's for). You edit, sign, and send the filled form to a chat or a
--     document request. Remembered answers are only yours, and you can clear them.
--   • Spreadsheets: built from the chats you pick (payment requests, receipts, messages, photos
--     and PDFs sent there, accepted documents), only what you're already allowed to see.
--     Plain code does all the math.
--   • Spreadsheets can be sent to a chat, so chat files now also take .xlsx and .csv.
--   • Daily AI limits: forms 20, spreadsheets 10 per person in any 24 hours.
-- Safe to run again.
-- Run once in Supabase, after 20261110250000_chat_documents.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Drafts -----------------------------------------------------------------------------------------

create table if not exists public.drafts (
  id           uuid primary key,  -- made by the app
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('form', 'sheet')),
  title        text not null check (char_length(title) between 1 and 120),
  status       text not null default 'draft' check (status in ('draft', 'done')),
  source_path  text,  -- the uploaded empty form: "<owner>/<draft>/<file>" in the drafts bucket
  source_name  text check (source_name is null or char_length(source_name) <= 200),
  data         jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and length(data::text) <= 600000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists drafts_owner_idx on public.drafts (owner_id, updated_at desc);

alter table public.drafts enable row level security;
drop policy if exists "You see your own drafts" on public.drafts;
create policy "You see your own drafts"
  on public.drafts for select to authenticated
  using (owner_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drafts', 'drafts', false, 15728640, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "You upload your own draft files" on storage.objects;
create policy "You upload your own draft files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'drafts' and array_length(storage.foldername(name), 1) = 2
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "You open your own draft files" on storage.objects;
create policy "You open your own draft files"
  on storage.objects for select to authenticated
  using (bucket_id = 'drafts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "You delete your own draft files" on storage.objects;
create policy "You delete your own draft files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'drafts' and (storage.foldername(name))[1] = auth.uid()::text);

-- Saves a draft (creates it the first time). A source file must be yours, in that draft's folder.
create or replace function public.save_draft(
  draft_id uuid, draft_kind text, draft_title text, draft_data jsonb,
  draft_status text default 'draft', file_path text default null, file_name text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  clean  text := left(btrim(coalesce(draft_title, '')), 120);
  t      timestamptz := now();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if draft_id is null then raise exception 'Missing draft id'; end if;
  if draft_kind not in ('form', 'sheet') then raise exception 'Unknown draft type'; end if;
  if draft_status not in ('draft', 'done') then raise exception 'Unknown status'; end if;
  if clean = '' then clean := case draft_kind when 'form' then 'Untitled form' else 'Untitled spreadsheet' end; end if;
  if draft_data is null or jsonb_typeof(draft_data) <> 'object' or length(draft_data::text) > 600000 then
    raise exception 'This draft is too big to save';
  end if;
  if file_path is not null then
    if file_path not like me::text || '/' || draft_id::text || '/%' then raise exception 'That file isn''t valid'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'drafts' and o.name = file_path and o.owner_id = me::text) then
      raise exception 'The file didn''t finish uploading. Try again.';
    end if;
  end if;

  if exists (select 1 from public.drafts d where d.id = draft_id and d.owner_id <> me) then
    raise exception 'That draft id is already used';
  end if;
  insert into public.drafts (id, owner_id, kind, title, status, source_path, source_name, data, updated_at)
  values (draft_id, me, draft_kind, clean, draft_status, file_path, left(file_name, 200), draft_data, t)
  on conflict (id) do update
    set title = excluded.title, status = excluded.status, data = excluded.data, updated_at = t,
        source_path = coalesce(excluded.source_path, public.drafts.source_path),
        source_name = coalesce(excluded.source_name, public.drafts.source_name);
  return t;
end;
$$;

create or replace function public.delete_draft(draft_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.drafts d where d.id = draft_id and d.owner_id = auth.uid();
$$;

-- 2. Remembered form answers (only yours) ------------------------------------------------------------

create table if not exists public.form_memory (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  field_key   text not null check (char_length(field_key) between 1 and 80),
  label       text not null check (char_length(label) between 1 and 120),
  value       text not null check (char_length(value) between 1 and 500),
  updated_at  timestamptz not null default now(),
  primary key (user_id, field_key)
);
alter table public.form_memory enable row level security;
drop policy if exists "You see your own remembered answers" on public.form_memory;
create policy "You see your own remembered answers"
  on public.form_memory for select to authenticated
  using (user_id = auth.uid());

-- items: [{ "key": "emergency_contact_name", "label": "Emergency contact", "value": "Jane Doe" }, …]
create or replace function public.remember_form_answers(items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(coalesce(items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(items, '[]'::jsonb)) > 100 then
    raise exception 'Too many answers';
  end if;
  insert into public.form_memory (user_id, field_key, label, value, updated_at)
  select me, left(lower(btrim(e->>'key')), 80), left(btrim(e->>'label'), 120), left(btrim(e->>'value'), 500), now()
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) e
   where coalesce(btrim(e->>'key'), '') <> '' and coalesce(btrim(e->>'label'), '') <> '' and coalesce(btrim(e->>'value'), '') <> ''
  on conflict (user_id, field_key) do update set label = excluded.label, value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.forget_form_answers()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.form_memory m where m.user_id = auth.uid();
$$;

-- 3. What a spreadsheet can read: your chats' records you're allowed to see ------------------------

create or replace function public.sheet_sources(conversation_ids uuid[], since date default null, until date default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with chats as (
    select c.id, c.name, c.kind from public.conversations c
     where c.id = any(coalesce(conversation_ids, '{}')) and public.is_conversation_member(c.id)
  )
  select jsonb_build_object(
    'conversations', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'kind', ch.kind)) from chats ch), '[]'::jsonb),
    'payment_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'conversation_id', r.conversation_id, 'title', r.title, 'total_cents', r.total_cents,
               'due_date', r.due_date, 'status', r.status, 'created_at', r.created_at,
               'requester', (select btrim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = r.payee_id),
               'receipt', r.receipt,
               'shares', coalesce((select jsonb_agg(jsonb_build_object(
                                     'user_id', s.user_id, 'name', btrim(p.first_name || ' ' || p.last_name),
                                     'amount_cents', s.amount_cents, 'status', s.status) order by p.first_name)
                                     from public.payment_shares s join public.profiles p on p.id = s.user_id
                                    where s.request_id = r.id), '[]'::jsonb),
               'transfers', coalesce((select jsonb_agg(jsonb_build_object(
                                        'payer', btrim(p.first_name || ' ' || p.last_name), 'amount_cents', t.amount_cents,
                                        'method', t.method, 'confirmation', t.confirmation, 'created_at', t.created_at) order by t.created_at)
                                        from public.payment_transfers t join public.profiles p on p.id = t.payer_id
                                       where t.request_id = r.id and (t.payer_id = auth.uid() or t.payee_id = auth.uid())), '[]'::jsonb))
             order by r.created_at)
        from public.payment_requests r join chats ch on ch.id = r.conversation_id
       where r.status <> 'cancelled'
         and (since is null or r.created_at::date >= since) and (until is null or r.created_at::date <= until)), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(x.item order by x.at)
        from (select m.created_at as at,
                     jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id,
                                        'sender', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
                                        'body', left(m.body, 500), 'created_at', m.created_at) as item
                from public.messages m join chats ch on ch.id = m.conversation_id
                left join public.profiles p on p.id = m.sender_id
               where m.payment_request_id is null and m.document_request_id is null and btrim(m.body) <> ''
                 and (since is null or m.created_at::date >= since) and (until is null or m.created_at::date <= until)
               order by m.created_at desc
               limit 600) x), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(y.item order by y.at)
        from (select m.created_at as at,
                     jsonb_build_object('id', a.id, 'message_id', a.message_id, 'conversation_id', m.conversation_id, 'path', a.path, 'name', a.name,
                                        'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'created_at', m.created_at,
                                        'sender', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))) as item
                from public.message_attachments a
                join public.messages m on m.id = a.message_id
                join chats ch on ch.id = m.conversation_id
                left join public.profiles p on p.id = m.sender_id
               where a.mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
                 and (since is null or m.created_at::date >= since) and (until is null or m.created_at::date <= until)
               order by m.created_at desc
               limit 30) y), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'upload_id', u.id, 'conversation_id', r.conversation_id, 'title', r.title, 'accepted_at', u.reviewed_at,
               'sender', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
               'summary', u.ai_result->>'summary', 'key_details', u.ai_result->'key_details'))
        from public.document_uploads u
        join public.document_requests r on r.id = u.request_id
        join chats ch on ch.id = r.conversation_id
        left join public.profiles p on p.id = u.user_id
       where u.status = 'accepted' and (u.user_id = auth.uid() or r.created_by = auth.uid())), '[]'::jsonb));
$$;

-- 4. Spreadsheets can be sent to a chat ---------------------------------------------------------------

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
                                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']
 where id = 'chat-files';
alter table public.message_attachments drop constraint if exists message_attachments_mime_type_check;
alter table public.message_attachments add constraint message_attachments_mime_type_check
  check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf',
                       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'));

-- 5. AI limits --------------------------------------------------------------------------------------------

alter table public.ai_calls drop constraint if exists ai_calls_feature_check;
alter table public.ai_calls add constraint ai_calls_feature_check check (feature in ('chat', 'receipt', 'document', 'form', 'sheet'));

create or replace function public.ai_daily_limit(feature_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case feature_name
           when 'chat' then 30 when 'receipt' then 20 when 'document' then 20
           when 'form' then 20 when 'sheet' then 10 else 0 end;
$$;

-- 6. Permissions ------------------------------------------------------------------------------------------

revoke all on function public.save_draft(uuid, text, text, jsonb, text, text, text) from public, anon;
revoke all on function public.delete_draft(uuid) from public, anon;
revoke all on function public.remember_form_answers(jsonb) from public, anon;
revoke all on function public.forget_form_answers() from public, anon;
revoke all on function public.sheet_sources(uuid[], date, date) from public, anon;
grant execute on function public.save_draft(uuid, text, text, jsonb, text, text, text) to authenticated;
grant execute on function public.delete_draft(uuid) to authenticated;
grant execute on function public.remember_form_answers(jsonb) to authenticated;
grant execute on function public.forget_form_answers() to authenticated;
grant execute on function public.sheet_sources(uuid[], date, date) to authenticated;
