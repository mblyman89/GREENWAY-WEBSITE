-- ============================================================================
-- 0235 - ATTACHED FACTS + APPEND-ONLY FACT PROVENANCE (bible slice S08,
--        Phase 2, Ring 0)
--
-- WHY THIS EXISTS
-- ---------------
-- Nothing on a draft can hold what Gemini, the knowledge base or a person
-- told us about the product. catalog_product_drafts has no description,
-- effects, terpenes, lineage or image columns (bible F-030), so every
-- lookup result either dies in the browser or goes sideways into
-- ai_suggestions (F-014). There is also no trail of WHO or WHAT set a
-- product fact, and WHEN.
--
-- S06 made the lookup return one {value, confidence, sources} record per
-- field. This migration gives those records a home:
--
--   catalog_product_drafts.attached_facts             the facts married to
--   catalog_product_drafts.attached_facts_provenance  this draft (jsonb pair,
--                                                     owner decision D-07)
--   product_fact_provenance                           one immutable row per
--                                                     field per write, keyed
--                                                     by product identity
--
-- It follows the chosen_* doctrine (0141 / 0146 / 0218 / 0224, bible F-087):
-- human outranks machine, and the raw manifest values are never touched.
-- The facts live BESIDE the manifest columns, never over them.
--
-- WHAT THIS DOES
-- --------------
--   * Two nullable jsonb columns on catalog_product_drafts. No default, so
--     "never attached" (NULL) stays distinct from "attached nothing" ('{}').
--     On Postgres 11+ each add is a catalog-only change: no table rewrite.
--   * One new table, product_fact_provenance, that is APPEND-ONLY. A trigger
--     refuses UPDATE, DELETE and TRUNCATE.
--   * One index, (identity_key, field, created_at desc): "latest value of
--     field F for product P", the lookup S09 (recall before Gemini) needs.
--   * Row-level security ON with NO policy. Only the service role (server
--     code) can read or write it (0226 precedent).
--
-- No backfill and no change to existing rows. Nothing reads or writes these
-- columns or this table until S07 (attachProductFacts) and S11 (the
-- onboarding row). The app is byte-for-byte unchanged before and after this
-- file runs.
--
-- DECISIONS THAT DIFFER FROM THE WORDING OF THE S08 SPEC (all deliberate)
-- ----------------------------------------------------------------------
--   1. NO FOREIGN KEYS on the provenance table, not even kb_product_id.
--      - draft_id, lot_id: drafts and lots are WIPED by the factory reset,
--        and this table is KEPT (see 4). A kept row pointing at a wiped row
--        is exactly what tests/compliance/factory-reset-core.test.ts
--        ("no KEPT table points at a table that gets emptied") forbids.
--      - kb_product_id: an FK needs ON DELETE SET NULL or CASCADE, and both
--        rewrite provenance rows, which the append-only trigger refuses.
--        Deleting a knowledge-base product would then fail. The spec leaves
--        it a plain uuid, and so do we.
--      These columns are stamps, not links (0234 precedent). After a reset
--      or a KB delete they name a row that no longer exists, which is true.
--   2. APPEND-ONLY IS ENFORCED, not just promised. The spec title says
--      "append-only", and the trigger makes it so (gl_audit_events precedent,
--      0172:581-592, plus TRUNCATE). A correction is a NEW row with a newer
--      created_at. The index returns it first.
--   3. EXTRA CHECK CONSTRAINTS, so a bad writer fails loudly:
--        - identity_key must not be blank. 0234 doctrine: identity is never
--          ''. A fact about "no identity" is a fact about nothing.
--        - field must be a lowercase snake_case key, e.g. "description".
--        - confidence is 0..1 or NULL. That is the scale every other
--          confidence column in this schema uses (0018 ai_suggestions,
--          0071 kb_products, 0084 potency). The S06 lookup speaks 0-100,
--          so writers convert with toStoredConfidence()
--          (src/lib/catalog/attach-facts-core.ts). The check catches a
--          writer that forgot.
--        - created_at is NOT NULL.
--   4. FACTORY RESET: KEEP. These rows are knowledge about PRODUCTS (who
--      said the description of phat panda|flower|blue dream is X, and how
--      sure). That is the same kind of data as kb_* and product_enrichments,
--      which the reset keeps, and it is what S09 recalls instead of paying
--      for a new Gemini call. Wiping it would make the store forget every
--      decision a person made during testing. The rule lives in
--      src/lib/accounting/factory-reset-core.ts and can be flipped there if
--      the owner decides otherwise.
--
-- UNTIL IT IS APPLIED
-- -------------------
-- Nothing uses it yet, so nothing can break. When S07 starts writing, the
-- writers detect the missing column or table with isMissingAttachedFactsError()
-- (src/lib/catalog/attach-facts-core.ts) and carry on without it.
--
-- APPLIED BY HAND (AGENTS rule 6). Safe to re-run: add column if not exists,
-- create table / index if not exists, create or replace function,
-- drop trigger if exists + create trigger, comment (idempotent by nature).
-- ============================================================================

-- -- 0. Refuse politely if an earlier migration is missing ------------------
do $precheck$
begin
  if to_regclass('public.catalog_product_drafts') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0235 alters public.catalog_product_drafts, created by 0026_pos_catalog_drafts.sql. Run the earlier migrations first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'catalog_product_drafts'
       and column_name = 'identity_key'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0235 depends on the product identity added by 0234_product_identity.sql (slice S04). Run 0234 first.';
  end if;
end
$precheck$;

-- -- 1. The facts married to a draft ----------------------------------------
alter table public.catalog_product_drafts
  add column if not exists attached_facts            jsonb,
  add column if not exists attached_facts_provenance jsonb;

comment on column public.catalog_product_drafts.attached_facts is
  '0235 / S08: Per-field facts married at onboarding: {field:{value, source, confidence, at}}. Human > coa/manifest > kb_published > gemini(auto >=90) > gemini(review). Raw manifest values untouched. NULL = nothing attached yet (not the same as {}). confidence is 0..1. Written only by attachProductFacts() (S07).';

comment on column public.catalog_product_drafts.attached_facts_provenance is
  '0235 / S08: who/what/when behind each attached fact: {field:{source, confidence, at, by, urls}}. source uses the product_fact_provenance vocabulary. Same doctrine as chosen_classification_provenance (0218): the value and the story of how it came to exist are kept apart so a human answer is never mistaken for a machine default. The full, immutable history is in product_fact_provenance.';

-- -- 2. The immutable trail ----------------------------------------------------
create table if not exists public.product_fact_provenance (
  id              uuid primary key default gen_random_uuid(),
  identity_key    text not null,
  kb_product_id   uuid,
  draft_id        uuid,
  lot_id          uuid,
  pos_product_key text,
  field           text not null,
  value_json      jsonb,
  source          text not null,
  confidence      numeric,
  source_urls     text[],
  actor_id        uuid,
  created_at      timestamptz not null default now(),
  constraint pfp_source_known check (source in (
    'manifest', 'coa', 'kb_published', 'kb_draft', 'gemini', 'human', 'remembered', 'cultivera'
  )),
  constraint pfp_identity_not_blank check (btrim(identity_key) <> ''),
  constraint pfp_field_key check (field ~ '^[a-z][a-z0-9_]*$'),
  constraint pfp_confidence_unit check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists idx_pfp_identity
  on public.product_fact_provenance (identity_key, field, created_at desc);

comment on table public.product_fact_provenance is
  '0235 / S08: APPEND-ONLY trail of every product fact written by attachProductFacts() (S07): one row per field per write. UPDATE, DELETE and TRUNCATE are refused by trigger, and a correction is a new row. kb_product_id / draft_id / lot_id / actor_id are stamps, not foreign keys (drafts and lots are wiped by the factory reset, this table is kept). Service role only.';

comment on column public.product_fact_provenance.identity_key is
  '0235 / S08: the S03 product identity (vendor|categoryAxis|family), never blank. The recall key: latest row per (identity_key, field) wins.';

comment on column public.product_fact_provenance.source is
  '0235 / S08: manifest | coa | kb_published | kb_draft | gemini | human | remembered | cultivera. human = a person answered cold. remembered = a person confirmed their own earlier answer (0220 doctrine).';

comment on column public.product_fact_provenance.confidence is
  '0235 / S08: 0..1, the same scale as ai_suggestions / kb_products. NULL when the source carries no confidence (human, manifest). The S06 lookup reports 0-100, so writers divide by 100.';

-- -- 3. Append-only, enforced -------------------------------------------------
create or replace function public.product_fact_provenance_append_only()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  raise exception 'PROVENANCE_IMMUTABLE: product_fact_provenance is append-only. Write a new row instead of changing history.'
    using errcode = 'raise_exception';
end
$fn$;

drop trigger if exists trg_pfp_append_only on public.product_fact_provenance;
create trigger trg_pfp_append_only
  before update or delete on public.product_fact_provenance
  for each row execute function public.product_fact_provenance_append_only();

drop trigger if exists trg_pfp_no_truncate on public.product_fact_provenance;
create trigger trg_pfp_no_truncate
  before truncate on public.product_fact_provenance
  for each statement execute function public.product_fact_provenance_append_only();

-- -- 4. Service role only ------------------------------------------------------
-- RLS on with NO permissive policy: anon and authenticated get nothing. The
-- only writer (S07) and readers (S09, S11) run on the server.
alter table public.product_fact_provenance enable row level security;
revoke all on public.product_fact_provenance from anon, authenticated;
revoke all on function public.product_fact_provenance_append_only() from public;
