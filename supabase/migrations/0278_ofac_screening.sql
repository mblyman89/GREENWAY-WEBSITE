-- =============================================================================
-- Migration 0278 - R41 S11: OFAC sanctions screening of payees (append-only)
-- =============================================================================
-- Plan: R41 S11. The signed Timberland ACH agreement, section 3: "It shall be
-- the responsibility of Company to obtain information regarding such OFAC
-- enforced sanctions." The app screens every payee (employees and vendors)
-- against OFAC's SDN and Consolidated lists every day, and keeps the record.
--
-- NEVER A PAYMENT GATE (owner, round 12: "Strict is fine with me so long as it
-- doesn't block me from paying my vendors and employees"). Nothing here is
-- read by payroll, the vendor file builder or the ACH file checker. A possible
-- match is an item for the owner to review (OFAC FAQ 5: "Many potential
-- matches identified through screening are false positives."), shown on the
-- Sanctions screening page and emailed.
--
--   ofac_screening_runs     one row per screen (daily cron or "Screen now").
--     status ok|failed      a failed run says why (download, format) and has
--                           no results.
--     list_sha256           sha256 over the four files' sha256 values.
--     files                 per file: sha256, bytes, records, last_modified.
--     digest_verified       OFAC's published Digest for SDN.CSV matched.
--     payees_sha256         fingerprint of the payee names screened.
--   ofac_screening_results  one row per payee per ok run: the names screened,
--                           clear or possible_match, the best score and up to
--                           10 list entries (jsonb). clear <=> no matches.
--   ofac_match_reviews      the owner's decision on one possible match:
--                           not_a_match or true_match, with a 20-2000
--                           character note (no run of 7+ digits). Once per
--                           result (ofac_reviews_once). OWNER only
--                           (ach_write_by_owner, 0271); an admin's review is
--                           a request for the owner (achGate kind
--                           ofac_review.record).
--   ofac_record_run(jsonb, jsonb)  writes a run and its results in ONE
--                           transaction (never a run with half its results).
--
-- All three tables: never updated, never deleted (OFAC_APPEND_ONLY). FAQ 5:
-- "Organizations should keep complete, accurate records detailing the steps
-- taken to investigate the potential match".
-- Add-only: three tables, two trigger functions, one recording function; the
-- only change to an existing object is the 0277 ach_change_requests
-- target_type list, which gains 'ofac_review'. Not security definer.
-- Idempotent. Apply MANUALLY (standing rule), AFTER 0277.
-- Rollback: supabase/rollbacks/0278_ofac_screening.rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.ofac_screening_runs (
  id                  uuid primary key default gen_random_uuid(),
  ran_at              timestamptz not null default now(),
  trigger             text not null check (trigger in ('cron', 'manual')),
  created_by          uuid references public.staff_profiles (id) on delete restrict,
  status              text not null check (status in ('ok', 'failed')),
  error               text check (error is null or length(error) between 1 and 1000),
  list_last_modified  text check (list_last_modified is null or length(list_last_modified) <= 100),
  list_sha256         text check (list_sha256 is null or list_sha256 ~ '^[0-9a-f]{64}$'),
  files               jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  digest_verified     boolean not null default false,
  payees_sha256       text check (payees_sha256 is null or payees_sha256 ~ '^[0-9a-f]{64}$'),
  payees_count        integer not null default 0 check (payees_count >= 0),
  possible_matches    integer not null default 0 check (possible_matches >= 0),
  unscreenable        integer not null default 0 check (unscreenable >= 0),
  threshold           numeric(5,4) not null check (threshold > 0 and threshold <= 1),
  constraint osr_manual_has_actor check (trigger <> 'manual' or created_by is not null),
  constraint osr_failed_has_error check ((status = 'failed') = (error is not null)),
  constraint osr_ok_has_lists check (status <> 'ok' or (list_sha256 is not null and payees_sha256 is not null))
);
create index if not exists osr_ran_idx on public.ofac_screening_runs (ran_at desc);

create table if not exists public.ofac_screening_results (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.ofac_screening_runs (id) on delete restrict,
  payee_type      text not null check (payee_type in ('employee', 'vendor')),
  payee_id        uuid not null,
  label           text not null check (length(label) between 1 and 300),
  names_screened  text[] not null check (cardinality(names_screened) between 1 and 20),
  result          text not null check (result in ('clear', 'possible_match')),
  top_score       numeric(5,4) not null check (top_score >= 0 and top_score <= 1),
  matches         jsonb not null default '[]'::jsonb check (jsonb_typeof(matches) = 'array' and jsonb_array_length(matches) <= 10),
  created_at      timestamptz not null default now(),
  constraint osres_clear_shape check ((result = 'clear') = (jsonb_array_length(matches) = 0)),
  constraint osres_once_per_run unique (run_id, payee_type, payee_id)
);
create index if not exists osres_payee_idx on public.ofac_screening_results (payee_type, payee_id, created_at desc);

create table if not exists public.ofac_match_reviews (
  id          uuid primary key default gen_random_uuid(),
  result_id   uuid not null references public.ofac_screening_results (id) on delete restrict,
  payee_type  text not null check (payee_type in ('employee', 'vendor')),
  payee_id    uuid not null,
  decision    text not null check (decision in ('not_a_match', 'true_match')),
  match_keys  text[] not null check (cardinality(match_keys) between 1 and 10),
  note        text not null,
  created_by  uuid not null references public.staff_profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  constraint ofac_reviews_once unique (result_id)
);
create index if not exists omr_payee_idx on public.ofac_match_reviews (payee_type, payee_id);

comment on table public.ofac_screening_runs is
  'R41 S11 (0278): one OFAC screen of every payee. Append-only. Never read by payroll or the vendor file builder: screening never blocks a payment.';
comment on table public.ofac_screening_results is
  'R41 S11 (0278): one payee in one screen: clear, or a possible match with up to 10 OFAC list entries. Append-only.';
comment on table public.ofac_match_reviews is
  'R41 S11 (0278): the owner''s recorded decision on a possible match (OFAC FAQ 5 records). Append-only, owner-stamped, once per result.';

-- -----------------------------------------------------------------------------
-- 2. Guards: append-only everywhere; a result belongs to an ok run; a review is
--    the owner's, of a possible match, for that same payee, with a real note
-- -----------------------------------------------------------------------------
create or replace function public.ofac_screening_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  run_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';
  end if;
  if tg_table_name = 'ofac_screening_results' then
    select status into run_status from public.ofac_screening_runs where id = new.run_id;
    if run_status is distinct from 'ok' then
      raise exception 'OFAC_RESULT_RUN: results belong to a successful screen only.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ofac_screening_runs_guard on public.ofac_screening_runs;
create trigger trg_ofac_screening_runs_guard
  before insert or update or delete on public.ofac_screening_runs
  for each row execute function public.ofac_screening_guard();
drop trigger if exists trg_ofac_screening_results_guard on public.ofac_screening_results;
create trigger trg_ofac_screening_results_guard
  before insert or update or delete on public.ofac_screening_results
  for each row execute function public.ofac_screening_guard();

-- TRUNCATE skips row triggers; refuse it with a statement trigger.
create or replace function public.ofac_screening_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';
end $$;

drop trigger if exists trg_ofac_runs_no_truncate on public.ofac_screening_runs;
create trigger trg_ofac_runs_no_truncate before truncate on public.ofac_screening_runs
  for each statement execute function public.ofac_screening_no_truncate();
drop trigger if exists trg_ofac_results_no_truncate on public.ofac_screening_results;
create trigger trg_ofac_results_no_truncate before truncate on public.ofac_screening_results
  for each statement execute function public.ofac_screening_no_truncate();
drop trigger if exists trg_ofac_reviews_no_truncate on public.ofac_match_reviews;
create trigger trg_ofac_reviews_no_truncate before truncate on public.ofac_match_reviews
  for each statement execute function public.ofac_screening_no_truncate();

create or replace function public.ofac_match_reviews_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';
  end if;
  if not public.ach_write_by_owner(new.created_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner records a screening review. Send it as a request for owner approval.';
  end if;
  select payee_type, payee_id, result into target from public.ofac_screening_results where id = new.result_id;
  if not found or target.result <> 'possible_match' then
    raise exception 'OFAC_REVIEW_TARGET: the result was not found or is not a possible match.';
  end if;
  if target.payee_type <> new.payee_type or target.payee_id <> new.payee_id then
    raise exception 'OFAC_REVIEW_TARGET: the review must name the same payee as the result.';
  end if;
  if length(regexp_replace(btrim(new.note), '\s+', ' ', 'g')) not between 20 and 2000 or new.note ~ '[0-9]{7,}' then
    raise exception 'OFAC_REVIEW_NOTE: the note must be 20 to 2,000 characters with no run of 7 or more digits.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ofac_match_reviews_guard on public.ofac_match_reviews;
create trigger trg_ofac_match_reviews_guard
  before insert or update or delete on public.ofac_match_reviews
  for each row execute function public.ofac_match_reviews_guard();

-- -----------------------------------------------------------------------------
-- 3. One transaction for a run and its results
-- -----------------------------------------------------------------------------
create or replace function public.ofac_record_run(p_run jsonb, p_results jsonb)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  run_id uuid;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'OFAC_RECORD_RUN: results must be a JSON array.';
  end if;
  insert into public.ofac_screening_runs (trigger, created_by, status, error, list_last_modified, list_sha256, files,
                                          digest_verified, payees_sha256, payees_count, possible_matches, unscreenable, threshold)
  values (p_run->>'trigger', nullif(p_run->>'created_by', '')::uuid, p_run->>'status', p_run->>'error',
          p_run->>'list_last_modified', p_run->>'list_sha256', coalesce(p_run->'files', '[]'::jsonb),
          coalesce((p_run->>'digest_verified')::boolean, false), p_run->>'payees_sha256',
          coalesce((p_run->>'payees_count')::int, 0), coalesce((p_run->>'possible_matches')::int, 0),
          coalesce((p_run->>'unscreenable')::int, 0), (p_run->>'threshold')::numeric)
  returning id into run_id;
  insert into public.ofac_screening_results (run_id, payee_type, payee_id, label, names_screened, result, top_score, matches)
  select run_id, r.payee_type, r.payee_id, r.label, r.names_screened, r.result, r.top_score, coalesce(r.matches, '[]'::jsonb)
  from jsonb_to_recordset(p_results) as r(payee_type text, payee_id uuid, label text, names_screened text[], result text, top_score numeric, matches jsonb);
  return run_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. 0271 request target: a review (an admin's review waits for the owner)
-- -----------------------------------------------------------------------------
alter table public.ach_change_requests drop constraint if exists ach_change_requests_target_type_check;
alter table public.ach_change_requests add constraint ach_change_requests_target_type_check
  check (target_type in ('vendor', 'employee', 'authorization', 'account', 'verification',
                         'notice', 'document', 'contact', 'invite', 'payroll_run',
                         'company', 'vendor_payment', 'ach_file', 'timberland_comms', 'ofac_review'));

-- -----------------------------------------------------------------------------
-- 5. RLS and grants (same pattern as 0277)
-- -----------------------------------------------------------------------------
alter table public.ofac_screening_runs enable row level security;
alter table public.ofac_screening_results enable row level security;
alter table public.ofac_match_reviews enable row level security;

drop policy if exists ofac_screening_runs_admin_read on public.ofac_screening_runs;
create policy ofac_screening_runs_admin_read on public.ofac_screening_runs for select using (public.is_admin());
drop policy if exists ofac_screening_results_admin_read on public.ofac_screening_results;
create policy ofac_screening_results_admin_read on public.ofac_screening_results for select using (public.is_admin());
drop policy if exists ofac_match_reviews_admin_read on public.ofac_match_reviews;
create policy ofac_match_reviews_admin_read on public.ofac_match_reviews for select using (public.is_admin());

-- Least privilege: anon nothing; authenticated select (admins by RLS);
-- service_role select and insert only (no update, no delete, no truncate).
revoke all on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews from anon;
revoke all on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews from authenticated;
grant select on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews to authenticated;
revoke update, delete, truncate on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews from service_role;
grant select, insert on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews to service_role;

revoke all on function public.ofac_screening_guard() from public, anon, authenticated;
revoke all on function public.ofac_screening_no_truncate() from public, anon, authenticated;
revoke all on function public.ofac_match_reviews_guard() from public, anon, authenticated;
revoke all on function public.ofac_record_run(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ofac_record_run(jsonb, jsonb) to service_role;
