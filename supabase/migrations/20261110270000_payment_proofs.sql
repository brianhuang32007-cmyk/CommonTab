-- CommonTab: real payments with proof (Brian's call, 2026-11-10). Replaces the simulated
-- in-app payments (pay_my_share is switched off; earlier demo payments stay in the history).
--   • The payer pays outside CommonTab: Venmo or PayPal (opened with the amount filled in),
--     or Zelle in their bank's app. CommonTab never moves or holds money.
--   • Then they tap I Paid: pick the method, upload a screenshot (up to 3 photos or PDFs), add
--     a note, and submit it. Their share shows "Awaiting approval".
--   • The requester checks their own Venmo, PayPal or bank, looks at the screenshot, and
--     approves (the share is Paid) or rejects with a reason (the share goes back to Confirmed
--     and the payer can submit new proof). Every submission and decision is kept.
--   • Private: only the payer and the requester see the proof, screenshots and reasons. The
--     group sees the share's status and Activity lines.
-- Safe to run again.
-- Run once in Supabase, after 20261110260000_document_drafting.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Proofs ------------------------------------------------------------------------------------------

create table if not exists public.payment_proofs (
  id             uuid primary key,  -- made by the app, so a retry can't submit twice
  request_id     uuid not null references public.payment_requests (id) on delete cascade,
  payer_id       uuid not null references public.profiles (id) on delete cascade,
  payee_id       uuid references public.profiles (id) on delete set null,
  amount_cents   integer not null check (amount_cents > 0),
  method         text not null check (method in ('venmo', 'paypal', 'zelle')),
  note           text check (note is null or char_length(note) <= 300),
  status         text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  review_reason  text check (review_reason is null or char_length(review_reason) <= 300),
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);
create index if not exists payment_proofs_request_idx on public.payment_proofs (request_id, payer_id, created_at desc);

create table if not exists public.payment_proof_files (
  id          uuid primary key default gen_random_uuid(),
  proof_id    uuid not null references public.payment_proofs (id) on delete cascade,
  path        text not null unique,  -- "<request>/<payer>/<proof>/<file>" in payment-proofs
  name        text not null check (char_length(name) between 1 and 200),
  mime_type   text not null,
  size_bytes  bigint not null check (size_bytes >= 0),
  position    smallint not null
);

alter table public.payment_proofs enable row level security;
alter table public.payment_proof_files enable row level security;

drop policy if exists "The payer and the requester see a payment proof" on public.payment_proofs;
create policy "The payer and the requester see a payment proof"
  on public.payment_proofs for select to authenticated
  using (payer_id = auth.uid() or payee_id = auth.uid());

drop policy if exists "The payer and the requester see its screenshots" on public.payment_proof_files;
create policy "The payer and the requester see its screenshots"
  on public.payment_proof_files for select to authenticated
  using (exists (select 1 from public.payment_proofs p
                  where p.id = proof_id and (p.payer_id = auth.uid() or p.payee_id = auth.uid())));

-- New lines in a share's history.
alter table public.payment_share_events drop constraint if exists payment_share_events_kind_check;
alter table public.payment_share_events add constraint payment_share_events_kind_check
  check (kind in ('confirmed', 'disputed', 'amount_changed', 'waived', 'paid', 'dispute_canceled',
                  'proof_submitted', 'proof_rejected'));

-- 2. Private screenshot storage -------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the signed-in person upload proof for this request? (They owe a confirmed share in it.)
create or replace function public.can_upload_payment_proof(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payment_shares s join public.payment_requests r on r.id = s.request_id
     where r.id::text = folder and s.user_id = auth.uid() and s.status = 'confirmed'
       and r.status = 'open' and r.payee_id is distinct from auth.uid()
       and public.is_conversation_member(r.conversation_id)
  );
$$;

-- May the signed-in person open this screenshot? Its payer, or the requester once it's submitted.
create or replace function public.can_open_payment_proof(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(file_path))[2] = auth.uid()::text
         or exists (select 1 from public.payment_proof_files f join public.payment_proofs p on p.id = f.proof_id
                     where f.path = file_path and p.payee_id = auth.uid());
$$;

create or replace function public.is_submitted_payment_proof(file_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.payment_proof_files f where f.path = file_path);
$$;

drop policy if exists "Payers upload payment proof" on storage.objects;
create policy "Payers upload payment proof"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and array_length(storage.foldername(name), 1) = 3
              and (storage.foldername(name))[2] = auth.uid()::text
              and public.can_upload_payment_proof((storage.foldername(name))[1]));
drop policy if exists "The payer and the requester open payment proof" on storage.objects;
create policy "The payer and the requester open payment proof"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.can_open_payment_proof(name));
drop policy if exists "Payers delete unsent payment proof" on storage.objects;
create policy "Payers delete unsent payment proof"
  on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and owner_id = auth.uid()::text and not public.is_submitted_payment_proof(name));

-- 3. I Paid: submit proof -------------------------------------------------------------------------------
--    files: [{ "path": "<request>/<me>/<proof>/<file>", "name": "venmo.png" }, …] (1 to 3).

create or replace function public.submit_payment_proof(proof_id uuid, req uuid, pay_method text, proof_note text default null, files jsonb default '[]')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  list   jsonb := coalesce(files, '[]'::jsonb);
  clean  text := nullif(btrim(coalesce(proof_note, '')), '');
  st     text;
  amt    integer;
  payee  uuid;
  f      jsonb;
  obj    record;
  pos    integer := 0;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if proof_id is null then raise exception 'Missing proof id'; end if;

  -- Sent before (a retry after a lost reply): hand back the request.
  if exists (select 1 from public.payment_proofs p where p.id = proof_id) then
    if exists (select 1 from public.payment_proofs p where p.id = proof_id and p.payer_id = me and p.request_id = req) then
      return public.payment_request_view(req);
    end if;
    raise exception 'That proof id is already used';
  end if;

  if pay_method is null or pay_method not in ('venmo', 'paypal', 'zelle') then raise exception 'Pick how you paid: Venmo, PayPal or Zelle'; end if;
  if clean is not null and char_length(clean) > 300 then raise exception 'The note can be up to 300 characters'; end if;
  if jsonb_typeof(list) <> 'array' or jsonb_array_length(list) not between 1 and 3 then raise exception 'Add a screenshot of your payment'; end if;

  select s.status, s.amount_cents, r.payee_id into st, amt, payee
    from public.payment_shares s join public.payment_requests r on r.id = s.request_id
   where s.request_id = req and s.user_id = me and r.payee_id is distinct from me and r.status = 'open'
     and public.is_conversation_member(r.conversation_id)
     for update of s;
  if not found then raise exception 'You''re not paying in this request'; end if;
  if st = 'pending' then raise exception 'Confirm your share before paying'; end if;
  if st = 'marked_paid' then raise exception 'Your proof is already waiting for approval'; end if;
  if st = 'settled' then raise exception 'This share is already paid'; end if;
  if st = 'disputed' then raise exception 'Your share is in dispute. Settle the dispute first.'; end if;
  if st <> 'confirmed' then raise exception 'This share can''t be paid now'; end if;

  insert into public.payment_proofs (id, request_id, payer_id, payee_id, amount_cents, method, note)
  values (proof_id, req, me, payee, amt, pay_method, clean);

  for f in select value from jsonb_array_elements(list) loop
    if coalesce(f->>'path', '') not like req::text || '/' || me::text || '/' || proof_id::text || '/%' then
      raise exception 'That screenshot upload isn''t valid';
    end if;
    select o.metadata into obj from storage.objects o
     where o.bucket_id = 'payment-proofs' and o.name = f->>'path' and o.owner_id = me::text;
    if not found then raise exception 'A screenshot didn''t finish uploading. Try again.'; end if;
    insert into public.payment_proof_files (proof_id, path, name, mime_type, size_bytes, position)
    values (proof_id, f->>'path', left(coalesce(nullif(btrim(f->>'name'), ''), 'screenshot'), 200),
            coalesce(obj.metadata->>'mimetype', 'image/jpeg'), coalesce((obj.metadata->>'size')::bigint, 0), pos);
    pos := pos + 1;
  end loop;

  update public.payment_shares set status = 'marked_paid', updated_at = now() where request_id = req and user_id = me;
  insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
  values (req, me, me, 'proof_submitted', amt);
  return public.payment_request_view(req);
end;
$$;

-- 4. Review (the requester): approve, or reject with a reason --------------------------------------------

create or replace function public.review_payment_proof(target uuid, decision text, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  p      public.payment_proofs%rowtype;
  clean  text := nullif(btrim(coalesce(reason, '')), '');
begin
  if me is null then raise exception 'Not signed in'; end if;
  if decision not in ('approve', 'reject') then raise exception 'Unknown decision'; end if;
  select pr.* into p from public.payment_proofs pr join public.payment_requests r on r.id = pr.request_id
   where pr.id = target and r.payee_id = me and public.is_conversation_member(r.conversation_id);
  if not found then raise exception 'Only the person being paid can review this'; end if;
  if p.status <> 'submitted' then raise exception 'This proof was already reviewed'; end if;

  if decision = 'approve' then
    update public.payment_proofs set status = 'approved', reviewed_at = now() where id = target;
    update public.payment_shares set status = 'settled', updated_at = now()
     where request_id = p.request_id and user_id = p.payer_id and status = 'marked_paid';
    insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
    values (p.request_id, p.payer_id, me, 'paid', p.amount_cents);
    -- Everyone paid (or waived): the request is fully paid.
    if not exists (select 1 from public.payment_shares s where s.request_id = p.request_id and s.status not in ('settled', 'waived')) then
      update public.payment_requests set status = 'settled' where id = p.request_id;
    end if;
  else
    if clean is null or char_length(clean) > 300 then raise exception 'Say why (300 characters max)'; end if;
    update public.payment_proofs set status = 'rejected', reviewed_at = now(), review_reason = clean where id = target;
    update public.payment_shares set status = 'confirmed', updated_at = now()
     where request_id = p.request_id and user_id = p.payer_id and status = 'marked_paid';
    insert into public.payment_share_events (request_id, user_id, actor_id, kind, amount_cents)
    values (p.request_id, p.payer_id, me, 'proof_rejected', p.amount_cents);
  end if;
  return public.payment_request_view(p.request_id);
end;
$$;

-- 5. The proofs on a request you can see (yours as the payer; everyone's as the requester) -------------

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

-- 6. The simulated payments are switched off ---------------------------------------------------------------

revoke execute on function public.pay_my_share(uuid, uuid, text) from authenticated;

-- 7. Permissions and live updates --------------------------------------------------------------------------

revoke all on function public.can_upload_payment_proof(text) from public, anon;
revoke all on function public.can_open_payment_proof(text) from public, anon;
revoke all on function public.is_submitted_payment_proof(text) from public, anon;
revoke all on function public.submit_payment_proof(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.review_payment_proof(uuid, text, text) from public, anon;
revoke all on function public.my_payment_proofs(uuid) from public, anon;
grant execute on function public.can_upload_payment_proof(text) to authenticated;
grant execute on function public.can_open_payment_proof(text) to authenticated;
grant execute on function public.is_submitted_payment_proof(text) to authenticated;
grant execute on function public.submit_payment_proof(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.review_payment_proof(uuid, text, text) to authenticated;
grant execute on function public.my_payment_proofs(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_proofs') then
    alter publication supabase_realtime add table public.payment_proofs;
  end if;
end;
$$;
