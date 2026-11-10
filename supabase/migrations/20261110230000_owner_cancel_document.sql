-- CommonTab: the group owner can cancel a document request too (Brian's call, 2026-11-10).
--   • Cancel Request works for whoever made the request, or the group's owner.
--   • Nobody can upload to a canceled request; files already sent stay private to the
--     requester and whoever sent them.
--   • Recent updates: when someone else cancels your request, you get one "Request canceled"
--     update (not one per person asked).
-- Safe to run again.
-- Run once in Supabase, after 20261110220000_document_requests.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.cancel_document_request(req uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.document_requests r
                  where r.id = req
                    and (r.created_by = me or public.my_group_role(r.conversation_id) = 'owner')) then
    raise exception 'Only the requester or the group owner can cancel this request';
  end if;
  if exists (select 1 from public.document_requests r where r.id = req and r.status <> 'open') then
    return public.document_request_view(req);
  end if;
  update public.document_requests r set status = 'cancelled' where r.id = req;
  insert into public.document_events (request_id, user_id, actor_id, kind)
  select req, d.user_id, me, 'cancelled' from public.document_recipients d
   where d.request_id = req and d.status not in ('accepted', 'cant_provide');
  return public.document_request_view(req);
end;
$$;

create or replace function public.my_document_events(max_rows integer default 50)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'source', 'document',
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
           'amount_cents', null,
           'previous_cents', null,
           'note', e.note,
           'created_at', e.created_at,
           'i_am_requester', r.created_by = auth.uid())
    from public.document_events e
    join public.document_requests r on r.id = e.request_id
    join public.conversations c on c.id = r.conversation_id
    left join public.profiles u on u.id = e.user_id
    left join public.profiles a on a.id = e.actor_id
   where public.is_conversation_member(r.conversation_id)
     and (r.created_by = auth.uid() or e.user_id = auth.uid())
     and e.actor_id is distinct from auth.uid()
     -- A cancel is one event per person asked: show the requester just one of them.
     and (e.kind <> 'cancelled' or e.user_id = auth.uid()
          or e.id = (select min(x.id) from public.document_events x where x.request_id = e.request_id and x.kind = 'cancelled'))
     and e.created_at > now() - interval '30 days'
   order by e.created_at desc, e.id desc
   limit least(greatest(coalesce(max_rows, 50), 1), 100);
$$;

revoke all on function public.cancel_document_request(uuid) from public, anon;
revoke all on function public.my_document_events(integer) from public, anon;
grant execute on function public.cancel_document_request(uuid) to authenticated;
grant execute on function public.my_document_events(integer) to authenticated;
