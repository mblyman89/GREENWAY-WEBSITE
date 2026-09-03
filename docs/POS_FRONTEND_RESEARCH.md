# POS Front-End Mega Report — Compliant, Offline-First iPad POS for Greenway Marijuana

Status: RESEARCH v2 (Task Z). No build authorized yet. This document supersedes and expands the
v1 research (PR #211). Every external claim below was re-verified against primary sources during
Task Z (Apple developer docs, WebKit blog, WA Legislature WAC pages, vendor pages, App Store
listings). Every internal claim was verified by reading the actual code in this repo.

AUDIENCE: this report is optimized to be read by an AI agent during the POS build. It is the
single reference for platform choice, deployment path, offline architecture, compliance gates,
guided-sale UX, payments, hardware, and build sequencing. Sections are numbered for citation
(e.g. "per POS_FRONTEND_RESEARCH §6.3").

---

## 0. The one constraint that shapes everything (verified)

CCRS has **NO API** — it is CSV file-upload only, uploaded by a human through the web portal at
https://cannabisreporting.lcb.wa.gov/ (see `docs/_research_notes_ccrs.md`). Therefore:

- The POS does **NOT** talk to CCRS in real time. It never could — there is no live pipe.
- The offline "sync target" when internet returns is **OUR Supabase**, not CCRS.
- CCRS remains a **weekly batch CSV export a human uploads** (Sunday–Saturday week, due the following Sunday).
- "Sales flow into CCRS accurately after internet is restored" therefore means: offline sale →
  queued locally → synced to Supabase when online → included in the next weekly CCRS CSV export
  (which already passes the existing hard gate). This is a solved, well-understood path.

**Implication:** we are NOT building a real-time compliance uplink. We are building an
offline-durable sales terminal whose single source of financial/inventory truth eventually
reconciles into Supabase, from which the existing export machinery produces compliant CSVs.

---

## 1. Repo ground truth — what the POS front end MUST reuse (verified by reading code)

The back office already contains a complete, tested compliance brain. The POS reuses it verbatim
(this is the core argument for the Capacitor platform choice in §2). Verified surfaces:

### 1.1 Pricing & tax — `src/lib/orders/order-pricing-core.ts` (single source of truth)
- Card prices are **tax-INCLUSIVE out-the-door**, in minor units (cents).
- Cannabis divisor **1.463** (37% excise RCW 69.50.535 + 6.5% state + 2.8% local sales tax =
  3700 + 650 + 280 bps). Non-cannabis divisor **1.093**.
- `NON_CANNABIS_TAX_CATEGORIES = { merch, accessories, accessory, paraphernalia }`.
- Subtotal = single-rounded back-out of the total; tax = total − subtotal.
- `assertCannabisLineSellable` / `clampCannabisUnitPrice` enforce
  `MIN_CANNABIS_UNIT_PRICE_MINOR = 1` (no free cannabis, RCW 69.50.357).
- `computeOrderTotals` + `moneyMatches` are what the completion gate uses to recompute money
  server-side. **The POS cart must call these exact functions** — never reimplement the math.

### 1.2 Cost floors — `cart-discount.ts` + `loyalty-sale-core.ts`
- Acquisition-cost floor per WAC 314-55-155 / CCRS guidance ("may not discount below cost of
  acquisition"). Any manual discount path on the POS must run through these floors and
  **hard-block** below-cost pricing (owner requirement: "so we don't sell below cost").

### 1.3 Order completion compliance gate — `src/app/admin/orders/actions.ts`
Sequence enforced when a sale moves → completed (the POS checkout must run the same gates
client-side for UX, and the same gates run again server-side on sync):
1. Sales-hours gate (WAC 314-55-147).
2. Money recompute gate (recompute from lines; reject drift).
3. Loyalty-code consistency gate.
4. Sales-limit HARD gate (WAC 314-55-095) — override requires `sales_limit.override`
   permission + reason; medical path requires DOH 246-70 exemption plan + card re-validation;
   exempt-sale record writes per WAC 314-55-090(2).
5. `completion_blocked` audit event on any refusal.

### 1.4 Order lifecycle — `src/lib/orders/order-lifecycle-core.ts`
- Forward-only chain: new → acknowledged → preparing → ready → completed.
- Terminal statuses reopened only via reasoned reversal (≥5 chars):
  completed→ready, cancelled→new, no_show→new. POS refunds/voids follow this model.

### 1.5 Registers & drawers — `src/lib/registers/store.ts` (+ `cash.ts`, `oversight.ts`)
- Register kinds: `sales` | `manager_till`. DrawerSession lifecycle:
  open → closed → reconciled → verified, all counts blind and in minor units; manager reveals
  variance at reconcile. DrawerDrop windows exist. **The POS till maps 1:1 onto these tables** —
  no new cash model is needed, only a front-end for it.

### 1.6 Time clock — `src/lib/staffing/timeclock-core.ts`
- Pure punch-edit validation (Pacific wall-clock, mandatory 3–500 char reason for edits).
  POS clock-in/out reuses this core; the register screen is locked unless the budtender is
  clocked in AND unlocks with their PIN (see §6.1).

### 1.7 Auth — `src/lib/auth/session.ts`, `roles.ts`, `webauthn-core.ts`
- `getStaffSession` / `requirePermission` on Supabase auth + `staff_profiles`; roles
  owner/admin/manager/content_editor/staff/readonly with ROLE_RANK; passkeys via webauthn-core
  (rpID = bare hostname). POS device provisioning + per-budtender PIN layer sits on top of this
  (device holds a device-scoped session; PIN identifies the human per sale — §6.1).

### 1.8 Equipment hub — `/admin/equipment` (nav group Admin, permission `inventory.manage`)
- 4 devices seeded today: Star TSP143IV receipt printer (CloudPRNT), Wireless X1040 label
  printer, Canon PIXMA TS3522 scanner, laminator. **No iPad/front-of-house hardware seeded
  yet** — §9 lists what to add. Owner requirement: all front-side hardware lives here.

### 1.9 Existing POS libs — `src/lib/pos/`
- live-menu, preview-menu, menu-version, category-taxonomy, auto-discount, import modules.
  The iPad menu snapshot is generated from these — do not build a parallel catalog.

---

## 2. Platform decision (the crux) — RECOMMENDATION UNCHANGED, EVIDENCE CORRECTED

Requirement: an Apple app running on iPad Pros, works offline (complete a sale with no
internet), records sales for later sync, and drives real POS hardware.

### 2.1 Candidates

| Option | Offline durability | Hardware (scanner/printer/drawer) | Reuse our TS compliance cores | App Store | Effort |
|---|---|---|---|---|---|
| **PWA (Home Screen web app)** | ⚠️ better than previously stated (§2.2) but still eviction-exposed | ❌ **No Web Bluetooth / USB / Serial on iOS** | ✅ | not possible | low |
| **Native Swift / SwiftUI** | ✅ full (SQLite, unlimited) | ✅ full (CoreBluetooth, ExternalAccessory) | ❌ reimplement compliance in Swift | ✅ | high |
| **React Native** | ✅ full | ✅ (native modules; Star ships a StarXpand RN SDK) | ⚠️ partial (logic reusable, UI rewritten) | ✅ | high |
| **Capacitor (web UI + native shell)** | ✅ full (native SQLite via `@capacitor-community/sqlite`) | ✅ (Bluetooth/USB via Capacitor plugins + thin Swift bridges) | ✅✅ **verbatim reuse** | ✅ | medium |

### 2.2 CORRECTION to v1 — iOS PWA storage (verified: WebKit blog "Updates to Storage Policy", Aug 2023 / Safari 17)
v1 of this document claimed iOS PWAs are capped at "~50 MB with 7-day cache eviction." That is
**outdated**. Current WebKit policy (Safari 17+):
- Per-origin quota for non-browser apps/Home Screen web apps: up to **~15% of disk** (browsers 60%),
  overall app cap ~20% of disk.
- Eviction is LRU under storage pressure, plus the 7-day ITP inactivity rule **unless** the site
  holds persistent-storage mode (`navigator.storage.persist()`), which WebKit's heuristics grant
  favorably to Home Screen web apps.

So storage is no longer the PWA disqualifier. **The disqualifier that stands is hardware:** iOS
Safari/Home Screen web apps have **no Web Bluetooth, Web USB, or Web Serial** — there is no way
for a browser app to talk to a Bluetooth receipt printer, barcode/ID scanner, or fire a cash-drawer
kick. A real till requires native peripheral access. PWA remains disqualified; the reason is
corrected for the record.

### 2.3 RECOMMENDED: Capacitor
1. **One compliance brain.** The iPad runs the exact TS cores from §1 (`order-pricing-core`,
   `cart-discount`, `sales-limits-core`, `sales-limit-gate-core`, lifecycle, timeclock). No drift,
   no double-maintenance, no Swift re-implementation to audit.
2. **Native hardware** via `@capacitor-community/bluetooth-le`, Star's StarPRNT/StarXpand SDKs
   bridged behind a small plugin, drawer kick fired through the printer's DK port (§9).
3. **Real offline storage** via `@capacitor-community/sqlite` (native SQLite; verified plugin,
   actively maintained, iOS support).
4. **Ships through the App Store** (three verified paths in §3), satisfying the owner's "ideally
   through the App Store" requirement — Cultivera proves the precedent (§3.4).
5. **Lowest total effort** given the existing Next.js/React/TypeScript codebase.
6. Dev machine is an Apple-silicon MacBook Pro (2025) — Xcode + Capacitor iOS toolchain runs
   natively; no toolchain risk.

Fallback: any single device that Capacitor plugins can't drive gets a thin native Swift plugin
behind the Capacitor bridge (all business logic stays in TS).

---

## 3. Getting the app onto iPads — three verified Apple paths (all legitimate)

### 3.1 Cannabis apps ARE allowed (verified: App Store Review Guideline 1.4.3, current text)
Guideline 1.4.3 permits apps that facilitate sale of controlled substances from
"licensed or otherwise legal cannabis dispensaries," with two conditions (Guideline §5 / policy
in effect since June 7, 2021):
- The app must be **submitted by the legal entity** that provides the services (i.e., the
  licensee's own Apple Developer account — Greenway's LLC enrolls, not an individual).
- The app must be **geo-restricted to jurisdictions where it is legal** (limit availability to
  the United States / functionally to WA).

### 3.2 Path A — Standard App Store listing
Public listing like Cultivera's. Fully allowed under 1.4.3 when submitted by the licensed entity
and geo-restricted. Downside: public visibility, App Review marketing scrutiny, screenshots, etc.

### 3.3 Path B — Unlisted App Distribution (RECOMMENDED)
Verified Apple program: the app passes normal App Review, then you submit a request form and Apple
converts it to **link-only** distribution — not searchable, not in charts, installable by anyone
with the link, and manageable through Apple Business Manager. Ideal for a line-of-business POS:
it is genuinely "on the App Store" (owner's preference), gets normal OTA updates, but has zero
public surface. This is the recommended default.

### 3.4 Path C — Custom Apps via Apple Business Manager (private)
Distribution method "Private" + the organization's ABM Organization ID; delivered via MDM or
redemption codes. Caveat (verified): the private-distribution choice must be made **before the
app's first approval** and is hard to change later. Choose between B and C before first submission.

### 3.5 Precedent (verified): Cultivera POS is live on the App Store
App id1449676115, seller S2 Solutions LLC, iPad-only, ~37.7 MB, rated 13+, description includes
"manage your store(s) on and off-line," updated through Aug 2025. A WA cannabis POS with offline
mode is already approved and distributed exactly this way. Our plan is precedented, not novel.

### 3.6 Practical checklist
1. Enroll Greenway's legal entity in the Apple Developer Program ($99/yr) + Apple Business Manager.
2. Decide B vs C **before first submission** (recommend B: Unlisted).
3. Geo-restrict availability; 17+/13+ rating per current App Review norms; no cannabis sales TO
   consumers through the app itself (it's a staff tool — even cleaner under 1.4.3).
4. Enroll the iPad Pros in ABM + lightweight MDM for supervised mode, kiosk lock
   (Single App Mode/Guided Access), and remote wipe — standard retail practice.

---

## 4. Offline-first architecture (design confirmed; Cova validates the pattern)

Core principle: **the local device is the source of truth for an in-progress transaction; the
network is a background optimization.** The cashier never waits on the network.

Industry validation (verified Cova blog): Cova's offline mode pre-caches product/pricing/limit
data, tenders sales offline where a live traceability connection is not legally required (true in
WA — §0), and auto-syncs on reconnect. Same shape as our design.

### 4.1 Local store (on the iPad, native SQLite)
- Pre-cached: menu/product snapshot (from `src/lib/pos/` live-menu), price/tax rules, promotion
  rules, sales-limit rules, staff PIN hashes + permissions snapshot, register/drawer state.
- **Outbound sync queue:** every sale, drawer event, punch, adjustment as an append-only,
  immutable event with a client-generated UUID, device id, register id, staff id, and monotonic
  timestamp/sequence.

### 4.2 Sync engine
- On reconnect, flush the queue in order to Supabase; server ACKs by UUID; ACKed events marked
  synced (never deleted until confirmed).
- **Idempotency:** server upserts on client UUID; retried flushes cannot double-post a sale.
- **Conflict policy by domain:**
  - Sales: append-only immutable facts — insert-once, no conflicts.
  - Inventory: server is authoritative; device decrements a cached snapshot optimistically;
    on sync the server applies **deltas** (event-sourced), so concurrent registers both decrement
    correctly. Local snapshot is the oversell guardrail; server is final arbiter.
  - Rules/prices/menu: server → device only, versioned snapshots; device never edits rules.
  - Server-side re-validation: every synced sale re-runs the §1.3 completion gates. A sale that
    passed on-device but fails server-side (e.g., limits crossed by a concurrent register) is
    flagged into an exception queue for manager review — never silently dropped.
- **Sync status visible:** online/offline chip, pending-queue depth, last-successful-sync time,
  manual "sync now."

### 4.3 What "offline sale" concretely means
1. Menu, prices, tax, promos, limit rules pre-cached.
2. Cashier rings the sale entirely locally — all math by the shared TS cores (§1.1–1.3).
3. Receipt prints locally (Bluetooth/LAN printer), drawer kicks locally (printer DK port).
4. Event queued → flushes to Supabase on reconnect → lands in the next weekly CCRS CSV.

---

## 5. Compliance rules the till enforces (verified against current WAC text)

### 5.1 Acceptable IDs — WAC 314-55-150 (as amended WSR 25-21-035, effective Nov 8, 2025)
Acceptable identification (must be valid/unexpired; expired = NOT acceptable):
- Driver's license, instruction permit, or ID card of **any U.S. state, U.S. territory, D.C., or
  Canadian province**; Washington identicard.
- U.S. armed forces ID; Merchant Marine ID.
- Passport or passport card; NEXUS card; **Global Entry card** (new, eff. 11/8/2025);
  **Permanent Resident card** (new, eff. 11/8/2025); tribal enrollment card.
The scanner path (§7) covers PDF417 DL/ID cards; everything else uses the manual-verify path
with mandatory audit trail (§6.2).

### 5.2 Transaction limits — WAC 314-55-095 (verified full text, current through WSR 24-21-051)
Recreational (and non-MCAD patients), per single transaction:
- **1 oz** useable cannabis (flower);
- **16 oz** solid-form infused edibles;
- **7 g** concentrate/extract for inhalation (infused pre-rolls count as concentrate);
- **10 units** of infused product otherwise taken into the body;
- **72 oz** liquid infused product (oral/topical), OR **200 mg** total active delta-9 THC in
  liquid form when packaged in ≤4 mg units.
  - *Implemented in SLICE 16.* Bucket `low_thc_liquid`, denominated in **mg of THC** (see
    `LIMIT_BUCKET_UNITS` in `src/lib/compliance/sales-limits-core.ts` — the first
    non-gram bucket). Qualification requires an explicit intake flag
    (`menu_items.low_thc_liquid` + `unit_thc_mg`, migration 0216); it is deliberately NOT
    derived from the label's serving math, because a 16 mg bottle sold as "4 × 4 mg"
    would derive to 4 mg and wrongly qualify. **An unflagged liquid is treated as a normal
    72 oz liquid** — the stricter, fail-safe direction.
MCAD-registered patients/providers (medical endorsement required): **3 oz / 48 oz / 21 g /
216 oz** (+ the 200 mg ≤4 mg-unit liquid rule).
Also verified: single serving ≤10 mg delta-9 THC; single package ≤100 mg; single concentrate
unit ≤1 g; and **"a licensee or employee is prohibited from conducting a transaction that
facilitates an individual in obtaining more than the personal possession amount"** — this is the
statutory basis for the hard-block-no-matter-what behavior in §6.4. The repo's
`sales-limits-core.ts` / `sales-limit-gate-core.ts` already encode these; the POS reuses them.

### 5.3 Other gates (already in the repo, reused as-is)
- Sales hours (WAC 314-55-147) — block checkout outside legal hours.
- No free cannabis (RCW 69.50.357) → `MIN_CANNABIS_UNIT_PRICE_MINOR = 1`.
- No discount below acquisition cost (WAC 314-55-155 / CCRS guidance) → cost-floor cores.
- Medical exemptions (DOH 246-70): store endorsement + MCAD card validation + medically-compliant
  product flags; exempt-sale records per WAC 314-55-090(2). Tax exemption, not a discount.

---

## 6. Guided-sale UX spec — "no way to break compliance"

The owner's directive: walk the budtender through every sale step-by-step; hard-block anything
non-compliant; tie every action to a person. Verified industry pattern: Flowhub's "Verify
Customer ID" setting forces re-confirmation of ID when pulling a customer from queue before cart
building — we adopt and strengthen that.

### 6.1 Session & till accountability (PIN-per-sale)
- Device holds a device-scoped Supabase session (provisioned by a manager). Humans are
  identified per-action by **PIN** (backed by `staff_profiles`; PIN hashes cached for offline).
- Budtender must be **clocked in** (timeclock-core) to unlock the register. Clock-in/out lives
  on the lock screen.
- The register screen **locks after every completed sale**; the next sale requires a PIN unlock.
  Whoever unlocks owns that sale and that drawer (maps to §1.5 DrawerSession). Manager PINs can
  unlock override flows only (limits override, reversal, no-sale drawer open) — each writes an
  audit event with staff id + reason.

### 6.2 Step 1 — ID gate (nothing can be added to a cart before this)
- Scan the ID barcode (PDF417) with the hardware scanner or camera fallback. Parse per AAMVA
  (§7); compute age from DBB (DOB); check DBA (expiry). Under-21 or expired → hard block with a
  full-screen refusal.
- **Manual verification fallback** (for passports, Global Entry, tribal cards, unreadable
  barcodes): budtender selects ID type from the §5.1 list, keys DOB + expiry, and confirms a
  visual check. Every manual verify writes an **audit event** (staff id, ID type, timestamp,
  reason "manual_id_verification") — owner requirement, verbatim.
- Medical path: MCAD card check per §5.3 before the medical limits/tax exemption applies.
- ID data is used transiently for the gate; only the minimum lawful record (verification event,
  not the barcode payload) is persisted.

### 6.3 Step 2 — Cart building
- Products added by barcode scan or search from the local menu snapshot. Prices are the
  tax-inclusive card prices; the running limit meter (flower g / concentrate g / edible oz /
  liquid oz / units) is always visible and turns amber near limits.
- Discounts apply only through the discount engine; **manual discounts** require a reason and
  are clamped by the cost floors (§5.3) — the UI simply won't accept a below-floor price, with
  an explanation of which floor blocked it.

### 6.4 Step 3 — Compliance checkpoint (automatic, before tender)
Run the full §1.3 gate sequence locally: sales hours, money recompute, limits (hard gate — the
UI shows exactly which category is over and by how much; manager override only where the
back-office rules allow it, with permission + reason), medical validations. A blocked checkout
shows what to remove to become legal. **There is no path to tender while any gate fails.**

### 6.5 Step 4 — Tender & receipt
- Cash tender screen: amount received → computed change (no mental math); drawer kicks via
  printer; receipt prints with required tax breakdown (excise + sales tax lines from
  order-pricing-core's back-out).
- Payment methods are a pluggable enum from day one: `cash` now; `point_of_banking`, `ach`,
  `debit` reserved (§8) so enabling a processor later is config, not surgery.
- Sale finalizes locally as an immutable event → queue → lock screen returns (§6.1).

### 6.6 Refunds / voids
Follow the lifecycle reversal model (§1.4): reasoned reversal, manager PIN, audit event,
inventory return adjustment event for CCRS (original sale removed from export, adjustment
reported — per existing return rule).

---

## 7. ID scanning (built-in and required)

- WA driver's licenses/ID cards (and all US/Canada DL/IDs) carry a **PDF417** barcode per the
  AAMVA DL/ID Card Design Standard (2020). Key element IDs: DAQ (license number), DCS/DAC/DAD
  (name), DBB (date of birth), DBA (expiry), DBD (issue), DAJ (state), DCG (country).
- Parse on-device with a small TS AAMVA parser (open-source implementations exist; ours will be
  a pure core with self-tests like every other core in the repo — `id-scan-core.ts`).
- Capture paths: (a) Bluetooth 2D scanner (Zebra DS2278 or Socket S740/S760 — both verified in
  Cultivera's recommended iPad hardware) in keyboard/SPP mode; (b) iPad camera via a barcode
  scanning library as fallback. Both feed the same parser + gate.
- Age math done in America/Los_Angeles wall-clock (same discipline as timeclock-core).
- The scanner also does product barcodes — one device, two jobs.

---

## 8. Payments (verified landscape, 2025/2026)

- **Credit cards: NOT possible** while cannabis is federally illegal — card networks prohibit
  it; processors that sneak it get shut down and merchants blacklisted. Do not integrate any
  "workaround" credit rails.
- **Compliant options today:** cash; **point-of-banking** (cashless-ATM style, $5 increments,
  customer convenience fee); **ACH / pay-by-bank** (e.g., Aeropay). **POSaBIT** (Seattle-based,
  WA-focused) offers compliant PIN-debit-style in-store payments and is the natural first
  integration candidate for a WA store when the owner is ready.
- **Watch items:** SAFE(R) Banking has passed the House 7× and stalls in the Senate; DEA
  Schedule III rescheduling proposed May 2024. When federal rules change, the §6.5 payment-enum
  design means enabling card tender is a processor integration + config flag, not a rebuild.
- **Launch posture: cash only, tight controls** — blind drawer counts, PIN-per-sale ownership,
  drawer drops with windows, manager-revealed variance (all already modeled in §1.5).

---

## 9. Hardware — front-of-house kit (to be added to `/admin/equipment`)

Owner requirement: all front-side hardware lives in the Equipment hub. Recommended kit per
register, grounded in verified specs + Cultivera's published iPad hardware guidance (tablets
need all-wireless peripherals):

| Role | Recommended | Verified notes |
|---|---|---|
| Terminal | **iPad Pro** (owner already chose) | Enroll in ABM + MDM, supervised, kiosk-locked (§3.6) |
| Receipt printer | **Star TSP143IV (X4 variant)** or **Star mC-Print3 (mCP31LB)** | TSP143IV already seeded in the equipment hub (migration 0061); X4 = USB-C/LAN/WLAN/**Bluetooth**; CloudPRNT Next (MQTT); StarPRNT SDK (iOS) / StarXpand SDK; 250 mm/s, 80 mm paper. mC-Print3 is Star's tablet-kit favorite (Cultivera's suggestion for iPads) |
| Cash drawer | **Star CD4 or CD5** | Kicks via the printer's DK peripheral port (TSP143IV has 2 × 24V/1A drive circuits) — no separate interface needed |
| Barcode/ID scanner | **Zebra DS2278** or **Socket S740/S760** (Bluetooth 2D) | Both on Cultivera's recommended list; PDF417-capable for IDs + product barcodes |
| Networking | Dedicated VLAN/SSID + LTE failover optional | Offline mode (§4) already covers outages; failover just shortens queue time |
| Future payments | POSaBIT terminal (when enabled) | §8 |

Action when building: seed these as equipment records (category "Register hardware") so
purchasing, serials, and assignments live in the existing hub.

---

## 10. Industry benchmark (verified, big players)

- **Dutchie** (6,500+ dispensaries): Register + Kiosk + Mobile + Ecommerce on one core; Pay by
  Bank; Register Co-Pilot AI; 100+ integrations. Lesson: one shared core across surfaces — which
  is exactly our shared-TS-cores plan.
- **Cova**: strongest verified offline story (§4); built-in ID scan, queue management, purchase
  limit monitoring with product equivalency, automatic taxes. Our target parity list.
- **Flowhub**: "Verify Customer ID" forced re-check pattern (§6.2); their 2025/2026 payments
  guide is the source for §8.
- **Cultivera POS**: WA-local proof that an iPad-only, offline-capable cannabis POS ships on the
  App Store (§3.5), plus the published Bluetooth-peripheral hardware guidance used in §9.

Our differentiators: one compliance brain shared with the back office (none of the above can
claim that with OUR rules), CCRS-export-ready by construction, per-sale PIN till accountability,
and a guided flow where compliance failure is unrepresentable in the UI.

---

## 11. Phased build plan (maps onto roadmap POS slices P0–P7)

1. **P0 — Platform spike:** Capacitor shell on the Mac, one screen rendering a live menu
   snapshot; confirm SQLite plugin + one Star SDK round-trip. Decide Unlisted vs Custom (§3)
   and enroll the entity in the Developer Program + ABM.
2. **P1 — Local store & event log:** SQLite schema, snapshot download/versioning, append-only
   queue, sync-status UI.
3. **P2 — Sync engine:** idempotent flush to Supabase, inventory deltas, server-side gate
   re-validation + exception queue.
4. **P3 — Guided sale:** ID gate (scan + manual fallback + audit), cart with shared cores,
   compliance checkpoint, cash tender, receipt.
5. **P4 — Till & people:** PIN-per-sale lock screen, clock in/out, drawer sessions/drops wired
   to registers store; manager override flows.
6. **P5 — Hardware:** scanner → printer → drawer kick; equipment-hub records.
7. **P6 — Hardening:** flaky-network test matrix, offline soak tests, sync-health monitoring,
   MDM kiosk config.
8. **P7 — Pilot:** one register live in-store; then payments integration (POSaBIT) when the
   owner green-lights.

---

## 12. Open questions for the owner

1. **Distribution:** approve **Unlisted App Distribution** (recommended) vs Custom Apps/ABM
   private vs public listing? (Must be decided before first App Review submission — §3.4.)
2. **Hardware:** approve the §9 kit (or name preferred models) and the number of registers.
3. **Payments:** cash-only at launch confirmed? Pre-approve POSaBIT as the future first
   integration, or evaluate alternatives (Aeropay ACH) when the time comes?
4. **Printer:** reuse the already-owned TSP143IV at the counter (LAN/CloudPRNT) or buy
   Bluetooth mC-Print3 units for tablet-native pairing?

---

## 13. Source appendix (verified during Task Z)

- App Store Review Guidelines §1.4.3 + §5 (developer.apple.com) — cannabis dispensary apps,
  legal-entity + geo-restriction requirements (policy since June 7, 2021).
- Apple "Unlisted app distribution" (developer.apple.com/support/unlisted-app-distribution).
- Apple "Custom Apps" / Apple Business Manager private distribution docs.
- Cultivera POS App Store listing (id1449676115, S2 Solutions LLC) + Cultivera recommended
  hardware documentation.
- WebKit blog "Updates to Storage Policy" (Aug 2023, Safari 17) — quota/eviction corrections.
- WAC 314-55-095 (apps.leg.wa.gov, current through WSR 24-21-051, eff. 1/7/25) — full
  transaction-limit text quoted in §5.2.
- WAC 314-55-150 as amended by WSR 25-21-035 (eff. 11/8/2025) — acceptable ID list.
- WAC 314-55-147 (sales hours), WAC 314-55-155 + CCRS guidance (cost floor), RCW 69.50.357
  (no free cannabis), RCW 69.50.535 (37% excise), DOH 246-70 / WAC 314-55-090(2) (medical).
- AAMVA DL/ID Card Design Standard (2020) — PDF417 data element IDs.
- Star Micronics TSP143IV spec sheet (interfaces, CloudPRNT Next, 2× drawer drive circuits,
  StarPRNT/StarXpand SDKs); Star CD4/CD5 drawer docs.
- Cova offline-mode blog; Dutchie platform pages; Flowhub "Verify Customer ID" help doc +
  Flowhub cannabis payments guide (2025/2026); POSaBIT product pages.
- Repo code read in full or in relevant part: `order-pricing-core.ts`, `order-lifecycle-core.ts`,
  `orders/actions.ts` (completion gate), `registers/store.ts`, `timeclock-core.ts`,
  `auth/session.ts` + `roles.ts` + `webauthn-core.ts`, `admin-nav-data.ts` (equipment),
  `src/lib/pos/*`, `src/lib/compliance/*`, `docs/_research_notes_ccrs.md`,
  `docs/ROADMAP_ENHANCEMENTS_AND_POS.md` + `_PART2.md`.

---

## 14. OWNER DECISIONS — RECORDED (Task AA; these answer §12 and are binding for the build)

1. **Distribution: Unlisted App Distribution — APPROVED.** Pass normal App Review under the
   store's legal entity, then request unlisted (link-only) conversion. Decided before first
   submission per §3.4.
2. **Registers: 3 at launch** — two budtender sales registers + one manager till. This matches
   the migration-0038 seed exactly (Sales Register 1 & 2 @ $167.50 float, Manager Till @ $300);
   no schema change needed.
3. **Receipt printer: KEEP the store's existing Bluetooth receipt printer.** The store already
   runs a Bluetooth receipt printer with its iPad Pros that kicks the drawer after a sale — it
   stays. (The TSP143IV in the equipment hub is the ONLINE-order auto-print printer, a separate
   job; do not repurpose it.) No mC-Print3 purchase. ACTION: owner to provide the exact
   make/model of the front-counter Bluetooth printer so the correct SDK/plugin is chosen and
   the device is added to the equipment hub.
4. **Payments: cash-only at launch; POSaBIT pre-approved** as the first card-style integration
   when the owner green-lights it (§8).
5. **Seam audit: APPROVED and COMPLETED** — see `docs/POS_SEAM_AUDIT.md` for the verified
   contracts of the five back-office surfaces the POS builds on (money core, completion gate,
   registers/drawers, time clock, auth/PIN), plus the four additive refactors folded into
   slices P0/P1. Notable finding: **PIN infrastructure already exists** (salted-scrypt
   `employees.clock_pin` + throttle + `getEmployeeByPin`) — the POS PIN-per-sale layer reuses
   it rather than building new.
