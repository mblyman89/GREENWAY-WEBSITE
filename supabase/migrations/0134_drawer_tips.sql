-- ---------------------------------------------------------------------------
-- 0134_drawer_tips.sql  (Feature slice 30 - tips in the end-of-shift count-out)
--
-- drawer_sessions.tips_minor - tips counted at close, in MINOR UNITS (cents).
--
-- Semantics (owner's rule: tips are the EMPLOYEE'S money, not store cash):
--   * NULL = tips were not recorded for this close (every session closed
--     before this feature shipped, or the cashier skipped the field).
--   * 0    = the cashier explicitly counted a zero tip jar.
--   * > 0  = cents counted out of the tip jar at close.
--
-- Tips NEVER enter the drawer math: expected close stays
--   opening float + cash sales - safe drops
-- and over/short compares the BLIND drawer count against that expected
-- figure. The tip jar is counted separately and openly (it is the
-- cashier's own money, so there is nothing to keep blind).
--
-- Idempotent (add column if not exists); safe to re-run. No backfill:
-- historical closes simply show no tip figure. RLS on drawer_sessions is
-- unchanged - the new column inherits the table's existing policies.
-- ---------------------------------------------------------------------------

alter table public.drawer_sessions
  add column if not exists tips_minor integer check (tips_minor is null or tips_minor >= 0);

comment on column public.drawer_sessions.tips_minor is
  'Tips counted at close, cents. NULL = not recorded; 0 = counted zero. Employee money - never part of expected-close or over/short drawer math.';
