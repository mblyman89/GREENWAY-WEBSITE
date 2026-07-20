# Audit Findings Log

> Conventions: see `README.md`. IDs are permanent (`GW-###`). Newest findings appended at
> the bottom of their severity section. Every finding carries: where (file:line at the
> commit noted), what, why it matters, recommendation, and status.

**Log opened:** 2026-07-20 · main @ `a61aa816`

---

## 🔴 Critical

*(none logged yet)*

---

## 🟠 Moderate

### GW-001 — Offline-queue persistence writes are unprotected; a full localStorage crashes the register loop
- **Where:** `src/app/pos/RegisterShell.tsx:404–410` (queue/sequence persist effect), at `a61aa816`.
- **What:** The effect that persists the offline queue calls
  `window.localStorage.setItem(LS_QUEUE, …)` and `setItem(LS_SEQ, …)` with **no
  try/catch**. Every OTHER localStorage write in the shell (theme, medical
  test-mode, menu cache, held sale, last receipt, active-sale snapshot) is
  wrapped in try/catch with a documented degrade path; these two — arguably the
  most important writes in the file — are not. The provisioning write at
  `RegisterShell.tsx:721` (`setItem(LS_DEVICE, …)`) is also unguarded.
- **Why it matters:** If storage quota is exhausted (e.g. a long offline stretch
  growing the queue, or iOS pressure), `setItem` throws inside a `useEffect`,
  which unmounts the React tree — the register white-screens **every time the
  queue changes**, potentially mid-shift. The in-memory queue is lost on the
  resulting reload back to whatever last persisted. Amplifier: a permanently
  rejected/401 state lets the queue grow without bound (no cap or size alarm),
  marching toward exactly this failure.
- **Recommendation:** Wrap both writes in try/catch; on failure surface a
  persistent banner ("Register storage is full — call a manager; do NOT keep
  ringing sales offline") and keep the in-memory queue serving. Consider a
  queue-length watermark banner (e.g. >200 pending) as an early warning.
- **Status:** OPEN

### GW-002 — A register re-bind is never persisted; after a restart, lock-screen punches carry the stale register id and are rejected
- **Where:** `src/app/pos/RegisterShell.tsx:757` (`onUnlocked` updates `creds`
  in memory only) vs `RegisterShell.tsx:721` (the ONLY `setItem(LS_DEVICE, …)`,
  at provisioning), at `a61aa816`.
- **What:** When an unlock reveals the server moved this device to a different
  register, the shell updates the in-memory `creds.registerId` — but never
  rewrites `gw-pos-device`. After the next app restart, boot re-loads the OLD
  register id. Envelopes built before the next successful unlock — notably
  **clock in/out punches from the lock screen** (`onPunch`,
  `RegisterShell.tsx:790`) — carry the stale `registerId`, and the server
  rejects them: `checkEnvelopeForDevice` (`src/lib/pos/sync-core.ts:35`) refuses
  any envelope whose registerId doesn't match the device's current binding.
- **Why it matters:** Punches are payroll facts. A rejected punch is kept and
  surfaced on the device, but it never becomes a time-clock entry — an employee
  who "clocked in" at the lock screen is silently not clocked in until a manager
  notices the rejected row. Trigger conditions are realistic: manager re-binds
  an iPad between registers, then the iPad restarts/reloads.
- **Recommendation:** Persist the corrected creds inside `onUnlocked` (same
  swap-safe write as provisioning), and/or have the empty-batch heartbeat
  refresh the stored `registerId`.
- **Status:** OPEN

### GW-003 — Side effects inside a React state updater can duplicate rejected-row records
- **Where:** `src/app/pos/RegisterShell.tsx:457–466` (`flush()` ACK handling), at `a61aa816`.
- **What:** `setQueue((q) => { … setRejected(…); setBanner(…); return applied.remaining; })`
  performs `setRejected`/`setBanner` **inside** the `setQueue` updater. React
  requires updater functions to be pure; React is permitted to invoke an updater
  more than once (and does, deliberately, in development Strict Mode).
- **Why it matters:** A double-invoked updater appends the same rejected rows to
  the `rejected` list twice. The duplicated rows are then **persisted** to
  `gw-pos-queue` by the persist effect, inflating the "N rejected — manager
  reviews in the back office" count and cluttering review. No money/ledger
  impact (rejected rows never re-send), but it is a genuine correctness bug
  waiting on a re-invocation.
- **Recommendation:** Compute `applyAcks` from `queueRef.current` BEFORE calling
  setState, then issue three sibling setState calls with plain values.
- **Status:** OPEN

---

## 🟡 Low

### GW-004 — PIN lookup scrypt-verifies against every active employee on each attempt
- **Where:** `src/lib/staffing/store.ts:117` (`getEmployeeByPin`), at `a61aa816`.
- **What:** Each PIN attempt loads ALL active employees with PINs and runs a
  ~25 ms scrypt verify per candidate until a match (hashed PINs can't be looked
  up by equality — this is inherent to salted hashing).
- **Why it matters:** At the store's scale (10 employees) worst case is
  ~250 ms — fine. It sets a scaling ceiling (100 employees ≈ 2.5 s per unlock)
  and each attempt costs server CPU. Not a problem before cutover; worth knowing.
- **Recommendation:** None needed now. If staff count ever grows large, add a
  non-secret bucketing hint (e.g. first digit stored separately) or move to a
  per-employee identifier + PIN model.
- **Status:** OPEN (accept as-is for current scale)

### GW-008 — Favorites persist writes localStorage inside a state updater, unguarded
- **Where:** `src/app/pos/SaleFlow.tsx:1899–1904` (`togglePin` in CartScreen), at `a61aa816`.
- **What:** Pinning/unpinning a favorite calls
  `window.localStorage.setItem(FAVORITES_KEY, …)` INSIDE the `setFavorites`
  functional updater. Two issues: (a) the write is not wrapped in try/catch, so
  a `QuotaExceededError` (or Safari private-mode write refusal) throws inside
  React's render/update path and can crash the cart screen mid-sale; (b) React
  updaters are expected to be pure — under StrictMode double-invocation the
  side effect runs twice (harmless here since the write is idempotent, but the
  same impure-updater pattern caused GW-003 in RegisterShell).
- **Why it matters:** Severity is low because the payload is tiny (a short
  array of variantIds), the write is idempotent, and a crash here loses no
  money — the queue and active-sale snapshot live elsewhere. But a thrown
  quota error during a sale would blank the register screen at the worst
  moment (and localStorage quota pressure is exactly the failure mode GW-001
  describes for the queue key on the same origin).
- **Recommendation:** Move the `setItem` out of the updater (e.g. an effect on
  `favorites`, or compute `next` before `setFavorites`) and wrap it in
  try/catch that degrades to "pin didn't stick" instead of throwing. Fix
  alongside GW-001/GW-003 as one "safe localStorage writes" slice.
- **Status:** OPEN

---

## 🔵 Hardening

### GW-005 — The durable PIN throttle depends on migration 0123; the fallback is materially weaker on serverless
- **Where:** `src/lib/security/pin-throttle-store.ts` (fallback posture),
  `src/lib/security/pin-hash.ts` (in-memory window), at `a61aa816`.
- **What:** When the `pin_throttle` table is missing (migration 0123 unapplied)
  or unreadable, the throttle falls back to a per-process in-memory window that
  is (a) **global, not per-device-scope**, and (b) **per serverless instance** —
  on Vercel, attempts landing on different lambda instances each get their own
  window, so the effective brute-force protection under fallback is much weaker
  than 5-per-60s.
- **Why it matters:** The design is sound (fallback ≥ legacy protection), but the
  REAL protection assumes 0123 is applied. There is no runtime signal telling
  the owner the durable throttle is active.
- **Recommendation:** Add "confirm migration 0123 applied" to the Cutover
  Checklist (owner applies migrations manually); consider logging one warning
  per boot when the durable table is missing so it shows in Vercel logs.
- **Status:** OPEN

### GW-006 — Device key rests in plaintext localStorage on the iPad
- **Where:** `src/app/pos/RegisterShell.tsx:97` (`LS_DEVICE`), at `a61aa816`.
- **What:** `gw-pos-device` holds the device key in the clear. This is a
  deliberate, reasonable PWA design (the key must survive restarts to work
  offline; there is no OS keychain in a web app), and the blast radius is
  bounded: the key only authenticates THIS device row, is scrypt-hashed
  server-side, and revocation/rotation kills it instantly.
- **Why it matters:** Anyone with unsupervised access to the iPad's browser
  context could copy the key and sync forged (but device-bound, envelope-
  validated) events from elsewhere until revoked.
- **Recommendation:** Operational, not code: run the registers in iOS Guided
  Access/single-app mode, keep iPads physically controlled, and rotate device
  keys if an iPad ever leaves the store's custody. Note for the Capacitor app:
  move the key into the iOS Keychain.
- **Status:** OPEN (operational mitigation; revisit at Capacitor packaging)

---

## 🟢 Enhancement

### GW-007 — Offline PIN unlock (register unusable offline until unlocked)
- **Where:** `src/app/pos/RegisterShell.tsx:1597` (offline unlock error copy), at `a61aa816`.
- **What:** Unlock requires the server, so a register that locks (2-minute idle)
  during an internet outage cannot ring OFFLINE sales until connectivity
  returns — the offline-queue machinery is ready, but nobody can get past the
  PIN pad. The UI copy already promises the fix: "Offline PIN cache ships with
  the Capacitor app."
- **Why it matters:** An outage longer than 2 idle minutes turns "offline-first
  POS" into "offline until it locks." Rush-hour outage + auto-lock = line stops.
- **Recommendation:** Ship the planned offline PIN cache (short-TTL, hashed,
  device-bound) either in the Capacitor app or as a carefully-scoped PWA
  feature. Until then: document for staff that during an outage the register
  should be kept awake/in use.
- **Status:** OPEN (roadmap; owner already aware via UI copy)
