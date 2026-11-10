-- CommonTab: details for the reminders in Alerts & Reminders ("Action needed").
--   • Your requests list now says when each request was made (so a new task shows as unread
--     until you mark alerts as read) and who requested it.
--   • Nothing else changes: same requests, same order, same privacy.
-- Safe to run again.
-- Run once in Supabase, after 20261110170000_cancel_dispute.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.my_payment_requests(target uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.payment_request_view(r.id)
           || jsonb_build_object(
                'direction', case when r.payee_id = auth.uid() then 'sent' else 'received' end,
                'conversation_name', c.name,
                'conversation_kind', c.kind,
                'created_at', r.created_at,
                'requester_first_name', p.first_name,
                'requester_last_name', p.last_name)
    from public.payment_requests r
    join public.conversations c on c.id = r.conversation_id
    left join public.profiles p on p.id = r.payee_id
   where r.status = 'open'
     and (target is null or r.conversation_id = target)
     and public.is_conversation_member(r.conversation_id)
     and (r.payee_id = auth.uid()
          or exists (select 1 from public.payment_shares s
                      where s.request_id = r.id and s.user_id = auth.uid() and s.status not in ('settled', 'waived')))
   order by r.due_date asc nulls last, r.created_at desc
   limit 200;
$$;
