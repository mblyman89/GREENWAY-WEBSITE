-- supabase/migrations/0340_pos_offline_till.sql  (D170 O1 — drawer work offline)
--
-- Owner request (verbatim, 2026-11-04): "I will test that now while you
-- finish all remaining offline mode tasks. ... I want to make sure we are
-- fully hardened and prepared for any situation."
--
-- When the internet (or the server) is down, the register iPad can now count
-- a drawer in, drop cash to the safe, swap change with the safe, open the
-- drawer for the blind count and close it blind. PINs are checked on the iPad
-- (the D161 offline verifier vault; never a PIN or hash), and each action is
-- queued as a `till_action` event. At sync the server re-checks every rule
-- the online till route checks, re-judges each PIN against who is active (and
-- a manager, for a swap) NOW, and writes the drawer rows with the time the
-- cash really moved. Anything doubtful lands in the exception queue.
--
-- This migration only widens the event_type CHECK on pos_sale_events (last
-- set in 0339). No new tables; drawer_sessions, drawer_drops, drawer_counts
-- and safe_swaps already hold everything.
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied, till_action events are REJECTED with a hint naming
-- this file and stay visible on the iPad (nothing is lost).

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment', 'offline_auth', 'till_action'));
