-- =============================================================================
-- 0065 — Marketing & Advertising: saved AI strategy ideas (drafts-only)
-- =============================================================================
-- E1 (Marketing & Advertising page). The Marketing page gives the owner a
-- GPT-4o "compliant strategy" assistant: type a goal (e.g. "grow our newsletter
-- list", "promote our new vendor drop") and get a WA I-502 / DOH-compliant
-- marketing strategy DRAFT grounded in the store's real brand context. The
-- owner can SAVE useful ideas here to revisit, refine, and action later.
--
-- These are DRAFTS ONLY. Nothing here is published or sent anywhere; it is a
-- private idea notebook. The AI output always passes through the existing WA
-- advertising compliance scanner (checkCompliance) before being shown/saved,
-- and every saved idea records the model + a compliance snapshot for audit.
--
-- Amounts: none here (strategy text only). No PII.
--
-- Idempotent: create if not exists + drop policy if exists. Apply MANUALLY in
-- the Supabase SQL editor.
-- =============================================================================

create table if not exists public.marketing_ideas (
  id                 uuid primary key default gen_random_uuid(),
  -- The employee's short goal/prompt that produced this idea.
  goal               text not null default '',
  -- Optional channel focus tag ("newsletter" | "in-store" | "website" | "social" | "general").
  channel            text not null default 'general',
  -- A short human title (defaults from the goal; editable).
  title              text not null default '',
  -- The AI strategy draft (markdown-ish plain text).
  body               text not null default '',
  -- Lifecycle so the owner can triage the notebook.
  status             text not null default 'idea'
                       check (status in ('idea', 'planned', 'done', 'archived')),
  -- Provenance / audit: which model wrote it and whether it passed the scan.
  ai_model           text,
  -- Compliance snapshot at save time: false only if a BLOCKING flag was present
  -- (blocking drafts are never saved, but we record the outcome for the audit trail).
  compliance_ok      boolean not null default true,
  compliance_flags   text[]  not null default '{}',
  -- Free-form notes the owner adds while refining.
  notes              text,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  updated_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists marketing_ideas_status_idx  on public.marketing_ideas (status);
create index if not exists marketing_ideas_channel_idx  on public.marketing_ideas (channel);
create index if not exists marketing_ideas_created_idx  on public.marketing_ideas (created_at desc);

-- ---------- RLS: staff read, admins (or content managers) write -------------
alter table public.marketing_ideas enable row level security;

drop policy if exists marketing_ideas_read on public.marketing_ideas;
create policy marketing_ideas_read on public.marketing_ideas
  for select using (public.is_staff());

drop policy if exists marketing_ideas_write on public.marketing_ideas;
create policy marketing_ideas_write on public.marketing_ideas
  for all using (public.is_staff()) with check (public.is_staff());

comment on table public.marketing_ideas is
  'E1: private notebook of WA-compliant AI marketing strategy DRAFTS. Drafts-only; nothing here is published or sent. Each row records the model and a compliance snapshot.';
