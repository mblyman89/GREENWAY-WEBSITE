-- =============================================================================
-- Migration 0010 — Content block revision history
-- =============================================================================
-- An append-only history of every PUBLISHED value of a content block, so staff
-- can see what changed, who changed it, and restore any previous version with
-- one click. We snapshot on publish (the value that goes live) — drafts are
-- transient and not worth versioning. Keeping this separate from content_blocks
-- means restoring is just "copy this revision's value into draft_value".
--
-- One row per publish event. Newest first via the created_at index.
-- =============================================================================

create table if not exists public.content_revisions (
  id              uuid primary key default gen_random_uuid(),
  block_key       text not null,                        -- references content_blocks.block_key (logical FK; blocks are seeded)
  value           text not null,                        -- the value that was published at this point in time
  field_type      text,                                 -- snapshot of the block's field_type for safe rendering
  label           text,                                 -- snapshot of the human label (so history reads nicely even if a block is renamed)
  note            text,                                 -- optional short note, e.g. "Restored v3", "Holiday hours"
  actor_id        uuid references public.staff_profiles(id) on delete set null,
  actor_email     text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_content_rev_block   on public.content_revisions(block_key, created_at desc);
create index if not exists idx_content_rev_created on public.content_revisions(created_at desc);

-- =============================================================================
-- Row-Level Security — staff only (internal operational data).
-- =============================================================================
alter table public.content_revisions enable row level security;

drop policy if exists content_rev_staff_all on public.content_revisions;
create policy content_rev_staff_all on public.content_revisions
  for all using (public.is_staff()) with check (public.is_staff());
