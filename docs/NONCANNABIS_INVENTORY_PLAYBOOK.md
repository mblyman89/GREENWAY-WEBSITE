# Non-Cannabis Inventory Playbook — Greenway Marijuana

**Scope:** paraphernalia & accessories — glass (pipes, bongs, rigs, bubblers,
downstems, bowls), lighters, torches, grinders, papers, wraps, trays,
batteries, chargers, storage, apparel. **NOT reported to CCRS** (not
cannabis). No DOH requirements. Money in MINOR UNITS (cents) everywhere.

This is the professional-standard playbook the `/admin/inventory/noncannabis`
page implements (Task M). Built on the industry pattern for mixed
barcoded / non-barcoded retail merchandise (the same approach used by
inventory platforms like Finale/Fishbowl/Lightspeed for boutiques, smoke
shops and gift retail).

---

## 1. The core problem, and the professional answer

Some merch ships with a **manufacturer barcode** (lighters, papers, wraps —
anything mass-produced). Most glass does **not** (hand-blown pipes, bongs,
one-off pieces). The industry-standard answer is a **dual-identifier
strategy**:

| Item has…                | Register identifier      | Where it comes from                        |
|--------------------------|--------------------------|--------------------------------------------|
| Manufacturer UPC/EAN     | The package barcode      | Scan it at intake, validate the check digit |
| No barcode (most glass)  | In-house Code128 SKU     | Auto-generated smart SKU, label printed in-house |

**Every sellable item ends up scannable.** No hot buttons, no "misc glass
$25" guesswork, no unscannable pegs.

### 1a. Manufacturer barcodes (UPC-A / EAN-13 / EAN-8)

- UPC-A = 12 digits, EAN-13 = 13, EAN-8 = 8. The last digit is a **GS1
  mod-10 check digit** — the system validates it on entry, so a mistyped or
  misread code is rejected on the spot (`validateRetailBarcode` in
  `merch-intel-core.ts`).
- One product per barcode — enforced by a unique index (migration 0111).
- At intake, staff literally scan the package into the barcode field. Done.

### 1b. In-house SKU labels (Code128)

- The smart SKU (`BONG-0001-12IN-BLUE-M`) is human-readable AND scannable:
  Code128 encodes the full alphanumeric SKU.
- Printed from `/admin/inventory/noncannabis/[id]/label` (2.25in × 1.25in) on
  the **label printer registered on the Equipment page** (Rollo Wireless
  X1040, asset `PRN-LABEL-01`) via the browser print dialog.
- Label carries: store name, price, item name, type, barcode + SKU text —
  price tag and inventory tag in one.
- The catalog shows a **"Need SKU labels"** KPI (active items with no
  manufacturer barcode) and a per-row print link so nothing goes on the wall
  unlabeled.

## 2. Reorder points (min/max) — never discover an empty peg

Every item can carry a **reorder point** (min) and **order qty**:

- `on hand = 0` → **OUT** (danger)
- `on hand ≤ min` → **Below min** (reorder)
- `on hand ≤ min × 1.25` → **Near min** (heads-up)

The page's **Reorder now** panel lists them in that order with a suggested
order quantity (the explicit order qty when set, otherwise enough to reach
2× the min — the classic min/max default). Fast movers with steady velocity
(lighters, papers) deserve real reorder points; one-off glass can stay
untracked (min 0).

## 3. Adjustments live ON the page — plain retail rules

Non-cannabis has **no CCRS hoops**, but a professional shop still documents
every unit that leaves outside a sale. The catalog row expands into an
**Adjust** panel:

- Controlled reasons: `received`, `return`, `count`, `damaged`, `theft`,
  `promo`, `sold_correction`, `other`.
- **Note required** for theft/other (say what happened).
- **Never below zero** — validated in the pure core AND re-checked
  server-side against a fresh read (stale forms can't oversubtract).
- Every change = one append-only `noncannabis_adjustments` ledger row
  (who / why / when / how many) + `recordAudit`. The page shows the last 30
  days of the ledger.

## 4. Shrink telemetry

Negative adjustments in the last 30 days are grouped by reason and **valued
at cost** — the "Documented reductions" panel. Damaged glass, theft, promo
giveaways: visible, quantified, and attributable instead of mysterious.

## 5. ABC by retail value

Same 80/95 cumulative-value technique as the cannabis side: items covering
the first 80% of on-hand retail value are **A** (count them, guard them,
never stock out), next 15% **B**, the tail **C**. Shown as a badge per
catalog row so attention follows the money.

## 6. The daily workflow

1. **Intake:** fill the form → scan the package barcode if there is one
   (validated live) → set reorder point / shelf → stage draft → confirm →
   print the SKU label if it had no barcode.
2. **Sell:** register scans either identifier.
3. **Breakage/theft/promo:** find the item (search by name, SKU, barcode or
   shelf — scanning a code into the search box jumps straight to it) →
   Adjust → reason + note → post. Ledger updated, shrink visible.
4. **Buy:** check "Reorder now" before every supplier order.
5. **Count:** periodically verify A items; post `count` corrections from the
   same row panel.

## 7. Data model (migration 0111 — applied manually by the owner)

- `noncannabis_products` + `barcode text` (unique when set),
  `reorder_point int`, `reorder_qty int`, `location text`.
- NEW `noncannabis_adjustments` (append-only): `product_id`, signed
  `qty_delta`, `reason`, `note`, `actor_id`, `created_at`.
- The store layer degrades gracefully pre-migration (intake retries without
  the 0111 columns; missing columns read as null/0).
