-- CommonTab: optional payment handles on profiles (Venmo, PayPal, Zelle).
-- Run once in Supabase, after 20261109000000_profiles.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

alter table public.profiles
  add column if not exists venmo_username  text,  -- without the @
  add column if not exists paypal_username text,  -- the name after paypal.me/
  add column if not exists zelle_contact   text;  -- email, or US phone as +1XXXXXXXXXX

alter table public.profiles
  add constraint venmo_format check (
    venmo_username is null or venmo_username ~ '^[A-Za-z0-9_-]{5,30}$'
  ),
  add constraint paypal_format check (
    paypal_username is null or paypal_username ~ '^[A-Za-z0-9]{1,20}$'
  ),
  add constraint zelle_format check (
    zelle_contact is null
    or zelle_contact ~ '^\+1[0-9]{10}$'
    or (char_length(zelle_contact) <= 254 and zelle_contact ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  );
