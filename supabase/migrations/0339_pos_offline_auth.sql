-- supabase/migrations/0339_pos_offline_auth.sql  (D161 — offline PIN unlock)
--
-- Owner request (verbatim, 2026-11-04): "please now build for me something
-- that allows my employees to unlock the ipad registers in offline mode. we
-- cant ring a sale if we cant get past the pin unlock page."
--
-- When the internet (or the server) is down, the register iPad now verifies
-- an employee's PIN against a device-bound verifier it stored the last time
-- that employee unlocked it online. Every such offline PIN use (unlock,
-- manager approval, clock PIN) is queued as an `offline_auth` event and
-- re-judged at sync: is the person still active, still a manager, was the PIN
-- from before an owner reset? Doubtful events land in the exception queue.
--
-- This migration only widens the event_type CHECK on pos_sale_events (last
-- set in 0301). No PIN, hash or verifier is ever stored server-side by this
-- feature; the owner policy lives in site_settings (pos_offline_unlock_policy).
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied, offline_auth events are REJECTED with a hint naming
-- this file and stay visible on the iPad (nothing is lost).

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment', 'offline_auth'));
