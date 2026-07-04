-- =============================================================================
-- 0077_drawer_counts_extra_denoms.sql
--
-- Add three real-world denominations Greenway regularly handles but that the
-- original drawer_counts table (0038) did not have columns for:
--   * $2 bills        -> twos          (200 cents each)
--   * 50-cent coins   -> half_dollars  (50 cents each)
--   * $1 coins        -> dollar_coins  (100 cents each)
--
-- Owner note (verbatim): "I regularly, often actually, get 2 dollar bills,
-- 50 cent coins, and dollar coins. will you please add these for me."
--
-- Storing these as their own columns keeps every blind count auditable to the
-- penny (a $2 bill is NOT two $1 bills for reconciliation purposes). Money is
-- in MINOR UNITS (cents); the app computes total_minor from all denominations.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- Backend note: MIGRATIONS ARE APPLIED MANUALLY BY THE OWNER.
-- =============================================================================

alter table public.drawer_counts
  add column if not exists twos          integer not null default 0,
  add column if not exists half_dollars  integer not null default 0,
  add column if not exists dollar_coins  integer not null default 0;

-- ---------------------------------------------------------------------------
-- Correct the sales-register standing float to the REAL Greenway float.
--
-- Owner note (verbatim): "we start with 167.50: 5 tens, 10 fives, 50 ones,
-- one roll each of quarters, dimes, nickels, and pennies."
--   5×$10  = $50.00
--  10×$5   = $50.00
--  50×$1   = $50.00
--   1 roll quarters ($10.00) + dimes ($5.00) + nickels ($2.00) + pennies ($0.50)
--                                                           = $17.50
--   TOTAL  = $167.50  -> 16750 cents.
--
-- The 0038 seed only ran on first install ($200/$300). This corrects existing
-- rows too. Only touches the two customer-facing SALES registers; the shared
-- Manager Till float is left as-is (owner has not specified a change).
-- Idempotent: re-running just re-sets the same value.
-- ---------------------------------------------------------------------------
update public.registers
   set default_float_minor = 16750
 where kind = 'sales'
   and default_float_minor <> 16750;
