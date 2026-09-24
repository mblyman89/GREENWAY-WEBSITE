-- ============================================================================
-- 0230 — AUTO-ACKNOWLEDGE
--
-- SLICE L-33. The owner:
--
--   > "I feel like 15 minutes is not enough time for us to press that button.
--   >  When we are busy, we can tell a customer, 'hang on, I have to go push a
--   >  button in the office', that's lame. ... Please build me an auto
--   >  acknowledge feature. ... It can't be acknowledge and confirm in the same
--   >  step though. Just auto acknowledge."
--
-- Leafly's specification supports this directly. From the "Expectations"
-- section of the Order API description:
--
--   "Orders are acknowledged as having been retrieved in whole BY YOUR SYSTEM
--    within fifteen minutes of receiving an order submission webhook. Any
--    orders not acknowledged by this deadline will be auto canceled."
--
-- The subject is "your system". The acknowledge endpoint takes no body, no
-- actor and no staff identifier — Leafly cannot distinguish an automated
-- acknowledgement from a manual one, because the API has no field in which the
-- difference could be expressed. The human gate was ours, never Leafly's.
--
-- ============================================================================
-- WHY THIS MIGRATION EXISTS AT ALL — THE BOARD WOULD OTHERWISE LIE
-- ============================================================================
-- This is the part nobody asked for, and it is the reason the slice needed a
-- schema change rather than just a function call.
--
-- Slice L-32 shipped a rule that treats "acknowledged AND still pending" as a
-- CONTRADICTORY state: proof that the confirm push was lost. It replaces every
-- button on such an order with a single repair action, "Check this order with
-- Leafly".
--
-- Auto-acknowledge makes that exact state the NORMAL, CORRECT, INTENDED resting
-- state of every order that ever arrives: acknowledged by the machine,
-- deliberately not confirmed, waiting for a human. Proven by execution in
-- `scripts/recon/l33-board-breakage-probe.mts`, which runs the real planner
-- against the real row shape and printed, before this slice:
--
--     buttons  : Check this order with Leafly [PRIMARY]
--
-- One button. The wrong one. On every order. The owner's entire daily workflow
-- — press Confirm, fill it, complete it — would have been replaced by a
-- diagnostic for a failure that did not occur.
--
-- The two states can no longer be told apart by the status columns, because
-- after this slice they are IDENTICAL in both. So the difference must be
-- RECORDED as a fact at the moment it happens, not inferred afterwards.
-- Inferring it would be guessing, and the standing rules forbid guessing.
--
-- ============================================================================
-- APPLIED BY HAND (AGENTS rule 6)
-- ============================================================================
-- Michael applies migrations himself in the Supabase SQL editor, one at a time.
-- Every statement below is `if not exists`, so running it twice is harmless.
--
-- EVERY READ PATH DEGRADES GRACEFULLY UNTIL IT IS APPLIED, and that degradation
-- is asserted in CI. Concretely: until this runs, `confirm_push_failed_at` is
-- absent, the server treats it as null, and the board behaves EXACTLY as it
-- does today. Auto-acknowledge itself does not depend on this column at all —
-- it depends only on the feature flag — so the feature is not blocked on the
-- migration; only the board's ability to distinguish a genuine failure is.
-- ============================================================================

-- ── 1. THE DISCRIMINATOR ────────────────────────────────────────────────────
--
-- Stamped ONLY when a confirm push was actually attempted and actually failed.
-- Never stamped by inference, never stamped on an automatic acknowledgement
-- (which does not push a confirm at all), and cleared the moment a later push
-- succeeds — because a stale warning is worse than none.
alter table public.leafly_orders
  add column if not exists confirm_push_failed_at timestamptz;

comment on column public.leafly_orders.confirm_push_failed_at is
  'SLICE L-33. When a status=confirmed push was ATTEMPTED and FAILED, leaving '
  'our row acknowledged-but-pending while Leafly may disagree. This is the '
  'RECORDED FACT that distinguishes a genuine lost push from the ordinary '
  'post-auto-acknowledge resting state, which looks identical in every other '
  'column. Before L-33, "acknowledged and pending" was itself the evidence; '
  'auto-acknowledge makes that state normal, so the evidence had to become '
  'explicit. Cleared to null when a later push succeeds.';

-- ── 2. HOW THE ACKNOWLEDGEMENT HAPPENED ─────────────────────────────────────
--
-- Not decoration. Three different people need this and none of them can get it
-- anywhere else:
--
--   • the budtender, who needs to know the machine already stopped the clock
--     so they do NOT go hunting for a button to press;
--   • the owner, who asked for this feature and is entitled to see it working
--     rather than take my word for it;
--   • whoever debugs the next incident, who otherwise cannot tell an order the
--     machine handled from one a person handled at 2am.
--
-- Nullable with no default: existing rows are genuinely unknown, and writing
-- 'human' across historical rows would be inventing data about who did what.
alter table public.leafly_orders
  add column if not exists acknowledged_by_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leafly_orders_acknowledged_by_kind_check'
  ) then
    alter table public.leafly_orders
      add constraint leafly_orders_acknowledged_by_kind_check
      check (acknowledged_by_kind is null
             or acknowledged_by_kind in ('human', 'auto'));
  end if;
end
$$;

comment on column public.leafly_orders.acknowledged_by_kind is
  'SLICE L-33. Whether this order was acknowledged automatically on arrival '
  '(auto) or by a person pressing the button (human). Null for rows that '
  'predate this column — genuinely unknown, and not backfilled, because '
  'guessing who acted on a historical order would be inventing an audit trail.';

-- ── 3. THE SWEEPER'S INDEX ──────────────────────────────────────────────────
--
-- A webhook can be missed: Leafly retries, but a sustained outage on our side
-- during the fifteen-minute window loses a real customer's order to auto-
-- cancellation. The sweeper asks one question — "is anything unacknowledged
-- with a deadline approaching?" — and this index is what makes that question
-- cheap enough to ask often.
--
-- Partial on `acknowledged_at is null`: the moment an order is acknowledged it
-- leaves the index entirely, so the index stays small however many orders the
-- shop takes.
--
-- NOTE: 0225 already creates an index on (acknowledge_by) where acknowledged_at
-- is null. This one is deliberately NOT a duplicate — it also carries
-- `leafly_order_id`, so the sweeper's lookup is index-only and does not touch
-- the heap for the id it needs to act on.
create index if not exists leafly_orders_unacknowledged_deadline_idx
  on public.leafly_orders (acknowledge_by, leafly_order_id)
  where acknowledged_at is null;
