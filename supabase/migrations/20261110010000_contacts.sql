-- CommonTab: Contacts (requests, contacts list, stars) + live updates.
-- Run once in Supabase, after the earlier files:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. One row per pair of people. "pending" until the person asked accepts.
create table public.contacts (
  id                 bigint generated always as identity primary key,
  requester_id       uuid not null references public.profiles (id) on delete cascade, -- who tapped Add
  addressee_id       uuid not null references public.profiles (id) on delete cascade, -- who was asked
  status             text not null default 'pending',
  requester_starred  boolean not null default false, -- stars are private to each side
  addressee_starred  boolean not null default false,
  created_at         timestamptz not null default now(),
  accepted_at        timestamptz,

  constraint contacts_status_valid check (status in ('pending', 'accepted')),
  constraint contacts_not_self check (requester_id <> addressee_id)
);

-- Two people can only be connected once, whoever asked first.
create unique index contacts_pair_unique
  on public.contacts (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index contacts_requester_idx on public.contacts (requester_id);
create index contacts_addressee_idx on public.contacts (addressee_id);

-- 2. Row-level security: you can only see rows that include you.
--    Nobody writes to the table directly; every change goes through the functions below.
alter table public.contacts enable row level security;

create policy "People can see their own contact rows"
  on public.contacts for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- 3. Search by username. Returns only name, username and photo, and your relationship
--    to each person. Skips people who chose "Only my contacts" (unless you're already connected).
create or replace function public.search_profiles(q text)
returns table (
  id uuid, username text, first_name text, last_name text, avatar_url text,
  relation text,   -- contact | sent | received | none
  total bigint     -- how many matched in all (only the top 10 are returned)
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
       term as (select lower(regexp_replace(btrim(q), '^@', '')) as t)
  select p.id, p.username, p.first_name, p.last_name, p.avatar_url,
         case
           when c.status = 'accepted' then 'contact'
           when c.requester_id = me.uid then 'sent'
           when c.addressee_id = me.uid then 'received'
           else 'none'
         end,
         count(*) over ()
  from public.profiles p
  cross join me
  cross join term
  left join public.contacts c
    on (c.requester_id = me.uid and c.addressee_id = p.id)
    or (c.addressee_id = me.uid and c.requester_id = p.id)
  where me.uid is not null
    and char_length(term.t) >= 2
    and p.id <> me.uid
    and strpos(p.username, term.t) > 0
    and (p.discoverable_by = 'everyone' or c.id is not null)
  order by
    case when p.username = term.t then 0
         when left(p.username, char_length(term.t)) = term.t then 1
         else 2 end,
    p.first_name, p.last_name
  limit 10;
$$;

-- 4. Everyone you're connected to or have a pending request with.
--    Payment handles only for accepted contacts; phone only if they chose to share it.
create or replace function public.my_contacts()
returns table (
  user_id uuid, username text, first_name text, last_name text, avatar_url text,
  relation text,   -- contact | sent | received
  starred boolean,
  requested_at timestamptz,
  venmo_username text, paypal_username text, zelle_contact text, preferred_handle text,
  phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.first_name, p.last_name, p.avatar_url,
         case when c.status = 'accepted' then 'contact'
              when c.requester_id = auth.uid() then 'sent'
              else 'received' end,
         case when c.requester_id = auth.uid() then c.requester_starred else c.addressee_starred end,
         c.created_at,
         case when c.status = 'accepted' then p.venmo_username end,
         case when c.status = 'accepted' then p.paypal_username end,
         case when c.status = 'accepted' then p.zelle_contact end,
         case when c.status = 'accepted' then p.preferred_handle end,
         case when c.status = 'accepted' and p.show_phone then p.phone end
  from public.contacts c
  join public.profiles p
    on p.id = case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
  where auth.uid() in (c.requester_id, c.addressee_id);
$$;

-- 5. Send a request (Add). If they already asked you, this accepts it instead.
create or replace function public.send_contact_request(target uuid)
returns text  -- the new relation: sent | contact
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing public.contacts;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if target = me then raise exception 'You can''t add yourself'; end if;

  select * into existing from public.contacts
   where (requester_id = me and addressee_id = target)
      or (requester_id = target and addressee_id = me);

  if found then
    if existing.status = 'accepted' then return 'contact'; end if;
    if existing.requester_id = me then return 'sent'; end if;
    update public.contacts set status = 'accepted', accepted_at = now() where id = existing.id;
    return 'contact';
  end if;

  if not exists (select 1 from public.profiles where id = target and discoverable_by = 'everyone') then
    raise exception 'User not found';
  end if;

  insert into public.contacts (requester_id, addressee_id) values (me, target);
  return 'sent';
end;
$$;

-- 6. Accept a request someone sent you.
create or replace function public.accept_contact_request(other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contacts
     set status = 'accepted', accepted_at = now()
   where requester_id = other and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Request not found'; end if;
end;
$$;

-- 7. Decline, cancel or remove: deletes the row between you and them.
create or replace function public.remove_contact(other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.contacts
   where (requester_id = auth.uid() and addressee_id = other)
      or (requester_id = other and addressee_id = auth.uid());
$$;

-- 8. Star or unstar a contact (only changes your own side).
create or replace function public.set_contact_star(other uuid, value boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.contacts
     set requester_starred = case when requester_id = auth.uid() then value else requester_starred end,
         addressee_starred = case when addressee_id = auth.uid() then value else addressee_starred end
   where status = 'accepted'
     and ((requester_id = auth.uid() and addressee_id = other)
       or (requester_id = other and addressee_id = auth.uid()));
$$;

revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.my_contacts() from public, anon;
revoke all on function public.send_contact_request(uuid) from public, anon;
revoke all on function public.accept_contact_request(uuid) from public, anon;
revoke all on function public.remove_contact(uuid) from public, anon;
revoke all on function public.set_contact_star(uuid, boolean) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.my_contacts() to authenticated;
grant execute on function public.send_contact_request(uuid) to authenticated;
grant execute on function public.accept_contact_request(uuid) to authenticated;
grant execute on function public.remove_contact(uuid) to authenticated;
grant execute on function public.set_contact_star(uuid, boolean) to authenticated;

-- 9. Live updates: send changes to this table to open apps (Supabase Realtime).
--    Each person only receives rows the policy in step 2 lets them see.
alter publication supabase_realtime add table public.contacts;
