-- CommonTab: "Recent updates" on Alerts & Reminders: what happened on your payment requests.
--   • The requester sees what others did on their requests (confirmed, disputed, paid, dispute
--     outcomes). Someone paying sees what happened to their own share (dispute outcomes from
--     the requester, and their own completed payments).
--   • Your own actions are left out, except your completed payments ("Payment complete").
--   • The last 30 days, newest first, at most 100. Never a dispute's reason or chat.
-- Safe to run again.
-- Run once in Supabase, after 20261110190000_notification_reads.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.my_request_events(max_rows integer default 50)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
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
           'amount_cents', e.amount_cents,
           'previous_cents', e.previous_cents,
           'created_at', e.created_at,
           'i_am_requester', r.payee_id = auth.uid())
    from public.payment_share_events e
    join public.payment_requests r on r.id = e.request_id
    join public.conversations c on c.id = r.conversation_id
    left join public.profiles u on u.id = e.user_id
    left join public.profiles a on a.id = e.actor_id
   where public.is_conversation_member(r.conversation_id)
     and (r.payee_id = auth.uid() or e.user_id = auth.uid())
     and (e.actor_id is distinct from auth.uid() or e.kind = 'paid')
     and e.created_at > now() - interval '30 days'
   order by e.created_at desc, e.id desc
   limit least(greatest(coalesce(max_rows, 50), 1), 100);
$$;

revoke all on function public.my_request_events(integer) from public, anon;
grant execute on function public.my_request_events(integer) to authenticated;
