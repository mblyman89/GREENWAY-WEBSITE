-- supabase/migrations/0341_pos_offline_reversal.sql  (D170 O2/O3 — voids and returns offline)
--
-- Owner request (verbatim, 2026-11-04): "I will test that now while you
-- finish all remaining offline mode tasks. ... I want to make sure we are
-- fully hardened and prepared for any situation."
--
-- When the internet (or the server) is down, the register iPad can now void
-- a same-day sale or take a return of a sale it rang itself (from its own
-- encrypted sale book). A manager or lead PIN is checked on the iPad (the
-- D161 offline verifier vault; never a PIN or hash), and the reversal is
-- queued as a `reversal` event. At sync the server runs the REAL void /
-- return machinery as of the time the cash moved, re-checks that the
-- approver is still an active manager or lead, and anything doubtful lands
-- in the exception queue.
--
-- This migration only widens the event_type CHECK on pos_sale_events (last
-- set in 0340). No new tables; orders, customer_returns, loyalty_ledger and
-- audit_logs already hold everything.
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied, reversal events are REJECTED with a hint naming this
-- file and stay visible on the iPad (nothing is lost).

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment', 'offline_auth', 'till_action', 'reversal'));
