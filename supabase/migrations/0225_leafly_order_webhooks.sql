-- =============================================================================
-- 0225_leafly_order_webhooks.sql  (Slice L-5)
--
-- Receive orders from Leafly. Everything in this file is grounded in Leafly's
-- live Order API specification, vendored at
-- docs/leafly-specs/order-api-v1.openapi.json (md5 daab7bcf6f77177de85425adf7f805f1,
-- re-verified byte-identical against the live download on 2026-09-17).
--
-- Three things this migration adds:
--   1. Two credential columns on integration_credentials. The Order API needs
--      credentials the Menu API does not: an HMAC key (to authenticate webhooks
--      Leafly sends US) and a per-retailer orderIntegrationKey.
--   2. leafly_webhook_events  -- the append-only delivery log + idempotency guard.
--   3. leafly_orders          -- the orders themselves.
--
-- WHY TWO TABLES AND NOT ONE. A webhook delivery and an order are different
-- things with different lifetimes. Leafly retries deliveries, sends six distinct
-- event types, and two of those events (integration activation/deactivation)
-- carry no order at all. Folding them together would mean either a row per
-- delivery with order columns mostly null, or a row per order that loses the
-- delivery history we need to prove what Leafly actually sent us. Leafly grades
-- certification "by review of logged activity", so the delivery log is evidence,
-- not debug noise.
--
-- SPEC QUOTATIONS THAT DROVE THE COLUMN CHOICES (all verbatim):
--   * "Webhooks outbound from Leafly will include an `X-Leafly-Signature` header
--     representing an `HMAC-SHA-256` digest of the request body using an HMAC key
--     issued to you alongside your client credentials for this purpose."
--   * "Orders are acknowledged as having been retrieved in whole by your system
--     within fifteen minutes of receiving an order submission webhook. Any orders
--     not acknowledged by this deadline will be auto canceled."
--   * "Orders are only available for retrieval while live, or within twenty four
--     hours of reaching a terminal state."
--   * "The Leafly Order Dashboard will become read-only, as your software system
--     will become the source of truth for order statuses and cart totals."
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Credentials
-- -----------------------------------------------------------------------------
-- Note the asymmetry, which is easy to get wrong: per the spec, "The OAuth2
-- credentials and HMAC key are unique to each integrator, while there is a
-- unique `orderIntegrationKey` for each retailer managed through your
-- integration." Greenway is a single retailer, so one row holds both -- but the
-- column comments record the distinction so a future multi-site build does not
-- assume the order key is global.
--
-- leafly_hmac_key is a TRUE SECRET and is registered in SECRET_COLUMNS in
-- src/lib/integrations/integration-credentials-store.ts, so it is
-- envelope-encrypted at rest (S-10). leafly_order_integration_key is an
-- identifier, not a secret -- it is the same class of value as
-- leafly_menu_integration_key. Note that the menu key IS in SECRET_COLUMNS
-- already; we follow the established local convention and encrypt the order key
-- too rather than inventing a second, weaker rule for a sibling field.
alter table public.integration_credentials
  add column if not exists leafly_hmac_key text not null default '';

alter table public.integration_credentials
  add column if not exists leafly_order_integration_key text not null default '';

comment on column public.integration_credentials.leafly_hmac_key is
  'Leafly Order API: HMAC key used to verify the X-Leafly-Signature header on '
  'INBOUND webhooks from Leafly (HMAC-SHA-256 over the raw request body). '
  'Unique per INTEGRATOR, not per retailer. True secret -- encrypted at rest.';

comment on column public.integration_credentials.leafly_order_integration_key is
  'Leafly Order API: orderIntegrationKey identifying THIS retailer. Unique per '
  'RETAILER (one per store), unlike the HMAC/OAuth credentials which are per '
  'integrator. Appears in every order webhook body and in every order API path.';

-- -----------------------------------------------------------------------------
-- 2. Webhook delivery log (append-only, idempotency guard)
-- -----------------------------------------------------------------------------
create table if not exists public.leafly_webhook_events (
  id                     uuid primary key default gen_random_uuid(),

  -- Leafly's EventType enum, verbatim: order_activate, order_deactivate,
  -- order_submit, order_preview, order_cancel, order_status.
  -- Deliberately NOT a Postgres enum: an unknown event type must be storable so
  -- we can see it and respond 200, rather than having the insert explode inside
  -- a webhook handler. Leafly says webhook requests "should only be responded to
  -- with status codes 200 or 201" -- a DB constraint violation would make that
  -- impossible to honour. Validation belongs in the pure core, where it can
  -- record the anomaly without dropping the delivery.
  event_type             text,

  -- Nullable BY DESIGN: the integration activation/deactivation webhooks carry
  -- no orderId. A not-null constraint here would reject a legitimate, correctly
  -- signed Leafly delivery.
  order_id               text,
  order_integration_key  text,

  -- eventTime from the body (when Leafly says it happened) vs received_at (when
  -- we got it). Kept separately because they differ under retry, and the gap is
  -- exactly what diagnoses a delivery problem.
  event_time             timestamptz,
  received_at            timestamptz not null default now(),

  -- IDEMPOTENCY. SHA-256 of the RAW request body. Leafly retries; a retry must
  -- be acknowledged 200 and do no work twice.
  --
  -- Deliberately the body hash and NOT (event_type, order_id): a status webhook
  -- and its retry share those two values, but so would two genuinely different
  -- status changes on the same order if they arrived in the same second. Hashing
  -- the body treats "byte-identical delivery" as the duplicate, which is what
  -- Leafly actually retries. The spec states no delivery-id header, and
  -- "Dynamic request metadata is not supported", so there is no id to dedupe on.
  body_sha256            text not null unique,

  -- Verification outcome. We log rejected deliveries too: a burst of signature
  -- failures is the signal that the HMAC key was rotated, and discarding that
  -- evidence would make the problem invisible.
  signature_verified     boolean not null default false,
  rejection_reason       text,

  -- What we sent back, so certification review can be answered from our own
  -- records rather than from memory.
  response_status        integer,

  processed_at           timestamptz
);

comment on table public.leafly_webhook_events is
  'Append-only log of every webhook delivery Leafly makes to us, verified or '
  'not. Doubles as the idempotency guard (unique body_sha256) and as the '
  'evidence Leafly reviews at certification ("validated by review of logged '
  'activity").';

create index if not exists leafly_webhook_events_order_idx
  on public.leafly_webhook_events (order_id);
create index if not exists leafly_webhook_events_received_idx
  on public.leafly_webhook_events (received_at desc);
-- Partial index: "show me what is going wrong" is the query that gets run under
-- pressure, and it should stay fast without carrying the healthy rows.
create index if not exists leafly_webhook_events_unverified_idx
  on public.leafly_webhook_events (received_at desc)
  where signature_verified = false;

-- -----------------------------------------------------------------------------
-- 3. Orders
-- -----------------------------------------------------------------------------
create table if not exists public.leafly_orders (
  id                      uuid primary key default gen_random_uuid(),

  -- Leafly's order uuid. Unique: one row per Leafly order, updated in place as
  -- the lifecycle advances.
  leafly_order_id         text not null unique,
  order_integration_key   text,

  -- Leafly's OrderStatus enum, verbatim and in lifecycle order: pending,
  -- confirmed, ready, out_for_delivery, arrived_at_customer, picked_up,
  -- canceled, expired. Text, not an enum type, for the same reason as above --
  -- an unrecognised status must be recordable inside a handler that is
  -- contractually obliged to answer 200.
  leafly_status           text,

  -- FulfillmentMechanism: pickup | delivery.
  fulfillment_mechanism   text,

  -- Marketplace: leafly | uberEats. Worth storing because UberEats orders behave
  -- differently in ways that matter operationally -- no email, a masking proxy
  -- phone number needing an access code, and first-name/last-initial only.
  marketplace             text,

  -- MedicalStatus: medical | recreational. Compliance-relevant, so it is stored
  -- as Leafly sent it and never inferred.
  medical_status          text,

  -- PaymentPreference: cash | debit | credit. Per the spec, "Leafly does not
  -- process payments ... provides no payment details ... other than a possible
  -- indication of the customer's paymentPreference" -- hence a preference, not a
  -- payment record. Nullable: "possible" means sometimes absent.
  payment_preference      text,

  -- THE ACKNOWLEDGEMENT CLOCK. acknowledge_by is Leafly's OWN deadline, taken
  -- from the acknowledgeBy field on the submission webhook -- never computed
  -- locally as received_at + 15 minutes. The spec supplies it precisely so the
  -- integrator does not have to guess, and their clock is the one that decides
  -- whether a real customer's order gets auto-cancelled.
  acknowledge_by          timestamptz,
  acknowledged_at         timestamptz,

  -- Cancellation. CancelReason enum: not_picked_up, customer, dispensary, pos,
  -- delivery_partner, ecommerce_partner, order_api_unacknowledged.
  -- order_api_unacknowledged is the one that means WE missed the 15-minute
  -- window, so it must stay distinguishable from a customer changing their mind.
  canceled_at             timestamptz,
  cancelation_reason_code text,

  -- Link to the shop's own order once one exists, so the orders dashboard can
  -- show a Leafly order beside a Greenway order (slice L-7). Nullable: the
  -- webhook always arrives before any local order is created, and ON DELETE SET
  -- NULL keeps the Leafly record -- which is Leafly's evidence, not ours to
  -- discard -- if the local order is ever removed.
  local_order_id          uuid references public.orders(id) on delete set null,

  -- The last full order payload we hold, for display and for diffing. The spec
  -- warns orders are "only available for retrieval while live, or within
  -- twenty four hours of reaching a terminal state", so after that window this
  -- snapshot is the ONLY copy in existence. That is why it is stored rather
  -- than re-fetched on demand.
  raw_order               jsonb,

  first_seen_at           timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.leafly_orders is
  'Orders received from Leafly via webhook. raw_order is retained deliberately: '
  'Leafly only serves an order "while live, or within twenty four hours of '
  'reaching a terminal state", after which our snapshot is the only copy.';

comment on column public.leafly_orders.acknowledge_by is
  'Leafly''s OWN acknowledgement deadline, copied from the acknowledgeBy field '
  'of the order submission webhook. Never computed locally. Missing it '
  'auto-cancels a real customer order (cancelation_reason_code = '
  '''order_api_unacknowledged'').';

create index if not exists leafly_orders_status_idx
  on public.leafly_orders (leafly_status);
create index if not exists leafly_orders_local_order_idx
  on public.leafly_orders (local_order_id);
-- The operational query that matters most: orders still waiting on
-- acknowledgement, soonest deadline first. Partial, because an acknowledged
-- order is no longer urgent and should not slow this down.
create index if not exists leafly_orders_pending_ack_idx
  on public.leafly_orders (acknowledge_by)
  where acknowledged_at is null;

drop trigger if exists trg_leafly_orders_updated on public.leafly_orders;
create trigger trg_leafly_orders_updated before update on public.leafly_orders
  for each row execute function public.set_updated_at();

-- (leafly_webhook_events has no updated_at -- append-then-mark-processed, the
--  same shape as plaid_webhook_events.)

-- -----------------------------------------------------------------------------
-- 4. RLS -- deny-by-default, service role only
-- -----------------------------------------------------------------------------
-- Both tables hold customer PII (names, phone numbers, delivery addresses inside
-- raw_order) and arrive from an external system. No browser client has any
-- reason to read them directly: the admin UI reaches them through server
-- actions, which use the service role. Enabling RLS with NO permissive policy
-- means the anon and authenticated roles get nothing at all, which is the
-- correct posture for a webhook sink.
alter table public.leafly_webhook_events enable row level security;
alter table public.leafly_orders         enable row level security;

revoke all on public.leafly_webhook_events from anon, authenticated;
revoke all on public.leafly_orders         from anon, authenticated;
