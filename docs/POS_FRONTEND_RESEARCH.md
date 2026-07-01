# POS Front-End Deep Research — World's-Best, Compliant, Offline-First iPad POS

Status: RESEARCH ONLY. No build authorized yet. Grounded in verified sources (LCB CCRS pages,
iOS PWA capability matrix, cannabis iPad-POS feature benchmarks, offline-first architecture literature).
Owner reviews before any code is written.

---

## 0. The one constraint that shapes everything (verified)

CCRS has **NO API** — it is CSV file-upload only, uploaded by a human through the web portal at
https://cannabisreporting.lcb.wa.gov/ (see `docs/_research_notes_ccrs.md`). Therefore:

- The POS does **NOT** talk to CCRS in real time. It never could — there is no live pipe.
- The offline "sync target" when internet returns is **OUR Supabase**, not CCRS.
- CCRS remains a **weekly batch CSV export a human uploads** (Sunday–Saturday week, due the following Sunday).
- "Sales flow into CCRS accurately after internet is restored" therefore means: offline sale →
  queued locally → synced to Supabase when online → included in the next weekly CCRS CSV export
  (which already passes the Slice-105 hard gate). This is a solved, well-understood path.

**Implication:** we are NOT building a real-time compliance uplink. We are building a beautiful,
offline-durable sales terminal whose single source of financial/inventory truth eventually
reconciles into Supabase, from which the existing export machinery produces compliant CSVs.

---

## 1. Platform decision (the crux) — RECOMMENDATION

The user requires: an **Apple app running on iPad**, works **offline** (complete a sale with no
internet), logs everything for later CCRS accuracy, and drives real POS hardware.

### Candidates evaluated

| Option | Offline durability | Hardware (scanner/printer/cash drawer) | Reuse our TS compliance cores | App Store | Effort |
|---|---|---|---|---|---|
| **PWA (Safari "Add to Home Screen")** | ❌ ~50 MB cap, **7-day cache eviction**, **no Background Sync** | ❌ **No Web Bluetooth / USB / Serial on iOS** | ✅ | not required | low |
| **Native Swift / SwiftUI** | ✅ full (SQLite, unlimited) | ✅ full (CoreBluetooth, MFi, ExternalAccessory) | ❌ must reimplement compliance logic in Swift | required | high |
| **React Native** | ✅ full | ✅ (via native modules) | ⚠️ partial (JS logic reusable, UI rewritten) | required | high |
| **Capacitor (web UI + native shell)** | ✅ full (SQLite plugin, no 50MB/7-day limit) | ✅ (Bluetooth/USB via Capacitor/Cordova plugins) | ✅✅ **reuse our TypeScript cores verbatim** | required | medium |

### Why PWA is DISQUALIFIED for this POS (verified, not opinion)

- iOS caps PWA storage at ~**50 MB** and **evicts all cached data after 7 days of inactivity** — a
  register that sits over a long weekend could lose its offline queue. Unacceptable for money/inventory.
- iOS PWAs have **no Background Sync API** — sync only runs while the app is foregrounded.
- iOS PWAs have **no Web Bluetooth, Web USB, or Web Serial** — there is literally no way to talk to a
  Bluetooth barcode scanner, receipt printer, or cash drawer from a browser PWA. Every real cannabis
  iPad-POS hardware kit (Star mC-Print3 printer, Star CD3 cash drawer, Socket D740 scanner) needs
  native Bluetooth/USB. This alone ends the PWA option for a real till.

### RECOMMENDED: Capacitor (web front-end wrapped in a native iOS shell)

Rationale grounded in our situation:
1. **We already have battle-tested TypeScript compliance cores** — `discount-engine-core.ts`,
   `sales-limits-core.ts`, `sales-limit-gate-core.ts`, `auto-discount.ts`, `cart-discount.ts`,
   category taxonomy, CCRS export cores. Capacitor lets the iPad app run this **exact same code**,
   so the till and the back office enforce **one** compliance brain. No drift, no double-maintenance.
2. **Native hardware** via plugins: `@capacitor-community/bluetooth-le`, ESC/POS printer plugins,
   cash-drawer kick (fired from the printer), camera-based + hardware scanners.
3. **Real offline storage** via `@capacitor-community/sqlite` (native SQLite) — no 50 MB / 7-day limit.
4. **Ships in the App Store** as a real "Apple app running on iPad," satisfying the user's requirement.
5. **Lowest total effort** given our existing Next.js/React/TypeScript codebase and cores.

Fallback if Capacitor hardware plugins prove insufficient for a specific device: implement that one
concern as a small native Swift plugin behind the Capacitor bridge (still reusing all our TS logic).

> DECISION TO CONFIRM WITH OWNER before building. If the owner prefers fully-native SwiftUI for
> maximum polish, we accept re-implementing compliance in Swift + a shared spec/test vector file so
> both brains stay identical. Capacitor is the recommended default because it protects the
> single-source-of-compliance-truth principle.

---

## 2. Offline-first architecture (grounded in offline-first literature)

Core principle: **the local device is the primary source of truth for an in-progress transaction;
the network is a background optimization.** Optimistic UI — the cashier never waits on the network.

### Local store (on the iPad)
- **SQLite (native, via Capacitor)** holds: product/menu snapshot, price/tax rules, active promotions,
  sales-limit rules, customer/loyalty cache, and the **outbound sync queue** (every sale, drawer event,
  adjustment as an append-only, immutable event log).
- Every mutation writes locally first and is **also** appended to the sync queue with a client-generated
  UUID, device id, and monotonic timestamp/version counter.

### Sync engine
- **Append-only event log → Supabase.** On reconnect, flush the queue in order; server ACKs by UUID;
  ACKed events are marked synced (never deleted locally until confirmed).
- **Idempotency:** server upserts on the client UUID so a retried flush can't double-post a sale.
- **Conflict policy by domain** (per offline-first best practice that financial/inventory need stronger
  consistency than content):
  - **Sales:** effectively append-only — a completed sale is an immutable fact; no conflict, just insert-once.
  - **Inventory quantity:** authoritative count lives server-side; the device holds a cached snapshot and
    decrements optimistically. On sync, the **server applies deltas** (event-sourced) rather than
    overwriting absolute counts, so two registers selling concurrently both decrement correctly.
    Oversell protection uses the local snapshot as a guardrail and the server as the final arbiter.
  - **Price/promo/rule data:** server → device only (last-write-wins from server; device never edits rules).
- **Sync status must be visible to the cashier/manager:** online/offline indicator, pending-queue depth,
  last-successful-sync time, and a **manual "sync now"** button. Monitor success/failure rate + queue depth.

### What "offline sale" concretely means
1. Menu, prices, tax rules, promotions, and sales-limit rules are pre-cached on the device.
2. Cashier rings a sale entirely from local data — all math (subtotal, discounts, excise 37%, sales tax,
   medical exemption, product-equivalency limits) computed **on-device by our shared TS cores**.
3. Sale is finalized locally, receipt prints locally, drawer opens locally.
4. Event is queued. When internet returns, it flushes to Supabase and lands in the next weekly CCRS CSV.

---

## 3. Compliance enforced ON THE FRONT END (verified rules → concrete gates)

All of these already exist as TypeScript cores or DB rules; the iPad app **reuses them** (Capacitor):

- **Age / ID:** hardware scanner or camera reads the ID barcode; must verify 21+ before a cart can be
  started (or DOH medical path below). Block the sale UI until verified.
- **Purchase / possession limits (per transaction):** enforce WA carry limits with **product-equivalency**
  math (flower vs concentrate vs infused/edible), because a customer can't be sold over the equivalent
  cap. Infused pre-rolls count as **concentrates** (verified). Use `sales-limits-core.ts` +
  `sales-limit-gate-core.ts`. Overselling inventory is blocked by the local snapshot guardrail.
- **Discounts / promotions:** `discount-engine-core.ts` + `auto-discount.ts` + `cart-discount.ts` +
  `promotions-store.ts` — BOGO/Buy-X-Get-Y, member/loyalty, category rules. All applied automatically
  so "no one ever does manual math." When QTY>1, discounts/taxes are reflected across the whole line
  (matches CCRS Sale.CSV semantics) and UnitPrice stays the single pre-discount unit price.
- **Taxes:** auto-calc 37% excise ("Other Tax") + WA/local sales tax. Never hand-entered.
- **Medical (DOH):** a "RecreationalMedical" sale zeroes **both** sales and excise tax — this is a tax
  exemption, **not a discount** — and requires: store DOH medical endorsement, the customer's card in the
  MCAD database, and the product flagged "Medically Compliant." The UI must gate this path on those
  three facts and label the transaction correctly for CCRS.
- **Returns:** produce an inventory-adjustment "return" event; on export, the original Sale identifier is
  removed from CCRS and the inventory id is reported on an Inventory Adjustment (verified return rule).
- **DOH advertising/compliance:** not a POS-transaction concern but respected app-wide.

Because these are the **same cores** the back office already uses, the till cannot drift out of compliance.

---

## 4. Industry-standard POS feature benchmark (Cova cannabis iPad POS)

Target parity/superiority on: built-in **ID scan & age verification**, **customer queue management**,
**product info on-demand**, flexible **discount + loyalty engine** (BOGO, member pricing), **full Offline
Mode**, cashless/again cash payments, **purchase-limit monitoring** (prevent overselling), **product
equivalency** calculation, **automatic tax calculator**, fast transaction processing, high uptime.

Plus our differentiators: one shared compliance brain with the back office, weekly-CCRS-export-ready by
construction, and a beautiful, math-free cashier experience.

---

## 5. Hardware (verified real-world cannabis iPad kits)

- **Receipt printer:** Star mC-Print3 (Bluetooth/USB/LAN, ESC/POS) — common in cannabis kits.
- **Cash drawer:** Star CD3-series, kicked open via the printer's drawer port.
- **Barcode/ID scanner:** Socket D740 (Bluetooth) or camera-based scanning as fallback.
- **iPad** as the terminal. All of the above need **native** Bluetooth/USB — confirming the Capacitor
  (native shell) decision over a PWA.

---

## 6. Open questions to confirm with the owner (before building)

1. **Platform:** approve **Capacitor** (recommended, reuses our compliance cores) vs fully-native SwiftUI?
2. **Hardware:** which exact printer / scanner / drawer models will the shop use? (drives plugin choice)
3. **Payments:** cash-first only at launch, or integrate a cashless/debit processor too? which one?
4. **Number of registers** running concurrently (drives inventory-delta conflict testing scope).
5. **Customer accounts / loyalty:** reuse the website's loyalty data, or POS-local only at first?

---

## 7. Proposed build sequencing (handoff-ready outline; detail lives in ROADMAP)

1. Platform spike: Capacitor shell + one screen reading a live menu snapshot from Supabase.
2. Local SQLite schema + append-only event log + sync-status UI.
3. Sync engine (flush queue → Supabase, idempotent upsert, inventory deltas).
4. Cart + shared compliance cores wired in (limits, discounts, taxes, medical).
5. Hardware: scanner → printer → cash drawer.
6. Offline hardening + flaky-network test matrix + sync-health monitoring.
7. Beauty pass (design system parity with the back office) + pilot on one register.
