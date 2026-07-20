# Bible 01 — Register Lifecycle

> **Scope:** everything that happens on the iPad register OUTSIDE of ringing a sale:
> device provisioning, the lock screen and PIN unlock, clock in/out from the lock
> screen, idle/auto-lock, session resume, the offline event queue and its sync
> contract, service-worker updates, menu caching, and the register-side till
> (count-in / safe drop / blind close).
>
> **As of:** main `a61aa816` (2026-07-20). Line numbers drift as code changes — the
> durable anchors are the named functions/constants cited next to each line.
>
> **Primary files:**
> - `src/app/pos/RegisterShell.tsx` (device shell — screens, queue, lifecycle)
> - `src/lib/pos/register-client-core.ts` (pure queue/envelope logic)
> - `src/app/api/pos/sync/route.ts` + `src/lib/pos/sync-store.ts` (server ingest)
> - `src/app/api/pos/unlock/route.ts` (PIN unlock)
> - `src/app/api/pos/till/route.ts` + `src/lib/pos/till-core.ts` (drawer work)
> - `src/lib/pos/device-setup-core.ts`, `src/lib/pos/device-store.ts` (provisioning)
> - `src/lib/pos/sw-core.ts`, `src/app/pos-sw.js/route.ts`, `src/app/api/pos/version/route.ts` (updates)
> - `src/lib/pos/active-sale-resume-core.ts` (session resume)
> - `src/lib/security/pin-hash.ts`, `src/lib/security/pin-throttle-core.ts`, `pin-throttle-store.ts` (PIN security)

---

## 1. The three screens (plus loading)

The register is a single React component tree (`RegisterShell`) with exactly four
screen states (`type Screen`, `RegisterShell.tsx:119`):

| Screen | When | What the human sees |
| --- | --- | --- |
| `loading` | First milliseconds of every boot | Wordmark + "Loading register…" while localStorage is hydrated (`RegisterShell.tsx:707`) |
| `setup` | No device credentials stored | One-time provisioning form (device id + device key) |
| `locked` | Credentials exist, nobody unlocked | PIN pad. This is the register's RESTING state |
| `home` | A valid PIN unlocked | Tiles: New Sale, holds, till, reports, pickup queue, etc. |

**Boot rule (plain English):** turn the iPad on → you get the lock screen if the
device was ever provisioned, or the setup form if it never was. You NEVER boot
straight into an unlocked register. (`setScreen(c ? "locked" : "setup")`,
`RegisterShell.tsx:277`.)

### 1.1 What boot restores from localStorage

The boot effect (`RegisterShell.tsx:224–299`) hydrates, in order:

| Key | Contents | On corruption |
| --- | --- | --- |
| `gw-pos-device` (`LS_DEVICE`) | `{deviceId, deviceKey, name, registerId}` | Treated as absent → setup screen (`loadCreds`, `RegisterShell.tsx:121`) |
| `gw-pos-queue` (`LS_QUEUE`) | Offline event queue (v1 wrapper) | Bad rows DROPPED with a counted banner: "N corrupted queue row(s) were dropped…" (`parseQueue`; banner `RegisterShell.tsx:275`) |
| `gw-pos-seq` (`LS_SEQ`) | Last used envelope sequence | Recovered as `highestSequence(queue, stored)` so the sequence can never go backwards even if the number is lost (`RegisterShell.tsx:272`) |
| `gw-pos-last-receipt` (`LAST_RECEIPT_KEY`) | Frozen copy of the last receipt | Parser returns null → reprint tile just absent |
| `gw-pos-held-sale` (`HELD_SALE_KEY`) | The one parked (held) sale | Parser returns null → no hold |
| `gw-pos-theme` (`THEME_KEY`) | light/dark | Degrades to dark |
| `gw-pos-medical-testmode` (`MEDICAL_TESTMODE_KEY`) | Slice 5 rehearsal flag | Fails safe to OFF (never silently drops real tax) |
| `gw-pos-menu` (`LS_MENU`) | Cached menu bundle for offline sales | Ignored; next online refresh replaces it |
| `gw-pos-active-sale` (`ACTIVE_SALE_KEY`) | Parked in-progress sale | Read at UNLOCK time, not boot (see §6) |

**Design intent:** every localStorage parser fails to a safe default. A corrupted
blob can never brick the register, garbage-print a receipt, or flip a tax flag on.

---

## 2. Device provisioning (one-time setup)

### 2.1 Where credentials come from

A manager provisions the iPad in the back office (Admin → Registers → POS devices).
`provisionDevice` (`src/lib/pos/device-store.ts:78`) generates the key:

- **Device id** — a UUID (the `pos_devices` row id).
- **Device key** — `randomBytes(24).toString("base64url")` = a 192-bit secret that is
  **exactly 32 characters** of case-sensitive base64url (`device-store.ts:88`).
- The server stores only a **scrypt hash** (`provision_hash`) — the plaintext key is
  shown ONCE at provisioning and never stored server-side.
- `rotateDeviceKey` (`device-store.ts:109`) mints a new key the same way; rotating
  invalidates all older keys for that row.

### 2.2 The setup screen (`SetupScreen`, `RegisterShell.tsx:1412`)

1. The human pastes the id + key.
2. **Before any network call**, `checkSetupCredentials`
   (`src/lib/pos/device-setup-core.ts`) shape-checks both fields:
   - detects the id/key being pasted into each other's fields and **swaps them back
     automatically** with a notice ("The id and key were in each other's fields —
     swapped them back for you", `RegisterShell.tsx:1431`) — this exact mix-up
     blocked first provisioning in the field;
   - both fields containing a UUID gets a specific human explanation;
   - inputs have `autoCapitalize="none" autoCorrect="off" spellCheck={false}`
     because iOS silently capitalizes/autocorrects the case-sensitive key (B26,
     `RegisterShell.tsx:1490`).
3. Verification is an **empty-batch POST to `/api/pos/sync`** (`{events: []}`) —
   the credential heartbeat (`sync/route.ts:55`). Success returns the device's
   name and bound register id.
4. A shape-valid key the server still rejects gets the long "Device key rejected —
   … only the NEWEST key works…" coaching message (`RegisterShell.tsx:1457`).
5. On success the creds are written to `gw-pos-device` and the screen goes to
   `locked` (`RegisterShell.tsx:741`).

**Setup is ONLINE-ONLY.** Offline first-time setup fails with "Could not reach the
server — connect to the internet for first-time setup."

### 2.3 How every server call authenticates the device

Every POS API route reads two headers — `X-POS-Device-Id` + `X-POS-Device-Key` —
and calls `authenticateDevice` (`src/lib/pos/sync-store.ts:108`):

1. Fails closed if Supabase isn't configured (503).
2. Malformed id (not a UUID) or empty key → 401.
3. Looks up `pos_devices` by id; row missing or `status !== "active"` → 401
   "Unknown or revoked device." (**Revoking a device in the back office cuts it
   off on its next request.**)
4. scrypt-verifies the key against `provision_hash`; mismatch → 401 "Device key
   rejected."
5. On success, best-effort updates `last_seen_at` (a heartbeat that never blocks).

These POS routes are deliberately **NOT behind the admin middleware** (its matcher
is `/admin/:path*`) — the iPad has no Supabase session; the device key IS the
credential.

**Two-factor discipline:** the device key identifies the IPAD; the PIN identifies
the HUMAN. A stolen PIN is useless without a provisioned device, and vice versa.

---

## 3. The lock screen: PIN unlock and clock in/out

### 3.1 PIN facts

- PINs are 4–6 digits (`isValidPin`, shared with the time clock).
- Stored as **salted scrypt hashes** (`hashPin`, `src/lib/security/pin-hash.ts:26`;
  N=16384, 16-byte salt, 32-byte key, `scrypt1$` prefix); verified constant-time
  (`verifyPin`).
- A legacy plaintext PIN that still matches is upgraded to a hash **on the spot**
  on first successful use (`getEmployeeByPin`, `src/lib/staffing/store.ts:117`).
- Duplicate PINs are blocked at save time in the back office by verifying the new
  PIN against every existing hash (`src/app/admin/staffing/actions.ts:125–129`),
  so one PIN maps to at most one active employee.

### 3.2 Brute-force throttle

All PIN entry points on a device share ONE throttle scope: `pos-device:<deviceId>`
(`deviceThrottleScope`, `src/lib/security/pin-throttle-core.ts:96`). Policy
(`pin-throttle-core.ts:29–31`): **5 failures inside 60 seconds locks the pad for
60 seconds.**

- The throttle is DURABLE (table `pin_throttle`, migration 0123) so it survives
  cold starts and is shared across server instances (`pin-throttle-store.ts`).
- If the table is missing or a read/write fails, it **falls back to the legacy
  in-memory window** — the pad is never less protected than before AN-8.
- A successful PIN clears the scope (durable delete + in-memory clear).

### 3.3 Unlock flow (`LockScreen`, `RegisterShell.tsx:1532`; route `unlock/route.ts`)

1. Cashier taps 4–6 digits, hits GO → `POST /api/pos/unlock` with device headers +
   `{pin}`.
2. Server order of checks: device auth → device must be **bound to a register**
   (409 "…a manager must assign one in the back office" if not) → throttle gate
   (429) → PIN format (400) → `getEmployeeByPin` (401 "No active employee for that
   PIN." + failure recorded).
3. On success the response carries (`unlock/route.ts:75–92`):
   - `employee`: id, fullName, jobRole, `clockedIn` (is there an open punch?), and
     `sawUsername` (Slice 6 — username ONLY, for the medical-verify step);
   - `register.id`;
   - `drawer`: the register's open drawer session or null.
4. **Every unlock writes an audit row** `register.unlocked` tying the person, the
   device, and the register together (`unlock/route.ts:66`).
5. The shell stores the employee + drawer in memory only (never localStorage) and
   flips to `home`. If the server reports a different bound register id than the
   cached one, the cached creds are updated (`RegisterShell.tsx:757`).

**Unlock is ONLINE-ONLY in this build.** Offline PIN entry shows: "Offline — unlock
requires a connection in this build. (Offline PIN cache ships with the Capacitor
app.)" (`RegisterShell.tsx:1597`).

### 3.4 Clock in/out from the lock screen

The lock screen has a second mode ("Clock in / out instead"). It reuses the SAME
`/api/pos/unlock` verification, but instead of opening a session the shell
enqueues a `punch` event with intent `in`/`out` (flipped from `clockedIn`) into
the offline queue and immediately tries a flush (`onPunch`,
`RegisterShell.tsx:790–795`). The banner confirms: "NAME: clock-in recorded
(offline — will sync)." if offline. **The punch itself is queue-carried, so a
network blip between verify and flush cannot lose it.**

---

## 4. Locking: idle, explicit, and iOS lifecycle hardening

- **Idle auto-lock:** 2 minutes without `pointerdown`/`keydown` while on `home`
  (`IDLE_LOCK_MS`, `RegisterShell.tsx:105`; timer wiring `RegisterShell.tsx:655–664`).
- **Auto-lock after every completed sale** (SaleFlow hands control back; see
  Bible 02).
- **Explicit lock** button on the home screen.
- `lock()` (`RegisterShell.tsx:636`) ALWAYS: parks the in-progress sale first
  (§6), clears the live-sale ref, drops the employee/session state, closes any
  open modals, and shows `locked`. **The employee identity never survives a lock —
  the next human must PIN in as themselves.**
- **iOS lifecycle hardening** (`RegisterShell.tsx:672–693`): `pagehide` and
  `visibilitychange→hidden` both trigger `parkActiveSale()` WITHOUT tearing down
  the session — if iOS backgrounds, suspends, or discards the PWA (or someone
  pulls-to-refresh), the in-progress sale is already persisted; if the tab comes
  back it keeps running untouched.

---

## 5. The offline event queue (the register's spine)

### 5.1 What an event is

Everything durable the register does (sales, punches, medical card captures,
void/return requests…) travels as an **envelope** (`buildEnvelope`,
`src/lib/pos/register-client-core.ts:38`):

```
{ clientUuid, deviceId, registerId, employeeId,
  sequence, occurredAt, eventType, payload, queuedAt }
```

- `clientUuid` = `crypto.randomUUID()` minted at enqueue → the **idempotency key**.
- `sequence` = per-device **monotonic counter** (`seqRef`), advanced on every
  enqueue and floored/rounded defensively.
- Enqueue requires a bound register; `enqueue()` returns null without one
  (`RegisterShell.tsx:414` — unreachable in practice because unlock 409s first).

### 5.2 Queue rules (plain English)

1. **Append-only until the server durably ACKs.** Nothing is deleted on send —
   only on ACK.
2. ACK statuses (`applyAcks`, `register-client-core.ts:83`):
   - `processed` — durably applied → row leaves the queue.
   - `duplicate` — this exact clientUuid was accepted earlier → row leaves.
   - `exception` — recorded in the manager exception queue (durably accepted; a
     human resolves it server-side) → row leaves.
   - `rejected` — never entered the ledger → row is KEPT, flagged with the
     reason, moved to the rejected list, and surfaced ("N event(s) were rejected
     by the server and kept for review: …", `RegisterShell.tsx:459–463`). The home
     screen shows "N rejected — manager reviews in the back office"
     (`RegisterShell.tsx:2225`). Rejected rows are **never re-sent blindly**
     (`nextFlushBatch` filters them out).
   - No ACK for a row → it simply stays queued for the next flush.
3. **Flush batching:** at most 50 rows per request, in true offline order —
   sorted by deviceId, then sequence, then occurredAt (`nextFlushBatch` →
   `sortEventsForReplay`, `sale-event-core.ts:562`). Server enforces the same
   MAX_BATCH=50 with a 413.
4. **Flush triggers:** every 15 s while credentialed and online
   (`RegisterShell.tsx:490–497`); immediately on the browser's `online` event
   (`RegisterShell.tsx:476`); immediately after a punch; after sale completion.
   A `flushingRef` guard prevents overlapping flushes.
5. **Failure handling:** network errors keep the queue untouched (interval
   retries). A 401 puts "Device credentials rejected — see a manager." in the
   banner (`RegisterShell.tsx:453`). Other non-OK statuses retry silently.
6. **Persistence:** the queue (+ rejected rows) and sequence are re-written to
   localStorage on every change (`RegisterShell.tsx:404–410`). See finding
   GW-001 — these two writes are not try/caught.

### 5.3 The server side (`/api/pos/sync` → `ingestPosEvents`, `sync-store.ts`)

1. Device auth (fails closed), body must be `{events: [...]}`, empty batch =
   heartbeat, >50 = 413.
2. Every envelope is validated AND **bound to the authenticated device** —
   `checkEnvelopeForDevice` rejects envelopes whose deviceId/registerId don't
   match the credential that carried them (a foreign device can't forge another
   register's facts).
3. Valid envelopes replay in `sortEventsForReplay` order so punches/sales land
   chronologically.
4. **Idempotency at the database:** insert into `pos_sale_events` with UNIQUE
   `client_uuid`. A unique violation (Postgres `23505`) re-reads the existing row
   and returns its ORIGINAL outcome as `duplicate`/`exception`
   (`sync-store.ts` `ingestOne`) — a retried flush converges without
   double-posting a sale.
5. Precise rejection reasons for missing migrations (e.g. the 0121 medical
   CHECK-constraint message).
6. Best-effort `last_synced_at` stamp on the device row.

**The invariant that matters:** a sale/punch is only ever counted ONCE, no matter
how many times a flaky network retries it, because the clientUuid is unique at
the DB layer and the ACK vocabulary distinguishes "durably accepted" from
"rejected".

---

## 6. Session resume (the parked in-progress sale)

Key `gw-pos-active-sale` (`ACTIVE_SALE_KEY`,
`src/lib/pos/active-sale-resume-core.ts:41`), TTL **30 minutes**
(`ACTIVE_SALE_TTL_MS:49`).

### 6.1 What gets parked, and when

`parkActiveSale` (`RegisterShell.tsx:600–635`) snapshots the live sale whenever
the register locks (idle, explicit, post-sale) or the page hides/unloads. The
snapshot keeps ONLY:

- the re-validatable age-gate **verdict** (DOB, ID expiration, method);
- cart lines as **variant ids + quantities — NEVER prices**;
- the medical card capture (if any), the attached member, who saved it, when,
  and the source website-order id (AM-D2).

A pre-gate sale (no verdict) is never parked — any stale snapshot is cleared
instead. Parking never throws; a full disk just means the ID gate re-runs.

### 6.2 What resume re-checks

At UNLOCK (`onUnlocked`, `RegisterShell.tsx:764–786`), the shell parses the
snapshot and runs `evaluateResume` (`active-sale-resume-core.ts:243`) against the
store's **Pacific** calendar day and the current clock:

- snapshot older than 30 min → refused ("too old to resume — rescan the ID");
- timestamp in the future beyond TTL (clock jumped) → refused;
- customer must STILL be ≥ 21 today; ID must not have expired since the scan;
- a parked medical card must still be effective and unexpired **today**;
- ANY doubt → snapshot cleared, banner explains why, sale restarts at the ID
  gate (the safe default).

On success the sale resumes PAST the age gate, and the cart is **rebuilt against
the CURRENT menu bundle** (`rebuildHeldCart`, `RegisterShell.tsx:793–799`) — fresh
prices, vanished/86'd items dropped. **A resumed sale can never ship a stale
price.**

### 6.3 Holds vs. the parked sale

A B17 **hold** ("save this sale for later", key `gw-pos-held-sale`) is a
different thing: it always re-runs the ID gate on resume, only one hold exists
at a time, and taking a hold deliberately clears the active-sale snapshot and
the website-order pointer so two parked sales can't fight
(`RegisterShell.tsx:815–848`).

---

## 7. Service-worker updates (how a deploy reaches the iPad)

- The worker is **built per deploy** with the commit SHA baked into its cache
  names (`buildPosServiceWorkerSource`, `sw-core.ts:109`; served by
  `GET /pos-sw.js`, `src/app/pos-sw.js/route.ts`) — every deploy is a
  byte-different worker, so installed registers detect it.
- Scope is `/pos` only; it NEVER intercepts `/api/*` or cross-origin requests —
  sync semantics are untouched by caching. `/pos` HTML is network-first with
  cache fallback (offline boot); static assets are cache-first.
- **An update can never land mid-sale:** install no longer calls
  `skipWaiting()`; a new worker PARKS in the waiting state (AN-0). It activates
  only when the shell posts `SKIP_WAITING`, which happens in exactly two ways:
  1. **Automatically on the LOCK screen only** (`shouldAutoApplyUpdate`,
     `sw-core.ts:91` — locked = nobody mid-sale; a held sale survives the reload
     in localStorage);
  2. Manually via the home-screen "Update available" banner.
  The `controllerchange` listener registered at boot reloads the page exactly
  once when the new worker takes over (`RegisterShell.tsx:265`).
- **Lock-screen update pump (AN-1):** while locked, every 60 s the shell asks the
  registration to re-check for a new worker AND probes `GET /api/pos/version`
  (unauthenticated on purpose — the SHA of a public deploy isn't a secret, and a
  stale device might predate a key rotation). `isBuildStale` compares the running
  build to the server's; "dev" on either side is never stale, so a garbage fetch
  can't trigger refresh loops (`sw-core.ts:74`; pump `RegisterShell.tsx:328–366`).
- **Force refresh** (always reachable on the lock screen): unregisters the /pos
  worker, deletes every `gw-pos-*` cache (`isPosCacheName` — the admin push
  worker at scope `/` is never touched), and reloads. Best-effort at every step
  so a partial failure still reloads (`forceRefresh`, `RegisterShell.tsx:383–403`).
- The lock screen footer shows the RUNNING build (`v<sha>`), and the button
  becomes "Update available — tap to refresh" when a worker is parked or the
  server reports a newer deploy (`RegisterShell.tsx:1662–1690`).

---

## 8. Menu bundle caching

- On credential bind (and on demand from the home screen) the shell fetches
  `/api/pos/menu` with device headers and caches the bundle to `gw-pos-menu`
  (`refreshMenu`, `RegisterShell.tsx:500–523`).
- **Offline sales use the last downloaded bundle** until a refresh succeeds.
- 86'ing an item (B43 stock-flag, ONLINE-ONLY) also strips it from the local
  cached bundle immediately so this register stops selling it before its next
  refresh (`onStockFlag`, `RegisterShell.tsx:900–935`).
- Slice 5 medical test mode transforms the bundle ONLY in memory at render time
  (`applyMedicalTestMode` — forces `medical.endorsed=true` when a medical block
  exists; never fabricates one, never touches the server; loud banner while
  active) (`effectiveBundle`, `RegisterShell.tsx:700–704`).

---

## 9. Register-side till (count-in / drop / blind close)

Endpoint: `POST /api/pos/till` (`till/route.ts`); pure validation in
`till-core.ts`. **ONLINE-ONLY by nature** — PINs can't verify offline and cash
custody events must land server-side the moment cash moves. All actions require
device auth + a bound register + the shared throttle + a valid employee PIN.

### 9.1 open — count-in
- Full denomination breakdown; **the counted total IS the opening float**.
- An empty float cannot open a drawer (validated: `denomTotalMinor(denoms) > 0`).
- One open session per register (enforced by `openDrawer`; second open → 409).
- Best-effort stamp of `drawer_sessions.device_id` (migration 0120) so oversight
  can see which iPad served the session — never blocks the open.
- Audit row `drawer.opened`.

### 9.2 drop — mid-shift safe drop
- Amount in MINOR UNITS (cents), integer > 0, capped at $50,000
  (`MAX_DROP_MINOR`) as an absurdity guard; window must be
  afternoon/night/other; notes ≤ 500 chars.
- `dollarsToMinor` parses cashier-typed dollars ("$1,250.50") and returns null —
  never 0 — for blank/invalid/negative input, so the UI disables submit instead
  of recording a $0 drop (`till-core.ts:80`).
- **Optional witness = a SECOND person's PIN verified server-side** ("a name
  typed into a box proves nothing; a PIN proves presence"). A drop cannot
  witness itself — same employee id is rejected (`till/route.ts:140`).
- Requires this register's open session (409 "No open drawer on this register."
  otherwise). Audit row `drawer.drop` with amount/window/witnessed.

### 9.3 close — BLIND count-out
- Full denomination breakdown, recorded blind: **the response is `{ok:true}` and
  nothing else — never expected cash, never variance, never even the counted
  total echoed back** (`till/route.ts:174–192`). The manager reveals over/short
  at reconcile in the back office. A zero count is legitimate (all cash was
  dropped). Audit row `drawer.closed_blind`.
- `reconcile` is NOT a register action — `validateTillRequest` rejects unknown
  actions by design (self-test: "reconcile is a back-office manager step, never
  register-side").

### 9.4 Money conventions
Everything is **integer cents** (minor units). Denomination math is shared with
the back office via `src/lib/registers/cash.ts` (pure). Per-denomination counts
are clamped to 99,999 (`MAX_DENOM_COUNT`); unknown denomination keys are dropped
(`sanitizeDenoms`).

---

## 10. Background polls & capability checks (while unlocked)

| What | Cadence | Gate | Failure mode |
| --- | --- | --- | --- |
| Queue flush | 15 s | creds + navigator.onLine | queue keeps rows; retry |
| Version probe + SW check | 60 s | LOCKED screen only | staleness stays unknown |
| Pickup-queue badge | 45 s | home + creds + online | badge shows nothing |
| Email-provider capability | once per creds bind | creds | email-receipt option never renders (no dead buttons) |
| Menu refresh | once per creds bind + manual | creds | cached bundle covers the sale |

---

## What SHOULD never happen (misbehavior watchlist)

Test against this list. Any of these observed in the field is a bug — report it
with the time, register name, and what was on screen.

1. **Booting straight into an unlocked register** (skipping the PIN pad) — the
   employee session must never survive a restart or lock.
2. **A sale, punch, or card capture counted twice** — no matter how bad the
   network was or how many times the register retried. (clientUuid idempotency.)
3. **A queued event silently vanishing** — rows leave the queue ONLY on durable
   ACK; rejected rows must stay visible until a manager reviews them.
4. **The register selling from a $0/blank menu after being offline** — offline
   sales must use the last cached bundle.
5. **A resumed sale showing yesterday's price** — resumed/held carts are rebuilt
   against the CURRENT bundle, always.
6. **A resumed sale skipping the age gate with an expired ID / underage DOB /
   expired medical card** — resume re-validates all three against today.
7. **A parked sale resuming after more than 30 minutes** — TTL refusal must
   force a fresh ID scan.
8. **An app/deploy update applying mid-sale** — updates park; they apply only on
   the lock screen (auto) or via the explicit home banner.
9. **"Force refresh" breaking the admin site's push worker** — it may only
   delete `gw-pos-*` caches.
10. **PIN pad accepting unlimited rapid guesses** — 5 fails in 60 s must lock
    the pad for 60 s (shared across unlock/till/approve on the same device).
11. **A revoked device still syncing or unlocking** — revocation cuts it off at
    the next request.
12. **The blind close revealing expected cash or variance at the register** —
    the response carries `ok` and nothing else.
13. **A $0 or negative safe drop being recorded**, or an empty float opening a
    drawer.
14. **A drop witnessing itself** — the witness must be a different person's PIN.
15. **Two open drawer sessions on one register.**
16. **Any employee action attributed to the wrong person** — every unlock, till
    action, and queued event carries the verified employee id; every unlock and
    till action writes an audit row.
17. **The idle register staying unlocked** — 2 minutes untouched must lock it.
18. **Medical test mode surviving into production silently** — it shows a loud
    banner whenever active and never touches the server.

---

*Chapter status: DRAFTED at main `a61aa816`. Findings logged during this trace:
GW-001 … GW-007 (see `../FINDINGS.md`).*
