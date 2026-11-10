-- CommonTab: AI call log and daily limits (CommonTab AI, Step 16).
--   • Every AI request is logged: who, which feature, which model, tokens used, ok or failed.
--   • Each person gets a set number of AI requests per feature in any 24 hours
--     (chat: 30). The limit lives here, in the database, so the app can't be talked out of it.
--   • People can see their own log; nobody can write to it directly.
-- Run once in Supabase, after 20261110090000_message_alerts.sql:
-- Dashboard → SQL Editor → New query → paste → Run.

create table public.ai_calls (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  feature        text not null check (feature in ('chat')),
  status         text not null default 'started' check (status in ('started', 'ok', 'failed')),
  model          text check (model is null or char_length(model) <= 100),
  input_tokens   integer check (input_tokens is null or input_tokens >= 0),
  output_tokens  integer check (output_tokens is null or output_tokens >= 0),
  error          text check (error is null or char_length(error) <= 500),
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index ai_calls_user_feature_idx on public.ai_calls (user_id, feature, created_at desc);

alter table public.ai_calls enable row level security;
create policy "You can see your own AI calls"
  on public.ai_calls for select to authenticated
  using (user_id = auth.uid());

-- How many requests each feature allows per person in any 24 hours.
create or replace function public.ai_daily_limit(feature_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case feature_name when 'chat' then 30 else 0 end;
$$;

-- Called by the app's server before each AI request. Every request counts, so the limit
-- can't be dodged. Returns { id, remaining }, or fails with DAILY_LIMIT.
create or replace function public.start_ai_call(feature_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  cap     integer := public.ai_daily_limit(feature_name);
  used    integer;
  new_id  uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if cap = 0 then raise exception 'Unknown AI feature'; end if;

  -- One check at a time per person, so two quick requests can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('ai:' || me::text || ':' || feature_name));

  select count(*)::integer into used
    from public.ai_calls c
   where c.user_id = me and c.feature = feature_name and c.created_at > now() - interval '24 hours';
  if used >= cap then raise exception 'DAILY_LIMIT'; end if;

  insert into public.ai_calls (user_id, feature) values (me, feature_name) returning id into new_id;
  return jsonb_build_object('id', new_id, 'remaining', cap - used - 1);
end;
$$;

-- Called by the app's server when the request ends. Only fills in an open call of yours.
create or replace function public.finish_ai_call(
  call_id uuid, succeeded boolean, model_used text default null,
  tokens_in integer default null, tokens_out integer default null, problem text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_calls
     set status = case when succeeded then 'ok' else 'failed' end,
         model = left(model_used, 100),
         input_tokens = greatest(tokens_in, 0),
         output_tokens = greatest(tokens_out, 0),
         error = left(problem, 500),
         finished_at = now()
   where id = call_id and user_id = auth.uid() and status = 'started';
$$;

revoke all on function public.ai_daily_limit(text) from public, anon;
revoke all on function public.start_ai_call(text) from public, anon;
revoke all on function public.finish_ai_call(uuid, boolean, text, integer, integer, text) from public, anon;
grant execute on function public.ai_daily_limit(text) to authenticated;
grant execute on function public.start_ai_call(text) to authenticated;
grant execute on function public.finish_ai_call(uuid, boolean, text, integer, integer, text) to authenticated;
