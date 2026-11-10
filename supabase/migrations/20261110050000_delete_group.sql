-- CommonTab: the group owner can delete the group.
--   Deleting removes the group and everyone's membership in it, for everyone. It can't be undone.
--   The app deletes the group's picture files first (while the owner still counts as an organizer).
-- Run once in Supabase, after 20261110040000_group_owner.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. Delete a group (owner only). Memberships go with it (on delete cascade). -------------

create or replace function public.delete_group(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_group_role(target) is distinct from 'owner' then raise exception 'Only the owner can delete the group'; end if;
  delete from public.conversations where id = target and kind = 'group';
end;
$$;

revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;

-- 2. Storage needs to see a file before it can delete it, so organizers (and the owner)
--    can list their group's picture folder. The pictures are public to view anyway.

create policy "Organizers can list their group's pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'group-pictures' and public.is_group_organizer((storage.foldername(name))[1]));
