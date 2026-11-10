-- CommonTab: payment request cards show who has paid and who hasn't.
--   The request view now lists each share (person, amount, status), so every member of the
--   group sees the progress bar and the paid / not paid lists. Members could already see
--   these rows; this only adds them to the view the chat card uses.
-- Run once in Supabase, after 20261110110000_payment_requests.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.payment_request_view(req uuid)
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
           'total_cents', r.total_cents,
           'due_date', r.due_date,
           'status', r.status,
           'created_by', r.created_by,
           'payee_id', r.payee_id,
           'my_share_cents', (select s.amount_cents from public.payment_shares s where s.request_id = r.id and s.user_id = auth.uid()),
           'my_share_status', (select s.status from public.payment_shares s where s.request_id = r.id and s.user_id = auth.uid()),
           'share_count', (select count(*)::integer from public.payment_shares s where s.request_id = r.id),
           'settled_count', (select count(*)::integer from public.payment_shares s where s.request_id = r.id and s.status = 'settled'),
           'outstanding_cents', (select coalesce(sum(s.amount_cents), 0)::integer from public.payment_shares s
                                  where s.request_id = r.id and s.status <> 'settled'),
           'shares', coalesce((
             select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'amount_cents', s.amount_cents, 'status', s.status)
                              order by s.amount_cents desc, s.user_id)
               from public.payment_shares s where s.request_id = r.id), '[]'::jsonb))
    from public.payment_requests r
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;
