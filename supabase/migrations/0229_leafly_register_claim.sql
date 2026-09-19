-- ============================================================================
-- 0229 — the register claim, and the cancellation interrupt
--
-- SLICE L-14. Two things this migration makes possible, neither of which the
-- database could express before:
--
--   1. WHICH REGISTER IS HOLDING A LEAFLY ORDER RIGHT NOW.
--      Slice L-10 shipped `decideCancelPlan`, whose whole purpose is to behave
--      differently when a till has the order open. It was called with a
--      hardcoded `registerSaleOpen: false`, because nothing in the schema could
--      answer the question. The collision branch — the thing the owner asked
--      about — could not fire. These columns are the missing fact.
--
--   2. AN INTERRUPT THAT SURVIVES A RELOAD.
--      A cancellation that arrives while a budtender is mid-sale must not be a
--      toast that disappears, and must not be lost if the tablet reloads. It is
--      a durable row that stays unresolved until a human chooses what to do
--      with it. That row is also the point-5 record — who acknowledged it, when,
--      and what they decided — which is the part that makes a dispute
--      answerable two weeks later.
--
-- IDEMPOTENT. Every statement is `if not exists` / `drop ... if exists`, so
-- running it twice is harmless. Applied BY HAND in the Supabase SQL editor
-- (AGENTS rule 6). Every read path degrades gracefully until it is applied, and
-- that degradation is asserted in CI.
-- ============================================================================

-- ── 1. THE CLAIM ────────────────────────────────────────────────────────────
--
-- Stored on `leafly_orders` rather than on `orders`, deliberately.
--
-- The claim exists to answer a question asked by the LEAFLY cancellation path,
-- about a LEAFLY order. Putting it on `orders` would put four columns on the
-- busiest table in the system that are null for every walk-in sale and every
-- website order — and would invite a future reader to think the register claim
-- is a general POS concept. It is not; it is Leafly-specific plumbing.
--
-- (If a general "which till is holding this order" feature is ever wanted for
-- website orders too, that is a different migration and a different shape —
-- probably a real lock table. This is the narrow version that solves the
-- problem in front of us without pretending to be more.)

alter table public.leafly_orders
  -- The pos_devices.id currently holding this order in an open sale.
  -- NOT a foreign key: pos_devices rows can be revoked and deleted, and a
  -- historical claim pointing at a deleted device is still evidence of what
  -- happened. An FK with `on delete set null` would erase exactly the fact we
  -- would want during an investigation. (Same reasoning as 0226's decision to
  -- keep leafly_order_id unconstrained.)
  add column if not exists register_device_id uuid;

alter table public.leafly_orders
  -- Copied, not joined, for the same reason 0226 copies order_integration_key:
  -- a device can be renamed, and a historical claim must not retroactively
  -- claim it was held by a register that did not exist under that name.
  add column if not exists register_device_name text;

alter table public.leafly_orders
  -- The employee who loaded it. Free text: this is the name typed at the
  -- register, and it is evidence, not a key.
  add column if not exists register_employee_name text;

alter table public.leafly_orders
  -- Last renewal. The claim is a LEASE — see CLAIM_STALE_AFTER_MINUTES in
  -- src/lib/leafly/register-claim-core.ts. A device that dies mid-sale must not
  -- hold an order hostage forever, so this is refreshed by the register's
  -- ordinary polling and goes stale on its own.
  add column if not exists register_claimed_at timestamptz;

-- Finding the claim for a given device, and sweeping stale claims.
create index if not exists leafly_orders_register_claim_idx
  on public.leafly_orders (register_device_id, register_claimed_at desc)
  where register_device_id is not null;


-- ── 2. THE INTERRUPT ────────────────────────────────────────────────────────

create table if not exists public.leafly_register_interrupts (
  id                      uuid primary key default gen_random_uuid(),

  -- Which Leafly order. Text, matching leafly_orders.leafly_order_id, and not
  -- an FK for the same reason as 0226: an interrupt about an order id we have
  -- no row for is exactly the anomaly worth keeping.
  leafly_order_id         text,

  -- The local order the till is holding. FK with `on delete cascade` IS correct
  -- here (unlike the device above): if the local order is deleted there is
  -- nothing left to dispose of, and an interrupt pointing at a vanished order
  -- would be an unresolvable modal that no one could ever clear.
  local_order_id          uuid references public.orders(id) on delete cascade,

  -- Which device must answer. Null means "any register" — used when the claim
  -- went stale between the cancellation arriving and this row being written.
  register_device_id      uuid,

  -- What kind of interrupt. Free text with a CHECK: we choose these values, so
  -- an unknown one is our own bug and should be loud. (Deliberately the same
  -- asymmetry as 0226: inbound values from Leafly are permissive, outbound
  -- values of our own invention are constrained.)
  kind                    text not null default 'leafly_cancel'
                            check (kind in ('leafly_cancel')),

  -- Leafly's verbatim cancellation reason code, when they sent one.
  -- UNCONSTRAINED on purpose: this is an INBOUND fact. Leafly can add a code
  -- at any time, and a CHECK here would reject the truth. The pure core
  -- (explainCancelReason) handles unknown codes by showing them rather than
  -- guessing.
  cancel_reason_code      text,

  -- The exact text shown to the budtender. Stored rather than regenerated so
  -- that a later wording change cannot rewrite what somebody was actually told
  -- at the moment they made a decision.
  title                   text not null,
  message                 text not null,

  -- Does a human have to choose? Mirrors decideCancelPlan.dispositionRequired.
  disposition_required    boolean not null default true,

  raised_at               timestamptz not null default now(),

  -- ── THE RESOLUTION (point 5 of the standard: record the collision) ────────
  --
  -- All four are null until a human answers. `resolved_at is null` is the
  -- definition of "still blocking a register", and the partial index below
  -- makes that the fast query.
  resolved_at             timestamptz,

  -- ALLOWLIST, matching toCancelDisposition() in register-claim-core.ts. The
  -- direction matters: a denylist would let an unanticipated value through and
  -- silently record a disposition nobody designed. Null while unresolved.
  disposition             text
                            check (disposition is null
                                   or disposition in ('void', 'walk_in')),

  -- Who answered. Free text (the name typed at the register) plus the device,
  -- because "Sam on Register 2" is what makes this reconstructable later.
  resolved_by_employee    text,
  resolved_by_device_id   uuid,

  created_at              timestamptz not null default now()
);

-- THE hot query: "does this device have anything blocking it right now?"
-- Partial, because resolved interrupts are history and are never polled for.
create index if not exists leafly_register_interrupts_open_idx
  on public.leafly_register_interrupts (register_device_id, raised_at desc)
  where resolved_at is null;

-- Looking up by order, for the board and for the order detail page.
create index if not exists leafly_register_interrupts_order_idx
  on public.leafly_register_interrupts (local_order_id, raised_at desc);

create index if not exists leafly_register_interrupts_leafly_order_idx
  on public.leafly_register_interrupts (leafly_order_id, raised_at desc);

-- ONE OPEN INTERRUPT PER ORDER.
--
-- Leafly retries webhooks, and `order_cancel` can legitimately arrive more than
-- once for the same order. Without this, three retries produce three modals and
-- a budtender has to dismiss the same cancellation three times — which is how
-- people learn to dismiss modals without reading them. The partial unique index
-- makes the second arrival a no-op at the database level rather than relying on
-- every call site to remember to check first.
create unique index if not exists leafly_register_interrupts_one_open_per_order
  on public.leafly_register_interrupts (local_order_id)
  where resolved_at is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Service-role only. The register reaches this table through
-- /api/pos/pickup, which authenticates the device with
-- x-pos-device-id/-key and uses the admin client — the same path every other
-- register endpoint uses. No anon or authenticated policy is created, so the
-- table is unreachable from the browser.
alter table public.leafly_register_interrupts enable row level security;

comment on table public.leafly_register_interrupts is
  'SLICE L-14. Blocking cancellation interrupts for the register, and the '
  'durable record of who dispositioned each one. An open row (resolved_at is '
  'null) blocks the till that holds the order.';

comment on column public.leafly_orders.register_claimed_at is
  'Lease renewal timestamp for the register claim. Goes stale on its own after '
  'CLAIM_STALE_AFTER_MINUTES (see src/lib/leafly/register-claim-core.ts) so a '
  'dead tablet cannot hold an order hostage.';
