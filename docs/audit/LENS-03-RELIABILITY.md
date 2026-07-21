# Lens Pass 3 — Reliability & Failure Modes

**Scope:** what happens when things break — a serverless function dying
mid-work, the internet dropping mid-sale, an email provider rejecting a
call, a printer eating a job, a cron missing a run, a queue filling up.
Covers the offline register queue and sync path end-to-end, the website
order pipeline (save → notify → print), receipt printing (CloudPRNT),
the daily cron, the crawler client, syndication push (Leafly/Weedmaps),
webhooks, menu publish, and backup posture.

**Basis:** every claim verified by reading the code at main commit
`00ebb3dd` (branch `lens-03-reliability`). File:line anchors are as-of that
commit. Standing rule: NEVER GUESS — nothing here is inferred.

**Fix policy (owner's direction):** ALL fixes deferred until every lens pass
is done; this pass only documents. New findings are logged in `FINDINGS.md`
as GW-023…GW-028, ordered below most severe → least, ending with the
verified-GOOD list.

---

## 1. Findings, most severe first

### GW-023 (Moderate, top of this pass) — a sale stranded mid-processing is silently lost
The sync path inserts the sale into the server ledger as `pending`
(`sync-store.ts:196–209`), then runs a long processing chain (~29 sequential
awaits, `:315–835`) and only marks `processed` at the very end (`:834`). If
the serverless function dies in between (timeout, deploy, outage mid-chain):

1. the row stays `pending` **forever** — no sweeper or reprocessor exists
   anywhere in the codebase (verified by search); the only reader is the day
   report, which counts it as "Still processing"
   (`day-report-core.ts:93–95,324`);
2. when the register retries, the server sees the row already exists and
   answers **"duplicate"** (`sync-store.ts:214–227` — only `exception` is
   special-cased, `pending` falls through to duplicate);
3. "duplicate" is a durable ack (`sync-core.ts:310–312`), so the register
   **deletes its own copy** of the sale.

Net effect: cash taken, customer gone, but no order, no inventory decrement,
no X/Z line, no CCRS row — and nothing anywhere will retry it. This is the
single gap in an otherwise excellent exactly-once design. The fix is small
(re-process stale `pending` on the duplicate path + a sweeper in the daily
cron) and is specced in FINDINGS.md.

### GW-024 (Moderate) — order email + receipt queueing can be dropped by the platform
`/api/orders` fires `notifyOrderPlaced(…).catch(() => {})` and
`queueOrderReceipt(…).catch(() => {})` and returns immediately
(`api/orders/route.ts:175–206`). On Vercel the function can be frozen the
moment the response is sent, so the un-awaited email/print work may simply
never run — and the empty catch guarantees no log. No `waitUntil` is used
anywhere in `src` (only the service worker uses it). Some fraction of pickup
orders would save fine but alert nobody.

### GW-025 (Low) — order email is sent blind
`notify.ts:39` awaits the Resend fetch but never checks `res.ok`. A bad API
key, unverified from-address, or rate limit looks identical to success.
Combined with GW-024 the notification path is a black box when it fails.

### GW-027 (Low) — the register's "manager reviews in the back office" promise for rejected rows is not true
Rejected events (refused before entering the ledger) live only in that
device's localStorage; the back-office exception queue only shows
server-side `exception` rows (`sync-store.ts:1087,1107,1130`). The register
status bar (`RegisterShell.tsx:2225`) tells staff a manager will see them in
the back office — a manager must actually walk to that iPad.

### GW-026 (Hardening) — a poison print job retries forever every 2 minutes
`claimNextJob` re-claims stale `printing` jobs (good) but never caps
`attempts` (`printer-store.ts:186–205`); the `failed` status exists in the
type but nothing ever sets it (`:27–33`; only `cancelJob` reads it at
`:246`). One un-printable job at the head of the queue blocks receipts
behind it until manually cancelled.

### GW-028 (Hardening) — the 24-hour order reservation is written but never read
`reservation_expires_at` is computed and stored
(`orders-store.ts:50,65`) and then never consulted by any job, query, or
UI. Orders never auto-expire; no-show is manual. Working as commented
("advisory hold") but it feeds the GW-015 stale-revenue problem.

---

## 2. Verified GOOD — reliability engineering that is already right

- **Idempotent sync ledger.** `client_uuid` UNIQUE means a retried flush can
  never double-post a sale; replay ordering is deterministic
  (`sale-event-core.ts:562–570`); batches capped at 50; envelope validation
  + device binding on every event.
- **Exceptions never drop.** Clock drift, missing drawer session, manual-ID
  problems, medical-card problems, loyalty mismatches — every one becomes a
  manager-queue `exception`, never a silent discard.
- **Atomic loyalty redemption claim** with release-on-failure; the offline
  completion gate re-runs the SAME compliance gate as the back office with
  hours evaluated at the original sale time.
- **Offline queue survives restarts** (localStorage persistence,
  `RegisterShell.tsx:404–410`), flushes every 15 s and on the browser
  `online` event; corrupted rows are dropped with a visible banner, never a
  crash loop (GW-001's quota edge case aside).
- **createOrder degrades gracefully** when newer migrations aren't applied
  (0122/0096 fallback ladders) and rolls back an orphaned order header if
  the lines insert fails (`orders-store.ts:43–120`).
- **Pickup completion fails loud, not silent:** if the day-ledger write
  fails after a pickup completes, a prominent note is written to
  `order_events` telling staff X/Z will undercount and to reconcile
  manually (`pickup-store.ts:243–254`).
- **Menu publish is atomic** — `publish_menu_version()` swaps the live
  pointer in a single SQL statement (`0002:238–242`); a failed import can
  never leave a half-published menu.
- **Cron is authenticated and deduplicated** — CRON_SECRET fails closed in
  production; `compliance_reminder_log` dedupe keys make a double-fired or
  manually re-run cron harmless (`compliance-reminders.ts:138–145`);
  `maxDuration 60` is set.
- **Syndication pushes retry properly** — both the Leafly and Weedmaps
  clients implement 429/5xx exponential backoff with an owner-tunable
  attempt cap (`leafly/push.ts:174–212`, `weedmaps/push.ts:254–294`), and
  every attempt is logged with payload + response for audit.
- **Webhooks are idempotent** — Resend/Svix events dedupe on the Svix
  message id and the endpoints return 200 on accepted payloads so provider
  retries can't create storms; signatures fail closed in production.
- **Crawler client can't hang the server** — explicit AbortSignal timeouts
  on every call (240 s research / 60 s social / 5 s health,
  `crawler-client.ts:109,154,196`).

---

## 3. Carried forward (not new, but reliability-relevant)

- **GW-001** — unguarded localStorage persistence (quota exhaustion crashes
  the register loop).
- **GW-007** — a register that locks during an outage can't be unlocked
  offline.
- **No backup/restore runbook** — already flagged in
  `GREENWAY_FULL_SCOPE_AUDIT.md`; folded into the Owner Task List
  (`OWNER-TASKLIST.md` §2) and, later, the Cutover Checklist: enable
  Supabase PITR/scheduled backups and write down the restore steps.

---

## 4. What remains in the audit after this pass

1. **Lens Pass 4 — Code quality, UX & operability** (the last lens): dead
   code, inconsistent patterns, accessibility of the register UI, admin
   ergonomics, log hygiene. Lighter than passes 1–3.
2. **TEST-PLAN.md** — a hands-on script the owner can follow to exercise
   every subsystem end-to-end before opening day.
3. **CUTOVER-CHECKLIST.md** — the ordered go-live list (migrations →
   dashboard settings → env vars → smoke tests), building on
   `OWNER-TASKLIST.md` from this pass.
4. **Fix slices** — then, and only then, fixes begin: most severe first
   (GW-010 compliance tax math), then the moderates (GW-011/012/017/018/023/
   024…), then lows, hardening, enhancements — one reviewed PR per slice.
