-- CommonTab: unread message counts and message alerts.
--   • A message is unread when someone else sent it after you last read that chat (or, if you
--     never opened it, after you joined). Your own messages never count.
--   • The chat list gets each chat's unread count; the alert bell gets one alert per chat with
--     unread messages (latest message, how many, and whether you were @mentioned).
-- Run once in Supabase, after 20261110080000_messages.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. The conversation list: unread messages and unread mentions per chat. ------------------

drop function if exists public.my_conversations();
create function public.my_conversations()
returns table (
  id               uuid,
  kind             text,
  name             text,
  description      text,
  picture_path     text,
  avatar_gradient  smallint,
  created_by       uuid,
  created_at       timestamptz,
  members          jsonb,
  unread_mentions  integer,
  unread_count     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.name, c.description, c.picture_path, c.avatar_gradient, c.created_by, c.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'user_id', p.id,
                    'username', p.username,
                    'first_name', p.first_name,
                    'last_name', p.last_name,
                    'avatar_url', p.avatar_url,
                    'role', m.role,
                    'added_by', m.added_by,
                    'venmo_username', case when c.kind = 'dm' then p.venmo_username end,
                    'paypal_username', case when c.kind = 'dm' then p.paypal_username end,
                    'zelle_contact', case when c.kind = 'dm' then p.zelle_contact end,
                    'preferred_handle', case when c.kind = 'dm' then p.preferred_handle end)
                  order by m.joined_at, p.first_name)
             from public.conversation_members m
             join public.profiles p on p.id = m.user_id
            where m.conversation_id = c.id), '[]'::jsonb),
         (select count(*)::integer
            from public.message_mentions mm
            join public.messages msg on msg.id = mm.message_id
           where mm.conversation_id = c.id and mm.user_id = auth.uid()
             and msg.sender_id is distinct from auth.uid() and msg.created_at > s.since),
         (select count(*)::integer
            from public.messages msg
           where msg.conversation_id = c.id
             and msg.sender_id is distinct from auth.uid() and msg.created_at > s.since)
    from public.conversation_members mine
    join public.conversations c on c.id = mine.conversation_id
    -- Read since: your last read position, or when you joined.
    cross join lateral (
      select coalesce(
               (select r.last_read_at from public.conversation_reads r
                 where r.conversation_id = c.id and r.user_id = auth.uid()),
               mine.joined_at) as since
    ) s
   where mine.user_id = auth.uid()
   order by c.created_at desc;
$$;

revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- 2. Message alerts: one per chat with unread messages, newest first. -------------------------

create or replace function public.my_message_alerts()
returns table (
  conversation_id    uuid,
  kind               text,
  group_name         text,
  picture_path       text,
  avatar_gradient    smallint,
  unread_count       integer,
  mentions_me        boolean,
  message_id         uuid,
  preview            text,
  file_count         integer,
  created_at         timestamptz,
  sender_id          uuid,
  sender_first_name  text,
  sender_last_name   text,
  sender_username    text,
  sender_avatar_url  text
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select m.conversation_id, coalesce(r.last_read_at, m.joined_at) as since
      from public.conversation_members m
      left join public.conversation_reads r on r.conversation_id = m.conversation_id and r.user_id = m.user_id
     where m.user_id = auth.uid()
  ), unread as (
    select msg.id, msg.conversation_id, msg.sender_id, msg.body, msg.seq, msg.created_at
      from public.messages msg
      join mine on mine.conversation_id = msg.conversation_id
     where msg.created_at > mine.since and msg.sender_id is distinct from auth.uid()
  ), latest as (
    select distinct on (u.conversation_id) u.* from unread u order by u.conversation_id, u.seq desc
  )
  select l.conversation_id, c.kind, c.name, c.picture_path, c.avatar_gradient,
         (select count(*)::integer from unread u where u.conversation_id = l.conversation_id),
         exists (
           select 1 from public.message_mentions mm join unread u on u.id = mm.message_id
            where mm.user_id = auth.uid() and u.conversation_id = l.conversation_id),
         l.id, left(l.body, 140),
         (select count(*)::integer from public.message_attachments a where a.message_id = l.id),
         l.created_at, p.id, p.first_name, p.last_name, p.username, p.avatar_url
    from latest l
    join public.conversations c on c.id = l.conversation_id
    left join public.profiles p on p.id = l.sender_id
   order by l.created_at desc
   limit 50;
$$;

revoke all on function public.my_message_alerts() from public, anon;
grant execute on function public.my_message_alerts() to authenticated;
