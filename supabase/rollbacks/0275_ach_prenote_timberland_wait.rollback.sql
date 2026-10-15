-- Rollback for 0275_ach_prenote_timberland_wait.sql (R41 S7).
--
-- Drops the floor trigger and its function. 0263's own checks (eligible_on
-- after settlement; no pass before eligible_on) stay. Rows already sent keep
-- their dates. Nothing is deleted. Safe to re-run.
--
-- After a rollback the database no longer refuses a 3-day prenote wait; the
-- app still computes Timberland's 6 days.

drop trigger if exists trg_ach_verification_timberland_wait on public.ach_verifications;
drop function if exists public.ach_verification_timberland_wait();
