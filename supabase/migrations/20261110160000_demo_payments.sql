-- CommonTab: paying your share inside the app (Step 11, demo).
--   • DEMO ONLY: no real money moves. Paying records who paid whom, how much, by which method
--     (Venmo, PayPal or Zelle, as a label), with a confirmation number. CommonTab holds no
--     balances or wallets.
--   • Only the person paying can pay, only a Confirmed share, and always exactly the share.
--     The share becomes Paid right away (no approval). The app makes the payment's id, so a
--     double tap or a retry can't pay twice.
--   • When every share is Paid or Waived, the request is Fully paid (status 'settled').
--   • The payment record (method, confirmation number) is seen only by the payer and the
--     requester; the group sees the share turn Paid and a line in the activity.
-- Safe to run again if a first try stopped partway.
-- Run once in Supabase, after 20261110150000_payment_disputes.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Payments --------------------------------------------------------------------------------

create table if not exists public.payment_transfers (
  id            uuid primary key,  -- made by the app, so a retry can't pay twice
  request_id    uuid not null references public.payment_requests (id) on delete cascade,
  payer_id      uuid not null references public.profiles (id) on delete cascade,
  payee_id      uuid references public.profiles (id) on delete set null,
  amount_cents  integer not null check (amount_cents > 0),
  method        text not null check (method in ('venmo', 'paypal', 'zelle')),
  confirmation  text not null,
  created_at    timestamptz not null default now(),
  unique (request_id, payer_id)  -- one payment per share
);

alter table public.payment_transfers enable row level security;
drop policy if exists "The payer and the requester see a payment" on public.payment_transfers;
create policy "The payer and the requester see a payment"
  on public.payment_transfers for select to authenticated
  using (payer_id = auth.uid() or payee_id = auth.uid());

-- The activity list gets a "paid" line.
alter table public.payment_share_events drop constraint if exists payment_share_events_kind_check;
alter table public.payment_share_events add constraint payment_share_events_kind_check
  check (kind in ('confirmed', 'disputed', 'amount_changed', 'waived', 'paid'));

-- 2. Paying your share -----------------------------------------------------------------------

create or replace function public.pay_my_share(transfer_id uuid, req uuid, pay_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  st      text;
  amt     integer;
  payee   uuid;
  code    text;
  t       public.payment_transfers;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if transfer_id is null then raise exception 'Missing payment id'; end if;

  -- Sent before (a retry after a lost reply): hand back the same payment.
  select * into t from public.payment_transfers where id = transfer_id;
  if found then
    if t.payer_id = me and t.request_id = req then return to_jsonb(t); end if;
    raise exception 'That payment id is already used';
  end if;

  if pay_method not in ('venmo', 'paypal', 'zelle') then raise exception 'Pick Venmo, PayPal or Zelle'; end if;

  select s.status, s.amount_cents, r.payee_id into st, amt, payee
    from public.payment_shares s
    join public.payment_requests r on r.id = s.request_id
   where s.request_id = req and s.user_id = me
     and r.payee_id is distinct from me and r.status = 'open'
     and public.is_conversation_member(r.conversation_id)
     for update of s;
  if not found then raise exception 'You''re not paying in this request'; end if;
  if st = 'settled' then raise exception 'You''ve already paid this share'; end if;
  if st = 'pending' then raise exception 'Confirm your share before paying'; end if;
  if st = 'disputed' then raise exception 'Your share is in dispute. Settle the dispute first.'; end if;
  if st <> 'confirmed' then raise exception 'This share can''t be paid now'; end if;

  code := 'CT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.payment_transfers (id, request_id, payer_id, payee_id, amount_cents, method, confirmation)
  values (transfer_id, req, me, payee, amt, pay_method, code)
  returning * into t;

  update public.payment_shares set status = 'settled', updated_at = now() where request_id = req and user_id = me;
  insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
  values (req, me, me, 'paid', amt);

  -- Last one in: the request is fully paid.
  if not exists (select 1 from public.payment_shares s where s.request_id = req and s.status not in ('settled', 'waived')) then
    update public.payment_requests set status = 'settled' where id = req;
  end if;

  return to_jsonb(t);
end;
$$;

-- 3. The Details page: your payment (payer) or the payments you received (requester). --------
--    Fully paid requests stay readable (only the open lists drop them).

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
                    order by (s.status in ('settled', 'waived')), s.amount_cents desc, p.first_name)
               from public.payment_shares s
               join public.profiles p on p.id = s.user_id
              where s.request_id = r.id), '[]'::jsonb),
           'events', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', e.id, 'user_id', e.user_id, 'actor_id', e.actor_id, 'kind', e.kind,
                      'amount_cents', e.amount_cents, 'previous_cents', e.previous_cents, 'created_at', e.created_at,
                      'first_name', p.first_name)
                    order by e.created_at, e.id)
               from public.payment_share_events e
               join public.profiles p on p.id = e.user_id
              where e.request_id = r.id), '[]'::jsonb),
           'transfers', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', t.id, 'payer_id', t.payer_id, 'first_name', p.first_name, 'last_name', p.last_name,
                      'amount_cents', t.amount_cents, 'method', t.method, 'confirmation', t.confirmation,
                      'created_at', t.created_at)
                    order by t.created_at desc)
               from public.payment_transfers t
               join public.profiles p on p.id = t.payer_id
              where t.request_id = r.id and (t.payer_id = auth.uid() or t.payee_id = auth.uid())), '[]'::jsonb))
    from public.payment_requests r
    join public.conversations c on c.id = r.conversation_id
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;

-- 4. Grants and live updates -------------------------------------------------------------------

revoke all on function public.pay_my_share(uuid, uuid, text) from public, anon;
grant execute on function public.pay_my_share(uuid, uuid, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_transfers') then
    alter publication supabase_realtime add table public.payment_transfers;
  end if;
end;
$$;
