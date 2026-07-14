-- ---------------------------------------------------------------------------
-- 0121_pos_medical.sql  (POS Slice B8 — medical sales at the register)
--
-- The register enqueues a `medical_card_capture` audit event BEFORE any
-- medical sale (same discipline as manual_id_verification): the recognition
-- card's UPID + effective/expiration dates + holder type + the budtender's
-- MCR-verification attestation become an immutable ledger fact even if the
-- sale is abandoned. The 0120 CHECK constraint enumerated the launch event
-- types, so it must be widened to accept the new one.
--
-- Apply AFTER 0120_pos_foundation.sql. Idempotent.
-- ---------------------------------------------------------------------------

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;

alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture'));
