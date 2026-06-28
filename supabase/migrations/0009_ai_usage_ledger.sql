-- =============================================================================
-- Migration 0009 — AI usage ledger
-- =============================================================================
-- A lightweight, append-only log of every AI generation call the back office
-- makes. Gives the owner cost visibility ("how much AI are we using and where")
-- without any third-party analytics. One row per generate() call.
--
-- Tokens are best-effort: when the provider returns usage we store the real
-- numbers; otherwise we store a rough character-based estimate so trends are
-- still meaningful. Never stores customer PII — only a short, scrubbed summary
-- of what feature invoked it.
-- =============================================================================

create table if not exists public.ai_usage (
  id              uuid primary key default gen_random_uuid(),
  feature         text not null,                       -- e.g. product.description | vendor.profile | media.alt_text | blog.write
  entity_type     text,                                -- product | vendor | brand | media | blog | content | seo | promotion | null
  entity_id       text,
  model           text,                                -- provider/model id
  prompt_tokens   integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens    integer not null default 0,
  estimated       boolean not null default true,       -- true when token counts are a heuristic, not provider-reported
  ok              boolean not null default true,        -- false when the call errored
  error_note      text,                                 -- short error message when ok=false
  actor_id        uuid references public.staff_profiles(id) on delete set null,
  actor_email     text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_usage_created on public.ai_usage(created_at desc);
create index if not exists idx_ai_usage_feature on public.ai_usage(feature);
create index if not exists idx_ai_usage_actor   on public.ai_usage(actor_id);

-- =============================================================================
-- Row-Level Security — staff only (internal operational data).
-- =============================================================================
alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_staff_all on public.ai_usage;
create policy ai_usage_staff_all on public.ai_usage
  for all using (public.is_staff()) with check (public.is_staff());
