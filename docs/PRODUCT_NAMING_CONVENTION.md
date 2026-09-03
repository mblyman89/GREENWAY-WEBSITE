# Greenway Product Naming Convention — Strategy (report-first)

**Status:** Research + proposal. **No code changed.** Awaiting owner approval of
the convention before implementation.

**Why this matters:** CCRS links Inventory→Product by the **exact Product.Name
string** (see `docs/CCRS_PRODUCT_NAMING_RESEARCH.md`). A stable, consistent
naming convention is therefore both a compliance requirement and the thing that
keeps the KB from drifting or confusing two products.

---

## 1. What industry best practice actually says (verified sources)

| Source | Type | Formula it recommends | Key rules |
| --- | --- | --- | --- |
| **Flowhub** (major cannabis POS, serves WA) | Vendor best-practice | `{Brand} {Strain/Flavor} {Type/Texture} {Total mg}` | Title Case; **avoid periods & hyphens**; **avoid `/ & ! # $`** (break CSV/spreadsheet + search); abbreviate units consistently (mg, g); keep short (exit-label space); **one master catalog, no duplicates**. |
| **Distru** (seed-to-sale ERP) | Vendor best-practice | `[Brand] - [Strain] - [Quantity]` | Order **general → specific, left to right**; avoid `$ # @ !`; dashes/pipes OK as subdividers; short; no ALL CAPS / all lowercase; consistent unit abbreviations. |
| **Ohio OARRS** | **State-mandated** convention | `Form – [Class] – [%THC] – [Strain]` etc. | Proves states standardize name **structure**; abbreviated form prefix; general → specific; rigid per form. |
| **WA CCRS** (our regulator) | Compliance rules | Product.Name = `text(75)`, required | **No forbidden characters**, but Name is a **join key** — must be identical in Product.csv and Inventory.csv. Commas force CSV quoting; keep names comma-free. |

**Converging principles (the consensus):**
1. Consistency beats any particular format — pick one and enforce it.
2. Order elements **general → specific** (left to right).
3. **Title Case**, never ALL CAPS / all lowercase.
4. Keep it **short** (fits exit labels; CCRS caps at 75).
5. **Avoid symbols** that break CSV/search: `, / & ! # $ @` — and (for us) **no
   commas** because CCRS CSV would quote them and the name is a join key.
6. Abbreviate units consistently (`mg`, `g`, `1g`, `3.5g`).
7. **One master catalog, zero duplicates.**
8. Separate the **identifier** (SKU / external ID) from the **display name** — IDs
   are for machines, names are for humans + the CCRS join.

---

## 2. Our building blocks (verified in the file tree)

We already have the right fields to compose a clean name — we don't need new
columns:

- `product_masters.display_name` — the canonical house name (source of truth).
- `product_masters.brand_name`, `vendor_name`, `category`, `strain_name`.
- `menu_items.name` (display) + `menu_items.product_name` (raw POS) + `strain_name`,
  `brand_name`, `pos_inventory_type`, price/weight.
- Weight/dose already live in structured fields (`unit_weight`, package size),
  so they do **not** need to be jammed into the name for CCRS (CCRS carries
  `UnitWeightGrams` separately).

This means the CCRS Product.Name can be a **clean, human name** and the
weight/dose can stay in their own fields — best of both worlds.

---

## 3. Proposed Greenway naming convention

### 3.1 The canonical format
Order **general → specific**, Title Case, ≤ 75 chars, no commas, minimal
punctuation:

```
{Brand} {Strain or Flavor} {Type/Texture} [{Size/Dose}]
```

- **Brand** — omit for house/bulk flower where there is no brand.
- **Strain or Flavor** — strain for flower/concentrate; flavor for edibles/drinks.
- **Type/Texture** — Flower, Live Resin, Cart, Gummies, Preroll, Tincture, etc.
  (from our category/inventory-type mapping — a controlled vocabulary).
- **Size/Dose** — optional in the *display* name; **kept out of the CCRS Name**
  when it duplicates `UnitWeightGrams`/package fields, to avoid drift. Include it
  only when it genuinely distinguishes two otherwise-identical products.

**Examples (correct):**
- `Blue Dream Flower` (house flower, weight in UnitWeightGrams)
- `Fairwinds Wedding Cake Live Resin Cart`
- `Wana Blackberry Gummies 100mg`
- `Dabstract Zkittlez Live Resin 1g`

**Examples (rejected — and why):**
- `BLUE DREAM FLOWER` (ALL CAPS)
- `Blue Dream, 3.5g Jar` (comma → CSV quoting; packaging noise)
- `BK B.Dream Conc 1g` (ambiguous abbreviations; period)
- `Wana Choc B 50mg` (abbreviation collides with other products)

### 3.2 Character & format rules (enforceable)
| Rule | Value |
| --- | --- |
| Case | Title Case |
| Max length | 75 chars (CCRS hard cap) — warn + flag before truncation |
| Disallowed chars | `, / & ! # $ @ " |` and control chars |
| Allowed punctuation | spaces, and hyphen only inside real strain names (e.g. `G-13`) |
| Units | `mg`, `g`, `1g`, `3.5g`, `100mg` (no space, lowercase unit) |
| Whitespace | single spaces; trim; underscores → spaces |
| Uniqueness | each distinct sellable product → exactly one stable name |

### 3.3 Three-name separation (the anti-drift core)
Keep three distinct concepts so the KB never confuses them:

1. **Inventory External ID (SKU / barcode)** — machine key. Already handled via
   `deriveInventoryExternalId()` / `sanitizeExternalId()`. Used by CCRS Inventory/
   Adjustment/Transfer/Sale cross-references. **Never shown to CCRS as a name.**
2. **Product.Name (compliance name)** — the human string CCRS joins on. Derived
   **once** from `display_name` via a single normalizer, and written **identically**
   into both Product.csv and Inventory.csv.
3. **Menu display name** — what the public menu shows; can be richer/prettier and
   is decoupled from the compliance name if we ever want it to be.

The KB should key strain/product knowledge off **strain_name + a stable product
identity**, not off the free-text menu name, so cosmetic name tweaks never move
KB facts.

---

## 4. How this maps to implementation (for the approved fix, later)

- A single pure function `ccrsProductName(displayName)` applying §3.2 rules
  (trim, collapse whitespace, strip disallowed chars, Title Case, word-boundary
  clamp to 75, warn on truncation). Pure + unit-tested.
- Build a `nameByProductKey` map in `buildCcrsBatch` so Product.csv and
  Inventory.csv write the **same** normalized name (closes the join bug from the
  CCRS research doc).
- Pre-submit guardrails (drafts-only, surface — never auto-guess):
  - warn on duplicate Product.Name across distinct products;
  - warn on truncation;
  - warn on disallowed characters (so staff fix the source).
- House-style suggestion for **new** products entered in intake/mastering
  (recommended, not blocking).

No migrations required. Everything is drafts-only per the standing rules.

---

## 5. Open questions for the owner (decide before build)

1. **Include size/dose in the CCRS Name?** Recommendation: **only when needed to
   disambiguate** (weight already lives in UnitWeightGrams). Do you agree, or do
   you want size always appended for readability?
2. **Brand-less house flower:** name as `{Strain} Flower` (no brand)? Or prefix
   with `Greenway`?
3. **Type vocabulary:** OK to derive Type/Texture from our existing category/
   inventory-type mapping (controlled list) rather than free text?
4. **House style enforcement level:** hard-block non-conforming names at submit,
   or warn-only (drafts-only) and let staff fix? Recommendation: **warn-only**,
   consistent with the standing "AI output = drafts" rule.

---

# v2 — Updated strategy (owner inputs + WA-regulation grounding)

**Status:** Research + proposal. **No code changed.** This section **supersedes**
the v1 open questions in §5. Still report-first — awaiting owner sign-off before
any implementation.

## v2.0 What changed since v1
The owner (a) **locked two decisions**, and (b) added **new requirements** that v1
did not cover. This section resolves all of them, grounded in verified WA rules
and in what our own code/data model already supports (no guessing).

**Owner decisions LOCKED:**
- **Enforcement = HARD-BLOCK** non-conforming names at submit (owner overrode the
  v1 "warn-only" recommendation: *"It makes it fool proof to hard block it."*).
  This is a **format/compliance gate** (chars, length, structure) — not the AI
  guessing product facts, so it stays consistent with the "AI output = drafts"
  rule (the AI still never invents cannabinoid values; it only enforces shape).
- **Vendor name goes at the FRONT** of the name (many vendors carry multiple
  brands). Data-supported: `GreenwayMenuItem.vendor` and
  `product_masters.vendor_name` already exist.

**Owner NEW requirements to design for:**
1. Multi-cannabinoid products (THC-only vs 1:1 THC:CBD vs blends w/ CBN/CBC/CBG).
2. Flower = strain + package size; **CBD flower needs an explicit CBD marker**
   (the strain name often won't say "CBD").
3. Customer-facing card must show cannabinoids **accurately** (a strawberry
   lemonade drink must not look like plain lemonade).
4. **Dosage-limit clarity:** a 100 mg / 10-dose lemonade must show **TOTAL
   package THC (100 mg)**, not the 10 mg per-serving, so it doesn't look like a
   microdose.
5. **Weight in ounces** for food/beverage (owner's industry instinct).

## v2.1 Verified WA regulation (primary sources — never guessed)
| Rule | Source | What it requires |
| --- | --- | --- |
| Low-THC beverage txn cap | **WAC 314-55-095(1)(d)(i)(E)–(F)** | A liquid infused product packaged in individual units of **≤4 mg active Δ9-THC** is capped at **200 mg active Δ9-THC per transaction** *instead of* the 72 oz volume cap (the statute's word is *"unless"* — exclusive, not additive). The 4 mg test is **per sealed container**: one can = one unit, a 4-pack = 4 units, and a single 16 mg bottle labelled *"4 servings × 4 mg"* does **not** qualify. Medical is **also 200 mg** (WAC 314-55-095(2)(d)) — the one limit a card does not triple. **→ the product NAME cannot carry this fact reliably; it rides on the intake flag `low_thc_liquid` + `unit_thc_mg` (migration 0216), sourced from the invoice and the lot number.** |
| Serving/package caps | **WAC 314-55-095** | ≤10 mg active Δ9-THC **per serving**; non-Δ9 THC compounds ≤0.5 mg each / ≤1.0 mg combined per serving; **≤100 mg Δ9-THC per package**; concentrate unit ≤1 g. Txn limits: 1 oz flower, 16 oz solid edible, 7 g inhalable concentrate, 10 units "otherwise taken in," 72 oz liquid. **→ the owner's 100 mg / 10×10 mg scenario is real and compliant.** |
| Labeling | **WAC 314-55-105** | Edibles (solid **and** liquid) must show **serving size + amount per serving + number of servings per package**. All products: **net weight in OUNCES *and* grams (or volume as applicable)**; **Total THC** (calculated per THC compound present >0.2 mg/g); **Total CBD** (CBDA+CBD). **→ WA already mandates ounces+grams AND total cannabinoids + servings.** |
| CCRS retail files | **CCRS Product.csv / Inventory.csv** | Columns carry **NO cannabinoid fields** — only `Name`(75), `Description`(250), `UnitWeightGrams`. Cannabinoid values reach the state via the **LabResult** channel, not the retail Name. **→ cannabinoids in the *name* are for humans/menu/label, not a CCRS data field; Description(250) is the richer free-text home.** |

## v2.2 What our code/data already supports (verified in tree)
- `GreenwayMenuItem` **already** has: `vendor?`, `strainName?`, `totalThc`,
  `totalCbd`, and `compounds: GreenwayCannabinoid[]` where
  `GreenwayCannabinoid = { type: thc|thca|cbd|cbda|cbg|cbn|cbdv, value, unit: "%"|"mg" }`.
- **The customer card today (`ProductCardVisual.tsx`) does NOT use most of it.**
  It renders only `THC: {item.thc}` and `CBD: {item.cbd}` — it **ignores
  `compounds[]` (CBN/CBC/CBG)** and shows no total-vs-serving context. This is
  exactly the confusion the owner flagged, confirmed in code.
- Fix path is therefore **data-supported end-to-end**: the fields exist; the card
  and the name normalizer just need to consume them.

## v2.3 Proposed naming convention (v2 — supersedes §3.1)

**Compliance Name (CCRS Product.Name — the join key, ≤75, no commas):**
```
{Vendor} {Brand} {Strain or Flavor} {Cannabinoid tag} {Type} [{Size/Dose}]
```
- **Vendor** — front position (owner). Omit only for true house/bulk with no vendor.
- **Brand** — omit when Vendor == Brand (avoid redundant `Acme Acme`).
- **Strain or Flavor** — strain for flower/concentrate; flavor for edible/drink.
- **Cannabinoid tag** — a **short controlled token** that conveys the profile:
  - THC-only → *(no tag)* (the default; keeps common names short).
  - Balanced/ratio → `1:1`, `2:1`, `5:1` (THC:CBD, the dominant ratio).
  - Notable minors present → append the compound letters in a fixed order:
    `THC:CBD:CBN`, or a compact `+CBN`, `+CBG` (controlled vocabulary, fixed order
    THC→CBD→CBG→CBN→CBC). *(This is a human hint; exact mg lives in Description +
    card + label.)*
- **CBD FLOWER marker (owner):** flower whose strain name doesn't say CBD gets an
  explicit `CBD` tag: e.g. `Greenway Cherry Wine CBD Flower`.
- **Type** — controlled vocabulary (Flower, Live Resin, Cart, Gummies, Drink,
  Tincture, Preroll…), from our category/inventory-type mapping.
- **Size/Dose** — include only to disambiguate; **weight stays in
  `UnitWeightGrams`** for CCRS. (Unchanged from v1.)

**Examples (Compliance Name):**
- `Greenway Blue Dream Flower` (house flower)
- `Greenway Cherry Wine CBD Flower` (CBD flower — explicit marker)
- `Hometown Wana Strawberry Lemonade Drink` (THC-only drink, no tag)
- `Hometown Wana Strawberry Lemonade 1:1 Drink` (balanced drink)
- `Hometown Wana Strawberry Lemonade THC:CBD:CBN Drink` (multi-cannabinoid)
- `Fairwinds Wedding Cake Live Resin Cart`

**Character/format rules:** same table as §3.2 (Title Case, ≤75, disallow
`, / & ! # $ @ " |`, units `100mg`/`3.5g`, single spaces, one name per product),
**now HARD-BLOCKED at submit** per the locked decision.

## v2.4 Where the FULL detail lives (name vs description vs card vs label)
Because the name is capped at 75 and is a join key, we **do not** cram full
cannabinoid math into it. Layered instead:
- **Name (≤75):** vendor→brand→strain/flavor→profile tag→type. Human-scannable.
- **CCRS Description (≤250):** richer free text (e.g.
  `Strawberry Lemonade. 100 mg total THC, 10 servings x 10 mg. Contains CBD, CBN.`).
- **Customer card (to be updated):** show the profile clearly — see v2.5.
- **Physical label:** WAC 314-55-105 net wt (oz+g/volume), total THC/CBD,
  servings — produced by the label path, not the name.

## v2.5 Customer-facing card — proposed fixes (drives requirements 3, 4, 5)
Grounded in WAC 314-55-105 + the fields we already have (`compounds[]`,
`totalThc`, `totalCbd`, package size):
1. **Show all present cannabinoids**, not just THC/CBD. Read `compounds[]` and
   render each with a value (e.g. `THC 100mg · CBD 100mg · CBN 10mg`). No more
   silently dropping CBN/CBC/CBG.
2. **Show TOTAL per package, with servings context** for edibles/drinks
   (`unit: "mg"`): e.g. **`100 mg THC total · 10 × 10 mg`** — so a 100 mg/10-dose
   lemonade never looks like a 10 mg microdose. This mirrors WAC 314-55-105
   (serving size + per-serving + #servings).
3. **Flower** stays `%` (e.g. `THC 22% · CBD <1%`); CBD flower carries the CBD
   marker from the name/badge.
4. **Weight in ounces (primary) + grams** for food/beverage on the card, matching
   WA's mandated oz+g/volume. (Flower can keep its familiar 3.5g/7g/1oz format.)
5. **A profile badge** (`THC` / `1:1` / `THC:CBD:CBN` / `CBD`) so the mix is
   obvious at a glance on the card, aligned with the name tag.

## v2.6 Three-name separation (unchanged, still the anti-drift core)
1. **Inventory External ID** — machine key (SKU/barcode). Never a CCRS name.
2. **Product.Name** — the compliance/join string above; normalized once, written
   identically to Product.csv and Inventory.csv.
3. **Menu display name / card** — richer (adds the cannabinoid + servings + oz
   detail from v2.5); decoupled so cosmetic tweaks never move the CCRS join key
   or KB facts.

## v2.7 Implementation outline (for the approved fix, later — NO code yet)
- `ccrsProductName(parts)` pure normalizer: compose vendor→brand→strain/flavor→
  tag→type, apply char rules, Title Case, ≤75 clamp; **hard-block** invalid at
  submit (surface the exact reason so staff fix the source).
- Cannabinoid **tag derivation** from `compounds[]`/`totalThc`/`totalCbd` (fixed
  ratio + minor-compound rules above) — computed from stored values, **never
  guessed**.
- `nameByProductKey` map so Product.csv & Inventory.csv share the identical name
  (closes the join bug in `CCRS_PRODUCT_NAMING_RESEARCH.md`, = S3 first).
- Update `ProductCardVisual.tsx` to consume `compounds[]` + totals + servings +
  oz per v2.5.
- No migrations. Everything drafts-first except the format hard-block gate.

## v2.8 Remaining decisions for the owner (v2)
1. **Cannabinoid tag style** in the *name*: prefer compact ratio (`1:1`) + minor
   letters (`THC:CBD:CBN`), or a shorter `+CBN`/`+CBG`? (Recommendation: `1:1`
   for ratios, `THC:CBD:CBN` when 3+ compounds — most self-explanatory.)
2. **Vendor vs brand redundancy:** when Vendor == Brand, drop the duplicate?
   (Recommendation: yes.)
3. **House flower vendor:** brand-less house flower → prefix `Greenway`, or leave
   vendor blank? (v1 Q2 — still open.)
4. **Card total display wording:** `100 mg THC total · 10 × 10 mg` acceptable, or
   different phrasing you prefer?
5. **Ounces on flower too**, or keep flower in familiar g (3.5g/7g/1oz) and use
   oz+g only on edibles/drinks? (Recommendation: keep flower in g; oz+g on
   food/beverage.)

---

# v2 FINAL — decisions locked by owner (build proceeds)

All v2.8 questions are resolved. This is the convention we build.

- **Compliance Name (CCRS Product.Name, ≤75, no commas):**
  `{Vendor} {Brand} {Strain/Flavor} {Cannabinoid tag} {Type} [{Size}]`
- **Cannabinoid tag:** THC-only → none; ratio → `1:1`/`2:1`/`5:1` (THC:CBD);
  3+ compounds → `THC:CBD:CBN` (fixed order THC→CBD→CBG→CBN→CBC).
- **Vendor == Brand → drop the duplicate** (no `Acme Acme`).
- **No house flower** — Greenway only sells approved-supplier product; the
  brand-less house-flower case does not exist and is not designed for.
- **CBD flower** → explicit `CBD` marker in the name.
- **Card total wording:** `100 mg THC total · 10 × 10 mg`.
- **Weight units:** flower = **grams only** (3.5g/7g/1oz); edible/drink =
  **ounces + grams** (WAC 314-55-105).
- **Enforcement:** HARD-BLOCK non-conforming names at submit.
- **AI suggestion:** on a rule violation, the house AI proposes an approved
  alternative name (drafts-only; staff confirm).

## Non-cannabis naming convention (owner-defined)
`{Brand (if any)} {Type} {Size/Joint size} {Gender} {Color}`
- Type = controlled vocab (pipe, bong, lighter, downstem, tray, papers, wraps,
  battery, grinder, …). Size e.g. `12in`, `14mm`, `18mm`. Gender = Male/Female
  (glass joint) when applicable. Color optional.
- Smart SKU generated per type, printable via the equipment-page label printer.
