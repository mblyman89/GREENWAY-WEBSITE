-- =============================================================================
-- 0015 — FAQ items (database-backed Q&A with draft/publish)
-- =============================================================================
-- Replaces the static src/content/faq.ts list with an editable, ordered set of
-- Q&A rows a non-technical employee manages from Admin → Pages → FAQ. Follows
-- the carousel / page_sections gold-standard pattern:
--   - published columns (question / answer) + draft_* mirror columns
--   - status (post_status) + enabled + draft_enabled
--   - sort_order for drag-style reorder
--   - is_staff() staff-all RLS + public read of published+enabled rows
--
-- The public FAQ page reads published+enabled rows and falls back to the static
-- committed list when the table is empty (zero-blank guarantee). Staff preview
-- (Draft Mode) shows draft values + draft-enabled rows.
--
-- Reuses: public.post_status, public.set_updated_at(), public.is_staff(),
--         public.staff_profiles.
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

create table if not exists public.faq_items (
  id               uuid primary key default gen_random_uuid(),
  sort_order       integer not null default 0,
  status           public.post_status not null default 'published',
  enabled          boolean not null default true,
  draft_enabled    boolean not null default true,
  locked           boolean not null default false,

  -- Published (live) content.
  question         text,
  answer           text,

  -- Draft (staff preview) mirror.
  draft_question   text,
  draft_answer     text,

  -- Provenance.
  last_edited_by   uuid references public.staff_profiles(id) on delete set null,
  published_by     uuid references public.staff_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_faq_items_sort on public.faq_items(sort_order asc);
create index if not exists idx_faq_items_status on public.faq_items(status);

-- updated_at trigger
drop trigger if exists trg_faq_items_updated_at on public.faq_items;
create trigger trg_faq_items_updated_at
  before update on public.faq_items
  for each row execute function public.set_updated_at();

-- RLS
alter table public.faq_items enable row level security;

drop policy if exists faq_items_staff_all on public.faq_items;
create policy faq_items_staff_all on public.faq_items
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists faq_items_public_read on public.faq_items;
create policy faq_items_public_read on public.faq_items
  for select using (status = 'published' and enabled = true);
