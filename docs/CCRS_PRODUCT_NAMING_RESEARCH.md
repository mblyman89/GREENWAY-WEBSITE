# CCRS Product-Naming Research & Strategy (report-first)

**Status:** Research complete. **No code changed yet** — this is a findings + strategy
report per the owner's request. Nothing here is implemented until the owner
approves a strategy.

**Grounding:** Every claim below is verified against (a) the actual file tree in
this repo and (b) three official WSLCB/CCRS documents. Nothing is guessed.

---

## 1. What the LCB actually requires for product names (verified)

Sources (all official LCB publications):

1. **CCRS Upload User Guide, CIB 133 (2/26)** — the current guide the code cites.
   <https://lcb.wa.gov/sites/default/files/2026-02/CCRS%20Upload%20User%20Guide%202-26%20word.pdf>
2. **CCRS Data Submission Guide: Error Messages, v7.0 (01/03/2022)** — the
   field-by-field error list.
   <https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/CCRSSubmissionErrors.pdf>
3. **CIB-95 — Creating and Reporting External Identifiers for CCRS.**
   <https://lcb.wa.gov/sites/default/files/publications/enforcement/enf-education/CIB-95_Creating_and_Reporting_External_Identifiers_for_CCRS-2.pdf>

### Product.csv `Name` field (the product name)
- **Type:** `text(75)`.
- **Required:** on Insert, Update, Delete.
- **Only two errors exist:** "Name is required" and "Name is over 75 characters."
- **No character restrictions.** Unlike `Strain` (which cannot be "Unknown",
  "THC", or "Other"), the CCRS docs impose **no** disallowed characters, no
  format template, and no "must match the label" rule on Product.Name.
- Example given by the LCB: `Purple Seeds`.

### Product.csv `Description` field
- `text(250)`. Not required in general, **but required when InventoryType =
  `Usable Cannabis` or `Cannabis Mix Packaged`.**

### The important, non-obvious rule — Product.Name is a JOIN KEY
This is the finding that matters most and is easy to miss:

- **Inventory.csv `Product` field** — `text(75)`, **Valid Values: `Product.Name`**,
  description "The **name** of the product associated with this record."
  Error: **"Invalid Product"** → *"Validate that you have submitted the product
  name in the **same format and spelling** as previously submitted on the
  product.csv."*
- **CIB-95** confirms the flip side: the **Product.csv ExternalIdentifier "is
  only for the Product report and is not referenced anywhere else."**

So CCRS links an Inventory row to its Product **by the exact Product.Name
string**, character-for-character. The Product's own ExternalIdentifier is never
used as a cross-file reference. (Cross-file identity for inventory instead flows
through the *Inventory* ExternalIdentifier — the SKU/barcode — which Adjustment,
Transfer, LabTest, and Sale all reference.)

---

## 2. How our code names products today (verified in the file tree)

Full data lineage, traced end-to-end:

```
Cultivera export "Product Name" column
  -> src/lib/pos/transform.ts  stripVariantNoise() / deriveDisplayName()
       (strips brand prefix, weights/mg, pack counts, category words, brackets;
        underscores -> spaces; Title Case) => a clean DISPLAY name
  -> src/lib/pos/import-service.ts  writes menu_items.name (raw kept in product_name)
  -> menu_items (0002_slice2_pos_import.sql): name text NOT NULL, no length/char CHECK
  -> published menu_version
  -> src/lib/compliance/ccrs-batch.ts  buildProductFile():
        productName = it.name.trim()
        Product.csv Name  = clampText(productName, 75)         [warns if truncated]
        Product.csv ExternalIdentifier = sanitizeExternalId(source_item_id)
  -> ccrs-batch-core.ts ccrsCell(): strips embedded double-quotes, wraps in
        quotes only if the value contains a comma/newline. (CSV-safe.)
```

**What's already correct:**
- `CCRS_PRODUCT_NAME_MAX = 75` and `CCRS_PRODUCT_DESCRIPTION_MAX = 250` match the
  guide exactly. `clampText()` clamps and **warns** on truncation (drafts-only —
  it flags for a human rather than silently shipping a cut name). Good.
- Description clamp + the "required for Usable/Mix Packaged" awareness is handled.
- `ccrsCell()` makes any name CSV-safe (commas get quoted; stray quotes stripped),
  so a comma or quote in a product name will **not** break the CSV structure.
- Category/Type are validated against the real CCRS enum (Table 2) and never
  invented (`validateProductClassification`).

---

## 3. The gap — one real, blocking compliance bug

**`buildInventoryFile()` puts the wrong value in the Inventory `Product` column.**

- File: `src/lib/compliance/ccrs-batch.ts`, `buildInventoryFile()`.
- The Inventory column order (verified in `CCRS_COLUMNS.Inventory`) is:
  `LicenseNumber, Strain, Area, Product, InitialQuantity, ...` → index **3** is
  `Product`.
- The code writes at index 3:
  `const productExt = sanitizeExternalId((l.pos_product_key ?? "").trim());`
  i.e. a **slugified external ID** (e.g. `Blue-Dream-3-5g`).
- But CCRS validates that column against **Product.Name** (e.g. `Blue Dream`).

**Consequence:** the Inventory `Product` value (`Blue-Dream-3-5g`) will not match
the Product.Name (`Blue Dream`), so **every Inventory.csv row would reject with
"Invalid Product."** Because Inventory is a Group-2 file, this also blocks the
Group-3 dependents (Adjustment/Transfer/Sale) that need Inventory to exist.

This is currently latent because we haven't cut over from Cultivera to live CCRS
self-reporting yet — but it **will** block the first real Inventory upload.

> Note: this is a *field-value* bug, not a naming-convention problem per se. The
> fix is to write `Product.Name` (the same string the Product.csv row used) into
> the Inventory `Product` column instead of the external-ID slug. I have **not**
> made that change — flagging it here for your decision, since you asked for a
> report first.

### Secondary observations (not blocking, but worth deciding on)
1. **No enforced house naming convention.** `menu_items.name` is whatever the
   Cultivera "Product Name" column contained, cleaned by `stripVariantNoise()`.
   Two products can therefore collide or drift. Because CCRS keys Inventory→
   Product by the exact name string, **name stability and uniqueness matter.**
2. **Name uniqueness.** CCRS does not require Product.Name to be unique, but for
   *our* join to be unambiguous, each distinct sellable product should map to one
   stable Product.Name. Today `buildProductFile` de-dupes by ExternalIdentifier,
   not by Name — two different SKUs could share a Name, or one product could get
   two Names across menu re-imports, and nothing warns about it.
3. **75-char truncation is a warning, not a block.** Good, but if a name is
   truncated in Product.csv it must be truncated *identically* in Inventory.csv
   or the join breaks. Both currently pass through the same `clampText`/`ccrsCell`
   for the Name path — but only if we start writing the Name into Inventory
   (see the bug above). Truncation consistency needs to be guaranteed by design.

---

## 4. Proposed naming-convention strategy (for owner approval — not yet built)

Goal: one **stable, consistent, CCRS-safe product name** per sellable product,
used identically everywhere CCRS joins on it.

**S1 — Single source of truth for the CCRS name.**
Treat `product_masters.display_name` (the mastering layer, Slice 24) as the
canonical "house name" for a product, and derive the CCRS Product.Name from it
(clamped to 75). This decouples the compliance name from raw POS text drift.

**S2 — A `ccrsProductName()` normalizer (pure, testable), applied ONCE.**
Rules, all grounded in the verified spec (no invented restrictions):
  - Trim + collapse internal whitespace.
  - Convert underscores to spaces (already done upstream).
  - Clamp to 75 chars **at a word boundary** where possible (avoid cutting
    mid-word), and **warn** on truncation (drafts-only).
  - Do **not** strip commas/quotes here — leave CSV-safety to `ccrsCell()` so the
    *same* function guarantees identical output in Product.csv and Inventory.csv.
  - Never emit an empty name (fall back to strain or a flagged placeholder that
    surfaces as an ERROR for a human to fix — never silently guess).

**S3 — Write the SAME name string in both files.**
Fix `buildInventoryFile` to set the Inventory `Product` column to the exact
Product.Name produced for that product in `buildProductFile` (share a
`nameByProductKey` map so the strings are guaranteed identical, including any
truncation). This closes the blocking bug and the truncation-consistency risk.

**S4 — Pre-submit guardrails (surface, don't auto-fix).**
  - Warn when two distinct sellable products resolve to the same Product.Name
    (ambiguous join).
  - Warn when a name would be truncated (already exists for Product.csv; extend
    the awareness so the truncated form is what's used in *both* files).
  - Keep everything drafts-only: the tool flags; a human fixes the source.

**S5 — House style (optional, cosmetic).**
A recommended-but-not-enforced pattern for new names, e.g.
`Strain — Form` (`Blue Dream — Flower`, `Wedding Cake — Live Resin Cart`), kept
≤75 chars, Title Case, no packaging/weight noise (weight lives in
UnitWeightGrams, dose in the description). This keeps names readable and stable
without being a compliance requirement.

---

## 5. Recommendation

- **Do S3 first** (the Inventory `Product` = Product.Name fix). It's the only
  item that is an outright compliance blocker; it's small and self-contained.
- Then **S2 + S4** to lock in consistency and add guardrails.
- **S1/S5** are polish/house-style and can follow.

All of the above is drafts-only, idempotent-friendly, and touches no migrations.
Awaiting owner sign-off on the strategy before any implementation.
