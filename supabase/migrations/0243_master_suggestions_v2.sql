-- ============================================================================
-- 0243 - MASTER SUGGESTIONS v2 (bible slice S36, Phase 8, Ring 1)
--
-- WHY THIS EXISTS
-- ---------------
-- The Product Masters "Suggestions" tab used to give every deterministic
-- suggestion the same constant confidence (0.97 / 0.9) and the reason
-- "Same brand, category, and product name". It could not say WHY two cards
-- looked alike, it never counted evidence AGAINST a match (same size twice,
-- different market), and "Reject" only marked that one suggestion row: the
-- next "Generate suggestions" proposed the same cards again (bible F-129,
-- F-130).
--
-- S36 scores every candidate pair with explainable Fellegi-Sunter weights
-- (src/lib/products/match-weights-core.ts). This migration gives that score
-- somewhere to live and makes a rejection stick:
--
--   * product_master_suggestions.evidence_json - the per-field waterfall
--     ("+1.7 same vendor  +6.3 same strain (verified)  -2.6 same size twice"),
--     the band, the probability, and every member pair's fingerprint.
--
--   * product_master_pair_decisions - ONE row per rejected PAIR of menu
--     cards, with a fingerprint of the critical attributes of both cards
--     (vendor, brand, strain, market, sizes). Generation skips a pair while
--     its stored fingerprint still matches; when either card changes one of
--     those attributes the fingerprint differs and the pair is proposed
--     again (Reltio-style "not a match" that re-opens on change).
--
-- WHAT THIS DOES
-- --------------
--   * One nullable jsonb column on product_master_suggestions.
--   * One new table, primary key (key_a, key_b) with key_a < key_b compared
--     in byte order (collate "C") - the app orders the keys the same way
--     (compareKeys in match-weights-core.ts), so a pair has exactly one row.
--   * decision is 'not_a_match' only (the one decision S36 records).
--   * decided_by -> staff_profiles ON DELETE SET NULL (staff_profiles is
--     KEPT by the factory reset, so the link never dangles).
--   * Row-level security ON with NO policy: only the service role (server
--     code behind requirePermission('inventory.manage')) reads or writes it.
--     Same posture as 0239 / 0242.
--
-- Additive and idempotent. The code is safe BEFORE this runs: without the
-- column a suggestion is saved without its waterfall (the card shows the
-- plain reason instead), and without the table no rejection is remembered,
-- which is exactly today's behaviour.
--
-- ROLLBACK: supabase/rollbacks/0243_master_suggestions_v2.rollback.sql
-- ============================================================================

alter table public.product_master_suggestions
  add column if not exists evidence_json jsonb;

comment on column public.product_master_suggestions.evidence_json is
  'S36: explainable match evidence - band, probability, total weight, per-field contributions (the waterfall) and each member pair''s fingerprint. NULL on suggestions made before S36.';

create table if not exists public.product_master_pair_decisions (
  key_a text not null,
  key_b text not null,
  decision text not null check (decision in ('not_a_match')),
  fingerprint text not null,
  decided_by uuid references public.staff_profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (key_a, key_b),
  constraint product_master_pair_decisions_ordered
    check (key_a < key_b collate "C")
);

comment on table public.product_master_pair_decisions is
  'S36: a pair of menu cards the owner said are NOT the same product. Suppresses that pair in every future suggestion while fingerprint still matches both cards; a changed card re-opens it.';
comment on column public.product_master_pair_decisions.fingerprint is
  'Critical attributes of both cards (vendor, brand, strain, market, sizes) when the decision was made. A different fingerprint later = the decision no longer applies.';

alter table public.product_master_pair_decisions enable row level security;
