-- CommonTab: a chat's Files tab keeps every accepted document (Brian's call, 2026-11-10).
--   • Once the requester accepts a document, it's kept in that chat's Files tab with its
--     original files, the AI check (summary, key details and transcript) if it was run, and
--     who sent it to whom and when. People can come back to it any time.
--   • Still private: only the requester and the person who sent it see it. Everyone else in
--     the chat sees nothing here.
--   • Only that chat's documents (everything across chats belongs in Alerts & Reminders).
-- Safe to run again.
-- Run once in Supabase, after 20261110240000_ai_verified_documents.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.my_chat_documents(target uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'upload_id', u.id,
           'request_id', r.id,
           'conversation_id', r.conversation_id,
           'title', r.title,
           'doc_type', r.doc_type,
           'doc_type_other', r.doc_type_other,
           'requester', jsonb_build_object('user_id', rq.id, 'first_name', rq.first_name, 'last_name', rq.last_name),
           'sender', jsonb_build_object('user_id', sd.id, 'first_name', sd.first_name, 'last_name', sd.last_name),
           'note', u.note,
           'submitted_at', u.submitted_at,
           'accepted_at', u.reviewed_at,
           'ai_status', u.ai_status,
           'ai_result', u.ai_result,
           'files', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', f.id, 'path', f.path, 'name', f.name, 'mime_type', f.mime_type,
                                'size_bytes', f.size_bytes, 'position', f.position) order by f.position)
                                from public.document_files f where f.upload_id = u.id), '[]'::jsonb))
    from public.document_uploads u
    join public.document_requests r on r.id = u.request_id
    left join public.profiles rq on rq.id = r.created_by
    left join public.profiles sd on sd.id = u.user_id
   where r.conversation_id = target
     and public.is_conversation_member(target)
     and u.status = 'accepted'
     and (u.user_id = auth.uid() or r.created_by = auth.uid())
   order by u.reviewed_at desc nulls last
   limit 200;
$$;

revoke all on function public.my_chat_documents(uuid) from public, anon;
grant execute on function public.my_chat_documents(uuid) to authenticated;
