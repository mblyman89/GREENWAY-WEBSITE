# Chapter 02 — The Sale Flow (ID gate → cart → tender → done)

> **Status:** COMPLETE (traced line-by-line against main @ `a61aa816`)
> **Primary files:**
> `src/app/pos/SaleFlow.tsx` (4,321 lines — the whole sale screen)
> `src/lib/pos/sale-flow-core.ts` (cart math, limits, payload builder)
> `src/lib/pos/id-scan-core.ts` (AAMVA scan parsing + manual verify rules)
> `src/lib/pos/medical-pos-core.ts` (recognition-card capture + medical pricing)
> `src/lib/pos/price-override-core.ts` (manager markdown rules + floors)
> `src/lib/pos/cash-rounding-core.ts`, `src/lib/pos/change-calc-core.ts`, `src/lib/pos/sale-event-core.ts` (money math)
> `src/lib/pos/sync-store.ts` `processSale` (the server side of every sale)

This chapter documents, in plain English with exact code references, everything
that happens from the moment a budtender taps "New sale" to the moment the
server marks the order completed. It is written so a future AI (or human
auditor) can verify every claim against the code.

---

## 1. The four steps — and the two gates that wrap them

`SaleFlow` (SaleFlow.tsx:373) is a state machine with four steps stored in
`step` state (line 376):

| Step | Screen | What must be true to reach it |
|---|---|---|
| `idgate` | ID check | Always the first step for a fresh sale (`initialVerdict` absent) |
| `cart` | Items + customer + limits | An **allowed** ID-gate verdict exists |
| `tender` | Cash keypad + change | Cart is non-empty, no pricing problems, limits not blocked, no high-THC violations |
| `done` | Change + receipt | `buildSalePayload` validated and the sale event was enqueued |

Two gates wrap the whole flow:

1. **Sales hours (WAC 314-55-147)** — before ANY step renders, SaleFlow.tsx:498
   evaluates `evaluateSalesHours(new Date(), bundle.hours)`. If sales are
   closed (`hoursBlocked`, line 500 — note it deliberately does NOT block the
   `done` step so a just-finished sale can still print its receipt), the whole
   flow is replaced by a friendly block screen (lines 502–522) that re-checks
   the clock every 15 seconds and opens the ID gate by itself when the window
   opens. The server re-checks hours at sync with ITS clock (see §9.8).
2. **The ID gate** — *nothing* enters the cart until the gate passes. There is
   no code path from `idgate` to `cart` that skips a verdict: the only
   transition is `onPassed` inside the `IdGateScreen` render (SaleFlow.tsx:
   525–552), which requires an `allowed: true` verdict object.

**Session resume:** when RegisterShell resumes a parked sale (Chapter 01 §6),
it passes `initialVerdict` / `initialCart` / `initialMedicalCard` /
`initialMember`, and step starts at `cart` (line 376) — but only after
`evaluateResume` re-proved the verdict is still valid *today* (age ≥ 21 today,
ID unexpired, card effective). A resumed sale never skips the rules; it skips
the *typing*.

**Snapshot reporting:** every change to `{verdict, cart, medicalCard, member}`
is reported up to the shell via `onSnapshot` (lines 428–433, ref-stabilized) so
the shell's `parkActiveSale` can persist an in-flight sale across lock/idle
(Chapter 01 §6). Carts are snapshotted as variantId + qty only — never prices.

---

## 2. Step 1 — the ID gate (`IdGateScreen`, SaleFlow.tsx:919)

### 2.1 The house-policy banner

The gate opens with the owner's rule on screen for every sale (SaleFlow.tsx:
~1240 render): **vertical ID always scans, under-40 always scans, clearly-40+
gets a visual validity check + DOB entry.**

### 2.2 The three verification paths

All three paths end in the same `IdGateVerdict` shape (id-scan-core.ts:395):
`{ allowed: true, method, age, dateOfBirth, expirationDate, idType }` or
`{ allowed: false, method, reason }`.

**Path A — Scan (default).** `submitScan` (SaleFlow.tsx:1007):
1. If medical mode is on, the recognition card must validate FIRST
   (`validateCard`, line 989 → `validateCardCapture`, medical-pos-core.ts:97).
   No card → no scan is even attempted.
2. `parseAamvaPdf417(raw)` (id-scan-core.ts:266) parses the AAMVA PDF417
   barcode (US/Canada licenses: `@\n\x1e\rANSI ` header, subfile directory,
   DL/ID subfile). A parse failure shows the error and points to manual.
3. `evaluateScannedId(license, todayYmd, card ? 18 : 21)` (id-scan-core.ts:415)
   enforces, in order: valid store date → readable DOB → age ≥ minimum
   (21 recreational; **18 only when a valid card was captured**, per RCW
   69.50.357(1)) → readable, unexpired expiration date (expired ID is refused
   per WAC 314-55-150; a scan with *no* readable expiry is refused and routed
   to manual).
4. `medicalAgeAllowed(age, !!card)` (medical-pos-core.ts:139) re-asserts the
   age rule independently: 21+ always allowed; 18–20 only with a valid card;
   under 18 refused with "no medical exception exists at retail." Two
   independent checks — a bug in one cannot open the door alone.
5. **Only after everything passes** is the `medical_card_capture` audit event
   enqueued (line 1029) — a refused customer leaves no card record. The parsed
   name is handed up for loyalty auto-attach (line 1031, `onMemberMatch`).

**Path B — Manual (audited fallback).** `submitManual` (SaleFlow.tsx:1148) for
WAC-acceptable IDs without a scannable barcode (passports, military, tribal,
NEXUS, Global Entry, permanent resident, merchant marine — the verified list
at id-scan-core.ts:30, including the WSR 25-21-035 additions effective
11/8/2025). Rules enforced by `evaluateManualId` (id-scan-core.ts:476):
acceptable ID type from the list → reason 3–500 chars (mandatory audit trail)
→ photo-match checkbox confirmed → valid DOB → age ≥ minimum → valid,
unexpired expiry. Dates are typed digits-only and masked MM/DD/YYYY
(`maskDateDigitsMdy`, id-scan-core.ts:69). On success the
`manual_id_verification` audit event is enqueued FIRST (line 1175) and the
sale payload will reference its UUID — the server refuses any manual-ID sale
whose audit event didn't sync and process first (§9.3).

**Path C — Over-40 visual (house policy).** `submitOver40` (SaleFlow.tsx:1190):
the budtender judged the customer clearly 40+, checked the document is real
and valid in hand, and enters ONLY the DOB. `evaluateManualId` with
`visualOver40: true` (id-scan-core.ts:476): no expiry entry required, no
photo-match checkbox — but **the DOB must prove age ≥ 40**
(`OVER40_VISUAL_MIN_AGE`, id-scan-core.ts:58) or the path refuses with "scan
the ID." The audit event carries the fixed reason string
`OVER40_VISUAL_REASON` (id-scan-core.ts:61) plus `visualOver40: true`, so
every visual verify is distinguishable in the audit trail.

### 2.3 The hidden scan capture (why scanning "just works")

There is no visible scan box. A document-level keydown listener buffers
scanner keystrokes in a ref (zero React re-renders — this is why capture is
instant; the old visible textarea re-rendered per keystroke and took ~5
seconds). Documented at SaleFlow.tsx:1034–1120:

- **IDS-1/2 — content-driven completion:** the DuraScan D760 in HID mode can
  *stall* mid-stream past any fixed idle window. So the buffer finalizes the
  INSTANT it contains a gate-ready license (ANSI header + DOB + expiry —
  `feedIdCaptureKey.complete`), with a long idle fallback
  (`ID_CAPTURE_FALLBACK_IDLE_MS`) only for odd/partial encodings. A fixed
  short timer would truncate stalled scans (the historical "5–7s then fails"
  bug).
- Enter/Tab inside the burst are treated as payload newlines (an AAMVA payload
  BEGINS with `@`+LF — the first Enter must not submit).
- Keystrokes going into form fields pass through untouched — manual-entry
  inputs keep normal behavior.
- **IDS-5 — post-scan burst drain** (SaleFlow.tsx:377–408): after the gate
  passes, the scanner's trailing keystrokes are swallowed at the SaleFlow
  level (each trailing key re-arms the drain window) so they can't type
  garbage into the cart screen, and any accidental iOS text selection is
  cleared.

### 2.4 Medical card capture at the gate

The medical checklist UI (SaleFlow.tsx: medical section of IdGateScreen)
captures the recognition-card facts required by WAC 314-55-090(2): UPID
(4–64 chars), effective date, expiration date, holder type
(patient / designated provider), and the **mandatory MCR attestation** — the
budtender must confirm the card was checked in the DOH database (HB 1453:
"the consultant must enter the card number into the DOH Database").
`validateCardCapture` (medical-pos-core.ts:97) refuses: missing/short UPID,
malformed dates, effective-after-expiry, not-yet-effective, and expired cards
("an expired card grants no exemptions and no 18–20 purchase allowance").
Since Slice 6, the signed-in employee's SAW username is shown at the
DOH-verify step so the attestation is personal.

The card is held in SaleFlow state (`medicalCard`, line 412) and its audit
event UUID (`cardEventUuid`) rides the sale payload. The server re-resolves
the UPID against the back-office authorization at sync (§9.4) — the register's
capture is never trusted alone.

---

## 3. Step 2 — the cart (`CartScreen`, SaleFlow.tsx:1820)

### 3.1 How items enter the cart

There are exactly five ways, all funneling through two functions:

| Entry path | Function | Scan-required guard? |
|---|---|---|
| Package barcode via search box + Enter | `tryScan` (SaleFlow.tsx:1974) → `resolveScan` | No — the scan IS the proof |
| Global wedge scan (nothing focused) | `handleGlobalScan` (SaleFlow.tsx:1998) via `wedgeKey` burst detection (2023–2041) | No — same |
| Menu tile / favorites tile / quick-search row / "the usual" chip / info-card Add | `manualAdd` (SaleFlow.tsx:1943) | **Yes** |
| Keypad custom amount (non-cannabis only) | `KeypadPanel` (SaleFlow.tsx:1736) → `buildCustomProduct` → `manualAdd` | Yes (but custom products are never cannabis, so never blocked) |
| Multi-variant scan → size pick buttons | direct `setCart(addToCart(...))` (SaleFlow.tsx:2216) | No — the scan already proved the package |

Key mechanics:
- `addToCart` / `setCartQuantity` (sale-flow-core.ts:187, 200) are pure;
  quantity is floored, capped at `MAX_LINE_QUANTITY`, and qty ≤ 0 removes the
  line.
- A scan that matches a **multi-variant** product opens a size pick — the
  cashier chooses which size left the shelf; the code never guesses
  (SaleFlow.tsx:1985, 2207).
- A wedge scan that matches nothing is surfaced LOUDLY (`scanMiss`, line 2036)
  — a silent miss looks like a broken scanner.
- The wedge listener ignores keystrokes going into INPUT/TEXTAREA/SELECT/
  contentEditable (line 2029) so form fields keep their own behavior.

### 3.2 Scan-required mode (B41)

When the owner turns on `bundle.scanRequired`, every **manual** add of a
cannabis item is blocked by `manualAddBlocked` inside `manualAdd`
(SaleFlow.tsx:1943–1950) with a loud notice. A manager or lead can lift the
requirement **for the current sale only** via `ScanUnlockModal`
(SaleFlow.tsx:3145): their PIN is verified server-side by `/api/pos/approve`
(same scrypt + throttle + role gate as price overrides — ONLINE-ONLY by
nature). The unlock cannot leak to the next customer because the register
locks after every sale, which unmounts the sale screen and all its state
(documented at SaleFlow.tsx:3138–3143).

### 3.3 The customer band (AO-4) — member, history, "the usual"

`CustomerBand` (SaleFlow.tsx:3598) owns the top of the cart screen:
- Name (member label or "Walk-in customer"), **ID ✓ age** badge, medical-card
  badge (`medicalCardBadge`, medical-pos-core.ts:274 — turns red if the card
  expired mid-visit), tier + points badge.
- Walk-in attach is `MemberPanel` (SaleFlow.tsx:3803): search by name/phone/
  email (min 2 chars, online-only), tap to attach, detach any time. Privacy
  budget is deliberately tiny — first name + last initial, points, tier;
  nothing cached beyond the sale.
- **History (B29)** auto-loads when a member attaches (effect keyed on
  customerId, SaleFlow.tsx:3739–3751) and is dropped when the screen unmounts.
- **"THE USUAL" chips** (SaleFlow.tsx:3654–3663): a favorite renders a chip
  only when its product name resolves to **exactly one** variant on today's
  menu and it isn't unavailable — the code never guesses a size. Chips add via
  the same `manualAdd` guard as every other button (scan-required still
  applies, SaleFlow.tsx:2127).
- Hold sale / Cancel chips live here (hold is Chapter 05 territory; the held
  cart stores variantId + qty only and the ID check re-runs on load).

### 3.4 The live legal-limit meter (WAC 314-55-095)

Every render recomputes `judgeLimits(limitLinesFor(priced.lines), carded ?
"medical" : "recreational", bundle.limits)` (SaleFlow.tsx:2069–2072;
core at sale-flow-core.ts:324, 346). The meter (SaleFlow.tsx:2472–2520):
- Buckets per WAC 314-55-095 (recreational: 1 oz = 28 g usable flower, with
  the statutory equivalents for concentrates/edibles/etc.; medical: 3×),
  each with used/max grams and a color bar (green → amber at >80% → red).
- `limits.blocked` (statutory limit exceeded) **disables tender entirely**
  (`canTender`, line 2088–2089). The owner can configure *tighter* limits,
  which produce `softWarning` (amber, non-blocking) — owner limits can only
  tighten, never loosen, the statutory ceiling.

### 3.5 High-THC products (chapter 246-70 WAC)

`priceForBuyer` returns `highThcViolations` from `applyMedicalPricing`
(medical-pos-core.ts:190 — the high-THC block runs for **everyone**, carded or
not). A violation renders a red banner (SaleFlow.tsx:2454–2463: "may ONLY be
sold to a patient with a valid recognition card… No override exists") and
blocks tender via `canTender`. Note the client-side check depends on
`bundle.medical` being present (priceForBuyer returns `med: null` without it);
the server completion gate independently re-checks with its own registry, so a
stale/degraded bundle cannot leak a high-THC sale past sync (§9.8).

### 3.6 Stock awareness (B32/B43) — advisory only, never blocking

- Tile badges (`StockBadge`, SaleFlow.tsx:4092) and cart-level
  `cartStockWarnings` (SaleFlow.tsx:2077) warn when cart quantity meets/
  exceeds the *cached* count. **Warnings only** — the cached menu can lag the
  shelf; the server-side decrement + completion gate are the authority.
- **"86 it" (B43):** the product info card (`ProductInfoModal`,
  SaleFlow.tsx:2946) lets a budtender flag an item out of stock with a reason
  (two taps, online-only, audited server-side, one-way — a manager brings it
  back through the back office).

### 3.7 The product info card (B42)

`ProductInfoModal` (SaleFlow.tsx:2946): potency/strain/terpenes/description
come from the CACHED bundle (works offline); the single photo resolves
online-only when the card opens, with an `active` guard against late responses
landing on another product's card (lines 2986–3003). Sensory/descriptive facts
only — no effects or medical claims (website posture, WAC 314-55-155).

### 3.8 Favorites (B40) and the keypad (B39)

- Favorites are pinned variantIds **per device** in localStorage
  (`FAVORITES_KEY`), hydrated once on mount (SaleFlow.tsx:1893–1898 — see
  finding GW-008: the `setItem` at line 1902 runs inside the state updater and
  is not quota-guarded). Pins resolve against the LIVE bundle every render so
  prices are current and delisted products never show a tile (line 1908).
- The keypad (`KeypadPanel`, SaleFlow.tsx:1736) builds **non-cannabis-only**
  custom lines (merch/accessories) via `buildCustomProduct` — cannabis must be
  rung from the menu "so inventory, excise, and limits stay exact" (on-screen
  copy at line 1762). Amount must be ≥ 1 minor unit; a note (≤ max length)
  prints on the receipt.

---

## 4. The pricing pipeline — one function, strict order

`priceForBuyer(cart, bundle, carded, overrides)` (SaleFlow.tsx:317–372) is the
ONLY way the register prices a cart, and its order is load-bearing:

```
priceCart (shared engine: promos, floors)          sale-flow-core.ts
  → applyPriceOverrides (manager markdowns)        price-override-core.ts:~172
    → applyMedicalPricing (carded exemptions)      medical-pos-core.ts:190
      → computeOrderTotals (recomputed on med lines when carded)
```

1. **Engine first.** `priceCart(cart, bundle.rules)` produces the same prices
   the website's server-side reprice produces — identical shared engine.
2. **Overrides against the ENGINE price.** A manager approved the markdown
   against a specific engine price; `applyPriceOverrides` applies it **only if
   the engine still charges exactly that price**. If the engine repriced the
   line since approval (e.g., a quantity change moved a promo tier), the
   override is returned in `staleVariantIds` and an effect (SaleFlow.tsx:
   2059–2068) clears it from state — dropped LOUDLY, never silently reapplied.
3. **Medical pass-through last.** `applyMedicalPricing` reprices FROM the
   overridden price (a carded patient gets both the markdown AND the
   exemption). Per line: back out the pre-tax base with the exact same
   `lineBaseMinor` the completion gate uses, decide exemptions with the shared
   `decideLineExemption` (zero policy drift), rebuild the unit price as
   base + still-due taxes. **Conservative claim policy:** with no valid card,
   NOTHING is claimed (`cardedValid=false` short-circuits at
   medical-pos-core.ts:222 — over-remit rather than under-document), but the
   high-THC block still runs for everyone.
4. When carded, totals are recomputed from the medical lines with the same
   `computeOrderTotals` the server uses.

### 4.1 Manager price overrides (B24) — the rules

`PriceOverrideModal` (SaleFlow.tsx:3235):
- **The floor is enforced BEFORE the PIN is spent.** `overrideFloorMinor`
  (price-override-core.ts:82) mirrors priceCart's floors exactly: cannabis =
  max(statutory 1-minor-unit minimum per RCW 69.50.357, CCRS acquisition-cost
  floor); merch = cost floor alone. `validateOverrideRequest`
  (price-override-core.ts:110) refuses: non-positive prices, prices ≥ the
  engine price ("an override must LOWER the price — raise prices in the back
  office"), prices below the floor ("**No PIN can approve it**"), and reasons
  outside 3–500 chars.
- Approval is ONLINE-ONLY: an explicit `navigator.onLine` check
  (SaleFlow.tsx:3277) plus the server PIN verify via `/api/pos/approve`
  (scrypt + throttle + manager/lead role gate).
- The applied override carries original price, reason, and approver employee
  ID into the payload verbatim; the server writes a per-line audit row at sync
  (§9.6). "Undo override" (SaleFlow.tsx:2385) simply deletes it from state.

### 4.2 Loyalty redemption (AM-B) — fingerprint-guarded

`LoyaltyRedeemPanel` (SaleFlow.tsx:3413), ONLINE-ONLY, one application per
sale (no stacking):
- **Redeem points:** the server sizes the discount to what the cart can
  legally absorb and returns a per-variant spread (`PosLoyaltyGrant`).
- **Apply code:** a code the customer brought (GW-XXXX-XXXX shape).
- **The fingerprint guard:** `loyaltyFingerprint` (SaleFlow.tsx:470–478) is a
  hash of `(variantId, productId, quantity, unitPriceMinor)` for every line.
  It is captured BEFORE the request (lines 3486, 3499); if the cart drifts in
  ANY way (item added/removed, qty change, override applied, reprice), the
  drift effect (lines 479–485) drops the discount and **releases the code /
  refunds the points** (`releaseLoyalty`, lines 457–465 — fire-and-forget; a
  lost release just leaves an 'issued' code that expires via the sweep).
  A spread is only ever honored for its exact cart.
- Display: the check keeps per-line engine prices; the rail's totals show the
  loyalty-reduced money (`loyaltyView` / `railTotals`, SaleFlow.tsx:2045–2050).
  Promo savings and loyalty get separate rows — never double-counted
  (lines 2601–2617).
- The earn preview ("This sale earns ~N points", line 2582) is an estimate
  (floor of pre-tax dollars × rate); the authoritative accrual runs
  server-side at completion.

---

## 5. Step 3 — cash tender (`TenderScreen`, SaleFlow.tsx:4044)

- **Cash only** (store policy; on-screen copy at line 4117).
- **Cash rounding (B33):** the owner's policy from the bundle
  (`normalizePosCashRoundingConfig` → `roundCashDue`,
  cash-rounding-core.ts:70) rounds the amount **DUE at the drawer**; the TOTAL
  and its tax stay pre-rounded per WA DOR guidance, and the adjustment shows
  as its own disclosed line (lines 4081–4124).
- **Quick chips (B31):** `smartTenderSuggestions(due)`
  (change-calc-core.ts:93) — exact, next whole dollar, $5/$10/$20 steps,
  $50/$100, deduplicated. The cart rail's quick-tender chips (SaleFlow.tsx:
  2096–2113) are built from the SAME functions with the SAME rounded due, so
  chip amounts and change math can never disagree; a chip tap opens the
  tender screen with the cash pre-entered (`initialTenderedMinor`).
- **Keypad:** register-style digit entry (2-6-4-1 reads $26.41) via
  `tenderKeypadAppend`/`Backspace` (pure, self-tested). Chip and keypad inputs
  never fight — a chip resets `keypadUsed` (lines 4087–4098).
- **Change plan (B31):** `ChangePlan` (SaleFlow.tsx:4023) renders the exact
  bills/coins to count back (greedy, optimal for US denominations; $50/$100
  never planned as change), live on tender and again on the done screen.
- "Complete sale" is disabled until `tendered >= due` (line 4201).

### 5.1 `onPaid` — building and freezing the sale (SaleFlow.tsx:615–724)

When the budtender taps Complete sale:
1. `priceForBuyer` runs one final time on the current cart; the loyalty spread
   is applied to those final lines (the fingerprint guard guarantees it still
   matches — drift would already have dropped it).
2. `buildSalePayload` (sale-flow-core.ts:415) assembles the payload:
   lines (with optional variantId, override block, per-unit loyalty discount,
   unitGrams — all omitted when absent so old payload shapes stay
   byte-identical), totals, `paymentMethod: "cash"`, tendered/change (change
   recomputed against the ROUNDED due via `computeCashChange`,
   sale-event-core.ts:57), drawerSessionId, the ID-verification block
   (`{method:"manual", manualEventUuid}` or `{method:"scan"}`), optional
   sourceOrderId (website-order pickups), optional medical block (card +
   cardEventUuid + savings), optional loyalty attach + redemption blocks, and
   the rounding block only when an adjustment actually happened. It then
   runs `validateSalePayload` on its own output — a payload that fails
   validation is never enqueued; the error string surfaces on the tender
   screen.
3. `onEnqueue("sale", payload)` puts the event in the offline queue
   (Chapter 01 §5 — monotonic sequence, envelope bound to device+register).
   **The sale is now durable on-device even with no network.**
4. **The receipt freezes from EXACTLY what was enqueued (B10)** — lines
   669–719 build `PosReceiptInput` from the same priced lines/totals, with the
   owner's receipt config (header/footer/address/employee/savings/loyalty
   toggles), medical tax-off markers per line, rounding disclosure, and the
   loyalty points ESTIMATE. `onReceiptFrozen` hands the snapshot to the shell
   so "reprint last receipt" survives the post-sale auto-lock (B17).
5. `setStep("done")`.

---

## 6. Step 4 — done (SaleFlow.tsx:729–754)

- Big change display + count-back plan.
- **Print (B10):** `ReceiptButtons` (SaleFlow.tsx:865) — Star PassPRNT via
  `starpassprnt://` URL (prints at 576 dots, kicks the drawer, returns via
  `back=`), with a browser-print fallback that opens the SAME HTML — the two
  paths can never differ. Reprint = tap again; the snapshot is immutable.
- **Email receipt (B30):** opt-in only (`EmailReceiptPanel`, SaleFlow.tsx:768).
  The server emails a restyled copy of the SAME frozen snapshot and never
  stores the address (masked in the audit trail); the input clears after send.
- "Done — lock register" calls `onComplete` → the shell locks. The lock
  unmounts SaleFlow, wiping every bit of per-sale state (verdict, card,
  member, overrides, scan unlock) — the next customer starts from zero.

---

## 7. Cancel paths and loyalty release

Every cancel path releases an applied points redemption before leaving
(refunding the points): tender-screen cancel (SaleFlow.tsx:611–614),
cart-screen cancel (577), hold (585), and the explicit remove button in the
redeem panel (3509). Codes (non-points) need no release — an unclaimed
'issued' code expires via the sweep.

---

## 8. What the payload does NOT contain

Worth stating explicitly (verified against `buildSalePayload` and the enqueue
call):
- No customer name, DOB, ID number, or scan payload — the ID verification
  block carries only the method and (for manual) the audit-event UUID. The
  raw AAMVA data never leaves the device.
- No medical card image; only the UPID + dates + holder type + attestation.
- No employee PIN, ever. Override blocks carry the approver's employee ID.

---

## 9. The server side — `processSale` (sync-store.ts:315–800)

Every sale event lands at POST `/api/pos/sync` (Chapter 01 §5: device auth,
envelope binding, idempotent insert on `client_uuid`). `processSale` then runs
this exact sequence — any failure marks the event an **exception** with a
plain-English operator message (never silent):

1. **Shape** — `validateSalePayload` (line 322) re-validates everything the
   register claimed: line shapes, money integers, totals recomputed, override
   blocks markdown-only, loyalty sums matching the redemption block.
2. **Drawer session (AN-3c, lines 328–360)** — the `drawerSessionId` must
   exist, belong to THIS register, and time-contain the sale's `occurredAt`
   (a late offline flush is fine; a sale claiming a drawer session from
   another register or outside its open window is an exception).
3. **Manual-ID prerequisite (AN-3b, line 361)** — a `method:"manual"` sale is
   accepted only if the referenced `manual_id_verification` event is synced
   AND processed. No audit record → no sale.
4. **Medical resolution (B8, lines 384–427)** — the referenced
   `medical_card_capture` event must be synced first (queue flush order
   guarantees the register sent it first), and the UPID must resolve via
   `findAuthorizationByUpid` to an **ACTIVE back-office authorization** that
   `authorizationValidityAt` proves valid on the sale date. A card that only
   ever existed on the register is refused: "Intake the patient's card
   (Admin → Medical) before ringing medical sales."
5. **Loyalty attach (B14, lines 430–460)** — the attached customer must still
   exist; and when the sale is ALSO medical, the recognition-card holder is
   authoritative — a mismatch ("points would land on the wrong person") is an
   exception.
6. **Redemption pre-check (AM-B, lines 463–509)** — the redemption row must
   exist, match the code, still be 'issued', and be worth at least what the
   register applied.
7. **Materialize the order** — header first, then lines (with the 0116
   loyalty-discount column and the 0122 `unit_grams` column; a missing-column
   error retries without `unit_grams` at line 580 so an unapplied migration
   degrades gracefully instead of dropping sales). If the lines fail, the
   header is deleted — never a headless order. Then: per-line override audit
   rows (lines 599–620), the recognition card attached BEFORE the gate runs
   (line 634 — so the gate's medical context/limits/ledger all fire), and the
   **atomic redemption claim** (lines 671–700: conditional UPDATE
   `WHERE status='issued'` — zero rows means someone else claimed it =
   exception; and if the subsequent write fails, the claim is RELEASED so a
   consumed code is never stranded on an unfinished sale).
8. **The completion gate** — `runCompletionGate` (line 723) is the IDENTICAL
   gate every back-office completion runs (hours re-checked at
   `occurredAt` per AN-3a, limits, medical ledger, high-THC, inventory), with
   **no override path** from the POS.
9. `setOrderStatus(order.id, "completed")` (line 753) — which triggers the
   authoritative loyalty accrual.
10. **AM-D2 supersede (lines 767–794)** — if the sale carried a
    `sourceOrderId` (a website order rung at the counter), the source order is
    cancelled with a supersede note, best-effort and only from ACTIVE
    statuses; a failure is audited (`order.supersede_on_complete_failed`) but
    NEVER undoes the completed, paid-for sale.

---

## 10. What SHOULD never happen (test-plan watchlist)

Each of these is an invariant the code enforces. If you ever observe one in
the field, it is a bug — log it against this chapter.

1. Any item entering the cart before an allowed ID verdict exists.
2. A sale to anyone under 21 without a valid recognition card captured at the
   gate; ANY sale to someone under 18.
3. An expired ID accepted (scan or manual); a scan with unreadable
   DOB/expiry passing without the manual path.
4. The over-40 visual path accepting a DOB that proves age < 40.
5. A manual verify or over-40 verify with NO `manual_id_verification` audit
   event in the queue.
6. A medical card capture event enqueued for a customer who was refused.
7. Tender enabled while: cart empty, pricing problems present, statutory
   limits exceeded, or a high-THC violation is on screen.
8. Owner-configured limits LOOSENING the statutory WAC 314-55-095 ceiling.
9. A price override applying at a different engine price than the manager
   approved (must drop loudly as stale).
10. Any override below the statutory cannabis minimum or acquisition-cost
    floor — regardless of whose PIN was entered.
11. An override or scan-unlock approval succeeding offline.
12. A scan-unlock or any per-sale state surviving into the next sale.
13. A loyalty spread honored for a cart that drifted from its fingerprint.
14. Loyalty points burned with no discount applied (release failed AND sweep
    failed) — points must come back on cancel/drift.
15. The receipt showing different lines/totals than the enqueued payload.
16. Tax computed on the rounded (rather than pre-rounded) total.
17. The server completing a sale whose drawer session belongs to another
    register or doesn't contain `occurredAt`.
18. A medical sale completing when the UPID doesn't resolve to an ACTIVE,
    currently-valid back-office authorization.
19. A redemption claimed twice, or left 'redeemed' on a sale that failed to
    complete.
20. A headless order (header without lines) surviving a lines-write failure.
21. A website source order superseded by a sale that did NOT complete.
22. Raw AAMVA scan data, customer DOB, or ID numbers appearing in the sale
    payload, the queue, or localStorage.

---

## 11. Findings raised while writing this chapter

- **GW-008 (🟡 low)** — Favorites `localStorage.setItem` runs inside the
  `setFavorites` state updater and is not quota-guarded
  (SaleFlow.tsx:1899–1904). See FINDINGS.md.

Cross-references: offline queue mechanics → Chapter 01 §5; session
resume/hold → Chapter 01 §6 and (holds) Chapter 05; loyalty program mechanics
→ Chapter 06; medical intake/back-office authorizations → Chapter 03;
completion gate internals → Chapter 09/11 (reports/CCRS chapters will detail
tax + ledger writes).
