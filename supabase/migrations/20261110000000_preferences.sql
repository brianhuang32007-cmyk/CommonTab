-- CommonTab: Preferences page (payment "show first", reminders, privacy) + delete account.
-- Run once in Supabase, after the earlier files:
-- Dashboard → SQL Editor → New query → paste → Run.

-- 1. New preference columns on profiles. Existing users get the defaults.
alter table public.profiles
  add column if not exists preferred_handle text,                              -- venmo | paypal | zelle, or null
  add column if not exists remind_3_days    boolean not null default true,     -- 3 days before a due date
  add column if not exists remind_1_day     boolean not null default true,     -- 1 day before
  add column if not exists remind_overdue   boolean not null default true,     -- once it's overdue
  add column if not exists discoverable_by  text    not null default 'everyone', -- everyone | contacts
  add column if not exists show_phone       boolean not null default false;    -- show phone to contacts

alter table public.profiles
  add constraint preferred_handle_valid check (
    preferred_handle is null or preferred_handle in ('venmo', 'paypal', 'zelle')
  ),
  add constraint discoverable_by_valid check (discoverable_by in ('everyone', 'contacts'));

-- 2. Let people see the files in their own photo folder (needed to tidy up old photos).
create policy "Users can list their own avatar files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 3. Delete account: removes the signed-in user's login. Their profile row goes with it
--    (profiles.id references auth.users on delete cascade). The app removes their photos first.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
