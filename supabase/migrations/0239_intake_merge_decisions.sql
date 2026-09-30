-- ============================================================================
-- 0239 - INTAKE MERGE DECISIONS (bible slice S32, Phase 7, Ring 1,
--        owner decision D-R2-4)
--
-- WHY THIS EXISTS
-- ---------------
-- When a delivered product matches TWO OR MORE live menu cards (same vendor,
-- category and product family), the mastering planner never guesses: it
-- adds the product as its own card and raises the warning
-- intake_master_merge_ambiguous (src/lib/pos/intake-mastering-core.ts).
-- Until now there was nowhere to record the human answer, so the same
-- warning came back on every delivery of that product (bible F-123).
--
-- This table stores ONE remembered answer per product identity:
--   'join'      put this product's lots on card target_card_key
--   'separate'  it is a different product; keep it as its own card
-- The planner applies an answer ONLY while the cards it matches still equal
-- candidate_card_keys (or those plus own_card_key, the card this product got
-- for itself - see below). If the cards on the menu changed, the answer is
-- STALE and the warning returns. Nothing is ever merged on a guess.
--
-- own_card_key: while no answer exists the product goes live as its OWN card,
-- keyed by its smallest lot key. That card has the same identity, so the
-- next delivery matches the old cards PLUS it. Storing that key keeps the
-- answer valid for every future delivery (the "we'll remember your choice"
-- promise); without it every answer would go stale one delivery later.
--
-- WHAT THIS DOES
-- --------------
--   * One new table, keyed by identity (vendor|categoryAxis|family, exactly
--     as the warning emits it).
--   * A check that 'join' always names a target and 'separate' never does.
--   * decided_by -> staff_profiles ON DELETE SET NULL (staff_profiles is
--     KEPT by the factory reset, so the link never dangles).
--   * Row-level security ON with NO policy: only the service role (server
--     code behind requirePermission('inventory.manage')) reads or writes it.
--     Same posture as 0235 / 0226.
--
-- Additive and idempotent. The code is safe BEFORE this runs: a missing
-- table reads as "no decisions" and the planner behaves exactly as before.
--
-- ROLLBACK: supabase/rollbacks/0239_intake_merge_decisions.rollback.sql
-- ============================================================================

create table if not exists public.intake_merge_decisions (
  identity text primary key,
  decision text not null check (decision in ('join', 'separate')),
  target_card_key text,
  candidate_card_keys text[] not null,
  own_card_key text,
  decided_by uuid references public.staff_profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  note text,
  constraint intake_merge_decisions_target_matches_decision
    check ((decision = 'join') = (target_card_key is not null)),
  constraint intake_merge_decisions_two_or_more_candidates
    check (cardinality(candidate_card_keys) >= 2)
);

comment on table public.intake_merge_decisions is
  'S32: the remembered human answer for a delivered product that matched 2+ live menu cards (join card X / keep separate). Applied only while the matched cards are unchanged.';
comment on column public.intake_merge_decisions.identity is
  'vendor|categoryAxis|family, exactly as intake_master_merge_ambiguous emits it.';
comment on column public.intake_merge_decisions.candidate_card_keys is
  'The live card keys matched when the choice was made. A different set later = stale, never applied.';
comment on column public.intake_merge_decisions.own_card_key is
  'The card this product got for itself (its smallest lot key). The next delivery matches the candidates plus this card and is still recognised.';

alter table public.intake_merge_decisions enable row level security;
