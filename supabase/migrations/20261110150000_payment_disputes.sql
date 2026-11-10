-- CommonTab: confirming and disputing a share (Step 10).
--   • A member confirms their share before paying. A Pending or Confirmed share can be disputed
--     with a short reason; it becomes Disputed. One open dispute per share.
--   • In a dispute, the member can propose a new amount or canceling their payment. The other
--     side accepts or counters; the requester can also persist (keep the original amount).
--     One proposal is open at a time; a newer one replaces it, and the old one stays in history.
--     Accepting a new amount sets the share back to Pending (the member confirms it again);
--     accepting a cancel marks the share Waived (they owe nothing).
--   • The dispute chat, the reason and the proposals are private to the requester and the
--     disputing member. The group only sees the share's status and a history of what happened
--     to it (confirmed, disputed, amount changed, waived), never the reason or the chat.
--   • Waived shares don't count toward progress or what's still owed.
-- Safe to run again if a first try stopped partway.
-- Run once in Supabase, after 20261110140000_payment_request_details.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Shares can be waived ----------------------------------------------------------------

alter table public.payment_shares drop constraint if exists payment_shares_status_check;
alter table public.payment_shares add constraint payment_shares_status_check
  check (status in ('pending', 'confirmed', 'marked_paid', 'settled', 'disputed', 'waived'));

-- 2. Tables -------------------------------------------------------------------------------

create table if not exists public.payment_disputes (
  id              uuid primary key,  -- made by the app, so a retry can't open two
  request_id      uuid not null,
  member_id       uuid not null,
  reason          text not null check (char_length(reason) between 1 and 500),
  original_cents  integer not null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  resolution      text check (resolution in ('new_amount', 'waived')),
  final_cents     integer,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  foreign key (request_id, member_id) references public.payment_shares (request_id, user_id) on delete cascade
);
create unique index if not exists payment_disputes_one_open on public.payment_disputes (request_id, member_id) where status = 'open';

create table if not exists public.dispute_messages (
  id          uuid primary key,
  dispute_id  uuid not null references public.payment_disputes (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists dispute_messages_dispute_idx on public.dispute_messages (dispute_id, created_at);

create table if not exists public.dispute_proposals (
  id            uuid primary key,
  dispute_id    uuid not null references public.payment_disputes (id) on delete cascade,
  author_id     uuid references public.profiles (id) on delete set null,
  kind          text not null check (kind in ('amount', 'cancel')),
  amount_cents  integer check (amount_cents between 1 and 1000000),
  status        text not null default 'open' check (status in ('open', 'accepted', 'countered', 'persisted', 'replaced')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles (id) on delete set null,
  check ((kind = 'amount') = (amount_cents is not null))
);
create unique index if not exists dispute_proposals_one_open on public.dispute_proposals (dispute_id) where status = 'open';

-- What happened to each share, for the group's activity list (no reasons, no chat).
create table if not exists public.payment_share_events (
  id              bigint generated always as identity primary key,
  request_id      uuid not null references public.payment_requests (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  actor_id        uuid references public.profiles (id) on delete set null,
  kind            text not null check (kind in ('confirmed', 'disputed', 'amount_changed', 'waived')),
  amount_cents    integer,
  previous_cents  integer,
  created_at      timestamptz not null default now()
);
create index if not exists payment_share_events_request_idx on public.payment_share_events (request_id, created_at);

-- 3. Who can see what ---------------------------------------------------------------------

-- The requester and the disputing member, while they're in the group.
create or replace function public.is_dispute_participant(d uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payment_disputes x
      join public.payment_requests r on r.id = x.request_id
     where x.id = d
       and (x.member_id = auth.uid() or r.payee_id = auth.uid())
       and public.is_conversation_member(r.conversation_id));
$$;

alter table public.payment_disputes     enable row level security;
alter table public.dispute_messages     enable row level security;
alter table public.dispute_proposals    enable row level security;
alter table public.payment_share_events enable row level security;

drop policy if exists "Only the two sides see a dispute" on public.payment_disputes;
create policy "Only the two sides see a dispute"
  on public.payment_disputes for select to authenticated using (public.is_dispute_participant(id));
drop policy if exists "Only the two sides see a dispute's chat" on public.dispute_messages;
create policy "Only the two sides see a dispute's chat"
  on public.dispute_messages for select to authenticated using (public.is_dispute_participant(dispute_id));
drop policy if exists "Only the two sides see a dispute's proposals" on public.dispute_proposals;
create policy "Only the two sides see a dispute's proposals"
  on public.dispute_proposals for select to authenticated using (public.is_dispute_participant(dispute_id));
drop policy if exists "Members see what happened to their group's shares" on public.payment_share_events;
create policy "Members see what happened to their group's shares"
  on public.payment_share_events for select to authenticated
  using (exists (select 1 from public.payment_requests r
                  where r.id = request_id and public.is_conversation_member(r.conversation_id)));

-- 4. Confirming your share ------------------------------------------------------------------

create or replace function public.confirm_payment_share(req uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  st   text;
  amt  integer;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select s.status, s.amount_cents into st, amt
    from public.payment_shares s
    join public.payment_requests r on r.id = s.request_id
   where s.request_id = req and s.user_id = me
     and r.payee_id is distinct from me and r.status = 'open'
     and public.is_conversation_member(r.conversation_id)
     for update of s;
  if not found then raise exception 'You''re not paying in this request'; end if;
  if st = 'confirmed' then return; end if;  -- already confirmed (a retry)
  if st = 'disputed' then raise exception 'Your share is in dispute. Settle the dispute first.'; end if;
  if st <> 'pending' then raise exception 'Your share can''t be confirmed now'; end if;

  update public.payment_shares set status = 'confirmed', updated_at = now() where request_id = req and user_id = me;
  insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
  values (req, me, me, 'confirmed', amt);
end;
$$;

-- 5. Opening a dispute -----------------------------------------------------------------------

create or replace function public.open_payment_dispute(new_id uuid, req uuid, dispute_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  clean  text := btrim(coalesce(dispute_reason, ''));
  st     text;
  amt    integer;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if new_id is null then raise exception 'Missing dispute id'; end if;

  -- Sent before (a retry after a lost reply).
  if exists (select 1 from public.payment_disputes x where x.id = new_id) then
    if exists (select 1 from public.payment_disputes x where x.id = new_id and x.member_id = me and x.request_id = req) then
      return new_id;
    end if;
    raise exception 'That dispute id is already used';
  end if;

  if char_length(clean) not between 1 and 500 then raise exception 'Write a short reason (up to 500 characters)'; end if;

  select s.status, s.amount_cents into st, amt
    from public.payment_shares s
    join public.payment_requests r on r.id = s.request_id
   where s.request_id = req and s.user_id = me
     and r.payee_id is distinct from me and r.status = 'open'
     and public.is_conversation_member(r.conversation_id)
     for update of s;
  if not found then raise exception 'You''re not paying in this request'; end if;
  if st = 'disputed' or exists (select 1 from public.payment_disputes x
                                 where x.request_id = req and x.member_id = me and x.status = 'open') then
    raise exception 'You already have an open dispute on this share';
  end if;
  if st not in ('pending', 'confirmed') then raise exception 'Only a Pending or Confirmed share can be disputed'; end if;

  insert into public.payment_disputes (id, request_id, member_id, reason, original_cents)
  values (new_id, req, me, clean, amt);
  update public.payment_shares set status = 'disputed', updated_at = now() where request_id = req and user_id = me;
  insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
  values (req, me, me, 'disputed', amt);
  return new_id;
end;
$$;

-- 6. The dispute chat ------------------------------------------------------------------------

create or replace function public.send_dispute_message(msg_id uuid, target uuid, message_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  clean  text := btrim(coalesce(message_body, ''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if msg_id is null then raise exception 'Missing message id'; end if;
  if not public.is_dispute_participant(target) then raise exception 'Dispute not found'; end if;
  if exists (select 1 from public.dispute_messages m where m.id = msg_id) then
    if exists (select 1 from public.dispute_messages m where m.id = msg_id and m.author_id = me and m.dispute_id = target) then return; end if;
    raise exception 'That message id is already used';
  end if;
  if char_length(clean) not between 1 and 1000 then raise exception 'Messages are 1 to 1,000 characters'; end if;
  insert into public.dispute_messages (id, dispute_id, author_id, body) values (msg_id, target, me, clean);
end;
$$;

-- 7. Proposals --------------------------------------------------------------------------------
--    The member proposes a new amount or canceling; the requester counters with an amount.

create or replace function public.propose_dispute_change(prop_id uuid, target uuid, proposal_kind text, amount integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  member  uuid;
  payee   uuid;
  st      text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if prop_id is null then raise exception 'Missing proposal id'; end if;
  if not public.is_dispute_participant(target) then raise exception 'Dispute not found'; end if;

  if exists (select 1 from public.dispute_proposals p where p.id = prop_id) then
    if exists (select 1 from public.dispute_proposals p where p.id = prop_id and p.author_id = me and p.dispute_id = target) then return; end if;
    raise exception 'That proposal id is already used';
  end if;

  select x.member_id, r.payee_id, x.status into member, payee, st
    from public.payment_disputes x join public.payment_requests r on r.id = x.request_id
   where x.id = target
     for update of x;
  if st <> 'open' then raise exception 'This dispute is already settled'; end if;

  if proposal_kind = 'cancel' then
    if me <> member then raise exception 'Only the person disputing can propose canceling their payment'; end if;
    amount := null;
  elsif proposal_kind = 'amount' then
    if amount is null or amount not between 1 and 1000000 then raise exception 'Enter an amount between $0.01 and $10,000'; end if;
  else
    raise exception 'Unknown proposal';
  end if;

  -- A newer proposal replaces the open one (yours) or counters it (theirs). Both stay in history.
  update public.dispute_proposals
     set status = case when author_id = me then 'replaced' else 'countered' end,
         decided_at = now(), decided_by = me
   where dispute_id = target and status = 'open';

  insert into public.dispute_proposals (id, dispute_id, author_id, kind, amount_cents)
  values (prop_id, target, me, proposal_kind, amount);
end;
$$;

-- decision: 'accept' (either side, on the other side's proposal) or 'persist' (requester only).
create or replace function public.respond_dispute_proposal(target uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := auth.uid();
  p        public.dispute_proposals;
  member   uuid;
  payee    uuid;
  req      uuid;
  prev     integer;
  answered text := case decision when 'accept' then 'accepted' when 'persist' then 'persisted' end;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into p from public.dispute_proposals where id = target for update;
  if not found or not public.is_dispute_participant(p.dispute_id) then raise exception 'Proposal not found'; end if;

  if p.status <> 'open' then
    -- Answered already: a retry of the same answer is fine.
    if p.decided_by = me and p.status = answered then return; end if;
    raise exception 'This proposal was already answered or replaced';
  end if;
  if p.author_id = me then raise exception 'You can''t answer your own proposal'; end if;

  select x.member_id, r.payee_id, x.request_id into member, payee, req
    from public.payment_disputes x join public.payment_requests r on r.id = x.request_id
   where x.id = p.dispute_id
     for update of x;

  if decision = 'persist' then
    if me <> payee then raise exception 'Only the requester can keep the original amount'; end if;
    update public.dispute_proposals set status = 'persisted', decided_at = now(), decided_by = me where id = target;
    return;  -- the share stays Disputed
  end if;
  if decision <> 'accept' then raise exception 'Unknown answer'; end if;

  select s.amount_cents into prev from public.payment_shares s where s.request_id = req and s.user_id = member for update;
  update public.dispute_proposals set status = 'accepted', decided_at = now(), decided_by = me where id = target;

  if p.kind = 'amount' then
    update public.payment_shares set amount_cents = p.amount_cents, status = 'pending', updated_at = now()
     where request_id = req and user_id = member;
    update public.payment_disputes set status = 'resolved', resolution = 'new_amount', final_cents = p.amount_cents, resolved_at = now()
     where id = p.dispute_id;
    insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents, previous_cents)
    values (req, member, me, 'amount_changed', p.amount_cents, prev);
  else
    update public.payment_shares set status = 'waived', updated_at = now() where request_id = req and user_id = member;
    update public.payment_disputes set status = 'resolved', resolution = 'waived', final_cents = 0, resolved_at = now()
     where id = p.dispute_id;
    insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents, previous_cents)
    values (req, member, me, 'waived', 0, prev);
  end if;
end;
$$;

-- 8. Reading disputes: the ones you're part of on a request (requester: everyone's; member: yours).

create or replace function public.my_payment_disputes(req uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'member', jsonb_build_object('user_id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name,
                                        'username', pr.username, 'avatar_url', pr.avatar_url),
           'reason', x.reason,
           'original_cents', x.original_cents,
           'status', x.status,
           'resolution', x.resolution,
           'final_cents', x.final_cents,
           'created_at', x.created_at,
           'resolved_at', x.resolved_at,
           'messages', coalesce((
             select jsonb_agg(jsonb_build_object('id', m.id, 'author_id', m.author_id, 'body', m.body, 'created_at', m.created_at)
                              order by m.created_at, m.id)
               from public.dispute_messages m where m.dispute_id = x.id), '[]'::jsonb),
           'proposals', coalesce((
             select jsonb_agg(jsonb_build_object('id', p.id, 'author_id', p.author_id, 'kind', p.kind, 'amount_cents', p.amount_cents,
                                                 'status', p.status, 'created_at', p.created_at, 'decided_at', p.decided_at,
                                                 'decided_by', p.decided_by)
                              order by p.created_at, p.id)
               from public.dispute_proposals p where p.dispute_id = x.id), '[]'::jsonb))
           order by (x.status = 'open') desc, x.created_at desc), '[]'::jsonb)
    from public.payment_disputes x
    join public.profiles pr on pr.id = x.member_id
   where x.request_id = req and public.is_dispute_participant(x.id);
$$;

-- 9. Waived shares leave progress and what's owed; the Details page gets the share history. ---

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
           'share_count', (select count(*)::integer from public.payment_shares s where s.request_id = r.id and s.status <> 'waived'),
           'settled_count', (select count(*)::integer from public.payment_shares s where s.request_id = r.id and s.status = 'settled'),
           'outstanding_cents', (select coalesce(sum(s.amount_cents), 0)::integer from public.payment_shares s
                                  where s.request_id = r.id and s.status not in ('settled', 'waived')),
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
              where e.request_id = r.id), '[]'::jsonb))
    from public.payment_requests r
    join public.conversations c on c.id = r.conversation_id
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;

-- Your requests list: a waived share is done, like a settled one.
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
                'conversation_kind', c.kind)
    from public.payment_requests r
    join public.conversations c on c.id = r.conversation_id
   where r.status = 'open'
     and (target is null or r.conversation_id = target)
     and public.is_conversation_member(r.conversation_id)
     and (r.payee_id = auth.uid()
          or exists (select 1 from public.payment_shares s
                      where s.request_id = r.id and s.user_id = auth.uid() and s.status not in ('settled', 'waived')))
   order by r.due_date asc nulls last, r.created_at desc
   limit 200;
$$;

-- 10. Grants and live updates ----------------------------------------------------------------

revoke all on function public.is_dispute_participant(uuid) from public, anon;
revoke all on function public.confirm_payment_share(uuid) from public, anon;
revoke all on function public.open_payment_dispute(uuid, uuid, text) from public, anon;
revoke all on function public.send_dispute_message(uuid, uuid, text) from public, anon;
revoke all on function public.propose_dispute_change(uuid, uuid, text, integer) from public, anon;
revoke all on function public.respond_dispute_proposal(uuid, text) from public, anon;
revoke all on function public.my_payment_disputes(uuid) from public, anon;
grant execute on function public.is_dispute_participant(uuid) to authenticated;
grant execute on function public.confirm_payment_share(uuid) to authenticated;
grant execute on function public.open_payment_dispute(uuid, uuid, text) to authenticated;
grant execute on function public.send_dispute_message(uuid, uuid, text) to authenticated;
grant execute on function public.propose_dispute_change(uuid, uuid, text, integer) to authenticated;
grant execute on function public.respond_dispute_proposal(uuid, text) to authenticated;
grant execute on function public.my_payment_disputes(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['payment_disputes', 'dispute_messages', 'dispute_proposals', 'payment_share_events'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
