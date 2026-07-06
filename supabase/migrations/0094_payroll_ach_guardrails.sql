-- =============================================================================
-- 0094 — Payroll ACH guardrails (source-document requirement + cadence + dual control)
-- =============================================================================
-- Owner's request (verbatim, item 3): "I need you to make sure that there are
-- guardrails in place for payroll ach payments. I will upload the payroll data
-- I want to pay employees and then the system reads it then makes it so only one
-- payment to one employee every two weeks and no more than one check per two
-- week period. I want the system to block payments unless there is a source
-- document to tie it to."
--
-- Plus expert, research-backed controls required of ACH ORIGINATORS by the
-- Nacha 2026 Risk Management Rules (fraud monitoring must be risk-based &
-- layered; RMAG best practices): DUAL CONTROL (creator ≠ releaser), RED-FLAG
-- reporting (amount ceilings, new/changed bank account, duplicate detection),
-- and ACCOUNT VALIDATION (already enforced via routing mod-10 in code).
--
-- This migration adds:
--   1. payroll_source_documents — the uploaded payroll data (paystub export,
--      Sage register, PDF, CSV, etc.) that a run must be tied to. Stores a
--      content hash so the same file can be recognized / not double-used.
--   2. payroll_runs columns:
--        - source_document_id  → FK: the file this run is tied to (REQUIRED to
--          generate; the app blocks generation when null).
--        - approved_by / approved_at → dual control: who released the file.
--        - guardrail_override / guardrail_override_reason / guardrail_override_by
--          → an admin may consciously override a soft warning; always recorded.
--
-- Money stays in CENTS. Idempotent: add column if not exists, create table if
-- not exists, drop policy/trigger if exists. Apply MANUALLY in the Supabase SQL
-- editor AFTER 0093.
-- =============================================================================

-- ---------- payroll_source_documents ----------------------------------------
-- The "payroll data I want to pay employees" the owner uploads. A run must be
-- tied to one of these before an ACH file can be generated.
create table if not exists public.payroll_source_documents (
  id             uuid primary key default gen_random_uuid(),
  -- Human label + original file name.
  label          text,
  file_name      text not null,
  mime_type      text,
  byte_size      bigint,
  -- Where the file lives (Supabase Storage path or external ref) — optional so
  -- a metadata-only record is still valid if the file is stored elsewhere.
  storage_path   text,
  -- SHA-256 of the file contents (hex). Lets us recognise the same upload and
  -- refuse to silently reuse one file for two different pay periods.
  content_sha256 text,
  -- The pay period the document covers (owner-entered), used by the cadence
  -- guardrail so "one check per two-week period" can be checked by period.
  period_start   date,
  period_end     date,
  notes          text,
  uploaded_by    uuid references public.staff_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists payroll_source_documents_created_idx
  on public.payroll_source_documents (created_at desc);
create index if not exists payroll_source_documents_hash_idx
  on public.payroll_source_documents (content_sha256);

-- ---------- payroll_runs: guardrail columns ----------------------------------
alter table public.payroll_runs
  -- The uploaded source document this run is tied to. Generation is BLOCKED in
  -- the app when this is null ("block payments unless there is a source
  -- document to tie it to"). Kept nullable at the DB level so a draft run can
  -- exist before the document is attached; the enforcement lives in the app so
  -- it can give a friendly message.
  add column if not exists source_document_id uuid
        references public.payroll_source_documents(id) on delete set null,
  -- Dual control: the file must be released by an admin. approved_by is the
  -- releaser; when it equals created_by that is a logged self-approval.
  add column if not exists approved_by uuid
        references public.staff_profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  -- Conscious override of a SOFT guardrail warning (e.g. amount over the usual
  -- ceiling). Hard blocks (missing source doc, cadence collision) cannot be
  -- overridden. Always recorded for the audit trail.
  add column if not exists guardrail_override boolean not null default false,
  add column if not exists guardrail_override_reason text,
  add column if not exists guardrail_override_by uuid
        references public.staff_profiles(id) on delete set null;

create index if not exists payroll_runs_source_doc_idx
  on public.payroll_runs (source_document_id);

-- ---------- updated_at trigger ----------------------------------------------
drop trigger if exists trg_payroll_source_documents_updated on public.payroll_source_documents;
create trigger trg_payroll_source_documents_updated before update on public.payroll_source_documents
  for each row execute function public.set_updated_at();

-- ---------- RLS --------------------------------------------------------------
alter table public.payroll_source_documents enable row level security;

-- Payroll is sensitive: admin-only, matching payroll_runs / payroll_run_lines.
drop policy if exists payroll_source_documents_admin on public.payroll_source_documents;
create policy payroll_source_documents_admin on public.payroll_source_documents
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- column comments (self-documenting) -------------------------------
comment on table public.payroll_source_documents is
  'Uploaded payroll data (Sage register / paystub export / CSV / PDF) a payroll run must be tied to before an ACH file can be generated. Enforced in the app.';
comment on column public.payroll_runs.source_document_id is
  'Required before generating the ACH file. The app blocks generation when null.';
comment on column public.payroll_runs.approved_by is
  'Dual control: the admin who released the file. Equal to created_by = logged self-approval.';
comment on column public.payroll_runs.guardrail_override is
  'True when an admin consciously overrode a SOFT guardrail warning. Hard blocks cannot be overridden.';
