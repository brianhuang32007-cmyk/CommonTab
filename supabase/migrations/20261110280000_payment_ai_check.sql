-- CommonTab: AI check on payment screenshots (Brian's call, 2026-11-10).
--   • After someone sends proof of paying (I Paid), CommonTab AI reads the screenshot and checks
--     it against what was owed: the amount, the recipient (the handle they were asked to pay),
--     the app, and that it looks completed and recent. The payer or the requester can run it
--     again.
--   • The result is saved on the proof and shown to both of them ("AI check: matches" or "AI
--     couldn't confirm it"). The AI never approves anything: the requester still decides.
--   • Only the app's server can save a result (the same AI_VERIFY_SECRET check as documents).
--   • Daily limit: 20 payment checks per person in any 24 hours.
-- Safe to run again.
-- Run once in Supabase, after 20261110270000_payment_proofs.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

alter table public.payment_proofs add column if not exists ai_status text check (ai_status is null or ai_status in ('verified', 'failed'));
alter table public.payment_proofs add column if not exists ai_result jsonb check (ai_result is null or (jsonb_typeof(ai_result) = 'object' and length(ai_result::text) <= 20000));
alter table public.payment_proofs add column if not exists ai_model text check (ai_model is null or char_length(ai_model) <= 100);
alter table public.payment_proofs add column if not exists ai_checked_at timestamptz;

-- What the AI route needs to check a proof, if you're its payer or requester.
create or replace function public.payment_proof_for_ai(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', p.id, 'status', p.status, 'amount_cents', p.amount_cents, 'method', p.method, 'note', p.note,
           'submitted_at', p.created_at, 'title', r.title, 'request_id', r.id,
           'payer', btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')),
           'payee', btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
           'payee_handle', case p.method when 'venmo' then e.venmo_username when 'paypal' then e.paypal_username else e.zelle_contact end,
           'files', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'name', f.name, 'mime_type', f.mime_type,
                                                                  'size_bytes', f.size_bytes) order by f.position)
                                from public.payment_proof_files f where f.proof_id = p.id), '[]'::jsonb))
    from public.payment_proofs p
    join public.payment_requests r on r.id = p.request_id
    left join public.profiles u on u.id = p.payer_id
    left join public.profiles e on e.id = p.payee_id
   where p.id = target and (p.payer_id = auth.uid() or p.payee_id = auth.uid())
     and public.is_conversation_member(r.conversation_id);
$$;

-- Saves an AI check result on a proof still waiting for review. Only works with the server's secret.
create or replace function public.record_payment_proof_ai_check(
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
  if verdict is null or verdict not in ('matches', 'partial', 'does_not_match', 'unreadable') then raise exception 'Unknown verdict'; end if;
  if check_result is null or jsonb_typeof(check_result) <> 'object' or length(check_result::text) > 20000 then
    raise exception 'That check result isn''t valid';
  end if;
  update public.payment_proofs p
     set ai_status = case when verdict = 'matches' then 'verified' else 'failed' end,
         ai_result = check_result, ai_model = left(model_used, 100), ai_checked_at = now()
   where p.id = target and p.status = 'submitted' and (p.payer_id = me or p.payee_id = me);
  if not found then raise exception 'This proof was already reviewed'; end if;
end;
$$;

-- Proofs now include their AI check.
create or replace function public.my_payment_proofs(req uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'payer_id', p.payer_id, 'first_name', u.first_name, 'last_name', u.last_name,
           'amount_cents', p.amount_cents, 'method', p.method, 'note', p.note, 'status', p.status,
           'review_reason', p.review_reason, 'created_at', p.created_at, 'reviewed_at', p.reviewed_at,
           'ai_status', p.ai_status, 'ai_result', p.ai_result, 'ai_checked_at', p.ai_checked_at,
           'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'name', f.name,
                                                                  'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.position)
                                from public.payment_proof_files f where f.proof_id = p.id), '[]'::jsonb))
           order by p.created_at desc), '[]'::jsonb)
    from public.payment_proofs p
    join public.payment_requests r on r.id = p.request_id
    left join public.profiles u on u.id = p.payer_id
   where p.request_id = req and public.is_conversation_member(r.conversation_id)
     and (p.payer_id = auth.uid() or p.payee_id = auth.uid());
$$;

-- AI limits: payment checks join the others.
alter table public.ai_calls drop constraint if exists ai_calls_feature_check;
alter table public.ai_calls add constraint ai_calls_feature_check check (feature in ('chat', 'receipt', 'document', 'form', 'sheet', 'payment'));

create or replace function public.ai_daily_limit(feature_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case feature_name
           when 'chat' then 30 when 'receipt' then 20 when 'document' then 20
           when 'form' then 20 when 'sheet' then 10 when 'payment' then 20 else 0 end;
$$;

revoke all on function public.payment_proof_for_ai(uuid) from public, anon;
revoke all on function public.record_payment_proof_ai_check(uuid, jsonb, text, text, text) from public, anon;
revoke all on function public.my_payment_proofs(uuid) from public, anon;
grant execute on function public.payment_proof_for_ai(uuid) to authenticated;
grant execute on function public.record_payment_proof_ai_check(uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.my_payment_proofs(uuid) to authenticated;
