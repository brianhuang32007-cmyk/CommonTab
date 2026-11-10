-- CommonTab: a payment request's Details page, and the "Digital receipt available" label.
--   • payment_request_view (used by chat cards) now says whether a digital receipt is attached.
--   • payment_request_details returns everything the Details page shows: each person's name,
--     share and status, the requester's payment handles (so people know where to pay), the
--     digital receipt and photo, and the split. Group members only.
-- Run once in Supabase, after 20261110130000_delete_payment_request.sql:
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
           'has_receipt', (r.receipt is not null),
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

create or replace function public.payment_request_details(req uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.payment_request_view(r.id) || jsonb_build_object(
           'split', r.split,
           'created_at', r.created_at,
           'receipt', r.receipt,
           'receipt_path', r.receipt_path,
           'conversation_name', c.name,
           'conversation_kind', c.kind,
           'my_role', public.my_group_role(r.conversation_id),
           'creator', (select jsonb_build_object('user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name)
                         from public.profiles p where p.id = r.created_by),
           -- Where to pay: the requester's handles, shown to the group for this request.
           'payee', (select jsonb_build_object(
                              'user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
                              'username', p.username, 'avatar_url', p.avatar_url,
                              'venmo_username', p.venmo_username, 'paypal_username', p.paypal_username,
                              'zelle_contact', p.zelle_contact, 'preferred_handle', p.preferred_handle)
                       from public.profiles p where p.id = r.payee_id),
           'people', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'user_id', s.user_id, 'first_name', p.first_name, 'last_name', p.last_name,
                      'username', p.username, 'avatar_url', p.avatar_url,
                      'amount_cents', s.amount_cents, 'status', s.status, 'updated_at', s.updated_at)
                    order by (s.status = 'settled'), s.amount_cents desc, p.first_name)
               from public.payment_shares s
               join public.profiles p on p.id = s.user_id
              where s.request_id = r.id), '[]'::jsonb))
    from public.payment_requests r
    join public.conversations c on c.id = r.conversation_id
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;

revoke all on function public.payment_request_details(uuid) from public, anon;
grant execute on function public.payment_request_details(uuid) to authenticated;
