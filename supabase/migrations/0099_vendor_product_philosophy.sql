-- 0099: vendors.product_philosophy — give vendors the same product-philosophy
-- field brands have had since 0003.
--
-- WHY: the crawler legitimately finds product-philosophy copy on vendor sites
-- (e.g. a producer/processor's "our rosin" / "our process" pages). Until now
-- vendors had no column to accept it into, so the review UI could only show
-- the draft as reference (Dismiss-only — the owner hit exactly this on the
-- Constellation Cannabis harvest). With the column present, the standard
-- accept flow (compliance re-scan gate + audit) can write it like any other
-- profile field.
--
-- Idempotent + zero-risk: adds a nullable text column only. No backfill, no
-- RLS change (vendors policies already cover all columns), no index needed.

alter table public.vendors
  add column if not exists product_philosophy text;

comment on column public.vendors.product_philosophy is
  'How this vendor approaches/makes their products (sensory/process copy, no medical claims). Same semantics as brands.product_philosophy.';
