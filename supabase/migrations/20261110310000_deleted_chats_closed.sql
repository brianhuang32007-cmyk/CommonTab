-- CommonTab: once a chat is deleted, nothing in it can be opened by anyone (Brian's call,
-- 2026-11-10).
--   • Deleting a group already removes its messages, members, payment and document requests,
--     proofs and history. Files people uploaded stay in storage, though, and two storage rules
--     still let the person who uploaded a document or a payment screenshot open it afterwards
--     (they only checked that the uploader's id was in the file's path).
--   • Now every request document and payment screenshot also needs its request to still exist
--     in a chat you're still in. When the chat is deleted (or you leave it), the files are closed
--     to everyone, the uploader included. Chat files and group pictures already worked this way.
-- Safe to run again.
-- Run once in Supabase, after 20261110300000_leave_group.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- Document request files: the request must still exist, in a chat you're in.
create or replace function public.can_open_document_file(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_requests r
     where r.id::text = (storage.foldername(file_path))[1]
       and public.is_conversation_member(r.conversation_id)
       and (
         -- The person who uploaded it (drafts included).
         (storage.foldername(file_path))[2] = auth.uid()::text
         -- The requester, once it's been sent.
         or (r.created_by = auth.uid()
             and exists (select 1 from public.document_files f
                           join public.document_uploads u on u.id = f.upload_id
                          where f.path = file_path and u.status <> 'draft'))
       )
  );
$$;

-- Payment screenshots: the payment request must still exist, in a chat you're in.
create or replace function public.can_open_payment_proof(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payment_requests r
     where r.id::text = (storage.foldername(file_path))[1]
       and public.is_conversation_member(r.conversation_id)
       and (
         -- The person who paid (before and after sending it).
         (storage.foldername(file_path))[2] = auth.uid()::text
         -- The person being paid, once it's been sent.
         or exists (select 1 from public.payment_proof_files f
                      join public.payment_proofs p on p.id = f.proof_id
                     where f.path = file_path and p.payee_id = auth.uid())
       )
  );
$$;

revoke all on function public.can_open_document_file(text) from public, anon;
revoke all on function public.can_open_payment_proof(text) from public, anon;
grant execute on function public.can_open_document_file(text) to authenticated;
grant execute on function public.can_open_payment_proof(text) to authenticated;
