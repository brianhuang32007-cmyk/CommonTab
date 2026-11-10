-- CommonTab: payment requests (Step 9, first part).
--   • Only a group's owner and organizers can request a payment. Each request is posted in the
--     chat as a card (a message linked to it) and tags everyone who has to pay.
--   • Amounts are whole cents. The shares must add up to the total, everyone in the split must
--     be in the group, and each person has one share. The app makes the request's id, so a
--     retry can't create a second one.
--   • A receipt photo (optional) lives in the private chat-files bucket, and the AI's digital
--     receipt (vendor, date, items, totals) is stored with the request.
--   • Members can see their group's requests; nobody writes to them directly.
--   • Receipt scans count toward a daily AI limit, like questions.
-- Run once in Supabase, after 20261110100000_ai_calls.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Tables -------------------------------------------------------------------------------

create table public.payment_requests (
  id               uuid primary key,  -- made by the app, so a retry can't create two
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  payee_id         uuid references public.profiles (id) on delete set null,
  title            text not null check (char_length(title) between 1 and 80),
  total_cents      integer not null check (total_cents between 1 and 1000000),
  due_date         date,
  split            text not null check (split in ('equal', 'custom')),
  receipt_path     text,
  receipt          jsonb,  -- the AI's digital receipt, as checked by the requester
  status           text not null default 'open' check (status in ('open', 'settled', 'cancelled')),
  created_at       timestamptz not null default now()
);
create index payment_requests_conversation_idx on public.payment_requests (conversation_id, created_at desc);

create table public.payment_shares (
  request_id    uuid not null references public.payment_requests (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  amount_cents  integer not null check (amount_cents >= 0),
  status        text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'marked_paid', 'settled', 'disputed')),
  updated_at    timestamptz not null default now(),
  primary key (request_id, user_id)
);
create index payment_shares_user_idx on public.payment_shares (user_id);

-- The chat card: a message that points at its request.
alter table public.messages
  add column payment_request_id uuid references public.payment_requests (id) on delete set null;

alter table public.payment_requests enable row level security;
alter table public.payment_shares   enable row level security;

create policy "Members can see their group's payment requests"
  on public.payment_requests for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "Members can see the shares of their group's requests"
  on public.payment_shares for select to authenticated
  using (exists (select 1 from public.payment_requests r
                  where r.id = request_id and public.is_conversation_member(r.conversation_id)));

-- 2. A request as the signed-in person sees it (for chat cards and pages). -----------------

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
                                  where s.request_id = r.id and s.status <> 'settled'))
    from public.payment_requests r
   where r.id = req and public.is_conversation_member(r.conversation_id);
$$;

-- Messages now carry their payment request (the chat card), if any.
create or replace function public.get_message(msg_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', m.id,
           'conversation_id', m.conversation_id,
           'sender_id', m.sender_id,
           'body', m.body,
           'seq', m.seq,
           'created_at', m.created_at,
           'attachments', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', a.id, 'path', a.path, 'name', a.name, 'mime_type', a.mime_type,
                      'size_bytes', a.size_bytes, 'position', a.position) order by a.position)
               from public.message_attachments a where a.message_id = m.id), '[]'::jsonb),
           'mentions', coalesce((
             select jsonb_agg(mm.user_id) from public.message_mentions mm where mm.message_id = m.id), '[]'::jsonb),
           'payment_request', case when m.payment_request_id is null then null
                                   else public.payment_request_view(m.payment_request_id) end)
    from public.messages m
   where m.id = msg_id and public.is_conversation_member(m.conversation_id);
$$;

-- 3. Making a request ---------------------------------------------------------------------
--    shares: [{ "user_id": "...", "amount_cents": 3334 }, …]  receipt: the digital receipt or null.

create or replace function public.create_payment_request(
  req_id uuid,
  target uuid,
  request_title text,
  total integer,
  due date default null,
  split_kind text default 'equal',
  shares jsonb default '[]',
  receipt_file text default null,
  receipt_data jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  clean   text := btrim(coalesce(request_title, ''));
  mine    text := public.my_group_role(target);
  share   jsonb;
  person  uuid;
  amount  integer;
  summed  integer := 0;
  people  uuid[] := '{}';
begin
  if me is null then raise exception 'Not signed in'; end if;
  if req_id is null then raise exception 'Missing request id'; end if;

  -- Sent before (a retry after a lost reply): hand back what was saved.
  if exists (select 1 from public.payment_requests r where r.id = req_id) then
    if exists (select 1 from public.payment_requests r where r.id = req_id and r.created_by = me and r.conversation_id = target) then
      return public.payment_request_view(req_id);
    end if;
    raise exception 'That request id is already used';
  end if;

  if mine is null or mine not in ('owner', 'organizer') then
    raise exception 'Only the owner and organizers can request a payment';
  end if;
  if char_length(clean) not between 1 and 80 then raise exception 'The title must be 1 to 80 characters'; end if;
  if total is null or total not between 1 and 1000000 then raise exception 'The total must be between $0.01 and $10,000'; end if;
  if due is not null and due < current_date then raise exception 'The due date can''t be in the past'; end if;
  if split_kind not in ('equal', 'custom') then raise exception 'Unknown split'; end if;
  if jsonb_typeof(coalesce(shares, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(shares, '[]'::jsonb)) = 0 then
    raise exception 'Pick at least one person to pay';
  end if;
  if jsonb_array_length(shares) > 100 then raise exception 'Too many people'; end if;

  for share in select value from jsonb_array_elements(shares) loop
    person := (share->>'user_id')::uuid;
    amount := (share->>'amount_cents')::integer;
    if person is null or amount is null or amount < 0 then raise exception 'Each share needs a person and an amount'; end if;
    if person = any(people) then raise exception 'Each person can only be in the split once'; end if;
    if not exists (select 1 from public.conversation_members m where m.conversation_id = target and m.user_id = person) then
      raise exception 'Everyone in the split must be in the group';
    end if;
    people := people || person;
    summed := summed + amount;
  end loop;
  if summed <> total then raise exception 'The shares must add up to the total'; end if;
  if not exists (select 1 from unnest(people) p where p <> me) then raise exception 'Pick at least one other person to pay'; end if;

  -- A receipt photo must be one you uploaded to this request's folder.
  if receipt_file is not null then
    if receipt_file not like target::text || '/' || req_id::text || '/%' then raise exception 'That receipt upload isn''t valid'; end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'chat-files' and o.name = receipt_file and o.owner_id = me::text) then
      raise exception 'The receipt didn''t finish uploading. Try again.';
    end if;
  end if;
  if receipt_data is not null and (jsonb_typeof(receipt_data) <> 'object' or length(receipt_data::text) > 20000) then
    raise exception 'That receipt isn''t valid';
  end if;

  insert into public.payment_requests
    (id, conversation_id, created_by, payee_id, title, total_cents, due_date, split, receipt_path, receipt)
  values (req_id, target, me, me, clean, total, due, split_kind, receipt_file, receipt_data);

  -- Your own share (if you're in the split) is already settled: you can't owe yourself.
  insert into public.payment_shares (request_id, user_id, amount_cents, status)
  select req_id, (e.item->>'user_id')::uuid, (e.item->>'amount_cents')::integer,
         case when (e.item->>'user_id')::uuid = me then 'settled' else 'pending' end
    from jsonb_array_elements(shares) as e(item);

  -- Post the card in the chat and tag everyone who has to pay (alerts and "@ You" follow).
  with card as (
    insert into public.messages (id, conversation_id, sender_id, body, payment_request_id)
    values (gen_random_uuid(), target, me, 'Payment request: ' || clean, req_id)
    returning id
  )
  insert into public.message_mentions (message_id, conversation_id, user_id)
  select card.id, target, p from card, unnest(people) as p where p <> me;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (target, me, now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();

  return public.payment_request_view(req_id);
end;
$$;

-- 4. Your requests list: everything open that you sent or that you have to pay. ------------
--    Most urgent first: overdue, then due soonest, then no due date. Optionally one chat.

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
                      where s.request_id = r.id and s.user_id = auth.uid() and s.status <> 'settled'))
   order by r.due_date asc nulls last, r.created_at desc
   limit 200;
$$;

revoke all on function public.payment_request_view(uuid) from public, anon;
revoke all on function public.create_payment_request(uuid, uuid, text, integer, date, text, jsonb, text, jsonb) from public, anon;
revoke all on function public.my_payment_requests(uuid) from public, anon;
grant execute on function public.payment_request_view(uuid) to authenticated;
grant execute on function public.create_payment_request(uuid, uuid, text, integer, date, text, jsonb, text, jsonb) to authenticated;
grant execute on function public.my_payment_requests(uuid) to authenticated;

-- 5. Receipt scans have their own daily limit (20 per person in any 24 hours). -------------

alter table public.ai_calls drop constraint ai_calls_feature_check;
alter table public.ai_calls add constraint ai_calls_feature_check check (feature in ('chat', 'receipt'));

create or replace function public.ai_daily_limit(feature_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case feature_name when 'chat' then 30 when 'receipt' then 20 else 0 end;
$$;

-- 6. Live updates: request changes reach the group. ------------------------------------------

alter publication supabase_realtime add table public.payment_requests;
alter publication supabase_realtime add table public.payment_shares;
