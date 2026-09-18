-- =============================================================================
-- 0226_leafly_outbound_orders.sql  (Slice L-6)
--
-- Talking BACK to Leafly. L-5 (migration 0225) taught us to RECEIVE orders;
-- this migration is what lets us ANSWER them: acknowledge an order inside
-- Leafly's fifteen-minute window, and then advance its status as the order is
-- confirmed, made ready, and picked up.
--
-- Everything here is grounded in Leafly's live Order API specification,
-- vendored at docs/leafly-specs/order-api-v1.openapi.json
-- (md5 daab7bcf6f77177de85425adf7f805f1). The three outbound endpoints this
-- migration supports are read directly out of that file:
--
--   POST /{order_integration_key}/orders/{id}/acknowledge  -> 204, 401, 403, 404
--   POST /{order_integration_key}/orders/{id}/status       -> 200, 400, 401, 403, 404
--   POST /{order_integration_key}/orders/{id}/cart         -> 200, 400, 401, 403, 404
--
-- Note the success codes DIFFER (204 for acknowledge, 200 for status). That is
-- not a typo in this comment; it is why response_status is stored as an integer
-- and judged by the pure core rather than by a `= 200` test anywhere in SQL.
--
-- THE POSTURE IS THE MIRROR IMAGE OF L-5, AND THAT IS THE WHOLE POINT.
-- L-5's webhook receivers must FAIL SOFT: Leafly's spec says inbound webhook
-- requests "should only be responded to with status codes 200 or 201", so an
-- inbound parsing bug has to be swallowed and logged rather than thrown. The
-- outbound endpoints in THIS migration are the opposite: Leafly documents
-- 400/401/403/404 for every one of them, so a rejection is a real, named,
-- actionable event. Swallowing it here would be the bug. Hence an attempt log
-- with an explicit disposition on every row -- nothing outbound is allowed to
-- fail quietly.
--
-- Two things this migration adds:
--   1. leafly_outbound_attempts -- an append-only log of every outbound call.
--   2. public.orders.origin     -- the column whose ABSENCE is the subject of
--                                  the owner's question. See section 2.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Outbound attempt log (append-only)
-- -----------------------------------------------------------------------------
-- WHY AN APPEND-ONLY LOG AND NOT JUST A FLAG ON leafly_orders.
--
-- leafly_orders.acknowledged_at (added in 0225) already records THAT we
-- acknowledged an order. It cannot record the far more interesting facts: that
-- we tried three times, that the first two attempts came back 401 because the
-- token had rotated, that the third succeeded with eleven seconds left before
-- Leafly's own acknowledge_by deadline. Those facts are what you need at 9pm
-- when a customer is standing at the counter, and they are also what Leafly
-- asks for -- their certification is "validated by review of logged activity",
-- so an outbound call we cannot evidence is an outbound call we cannot certify.
--
-- The single most valuable column here is the LAST one, not the first:
-- `refusal_code`. A row exists even when NO HTTP REQUEST WAS MADE, because the
-- pure core refused to make one (already acknowledged, order not acknowledged
-- yet, status going backwards, illegal cancel reason). A log that only records
-- calls that reached the network would be silent about the most common class of
-- operator mistake, which is precisely the class a UI needs to explain.
create table if not exists public.leafly_outbound_attempts (
  id                      uuid primary key default gen_random_uuid(),

  -- Which Leafly order this was about. Text, matching
  -- leafly_orders.leafly_order_id, and deliberately NOT a foreign key: an
  -- attempt against an order id we do not have a row for is exactly the
  -- anomaly worth logging, and an FK would reject the evidence. (Same
  -- reasoning as 0225's decision to keep event_type free text.)
  leafly_order_id         text,

  -- Copied per attempt rather than joined, because the key can be re-entered
  -- or corrected on the Integrations page, and then a historical row would
  -- start claiming it used a key it never used. An audit log that mutates
  -- retroactively is not an audit log.
  order_integration_key   text,

  -- Which of the three documented endpoints. Free text with a CHECK, so an
  -- unknown value is rejected at write time here (unlike 0225's inbound
  -- event_type, which must accept anything Leafly invents). The asymmetry is
  -- intentional: WE choose what we send, so a value outside this set is our
  -- own bug and should be loud.
  operation               text not null
                            check (operation in ('acknowledge', 'status', 'cart')),

  -- For a status change: the status we asked Leafly to set, and the cancel
  -- reason we sent (or that Leafly will have defaulted to). Null for
  -- acknowledge, which per the spec takes NO request body at all.
  requested_status        text,
  cancelation_reason_code text,

  -- The exact JSON body sent, or null when no request was made. Stored so that
  -- "what did we actually send" is answerable from our own records rather than
  -- from a reconstruction, which is the same discipline as syndication_logs.
  request_body            jsonb,

  -- THE RESPONSE. Nullable, because a refused attempt never got one, and
  -- because a network failure produces an error with no status at all.
  -- Integer, not boolean: the success code differs per endpoint (204 vs 200),
  -- so "was this ok" is a judgement the pure core makes, not a column.
  response_status         integer,
  response_body           jsonb,

  -- Classification from assessOutboundResponse() in order-ack-core.ts:
  -- success | retry | fix_config | fix_request | gone. Stored rather than
  -- recomputed so that a later change to the classifier cannot silently
  -- rewrite history.
  disposition             text
                            check (disposition is null or disposition in
                              ('success', 'retry', 'fix_config', 'fix_request', 'gone')),

  -- WHY NO REQUEST WAS SENT. Populated from the pure core's decision codes
  -- (decideAcknowledgement / decideStatusChange). When this is non-null,
  -- response_status is null by construction: we refused before dialling.
  --
  -- This is the column that makes the log worth keeping. "Leafly rejected it"
  -- and "we declined to ask" look identical in a naive log, and they need
  -- completely different responses from whoever is reading.
  refusal_code            text,

  -- Human-readable outcome, safe to display. Never null: every row can explain
  -- itself to a person without a developer translating a status code.
  message                 text not null default '',

  -- Which staff member pressed the button, null for automated attempts.
  -- Acknowledgement is IRREVERSIBLE (the spec: after acknowledging, "you will
  -- no longer have access to the customer's ID images"), so knowing who did it
  -- is not bureaucracy -- it is the only way to reconstruct why a compliance
  -- check was or was not possible.
  created_by              uuid references public.staff_profiles(id) on delete set null,

  attempted_at            timestamptz not null default now()
);

comment on table public.leafly_outbound_attempts is
  'Append-only log of every OUTBOUND call to the Leafly Order API, including '
  'attempts we refused to make. Unlike the inbound webhooks (0225) which must '
  'fail soft because Leafly demands a 200, these endpoints have documented '
  '4xx responses, so every rejection is a named actionable event. Evidence for '
  'Leafly certification, which is "validated by review of logged activity".';

comment on column public.leafly_outbound_attempts.refusal_code is
  'Set when NO HTTP request was made because the pure decision core declined '
  '(e.g. already_acknowledged, not_acknowledged, backwards, '
  'illegal_cancel_reason). Mutually exclusive with response_status: a refusal '
  'never reached the network. Distinguishes "we declined to ask" from "Leafly '
  'said no", which look identical in a naive log and require opposite fixes.';

comment on column public.leafly_outbound_attempts.response_status is
  'Raw HTTP status. Integer and not a boolean because the documented success '
  'code DIFFERS per endpoint: acknowledge returns 204, status returns 200. '
  'Judging success belongs in assessOutboundResponse(), not in SQL.';

-- The operational query: "what happened with this order", newest first.
create index if not exists leafly_outbound_attempts_order_idx
  on public.leafly_outbound_attempts (leafly_order_id, attempted_at desc);

-- Partial index for the query that gets run under pressure -- "show me what is
-- failing" -- kept fast by not carrying the successful rows. Mirrors 0225's
-- leafly_webhook_events_unverified_idx for the same reason.
create index if not exists leafly_outbound_attempts_trouble_idx
  on public.leafly_outbound_attempts (attempted_at desc)
  where disposition is distinct from 'success';

-- -----------------------------------------------------------------------------
-- 2. public.orders.origin  -- THE OWNER'S QUESTION, ANSWERED IN SQL
-- -----------------------------------------------------------------------------
-- The owner asked what was meant by "every order is a greenway order, and that
-- becomes wrong after L-6 lands". Here is the literal answer.
--
-- public.orders was created in 0007_slice7_orders.sql for exactly one purpose:
-- holding orders placed on the Greenway website. It has never had a column
-- saying where an order came from, because until now there was only one
-- possible answer. Verified by measurement, not memory: searching all 225
-- existing migrations for an origin column on this table returns nothing. The
-- `origin` columns that DO exist in this schema belong to other tables
-- entirely -- purchase_orders.origin (manual | ai_suggested, 0048),
-- kb_strains.origin (0020), product_masters.created_origin (0036).
--
-- So today, "this row is a Greenway website order" is not recorded anywhere.
-- It is ASSUMED, by the fact that the row exists at all. That assumption has
-- been correct for 225 migrations and it is about to stop being correct,
-- because L-6 and L-7 put Leafly orders into the same table so that staff can
-- work one queue instead of two.
--
-- Why that matters beyond tidiness -- and it matters a great deal -- is the
-- customer email. Leafly's Order API specification says, verbatim:
--
--   "Leafly will be the sole originator of automated consumer facing
--    communications related to orders placed on the Leafly platform. That is,
--    Leafly shoppers should receive _no_ automated emails or text messages
--    from a partner system with regard to order confirmation, status updates,
--    etc."
--
-- Our checkout path sends a confirmation email on every new order. If a Leafly
-- order lands in public.orders with nothing marking it as Leafly's, that email
-- goes out, and we have breached the integration agreement -- invisibly, since
-- the complaint goes to Leafly and not to us. This column is what
-- mayEmailCustomerForOrigin() in src/lib/orders/order-origin-core.ts reads to
-- stay silent.
--
-- DEFAULT 'greenway' is therefore a statement of fact about history, not a
-- convenience: every row that already exists in this table IS a Greenway
-- website order, so backfilling them as 'greenway' is accurate rather than
-- merely expedient.
--
-- The CHECK list is taken from ORDER_ORIGINS in order-origin-core.ts
-- ('greenway', 'leafly', 'register') rather than invented here, so the database
-- and the application cannot drift into disagreeing about what a valid origin
-- is. If a future marketplace is added, it must be added in both places, and
-- the failure mode of forgetting is a loud insert error rather than a quiet
-- mis-sent email.
alter table public.orders
  add column if not exists origin text not null default 'greenway';

-- Applied separately and idempotently, because `add column ... if not exists`
-- silently skips its inline constraints when the column is already there --
-- which would leave a re-run with an unconstrained column and no warning.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_origin_check'
  ) then
    alter table public.orders
      add constraint orders_origin_check
      check (origin in ('greenway', 'leafly', 'register'));
  end if;
end $$;

comment on column public.orders.origin is
  'Where this order came from: greenway (our website), leafly (the Leafly '
  'marketplace, slice L-6/L-7), or register (walked in, rung up in the POS). '
  'Added in 0226. Before this column existed the answer was implicit -- the '
  'table only ever held website orders -- and that implicit assumption becomes '
  'FALSE once Leafly orders share the table. Read by '
  'mayEmailCustomerForOrigin() to honour Leafly''s rule that "Leafly will be '
  'the sole originator of automated consumer facing communications"; a Leafly '
  'order that looked like a website order would trigger a confirmation email '
  'we are contractually forbidden to send.';

-- Indexed because the orders dashboard filters by it (slice L-7: "show me
-- Leafly orders only"), and because a NOT NULL text column with three values
-- and a heavy skew towards 'greenway' is exactly the case a plain btree
-- handles well for the selective values.
create index if not exists orders_origin_idx on public.orders (origin);

-- -----------------------------------------------------------------------------
-- 3. RLS -- deny-by-default, service role only
-- -----------------------------------------------------------------------------
-- Same posture as 0225. The attempt log references customer-facing order ids
-- and staff identities, and no browser client has any reason to read it: the
-- admin UI reaches it through server actions using the service role. RLS
-- enabled with NO permissive policy means anon and authenticated get nothing.
--
-- (public.orders already has its own RLS from 0007 and is deliberately left
--  alone here -- adding a column does not change who may read the table, and
--  re-declaring policies in a later migration is how policy drift starts.)
alter table public.leafly_outbound_attempts enable row level security;
revoke all on public.leafly_outbound_attempts from anon, authenticated;
