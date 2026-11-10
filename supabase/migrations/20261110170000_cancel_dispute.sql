-- CommonTab: the person who started a dispute can cancel it.
--   • Only the disputing member, only while it's open. The dispute is resolved as "withdrawn",
--     any open proposal is canceled (kept in history), and the share keeps its current amount
--     and goes back to Pending (they confirm it again before paying).
--   • The group's activity gets a "canceled their dispute" line; the chat stays readable.
--   • Canceling one that's already canceled does nothing, so a retry is safe.
-- Safe to run again if a first try stopped partway.
-- Run once in Supabase, after 20261110160000_demo_payments.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

alter table public.payment_disputes drop constraint if exists payment_disputes_resolution_check;
alter table public.payment_disputes add constraint payment_disputes_resolution_check
  check (resolution in ('new_amount', 'waived', 'withdrawn'));

alter table public.dispute_proposals drop constraint if exists dispute_proposals_status_check;
alter table public.dispute_proposals add constraint dispute_proposals_status_check
  check (status in ('open', 'accepted', 'countered', 'persisted', 'replaced', 'canceled'));

alter table public.payment_share_events drop constraint if exists payment_share_events_kind_check;
alter table public.payment_share_events add constraint payment_share_events_kind_check
  check (kind in ('confirmed', 'disputed', 'amount_changed', 'waived', 'paid', 'dispute_canceled'));

create or replace function public.cancel_payment_dispute(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  member  uuid;
  req     uuid;
  st      text;
  res     text;
  amt     integer;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select x.member_id, x.request_id, x.status, x.resolution into member, req, st, res
    from public.payment_disputes x
   where x.id = target
     for update;
  if not found or not public.is_dispute_participant(target) then raise exception 'Dispute not found'; end if;
  if member <> me then raise exception 'Only the person who started the dispute can cancel it'; end if;
  if st <> 'open' then
    if res = 'withdrawn' then return; end if;  -- already canceled (a retry)
    raise exception 'This dispute is already settled';
  end if;

  select s.amount_cents into amt from public.payment_shares s where s.request_id = req and s.user_id = me for update;

  update public.dispute_proposals set status = 'canceled', decided_at = now(), decided_by = me
   where dispute_id = target and status = 'open';
  update public.payment_disputes set status = 'resolved', resolution = 'withdrawn', final_cents = amt, resolved_at = now()
   where id = target;
  update public.payment_shares set status = 'pending', updated_at = now()
   where request_id = req and user_id = me and status = 'disputed';
  insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
  values (req, me, me, 'dispute_canceled', amt);
end;
$$;

revoke all on function public.cancel_payment_dispute(uuid) from public, anon;
grant execute on function public.cancel_payment_dispute(uuid) to authenticated;
