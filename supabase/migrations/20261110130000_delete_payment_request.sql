-- CommonTab: delete a payment request.
--   Only the group's owner or whoever made the request can delete it. It's removed for
--   everyone: the request, its shares and its card in the chat (and the card's mentions).
--   Deleting one that's already gone does nothing, so a retry is safe.
-- Run once in Supabase, after 20261110120000_request_shares_view.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.delete_payment_request(req uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  maker  uuid;
  chat   uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select r.created_by, r.conversation_id into maker, chat from public.payment_requests r where r.id = req;
  if not found then return; end if;  -- already deleted
  if not (maker = me or public.my_group_role(chat) = 'owner') then
    raise exception 'Only the group owner or whoever made the request can delete it';
  end if;

  delete from public.messages where payment_request_id = req;   -- the chat card (mentions go with it)
  delete from public.payment_requests where id = req;            -- shares go with it
end;
$$;

revoke all on function public.delete_payment_request(uuid) from public, anon;
grant execute on function public.delete_payment_request(uuid) to authenticated;
