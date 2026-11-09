-- CommonTab: user profiles + profile photos
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

-- 1. Profiles: one row per signed-up user, created on the "Create your profile" page.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  first_name  text not null,
  last_name   text not null,
  birthday    date not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),

  -- lowercase letters, numbers and underscores, 3–20 characters
  constraint username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint first_name_length check (char_length(btrim(first_name)) between 1 and 50),
  constraint last_name_length check (char_length(btrim(last_name)) between 1 and 50),
  -- must be at least 13 years old
  constraint birthday_valid check (
    birthday >= date '1900-01-01'
    and birthday <= (current_date - interval '13 years')
  )
);

-- 2. Row-level security: people can only see and change their own profile (for now).
alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 3. Username availability check (answers yes/no without exposing anyone's profile).
create or replace function public.is_username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles where username = lower(btrim(candidate))
  );
$$;

revoke all on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

-- 4. Profile photos: public "avatars" bucket, 2 MB max, JPEG/PNG/WebP only.
--    Each user may only upload into their own folder: avatars/<user id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
