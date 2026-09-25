-- ============================================================================
-- 0231 — LEAFLY CERTIFICATION PROOF
--
-- SLICE L-47. The owner:
--
--   > "Please now work on slice L-47: the screen showing proof that every
--   >  Leafly action works for certification."
--
-- and, on migrations:
--
--   > "I want a professional enterprise grade solution, so if that means
--   >  giving me a sql migration to run, then please do so."
--
-- ============================================================================
-- WHY A SCHEMA CHANGE WAS NEEDED AT ALL — TWO ENDPOINTS LEFT NO RECORD
-- ============================================================================
-- Leafly's Order API requirement table (vendored verbatim in
-- docs/leafly-specs/order-api-v1.openapi.json, "Preparing for Production")
-- says every element is "validated by review of logged activity". The L-47
-- proof panel may only turn a row green from a RECORDED run, never from a
-- claim. Recon found three endpoints that we call but never write down:
--
--   Fetch Order by ID            GET /{key}/orders/{id}          **Required**
--   Retrieve Government ID Image GET /{key}/government_id/{id}   Recommended
--   Retrieve Medical ID Image    GET /{key}/medical_id/{id}      Recommended
--
-- `fetchLeaflyOrder` (order-fetch-server.ts) and `fetchLeaflyOrderMedia`
-- (order-detail-server.ts) returned their HTTP status to the caller and
-- inserted nothing. A REQUIRED endpoint with no durable evidence would have
-- left the panel two choices: guess, or show that row grey forever. Both are
-- wrong, so the calls are now written to the existing outbound ledger.
--
-- `leafly_outbound_attempts.operation` carries a CHECK (0226) that allows
-- only 'acknowledge' | 'status' | 'cart' — on purpose: WE choose what we send,
-- so an unknown value is our own bug and should be loud. This migration
-- widens that allowlist by exactly three values and nothing else.
--
-- ============================================================================
-- WHAT IS STORED FOR AN ID IMAGE — AND WHAT IS DELIBERATELY NOT
-- ============================================================================
-- For government_id / medical_id rows the application writes the order id,
-- the key, the HTTP status, a disposition and a one-line message. It NEVER
-- writes the image bytes, the content type's payload, or any field of the
-- customer's identity: `response_body` is always null for those operations.
-- A certification ledger that became a store of customers' ID photographs
-- would be a far worse liability than the evidence gap it closes.
--
-- ============================================================================
-- APPLIED BY HAND (AGENTS rule 6) — SAFE TO RUN TWICE
-- ============================================================================
-- Michael applies migrations himself in the Supabase SQL editor. Every
-- statement is idempotent: the constraint is dropped `if exists` and re-added
-- with the full list, and the indexes are `if not exists`. Running this file
-- a second time changes nothing.
--
-- UNTIL IT IS APPLIED, NOTHING BREAKS. The new inserts are best-effort
-- (bounded by dbDeadline("attempt_log"), errors logged, never thrown), so
-- before this runs they are rejected by the old CHECK with 23514, a console
-- line is written, and the order is fetched / the ID image is shown exactly
-- as before. The proof panel then reports those rows as "no record yet" and
-- names this file — it never claims a pass it cannot show.
-- ============================================================================

alter table public.leafly_outbound_attempts
  drop constraint if exists leafly_outbound_attempts_operation_check;

alter table public.leafly_outbound_attempts
  add constraint leafly_outbound_attempts_operation_check
  check (operation in (
    'acknowledge',
    'status',
    'cart',
    -- SLICE L-47: the three read endpoints Leafly grades by logged activity.
    'fetch_order',
    'government_id',
    'medical_id'
  ));

comment on column public.leafly_outbound_attempts.operation is
  'Which Order API endpoint the attempt was aimed at. Allowlisted: '
  'acknowledge | status | cart (0226) and fetch_order | government_id | '
  'medical_id (0231, slice L-47, so the certification proof panel can show '
  'Fetch Order and ID-image retrievals from recorded rows). For the two ID '
  'image operations response_body is ALWAYS null: the ledger records that a '
  'retrieval happened and how Leafly answered, never the image.';

-- The proof panel asks, per operation, "the most recent successful attempt".
-- The existing order_idx is keyed by leafly_order_id and cannot answer that
-- without a scan; this one can, newest first.
create index if not exists leafly_outbound_attempts_operation_idx
  on public.leafly_outbound_attempts (operation, attempted_at desc);

-- The menu-side proof (POST / PUT / DELETE / status / readback) lives in
-- audit_logs, keyed by action name. audit_logs is the busiest append-only
-- table in the system and had no index on `action` (0001 indexes entity,
-- actor and created_at only), so every "latest leafly.* row" lookup would
-- scan it. This index makes the panel's reads O(log n) as the log grows.
create index if not exists idx_audit_logs_action_created
  on public.audit_logs (action, created_at desc);
