-- ============================================================================
-- 0270 - INTAKE CARD ALIASES (R50 A1: "Yes, this is that Cultivera product")
--
-- WHY THIS EXISTS
-- ---------------
-- R50 S4 shows "Looks like Cultivera product X" under a Product Onboarding
-- row whose restock verdict is "New card": the vendor spelled the product a
-- little differently from the one-time Cultivera import ("Train Wreck" vs
-- "Trainwreck"), so the exact restock rule finds no live card and approving
-- would add a duplicate card. The suggestion is never applied on its own.
--
-- The owner asked for a one-click "accept" that is REMEMBERED: once he says
-- "this product is that imported card", every delivery of this product joins
-- that card as a size / restock, instead of asking again every time.
--
-- S32's intake_merge_decisions (0239) cannot hold this: it is for a product
-- that matched TWO OR MORE cards (check cardinality >= 2) and is only read in
-- that case. This is the opposite case - ZERO exact matches - so it is its
-- own small table.
--
-- WHAT THIS DOES
-- --------------
--   * One new table, keyed by the product identity
--     (vendor|categoryAxis|family, exactly as the mastering planner builds it
--     in src/lib/pos/intake-mastering-core.ts).
--   * card_key = the live card the owner chose. card_name is what it was
--     called when he chose (display only).
--   * The planner applies an alias ONLY when the product matches no live
--     card by the exact rule, and ONLY while that card is still on the
--     published menu as a valid merge target (not hidden, not medical-only,
--     same category axis). Otherwise the alias is STALE and the product is
--     added as its own card exactly as before. Nothing is merged on a guess.
--   * decided_by -> staff_profiles ON DELETE SET NULL (staff_profiles is
--     KEPT by the factory reset, so the link never dangles). No foreign key
--     into menu_items / menu_versions (those are WIPED by the factory reset;
--     this table is KEPT, and a KEEP table may not point into a WIPE table).
--   * Row-level security ON with NO policy: only the service role (server
--     code behind requirePermission('inventory.manage')) reads or writes it.
--     Same posture as 0239.
--
-- FACTORY RESET: KEEP (src/lib/accounting/factory-reset-core.ts). After a
-- wipe the card keys it names are gone, so each alias simply reads as stale
-- and is never applied to another card.
--
-- Additive and idempotent. The code is safe BEFORE this runs: a missing table
-- reads as "no aliases" and the planner behaves exactly as before.
-- APPLY MANUALLY in the Supabase SQL editor.
--
-- ROLLBACK: supabase/rollbacks/0270_intake_card_aliases.rollback.sql
-- ============================================================================

do $precheck$
begin
  if to_regclass('public.staff_profiles') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0270 depends on staff_profiles from 0001';
  end if;
end
$precheck$;

create table if not exists public.intake_card_aliases (
  identity text primary key,
  card_key text not null,
  card_name text,
  decided_by uuid references public.staff_profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  note text
);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'intake_card_aliases_identity_three_parts'
  ) then
    alter table public.intake_card_aliases
      add constraint intake_card_aliases_identity_three_parts
      check (identity ~ '^[^|]+\|[^|]+\|[^|]+$' and length(identity) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'intake_card_aliases_card_key_not_blank'
  ) then
    alter table public.intake_card_aliases
      add constraint intake_card_aliases_card_key_not_blank
      check (length(btrim(card_key)) > 0 and length(card_key) <= 200);
  end if;
end
$constraints$;

comment on table public.intake_card_aliases is
  'R50 A1: the owner''s remembered "this product IS that live card" answer for a delivered product that matched NO live card by the exact rule. Applied only while that card is still a valid merge target.';
comment on column public.intake_card_aliases.identity is
  'vendor|categoryAxis|family, exactly as the mastering planner builds it.';
comment on column public.intake_card_aliases.card_key is
  'menu_items.source_item_id of the chosen live card (no FK: menu tables are wiped by the factory reset, this table is kept).';

alter table public.intake_card_aliases enable row level security;

notify pgrst, 'reload schema';
