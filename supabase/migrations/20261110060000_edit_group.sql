-- CommonTab: edit a group's name, description and picture.
--   The owner and organizers can edit. Same rules as creating a group: name 1 to 40
--   characters, description up to 200. Name, description and picture save together.
-- Run once in Supabase, after 20261110050000_delete_group.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create or replace function public.update_group(
  target uuid, group_name text, group_description text, picture text default null, change_picture boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean  text := btrim(coalesce(group_name, ''));
  about  text := nullif(btrim(coalesce(group_description, '')), '');
begin
  if not public.is_group_organizer(target::text) then raise exception 'Only the owner and organizers can edit the group'; end if;
  if char_length(clean) not between 1 and 40 then raise exception 'Group name must be 1 to 40 characters'; end if;
  if about is not null and char_length(about) > 200 then raise exception 'Description must be 200 characters or fewer'; end if;
  -- A new picture must be one uploaded to this group's own folder.
  if change_picture and picture is not null
     and picture not like '%/storage/v1/object/public/group-pictures/' || target::text || '/%' then
    raise exception 'That picture upload isn''t valid';
  end if;

  -- One update, so members see the whole change at once (live, through Realtime).
  update public.conversations
     set name = clean,
         description = about,
         picture_url = case when change_picture then picture else picture_url end
   where id = target and kind = 'group';
end;
$$;

revoke all on function public.update_group(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.update_group(uuid, text, text, text, boolean) to authenticated;
