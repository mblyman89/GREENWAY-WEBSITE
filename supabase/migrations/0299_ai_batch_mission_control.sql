-- 0299_ai_batch_mission_control.sql  (R74 S41, Round 21)
--
-- Batch Mission Control: see exactly what Google sees, and control what is
-- sent. Idempotent.
--
--   ai_batches + google_state, batch_stats, google_create_time,
--                google_update_time, last_polled_at, poll_status,
--                poll_error, state 'lost'
--                (Google's own words for each batch, saved every poll)
--   ai_batch_events          every message to / from Google, explained in
--                            plain English (KEEP: the paper trail)
--   ai_batch_send_lease      one sender at a time (fixes "11 / 4")
--   ai_batch_send_release
--   ai_batch_budget_spend    manual mode: one allowed batch used up

alter table public.ai_batches add column if not exists google_state text;
alter table public.ai_batches add column if not exists batch_stats jsonb;
alter table public.ai_batches add column if not exists google_create_time timestamptz;
alter table public.ai_batches add column if not exists google_update_time timestamptz;
alter table public.ai_batches add column if not exists last_polled_at timestamptz;
alter table public.ai_batches add column if not exists poll_status integer;
alter table public.ai_batches add column if not exists poll_error text;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.ai_batches'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%submitting%'
              and pg_get_constraintdef(oid) not like '%lost%'
  loop
    execute format('alter table public.ai_batches drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'ai_batches_state_check_s41') then
    alter table public.ai_batches add constraint ai_batches_state_check_s41
      check (state in ('submitting', 'pending', 'running', 'succeeded', 'failed', 'canceled', 'expired', 'ingesting', 'ingested', 'lost'));
  end if;
end $$;

create table if not exists public.ai_batch_events (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  batch_id    uuid references public.ai_batches (id) on delete set null,
  batch_name  text,
  kind        text not null check (kind in ('create', 'poll', 'cancel', 'delete', 'list', 'console', 'ingest', 'control', 'error')),
  http_status integer,
  google_state text,
  severity    text not null default 'info' check (severity in ('ok', 'info', 'warn', 'bad')),
  title       text not null,
  plain       text,
  fix         text,
  command     text,
  raw         text check (raw is null or length(raw) <= 40000),
  actor_email text
);

comment on table public.ai_batch_events is
  'R74 S41: every message to / from the Gemini Batch API, explained in plain English for Batch Mission Control.';

create index if not exists ai_batch_events_at_idx on public.ai_batch_events (at desc);
create index if not exists ai_batch_events_batch_idx on public.ai_batch_events (batch_id, at desc) where batch_id is not null;

alter table public.ai_batch_events enable row level security;
drop policy if exists "ai_batch_events staff read" on public.ai_batch_events;
create policy "ai_batch_events staff read" on public.ai_batch_events
  for select using (public.is_staff());

-- One sender at a time: a lease row in site_settings. Returns true when
-- p_holder now holds it (free, expired, or already its own).
create or replace function public.ai_batch_send_lease(p_holder text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean := false;
begin
  if p_holder is null or length(p_holder) = 0 or p_seconds is null or p_seconds < 5 or p_seconds > 900 then
    raise exception 'ai_batch_send_lease: bad arguments';
  end if;
  insert into public.site_settings (key, label, value_json, updated_at)
  values ('ai_batch_send_lease', 'AI batch lookups: the one sender allowed right now',
          jsonb_build_object('holder', p_holder, 'until', now() + make_interval(secs => p_seconds)), now())
  on conflict (key) do update
     set value_json = excluded.value_json, updated_at = now()
   where coalesce((public.site_settings.value_json ->> 'until')::timestamptz, '-infinity') < now()
      or public.site_settings.value_json ->> 'holder' = p_holder
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.ai_batch_send_release(p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.site_settings
     set value_json = jsonb_build_object('holder', null, 'until', now() - interval '1 second'), updated_at = now()
   where key = 'ai_batch_send_lease' and value_json ->> 'holder' = p_holder;
$$;

-- Manual mode: one allowed batch is used up (never below 0). Touches only
-- the budget key, so a Pause pressed at the same moment is never undone.
create or replace function public.ai_batch_budget_spend()
returns integer
language sql
security definer
set search_path = public
as $$
  update public.site_settings
     set value_json = jsonb_set(value_json, '{budget}', to_jsonb(greatest(0, coalesce((value_json ->> 'budget')::int, 0) - 1))), updated_at = now()
   where key = 'ai_batch_control'
  returning (value_json ->> 'budget')::int;
$$;

revoke all on function public.ai_batch_send_lease(text, integer) from public, anon, authenticated;
revoke all on function public.ai_batch_send_release(text) from public, anon, authenticated;
revoke all on function public.ai_batch_budget_spend() from public, anon, authenticated;
grant execute on function public.ai_batch_send_lease(text, integer) to service_role;
grant execute on function public.ai_batch_send_release(text) to service_role;
grant execute on function public.ai_batch_budget_spend() to service_role;

notify pgrst, 'reload schema';
