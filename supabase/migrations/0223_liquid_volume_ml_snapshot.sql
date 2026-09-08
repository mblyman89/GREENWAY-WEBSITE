-- ---------------------------------------------------------------------------
-- Migration 0223 — SLICE L4: the sale-time MILLILITRE snapshot
--
-- WHY THIS EXISTS
--
-- L4 rebased the liquid sales-limit bucket from weighted grams onto
-- MILLILITRES, because the statute's liquid maximum is 72 FLUID ounces
-- (2129.292 ml at 29.5735 ml per fluid ounce), not 72 weighted ounces. The
-- register and the website now both hand the engine a real per-line volume.
--
-- But an order is judged TWICE: once at placement, and again at PICKUP, when
-- the completion gate re-reads the stored order_lines. order_lines already
-- snapshots the weight (unit_grams, 0122), the low-THC classification and the
-- otherwise-taken classification (0217) for exactly this reason. It had no
-- volume column.
--
-- Without this column the two evaluations DISAGREE on the products the slice
-- was written for. A 1.5 L bottle carries no parseable weight at all, so at
-- placement it is metered as 1500 ml against 2129.292 ml, and at pickup it
-- falls back to the 28 g category default — the very defect the owner
-- reported, re-entering the system through the back door at the counter.
-- The disagreement runs BOTH ways: an order legally placed could be blocked at
-- the counter, and an over-limit basket could be waved through.
--
-- SNAPSHOT, NOT A LOOKUP: like category (0096), unit_grams (0122) and the
-- 0217 classification columns, this is the value AS OF THE SALE. Deliberately
-- not a foreign key to menu_items — re-measuring a product tomorrow must never
-- retroactively alter yesterday's receipt.
--
-- Nullable + no backfill. Null = unknown, and the limit engine then falls back
-- to the weight-carried basis exactly as it did before L4, which for every
-- ounce-labelled product yields a numerically identical verdict (the 28 g
-- factor cancels out of the ratio). Every writer degrades gracefully when this
-- column is absent (missing-column retry ladder in orders-store.ts), so
-- applying this migration is safe at any time, and NOT applying it cannot
-- break placement.
--
-- Apply manually (owner). Idempotent: add column if not exists; safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.order_lines
  add column if not exists unit_volume_ml numeric(12,3);

comment on column public.order_lines.unit_volume_ml is
  'SLICE L4 snapshot. Millilitres ONE unit of the sold variant contained, as of the sale (a 750 ml bottle = 750). This is what the liquid bucket is metered against: WAC 314-55-095(1)(d)(i)(C) caps recreational liquid at 72 FLUID ounces = 2129.292 ml. Sourced from the measured net_volume_ml plumbed at intake, or failing that from the package-size label. Null = unknown, and the gate falls back to the weight-carried basis. Never recomputed: the pickup completion gate re-reads this rather than re-deriving it, so placement and pickup can never reach different verdicts about the same basket.';
