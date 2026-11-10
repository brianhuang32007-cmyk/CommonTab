-- CommonTab: search your payments (Alerts & Reminders → Payments).
--   • Every payment request you're part of (you requested it, or you're in the split),
--     open or fully paid: its view, who requested it, the people in it, and the transaction
--     IDs (CT-…) you're allowed to see (your own payments, or all of them if you requested it).
--   • Counts of shares still pending and confirmed-but-unpaid, for ranking the results.
--   • Payment request IDs (PR-…) are made in the app from the request's id; nothing new is stored.
-- Safe to run again.
-- Run once in Supabase, after 20261110200000_request_events_feed.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.my_payment_search()
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
                'requester_last_name', p.last_name,
                'people', coalesce((
                  select jsonb_agg(trim(pp.first_name || ' ' || pp.last_name) order by pp.first_name)
                    from public.payment_shares s join public.profiles pp on pp.id = s.user_id
                   where s.request_id = r.id), '[]'::jsonb),
                'codes', coalesce((
                  select jsonb_agg(t.confirmation order by t.created_at)
                    from public.payment_transfers t
                   where t.request_id = r.id and (t.payer_id = auth.uid() or t.payee_id = auth.uid())), '[]'::jsonb),
                'pending_count', (select count(*)::integer from public.payment_shares s
                                   where s.request_id = r.id and s.status = 'pending'),
                'confirmed_count', (select count(*)::integer from public.payment_shares s
                                     where s.request_id = r.id and s.status in ('confirmed', 'marked_paid')))
    from public.payment_requests r
    join public.conversations c on c.id = r.conversation_id
    left join public.profiles p on p.id = r.payee_id
   where r.status <> 'cancelled'
     and public.is_conversation_member(r.conversation_id)
     and (r.payee_id = auth.uid()
          or exists (select 1 from public.payment_shares s where s.request_id = r.id and s.user_id = auth.uid()))
   order by r.created_at desc
   limit 300;
$$;

revoke all on function public.my_payment_search() from public, anon;
grant execute on function public.my_payment_search() to authenticated;
