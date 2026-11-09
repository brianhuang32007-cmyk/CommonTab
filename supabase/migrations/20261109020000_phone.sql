-- CommonTab: optional phone number on profiles (US numbers, stored as +1XXXXXXXXXX).
-- Run once in Supabase, after the earlier profile files:
-- Dashboard → SQL Editor → New query → paste → Run.

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add constraint phone_format check (phone is null or phone ~ '^\+1[0-9]{10}$');
