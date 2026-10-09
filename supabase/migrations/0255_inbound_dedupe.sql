-- ===========================================================================
-- 0255_inbound_dedupe.sql
--
-- R36 #2 (owner-requested). ONE EMAIL, ONE MANIFEST ROW.
--
-- Owner report (verbatim, abridged): "I emailed the vendor_intake@ address as
-- usual, I waited, then two identical rows appeared in the receiving table,
-- one broke, the other not ... give me a manual button to dismiss a
-- duplicate rather than rejecting it."
--
-- ROOT CAUSE (researched, sourced in docs/research + the R36 bible section):
--   * Resend delivers webhooks through Svix. Svix counts an attempt as FAILED
--     when no 2xx arrives within ~15 seconds, and retries on the schedule
--     "immediately, 5s, 5m, 30m, 2h, 5h, 10h, 10h"
--     (resend.com/docs/webhooks/retries-and-replays, docs.svix.com).
--   * Our inbound webhook ran LlamaParse on every PDF BEFORE answering, which
--     is well past 15 s. So the retry arrived while the first call was still
--     working, and the manifest dedupe was check-then-insert (not atomic):
--     both calls saw "no row yet" and both inserted.
--
-- WHAT THIS ADDS (no new table, nothing dropped)
--   inbound_email_log.delivery_key  text, UNIQUE when not null.
--        The provider's message identity ("resend:email:<email_id>", else
--        "svix:<svix-id>"). The webhook CLAIMS it with an insert before any
--        work; a second delivery of the same message hits the unique index
--        and is answered without staging anything: 200 "already received"
--        when the first delivery finished, 409 "still working" while it is
--        in flight (so Svix retries later instead of giving up), and a
--        delivery whose claim is older than 6 minutes (a crashed run; the
--        route's maxDuration is 300 s) may take the claim over.
--   inbound_email_log.claimed_at    timestamptz - when the claim was taken.
--   inbound_manifests.dedupe_key    text, UNIQUE when not null.
--        "<MANIFEST #>|<VENDOR>" (normalized exactly like
--        manifest-dedupe-core.buildManifestIdentity) while the row is LIVE.
--        Two concurrent stagings of the same manifest can no longer both
--        insert: the loser gets a unique violation and is treated as the
--        duplicate it is. Released (set null) when the row is rejected or
--        dismissed, so a corrected re-send can still stage.
--   inbound_manifests.dismissed_at / dismissed_reason / duplicate_of
--        The new "dismissed" status (a duplicate the owner dismissed - NOT a
--        rejection: nothing was refused at the dock and no lot was received).
--        duplicate_of points at the row that was kept.
--
-- WHAT IT NEVER DOES
--   * No backfill of dedupe_key: existing rows may already contain the
--     owner's duplicate pair, and a backfill would fail on the unique index.
--     Existing rows are still guarded by the app's read-then-check, which
--     is enough for non-concurrent re-sends; the key closes the race for
--     every NEW row.
--   * No status CHECK is added (inbound_manifests never had one; the app's
--     manifest-pipeline-core is the single list of stages).
--
-- IDEMPOTENT (standing rule 6): add-column-if-not-exists, create index if
-- not exists. Before it is applied the app behaves exactly as before: the
-- claim and the key are skipped on a narrow 42703 / PGRST204 "column does
-- not exist" answer (inbound-dedupe-core.isMissingColumnError).
-- APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0255_inbound_dedupe.rollback.sql
-- FACTORY RESET: no new table (inbound_email_log and inbound_manifests are
-- already WIPE; duplicate_of is a self-reference, ON DELETE SET NULL, and
-- inbound_manifests has no raising UPDATE trigger).
-- ===========================================================================

alter table public.inbound_email_log
  add column if not exists delivery_key text,
  add column if not exists claimed_at timestamptz;

create unique index if not exists inbound_email_log_delivery_key_uidx
  on public.inbound_email_log (delivery_key)
  where delivery_key is not null;

alter table public.inbound_manifests
  add column if not exists dedupe_key text,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_reason text,
  add column if not exists duplicate_of uuid references public.inbound_manifests(id) on delete set null;

create unique index if not exists inbound_manifests_dedupe_key_uidx
  on public.inbound_manifests (dedupe_key)
  where dedupe_key is not null;

create index if not exists inbound_manifests_duplicate_of_idx
  on public.inbound_manifests (duplicate_of)
  where duplicate_of is not null;
