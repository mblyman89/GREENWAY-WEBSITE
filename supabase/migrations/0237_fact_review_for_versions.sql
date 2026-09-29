-- =============================================================================
-- 0237 - Fact review for products that arrive by receiving (S30)
-- =============================================================================
-- WHY
-- The fact-review decision log (pos_fact_reviews, 0139) could only record a
-- decision against a POS spreadsheet import: import_id was NOT NULL and
-- pointed at pos_imports. A product that arrives by RECEIVING has no
-- pos_imports row at all, so when the word-by-word extraction engine could
-- not verify a fact on it, the menu update was held (intake-menu-staging.ts,
-- menu_publish_held_for_fact_review) and there was nowhere to say
-- "I checked it" - the hold had no exit except publishing by hand
-- (bible S30, findings F-094, F-095, F-118).
--
-- WHAT THIS FILE DOES (additive only, existing rows are untouched)
--   1. import_id becomes nullable.
--   2. manifest_id (the delivery the product came in on) is added, with
--      on delete cascade, so a decision lives exactly as long as its delivery.
--      Keying by delivery + lot key (source_item_id) means a decision SURVIVES
--      every re-built menu update of that delivery.
--   3. draft_id (the Product Onboarding row the decision was made on) is
--      added for the audit trail, set null if the draft is ever deleted.
--   4. flag_signature records WHICH flagged facts the human looked at. When
--      the facts change later the old decision no longer counts and the owner
--      is asked again - a decision is never silently re-used for a different
--      question.
--   5. Exactly one scope per row: an import OR a delivery, never both,
--      never neither (pos_fact_reviews_one_scope).
--   6. One decision per delivery + lot key, as a real UNIQUE constraint (not
--      a partial index) so the server can upsert with on_conflict. NULLs are
--      distinct in a unique constraint, so the existing import-scoped rows
--      (manifest_id null) can never collide with each other or with this key.
--
-- UNTIL IT IS RUN nothing breaks. Held receiving updates keep the current
-- behaviour (publish by hand under Admin, Publish Menu), and the Product
-- Onboarding page says this migration is what turns the inline fix on.
--
-- Depends on 0139 (pos_fact_reviews), 0023 (inbound_manifests) and
-- 0026 (catalog_product_drafts). Safe to re-run.
-- ROLLBACK: supabase/rollbacks/0237_fact_review_for_versions.rollback.sql
-- =============================================================================

do $precheck$
begin
  if to_regclass('public.pos_fact_reviews') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0237 depends on pos_fact_reviews from 0139_fact_review_queue.sql';
  end if;
  if to_regclass('public.inbound_manifests') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0237 depends on inbound_manifests from 0023_pos_inventory_lots.sql';
  end if;
  if to_regclass('public.catalog_product_drafts') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0237 depends on catalog_product_drafts from 0026_pos_catalog_drafts.sql';
  end if;
end
$precheck$;

alter table public.pos_fact_reviews
  alter column import_id drop not null;

alter table public.pos_fact_reviews
  add column if not exists manifest_id uuid references public.inbound_manifests(id) on delete cascade;

alter table public.pos_fact_reviews
  add column if not exists draft_id uuid references public.catalog_product_drafts(id) on delete set null;

alter table public.pos_fact_reviews
  add column if not exists flag_signature text;

alter table public.pos_fact_reviews
  drop constraint if exists pos_fact_reviews_one_scope;
alter table public.pos_fact_reviews
  add constraint pos_fact_reviews_one_scope check (num_nonnulls(import_id, manifest_id) = 1);

alter table public.pos_fact_reviews
  drop constraint if exists pos_fact_reviews_manifest_item_key;
alter table public.pos_fact_reviews
  add constraint pos_fact_reviews_manifest_item_key unique (manifest_id, source_item_id);

comment on column public.pos_fact_reviews.manifest_id is
  '0237 / S30: the delivery a receiving-origin decision belongs to (import_id is null on these rows).';
comment on column public.pos_fact_reviews.draft_id is
  '0237 / S30: the Product Onboarding draft the decision was made on (audit trail).';
comment on column public.pos_fact_reviews.flag_signature is
  '0237 / S30: which flagged facts the reviewer decided on. A changed flag is asked again.';
