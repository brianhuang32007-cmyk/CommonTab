-- CommonTab: AI Verified documents (Brian's calls, 2026-11-10).
--   • AI Verify can run before or after an upload is sent: by the person who sent it, or by
--     the requester. The latest result (verdict, summary, key details and a transcript) is
--     saved on the upload and shown to both of them: "AI Verified" (it matches what was
--     asked) or "AI Verification Failed" (check it by hand).
--   • Only the app's server can save a result: it proves it with a server-only secret whose
--     SHA-256 fingerprint is stored here (the secret itself is never in the code or database).
--     So nobody can save a made-up "AI Verified".
--   • The requester can always accept by hand. But if an upload isn't AI Verified, they must
--     open every file first (the viewer records that they opened it).
--   • Changing a draft's files clears its old AI result.
-- Safe to run again.
-- Run once in Supabase, after 20261110230000_owner_cancel_document.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. The AI result on each upload ----------------------------------------------------------------

alter table public.document_uploads add column if not exists ai_status text check (ai_status is null or ai_status in ('verified', 'failed'));
alter table public.document_uploads add column if not exists ai_result jsonb check (ai_result is null or (jsonb_typeof(ai_result) = 'object' and length(ai_result::text) <= 40000));
alter table public.document_uploads add column if not exists ai_model text check (ai_model is null or char_length(ai_model) <= 100);
alter table public.document_uploads add column if not exists ai_checked_at timestamptz;
alter table public.document_uploads add column if not exists ai_checked_by uuid references public.profiles (id) on delete set null;

-- The fingerprint of the server's secret. Nobody can read this table directly.
create table if not exists public.ai_verify_key (
  id           integer primary key default 1 check (id = 1),
  secret_hash  text not null
);
alter table public.ai_verify_key enable row level security;
insert into public.ai_verify_key (id, secret_hash)
values (1, '54810673e8ad62161fd5f14ba8dd1e0b029f46b37d207f69c603c32b7252374e')
on conflict (id) do update set secret_hash = excluded.secret_hash;

-- Saves an AI Verify result. Only works with the server's secret.
create or replace function public.record_document_ai_check(
  target uuid, check_result jsonb, verdict text, model_used text, route_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if route_secret is null or encode(sha256(convert_to(route_secret, 'UTF8')), 'hex')
       is distinct from (select k.secret_hash from public.ai_verify_key k where k.id = 1) then
    raise exception 'AI results can only be saved by CommonTab';
  end if;
  if not public.can_see_document_upload(target) then raise exception 'Upload not found'; end if;
  if verdict is null or verdict not in ('matches', 'partial', 'does_not_match', 'unreadable') then raise exception 'Unknown verdict'; end if;
  if check_result is null or jsonb_typeof(check_result) <> 'object' or length(check_result::text) > 40000 then
    raise exception 'That check result isn''t valid';
  end if;
  update public.document_uploads u
     set ai_status = case when verdict = 'matches' then 'verified' else 'failed' end,
         ai_result = check_result,
         ai_model = left(model_used, 100),
         ai_checked_at = now(),
         ai_checked_by = me
   where u.id = target and u.status in ('draft', 'submitted');
  if not found then raise exception 'This upload was already reviewed'; end if;
end;
$$;

-- The old per-person save is replaced by the one above.
drop function if exists public.save_document_ai_check(uuid, jsonb, text);

-- 2. Which files the requester has opened -----------------------------------------------------------

create table if not exists public.document_file_views (
  file_id    uuid not null references public.document_files (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (file_id, user_id)
);
alter table public.document_file_views enable row level security;
drop policy if exists "You see your own file views" on public.document_file_views;
create policy "You see your own file views"
  on public.document_file_views for select to authenticated
  using (user_id = auth.uid());

create or replace function public.mark_document_file_viewed(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.document_files f where f.id = target and public.can_see_document_upload(f.upload_id)) then
    raise exception 'File not found';
  end if;
  insert into public.document_file_views (file_id, user_id) values (target, me)
  on conflict (file_id, user_id) do update set viewed_at = now();
end;
$$;

-- 3. Drafts: new files clear the old AI result ------------------------------------------------------

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
  same   boolean;
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
    -- The same files as before keep their AI result; different files clear it.
    select coalesce(array_agg(df.path order by df.path), '{}') = coalesce((select array_agg(e->>'path' order by e->>'path') from jsonb_array_elements(list) e), '{}')
      into same from public.document_files df where df.upload_id = save_document_draft.upload_id;
    update public.document_uploads u set note = clean where u.id = upload_id;
    if not same then
      update public.document_uploads u
         set ai_status = null, ai_result = null, ai_model = null, ai_checked_at = null, ai_checked_by = null
       where u.id = upload_id;
    end if;
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

-- 4. Accepting: AI Verified, or every file opened first -----------------------------------------------

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
    if up.ai_status is distinct from 'verified' and exists (
         select 1 from public.document_files f
          where f.upload_id = target
            and not exists (select 1 from public.document_file_views v where v.file_id = f.id and v.user_id = me)) then
      raise exception 'It isn''t AI Verified, so open each file to check it before accepting';
    end if;
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

-- 5. The request's page: each upload's AI result (for both people) and which files you opened ----

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
                           'ai_status', u.ai_status, 'ai_result', u.ai_result, 'ai_model', u.ai_model,
                           'ai_checked_at', u.ai_checked_at, 'ai_checked_by', u.ai_checked_by,
                           'files', coalesce((select jsonb_agg(jsonb_build_object(
                                                'id', f.id, 'path', f.path, 'name', f.name, 'mime_type', f.mime_type,
                                                'size_bytes', f.size_bytes, 'position', f.position,
                                                'viewed', exists (select 1 from public.document_file_views v
                                                                   where v.file_id = f.id and v.user_id = auth.uid())) order by f.position)
                                                from public.document_files f where f.upload_id = u.id), '[]'::jsonb))
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

-- 6. Permissions ---------------------------------------------------------------------------------------

revoke all on function public.record_document_ai_check(uuid, jsonb, text, text, text) from public, anon;
revoke all on function public.mark_document_file_viewed(uuid) from public, anon;
revoke all on function public.save_document_draft(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.review_document_upload(uuid, text, text) from public, anon;
revoke all on function public.document_request_details(uuid) from public, anon;
grant execute on function public.record_document_ai_check(uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.mark_document_file_viewed(uuid) to authenticated;
grant execute on function public.save_document_draft(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.review_document_upload(uuid, text, text) to authenticated;
grant execute on function public.document_request_details(uuid) to authenticated;
