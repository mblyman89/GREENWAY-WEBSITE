# Bible Chapter 04 — Offline Sync & the Event Queue

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9a63c8b1` (all file:line anchors re-checked on
> that tree — if a line number looks off, the file changed after this chapter
> was written; re-verify before trusting).
> **Plain-English promise of this chapter:** the register works with NO
> internet, and NOTHING it does while offline is ever lost, double-counted, or
> silently altered when the internet comes back.

---

## 1. The big idea in one paragraph

Every meaningful thing a register does — a sale, a clock punch, a no-sale
drawer open, a manual ID check, a medical-card capture — is written as a small
sealed "envelope" into a queue that lives ON the iPad. The envelope carries a
one-time UUID (its fingerprint), a per-device counter (its position in line),
and the device's wall-clock time. Whenever the iPad has internet, it mails the
queue to the server in batches. The server accepts each envelope EXACTLY ONCE
(the fingerprint is a database-level UNIQUE key), replays them in the original
offline order, re-checks every legal and money rule server-side as if the sale
were being rung fresh, and answers with one of four verdicts per envelope:
**processed** (durably applied), **duplicate** (already accepted — safe retry),
**exception** (accepted and preserved, but a human manager must review it),
or **rejected** (never entered the ledger; the iPad keeps it and shows it).
Nothing is ever silently dropped.

---

## 2. The envelope — what every event must carry

**File:** `src/lib/pos/sale-event-core.ts`

- The five event types are declared at `:75` (`POS_EVENT_TYPES`): `sale`,
  `punch`, `no_sale`, `manual_id_verification`, and `medical_card_capture`
  (the last one requires migration **0121**; the base table's CHECK constraint
  from migration 0120 lists only the first four — see §7).
- The envelope shape is `PosEventEnvelope` at `:108`:
  - `clientUuid` — client-generated v4 UUID, **the idempotency key, never
    reused** (`:109–110`).
  - `deviceId`, `registerId`, `employeeId` — all must be UUIDs.
  - `sequence` — "monotonic per-device sequence — preserves offline ordering
    on replay" (`:117`).
  - `occurredAt` — device wall clock, ISO-8601 with timezone (`:119`).
  - `payload` — event-type-specific object.
- `validateEnvelope` at `:129` refuses anything malformed: bad UUIDs, negative
  or non-integer sequence, unparseable timestamp, unknown event type, or a
  non-object payload.

**The sale payload** (`PosSalePayload` at `:205`, validated by
`validateSalePayload` at `:305`) is the richest and most defended:

- Every line needs `productId`, `productName`, a `category` snapshot, a
  positive-integer `quantity`, and non-negative-integer cent prices
  (`unitPriceMinor` = charged, `regularPriceMinor` = pre-discount).
- Optional per-line blocks each have their own hard rules:
  - `variantId` (B20) — optional so pre-B20 queued sales still validate, but a
    blank string "is corruption" (`:320–322`).
  - `unitGrams` (AN-1) — optional/null = unknown; when present must be a
    positive finite number (`:326–330`), snapshotted to
    `order_lines.unit_grams` (migration 0122).
  - `override` (B24 manager markdown) — must be a genuine PRICE REDUCTION
    (`charged < originalUnitPriceMinor`, `:353`), reason 3–500 chars, approver
    must be an employees.id UUID. The manager's PIN itself **never rides in
    any queue payload** — it was verified live by `/api/pos/approve` before
    enqueue (comment at `:172–176`).
  - `loyaltyDiscountMinor` (AM-B) — positive integer cents; lines carrying it
    WITHOUT a matching `loyaltyRedemption` block are refused as an "orphaned
    discount" (`:514–517`, rule stated at `:483`).
- Payment: cash-only launch is enforced right here — `ENABLED_PAYMENT_METHODS`
  is `new Set(["cash"])` at `:34`, and `validateSalePayload` refuses any other
  method with "not enabled at this store (cash-only launch)" (`:369–372`).
- Cash math: `computeCashChange` (`:57`) must succeed, and a recorded
  `changeMinor` must equal tendered − due (`:402–414`).
- `rounding` (B33 nickel rounding) — never zero, |adjustment| ≤ 4 cents, due
  must be a multiple of 5 and equal `totalMinor + adjustmentMinor`; tax stays
  computed on the PRE-ROUNDED price (WA DOR interim guidance, comments at
  `:377–381`). When present, the cash-tender check runs against the ROUNDED
  due (`:407`).
- `drawerSessionId` must be a UUID — "sale must belong to an open drawer"
  (`:418`).
- `idVerification.method` must be `"scan"` or `"manual"`; manual MUST carry
  the UUID of its own `manual_id_verification` audit event (`:425–430`) — a
  sale cannot exist without an ID-gate result.
- `medical` (B7/B8) — the captured card (UPID 4–64 chars, YYYY-MM-DD dates,
  holderType patient/designated_provider) plus `mcrVerified === true`
  ("the consultant must verify the card in the DOH Medical Cannabis Database
  before a medical sale (WAC 246-71)", `:452–456`) and the `cardEventUuid` of
  the earlier `medical_card_capture` event.
- `loyalty` (B14 member attach) and `loyaltyRedemption` (AM-B code) blocks —
  UUID + label rules, and appliedMinor must equal the exact sum of per-line
  reductions × quantity (`:508–512`).
- `sourceOrderId` — present only when the sale was started from a loaded
  website pickup order (AM-D); must be a UUID (`:422–424`). See §6 for the
  supersede-on-completion behavior.

**Replay ordering:** `sortEventsForReplay` at `:562` sorts by deviceId, then
monotonic sequence, then time — so a flushed batch is applied in the true
order things happened at the counter.

---

## 3. The iPad side — queue, persistence, flushing

**Files:** `src/lib/pos/register-client-core.ts` (pure logic, self-tested) and
`src/app/pos/RegisterShell.tsx` (the React shell that wires it to the browser).

### 3.1 Pure queue logic (register-client-core.ts)

- `QueuedPosEvent` (`:30`) = envelope + `queuedAt` (diagnostics) +
  `rejectedReason` ("set when the server REJECTED the row — kept + surfaced,
  never re-sent blindly").
- `buildEnvelope` (`:38`) advances the sequence: `max(0, floor(last)) + 1` —
  monotonic, never reuses a number.
- `applyAcks` (`:83`) walks the queue against the server's ACKs:
  durably-accepted rows (processed/duplicate/exception —
  `ackMeansDurablyAccepted` in sync-core `:310`) leave the queue; `rejected`
  rows are moved to a kept-and-shown rejected list with the server's reason;
  un-ACKed rows simply remain for the next flush.
- `nextFlushBatch` (`:104`) = unrejected rows, in true replay order, capped
  (default 50 — matching the server's `MAX_BATCH`).
- `serializeQueue`/`parseQueue` (`:112`/`:122`) — defensive persistence:
  a totally unreadable blob yields an EMPTY queue; individually malformed rows
  are dropped AND COUNTED (`droppedRows`) rather than crashing the register.
- `highestSequence` (`:151`) — the resume point after a reload, so a restart
  never reuses a sequence number.
- All of the above are exercised by `__runRegisterClientCoreTests` (`:159`),
  which runs in the pure self-test runner.

### 3.2 The React shell (RegisterShell.tsx)

- localStorage keys at `:97–100`: `gw-pos-device` (credentials — see finding
  GW-006), `gw-pos-queue` (the serialized queue INCLUDING rejected rows),
  `gw-pos-seq` (last used sequence), `gw-pos-menu` (cached menu bundle for
  offline pricing).
- Boot (`:270–272`): parse the persisted queue, then set the sequence ref to
  `highestSequence(parsed.queue, storedSeq)` — whichever is higher wins, so
  neither a stale seq key nor a stale queue can cause reuse.
- Persistence effect (`:404–410`): on every queue/rejected change, write
  `serializeQueue([...queue, ...rejected])` and the sequence to localStorage.
  **These writes are UNGUARDED — this is finding GW-001** (a full localStorage
  throws inside the effect and can crash the register loop). Confirmed still
  present at `:408–409` on this tree.
- `enqueue` (`:413–431`): `crypto.randomUUID()` → `buildEnvelope` → advance
  `seqRef` → append to queue state. Note the sequence advances in a ref
  BEFORE the state write lands; the persist effect stores both together.
- `flush` (`:434–473`): guarded by `flushingRef` (no overlapping flushes);
  reads `queueRef` (kept in sync by the persist effect — the comment at
  `:438–439` explicitly says "without impure setState tricks"); POSTs
  `nextFlushBatch` to `/api/pos/sync` with the device headers; applies ACKs
  via `applyAcks`; rejected rows raise a visible banner and join the rejected
  list. A network error is swallowed — "queue stays; the interval retries"
  (`:469`).
- Flush triggers: reconnect (`online` event, `:475–488`), a 15-second
  background interval while online (`:490–497`), and several explicit
  "sync now" call sites (e.g. `:780`, `:1264`).
- Menu for offline sales: `refreshMenu` (`:500`) downloads `/api/pos/menu`
  and caches it under `gw-pos-menu` (write failure is non-fatal, `:514–517`);
  offline sales price from the cached bundle until a refresh succeeds. Stale
  cached prices are what the server's AN-5 drift NOTICE (§6) exists to catch.
- **Known findings living in this file:** GW-001 (unguarded persist writes,
  `:408`), GW-002 (register re-bind never persisted), GW-003 (side effects in
  a state updater duplicating rejected rows), GW-006 (device key in plaintext
  localStorage, `:97`), GW-007 (no offline PIN unlock). All logged in
  `FINDINGS.md`; none re-graded here.

### 3.3 Offline boot — the service worker

**File:** `src/lib/pos/sw-core.ts` (AN-0). The worker source is generated by
`buildPosServiceWorkerSource` (`:109`) and served with the commit SHA baked
into cache names (`posSwCacheNames` `:51`, prefix `gw-pos-` `:57`):

- `/pos` HTML: network-first with cache fallback — the register BOOTS with no
  internet (`:99`, fallback asserted by the self-test at `:242`).
- Old versions' caches are deleted on activate (`:139`), and
  `isPosCacheName` (`:64`) makes sure only OUR caches are touched (self-test
  at `:257`: "foreign cache is NOT ours").
- Registration is best-effort at RegisterShell `:241–263`, scoped to `/pos`
  so it can't collide with the admin push worker at scope `/`.

---

## 4. The server door — /api/pos/sync

**File:** `src/app/api/pos/sync/route.ts` (69 lines, read in full).

- Auth: `X-POS-Device-Id` + `X-POS-Device-Key` headers only. The route is
  deliberately OUTSIDE the admin middleware (matcher is `/admin/:path*`) so
  the iPad needs no Supabase session — "the device key IS the credential and
  the route fails closed without a valid one" (header comment `:15–19`).
- `MAX_BATCH = 50` (`:31`); a bigger batch gets HTTP 413.
- An EMPTY batch is a "credential heartbeat" (`:52–56`) — device setup screens
  verify their key without submitting a fact.
- Everything else goes to `ingestPosEvents`; a store-level failure returns 503
  (the device keeps its queue and retries).

**Device authentication:** `authenticateDevice` in
`src/lib/pos/sync-store.ts:108`:

- Fails CLOSED on: unconfigured database (503), malformed id/missing key
  (401), unknown or non-`active` device (401 — revocation is instant), and a
  missing `provision_hash` ("a manager must finish provisioning first").
- The key is verified with scrypt (`verifyPin` against `provision_hash`) —
  plaintext is never stored server-side.
- A `last_seen_at` heartbeat is best-effort and "never blocks ingest"
  (`:128–133`).

**Device binding:** before anything enters the ledger,
`checkEnvelopeForDevice` (`src/lib/pos/sync-core.ts:35`) rejects any envelope
whose `deviceId` doesn't match the authenticated device, whose device has no
register bound, or whose `registerId` doesn't match the bound register — "it
never enters the ledger" (comment `:30–33`). A stolen key can therefore only
speak AS its own device on its own register (the bounded blast radius that
keeps GW-006 at Hardening severity).

---

## 5. Exactly-once ingest — the ledger

**File:** `src/lib/pos/sync-store.ts`, function `ingestOne` (`:190`).
**Table:** `pos_sale_events` (migration `0120_pos_foundation.sql:48`), with
`client_uuid uuid not null unique` at `:51` — the database itself enforces
exactly-once.

The sequence for every envelope:

1. **Insert-once** (`:196–209`): the envelope is inserted into
   `pos_sale_events` as `status='pending'`.
2. **Duplicate convergence** (`:214–228`): a `23505` unique violation means
   this exact clientUuid was accepted before — the server re-reads the
   existing row and returns its RECORDED outcome (`duplicate`, or `exception`
   with the original reason, plus the orderId if one was made). "A retried
   flush converges without double-posting."
3. **Precise migration errors**: missing schema → rejected with the migration
   hint; a `23514` CHECK violation on a `medical_card_capture` → rejected
   with "apply supabase/migrations/0121_pos_medical.sql first" (`:234–241`).
4. **FK violations** (unknown employee/register) → `rejected` — "the event
   never became a ledger fact, the device keeps it visible" (`:243–245`).
5. **AN-3(d) clock drift** (`:250–258`): `checkClockDrift`
   (`sync-core.ts:265`, tolerance `CLOCK_DRIFT_TOLERANCE_MS` = 5 minutes at
   `:250`) flags only FUTURE timestamps — "Lateness is never drift — offline
   queues legitimately flush days later." A drifted envelope becomes an
   EXCEPTION (preserved for manager review), never processed as if the clock
   were right, because a future timestamp "poisons the sales-hours gate and
   the business-day ledger."
6. **Dispatch by type** (`:261–276`), with a catch-all: ANY thrown error
   during processing becomes an exception row (`:277–280`) — never a lost
   event, never a 500 that makes the device retry into ambiguity.

Outcome helpers: `markProcessed` (`:286`) stamps `processed_at`;
`markException` (`:297`) stores the reason (truncated to 1000 chars) and, when
an order was already materialized, links it via `order_id` so the manager can
see exactly what was created.

---

## 6. Replaying a SALE server-side — the full gauntlet

`processSale` (`sync-store.ts:315`) re-earns the sale from scratch. In order:

1. **Payload re-validation** (`:322–325`) — `validateSalePayload` again,
   server-side.
2. **AN-3(c) drawer-session reality check** (`:334–352` calling
   `checkDrawerSessionForSale`, sync-core `:195`): the session must EXIST,
   belong to THE register this device is bound to, and the sale's
   `occurredAt` must fall inside the session's open interval. A late flush
   after the drawer closed is fine; a sale claiming to predate the open or
   postdate the close is an exception. (Before AN-3c "a fabricated or foreign
   session id would have joined the day's cash story unchallenged.")
3. **AN-3(b) manual-ID prerequisite** (`:356–382`): a manual-verify sale must
   reference an ALREADY-SYNCED `manual_id_verification` event (queue flushes
   in order, so it precedes the sale), and that event must have status
   `processed` — an excepted verification "grants nothing."
4. **B8 medical prerequisites** (`:384–430`): the `medical_card_capture`
   event must be synced first; the UPID must resolve to an ACTIVE back-office
   authorization (`findAuthorizationByUpid`); that row must be valid TODAY via
   `authorizationValidityAt` — "same source of truth as the completion gate;
   catches revocations since the download." Any failure = exception BEFORE any
   order exists.
5. **B14 loyalty member** (`:436–460`): the customerId must still resolve
   (deleted/merged = exception, "never a silent recreational-anonymous
   completion — that would quietly lose the customer's points"), and on a
   medical sale the member MUST be the card holder (points on the wrong
   person = exception).
6. **AM-B redemption pre-check** (`:470–510`): the redemption row must exist,
   match the code, still be `issued`, and be worth at least what the device
   applied.
7. **Order materialization** (`:520–588`): insert the `orders` header
   (status `ready`, money in minor units, savings recomputed from the lines),
   then the `order_lines` — with a graceful 0122 fallback: if `unit_grams`
   isn't in the schema yet (PGRST204/42703), retry WITHOUT the weight column
   (`:577–585`). If lines still fail, **the order header is deleted** —
   "never strand a header" (`:587`).
8. **B24 override audit** (`:604–632`): one audit row per overridden line
   (`register.price_override`), queryable by manager, product, and order.
9. **Attach-before-gate** (`:633–662`): medical → `attachCardToOrder` (so the
   completion gate re-validates the card, applies 3× medical limits, and
   writes the WAC 314-55-090(2) exempt-sale ledger); else loyalty →
   `orders.customer_id` link (so the EXISTING completion accrual earns
   points). Attach/link failure = exception carrying the orphaned order's id.
10. **AM-B atomic claim** (`:670–719`): `update … set status='redeemed' where
    id=… AND status='issued'` (`:671–676`) — two registers (or a register +
    the back office) presenting the same code CANNOT both win. If the 0116
    header columns then fail to write, the claim is ROLLED BACK ("never
    strand a consumed code on an order that can't record it", `:696`) and the
    sale excepts with "apply migration 0116."
11. **THE completion gate** (`:723–752`): `runCompletionGate` — "the
    IDENTICAL 8-step sequence the back office runs. POS sync NEVER carries an
    override (`overridePermitted: false` at `:726`) — an over-limit sale that
    slipped through on-device lands in the exception queue." **AN-3(a):** the
    sales-hours check is graded on
    `hoursAt: envelope.occurredAt` (`:733`) — when the sale OCCURRED, not when it
    flushed ("a legal 11 PM sale syncing at 2 AM must pass; an illegal 2 AM
    sale syncing at noon must be refused"); the upstream drift check already
    excepted future stamps, "so this instant cannot be gamed forward."
    A refusal writes an `order.completion_blocked` audit row AND an exception.
12. **Completion** (`:753–766`): `setOrderStatus(order.id, "completed")` —
    this is what fires the standard downstream machinery (loyalty accrual,
    inventory decrement, exempt-sale write via the gate).
13. **AM-D2 supersede-on-complete** (`:777–805`): only NOW, after the
    register sale of record is completed, is the SOURCE website order (if
    any) cancelled with a loud timeline note — so an abandoned load never
    loses the website order, and the two can never both fulfill. Best-effort
    by design: a supersede hiccup NEVER undoes the completed sale; a failure
    leaves an `order.supersede_on_complete_failed` audit row for the manager.
14. **AN-5 price-drift NOTICE** (`:806–832`): compares the device's
    PRE-discount snapshots (`regularPriceMinor`) against the CURRENT published
    menu. Drift never blocks — "the customer paid the displayed price, and
    excepting it would strip its money from the X/Z report" — it writes a
    `register.price_drift` audit row telling the manager which register needs
    a menu refresh. `detectSalePriceDrift` (`:843`) returns `[]` when no menu
    version is published ("never a false positive").
15. `markProcessed` with the `order_id` (`:834–835`).

---

## 7. Replaying the other event types

All in `sync-store.ts`:

- **punch** (`processPunch` `:885`): validates the payload, then resolves the
  device-recorded INTENT against the server's live open-punch state via
  `resolvePunchIntent` (sync-core `:69` — Seam 4, "never blind-toggle"):
  - intent `in` + already in → **skip** (idempotent, processed with a note);
  - intent `in` + not in → clock_in; intent `out` + open punch → clock_out
    (both via the standard `toggleClock`);
  - intent `out` + NO open punch → **exception** ("possible missed clock-in
    or an edit made while the register was offline. Needs manager review.").
- **no_sale** (`:925`): validated (reason 3–500 chars, manager approver),
  written as a `register.no_sale` audit row.
- **manual_id_verification** (`:957`): AN-3(b) — the AGE and EXPIRY math is
  RE-RUN server-side via `checkManualIdMathAtSync` (sync-core `:137`) against
  the EVENT's OWN date (`occurredAt.slice(0,10)`) — "a tampered device or
  corrupted queue row cannot smuggle an underage or expired-document
  verification into the audit trail." Over-40 visual verifications are
  flagged (`visualOver40`) in the `register.manual_id_verification` audit row.
- **medical_card_capture** (`:1012`): validated against the DEVICE's
  wall-clock date ("the capture happened then, possibly offline days ago —
  the SALE re-validates against the durable authorization row at its own
  ingest"), then written as a `register.medical_card_capture` audit row with
  the full card facts + MCR attestation. **Requires migration 0121** (which
  widens the 0120 CHECK constraint on `event_type`); until applied, these
  events are precisely REJECTED with the migration hint (§5 item 3).

---

## 8. The exception queue — the manager's inbox

**Store:** `sync-store.ts` — `posExceptionSnapshot` (`:1077`, exact count for
the AN-6 dashboard badge), `listPosExceptions` (`:1099`, unresolved only:
`resolved_at is null`), `listResolvedPosExceptions` (`:1122`, "the manager's
paper trail"), `resolvePosException` (`:1139`, stamps resolved_by/at + a
required note).
**UI:** `src/app/admin/registers/exceptions/page.tsx` (and the badge on
`src/app/admin/registers/page.tsx`).

The design posture, repeated across every exception message in §6: the ledger
FACT is preserved, the reason says exactly what a human must do ("Re-ring the
sale, then resolve this exception", "apply migration 0116, then resolve"),
and nothing self-heals invisibly.

---

## 9. What SHOULD never happen (the watchlist)

If you ever observe one of these, something is broken — check the anchors:

1. **The same sale posted twice** (two orders from one clientUuid). The
   UNIQUE `client_uuid` (0120 `:51`) + 23505 convergence (`sync-store:214`)
   forbid it.
2. **A queued event vanishing without a trace** — every ACK path is
   processed/duplicate/exception/rejected; rejected rows are KEPT on the iPad
   with a banner (`RegisterShell:458–465`), exceptions are durable DB rows.
3. **A sale accepted for a different register than the device is bound to**
   (`checkEnvelopeForDevice`, sync-core `:35`).
4. **A sale joining a drawer session it couldn't have belonged to** — foreign
   register, before open, after close (`checkDrawerSessionForSale`,
   sync-core `:195`).
5. **A card/ID/manual-verify sale syncing BEFORE its prerequisite audit
   event** — flush order is enforced (`sync-store:356`, `:384`).
6. **An underage or expired-ID manual verification entering the audit trail**
   — the math re-runs server-side (`:957` + sync-core `:137`).
7. **A future-timestamped event processed as normal** — 5-minute drift gate
   (`sync-core:250/:265`) → exception.
8. **A legal late-flushed sale refused for "after hours"** — the gate grades
   `occurredAt`, not sync time (`sync-store:733`).
9. **An over-limit or gate-refused sale completing via sync** —
   `overridePermitted: false`, always (`:726`).
10. **A loyalty code redeemed twice** — atomic conditional claim
    (`:670–676`), with rollback if the header write fails.
11. **Points landing on the wrong person** — member/card-holder mismatch is
    an exception (`:452–459`).
12. **A stranded order header with no lines** — lines failure deletes the
    header (`:587`).
13. **A website pickup order AND its register sale both fulfilling** —
    supersede fires exactly at completion (`:777`), never at load.
14. **A sequence number reused after an iPad reload** — `highestSequence`
    boot logic (`RegisterShell:270–272`).
15. **A non-cash payment method syncing** — cash-only launch enforced in the
    payload validator itself (`sale-event-core:34/:369`).
16. **The register failing to BOOT offline** — the service worker's
    network-first-with-cache-fallback `/pos` shell (`sw-core:99/:156`).

---

## 10. Findings that live in this chapter

No NEW findings from this pass. The already-logged findings whose home is
this machinery (see `FINDINGS.md` for full text):

| ID | Severity | One-liner | Anchor re-confirmed at `9a63c8b1` |
| --- | --- | --- | --- |
| GW-001 | 🟠 Moderate | Queue persistence writes to localStorage are unguarded — quota error can crash the register loop | `RegisterShell.tsx:408–409` |
| GW-002 | 🟠 Moderate | Register re-bind never persisted; stale registerId after restart → rejected envelopes | `RegisterShell.tsx` (see finding) |
| GW-003 | 🟠 Moderate | Side effects inside a React state updater can duplicate rejected-row records | `RegisterShell.tsx` (see finding) |
| GW-006 | 🔵 Hardening | Device key in plaintext localStorage (bounded by device binding, §4) | `RegisterShell.tsx:97` |
| GW-007 | 🟢 Enhancement | No offline PIN unlock — a locked register stays locked during an outage | `RegisterShell.tsx:1597` |

The mitigating context this chapter adds: even if GW-001/GW-003 crash or
duplicate rows on the DEVICE, the server-side UNIQUE key + ACK convergence
mean the LEDGER stays exactly-once; the failure modes are register downtime
and operator confusion, not money corruption.
