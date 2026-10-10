-- Rollback for 0260_ach_document_intake.sql (R39 S5).
--
-- Drops the two intake functions only. No tables or columns were added, so no
-- data is touched: accepted / rejected documents, authorizations and events
-- stay exactly as they are (they are the record; owner answers Q7 / Q8).
-- After this, the "Accept" and "Reject" buttons say "One-time setup needed".
drop function if exists public.ach_intake_accept_employee(uuid, uuid, date, text, text, boolean, jsonb);
drop function if exists public.ach_intake_finish(uuid, uuid, text, text, jsonb);
