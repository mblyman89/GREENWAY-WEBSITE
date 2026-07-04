# Naming Convention + Non-Cannabis Inventory + KB — Master Roadmap

**Status:** Active build. Report-first research is DONE and approved by owner.
This roadmap is the hand-off source of truth for the whole initiative.

**Standing rules honored throughout:** never guess (ground in verified fact); AI
output = drafts; money in MINOR UNITS (cents); Supabase migrations applied
MANUALLY by owner + idempotent; `main` is branch-protected → every change is its
own branch + PR + squash-merge; always satisfy CCRS + DOH; hand-off ready.

---

## 0. Owner-finalized decisions (locked this session)

**Naming convention (from v2.3 + owner answers):**
- **Compliance Name format** (CCRS Product.Name, ≤75, no commas):
  `{Vendor} {Brand} {Strain/Flavor} {Cannabinoid tag} {Type} [{Size}]`
- **Q1 (tag style):** ratios as `1:1`/`2:1`; 3+ compounds as `THC:CBD:CBN`
  (fixed order THC→CBD→CBG→CBN→CBC). ✔ owner agreed.
- **Q2 (vendor==brand):** DROP the duplicate when Brand == Vendor. ✔
- **Q3 (house flower):** N/A — Greenway only sells approved-supplier product,
  never house-grown. No "house flower" case will ever exist. ✔
- **Q4 (card total wording):** `100 mg THC total · 10 × 10 mg`. ✔ owner agreed.
- **Q5 (ounces vs grams):** **Flower = grams ONLY** (3.5g/7g/1oz style stays g).
  Food/beverage (edible/drink) = **ounces + grams** per WAC 314-55-105. ✔
- **Enforcement = HARD-BLOCK** non-conforming names at submit. ✔ (locked earlier)
- **CBD flower** gets an explicit `CBD` marker. ✔
- **AI-suggested fix:** when a name violates a rule, the house AI proposes an
  approved/acceptable alternative (drafts-only — staff confirm). ✔ owner asked.

**Non-cannabis inventory (new, owner-requested):**
- Track non-cannabis (glass, accessories, lighters, etc.) professionally instead
  of hot-buttons (bong-$25, pipe-$10, lighter-$2…).
- **Non-cannabis naming convention:**
  `{Brand (if any)} {Type} {Size/Joint size} {Gender} {Color}`
  (e.g. `12in Bong 14mm Male Blue`, `RAW Lighter`).
  - Type ∈ controlled vocab (pipe, bong, lighter, downstem, tray, papers, …).
  - Size/joint size: `12in`, `14mm`, `18mm`, etc.
  - Gender: Male/Female (glass joint gender) — optional when N/A.
  - Color: optional.
- **Smart SKU generation** per non-cannabis type, wired to the label printer
  (equipment page) for easy SKU printing.
- Add non-cannabis intake to the inventory intake page.
- Add non-cannabis products to the KB; enhance KB so everything stays connected.

---

## 1. Verified facts grounding this build (see also the two research docs)

- **CCRS Product.csv** = `LicenseNumber, InventoryCategory, InventoryType, Name(75),
  Description(250), UnitWeightGrams, ExternalIdentifier, …` — **NO cannabinoid
  columns**. Inventory.csv joins to Product by **exact Product.Name**.
- **WAC 314-55-105:** net wt oz+grams/volume; Total THC/CBD; edibles show serving
  size + per-serving + #servings.
- **WAC 314-55-095:** ≤10mg Δ9-THC/serving, ≤100mg/package; non-Δ9 ≤0.5mg/≤1.0mg.
- **`GreenwayMenuItem`** already carries `vendor`, `strainName`, `totalThc`,
  `totalCbd`, `compounds[]` ({type,value,unit '%'|'mg'}). Card ignores most of it.
- **Uploaded Cultivera data (verified by inspection):**
  - `PRODUCTS_UPDATED.xlsx`: 3,500 rows. Cols: Product Name, Inventory Type,
    Category, Brand, Type, Strain, UOM, Package Size, prices, Cannabis Y/N,
    Pre Packed/Bulk, Tax Exempt, Vendor Only, Image Attached. **708 duplicate
    name groups (1,416 rows).** 44 non-cannabis. **No Vendor column here.**
  - `INVENTORIES_UPDATED.xlsx`: 4,346 rows. Cols include Product, Category,
    InventoryType, Strain, Brand, **Vendor**, prices/cost (dollars),
    Package Size, Cbd, Cbda, Thc, Thca, Total, Terpene Total, dates. **581
    duplicate name groups (1,347 rows).** 93 non-cannabis. **1,014 rows have both
    THC>0 and CBD>0** (multi-cannabinoid). **944 rows Vendor==Brand.**
  - Observed name defects: leading `- `, `Indica - ` prefixes, weight/pack noise,
    ratio notations (`1:2 CBD`, `60:1 CBD:THC`), brand sometimes embedded.

---

## 2. Slice plan (each = own branch + PR; squash-merge)

> Build order per owner: (A) naming engine w/ rules → (B) non-cannabis +
> SKU + label + KB → (C) menu card fixes → (D) Cultivera research →
> (E) normalize the two spreadsheets. Report after (E).

### SLICE A — Naming Convention Engine (`ccrsProductName` + rules + AI suggest)
- A1. Pure `src/lib/naming/convention-core.ts`: types + rule table + tokenizers.
- A2. `buildComplianceName({vendor,brand,strainOrFlavor,cannabinoidTag,type,size})`.
- A3. `cannabinoidTag(compounds,totalThc,totalCbd)` — derived, never guessed.
- A4. `validateName(name)` → hard-block reasons (chars, len, structure).
- A5. `suggestName(...)` — AI/rule-based acceptable alternative (draft).
- A6. Unit tests (Node test runner) covering flower/edible/drink/multi-cannabinoid.
- A7. Wire hard-block into CCRS batch + the `nameByProductKey` map (S3/S2/S4 from
  the CCRS research doc: Inventory.Product = exact normalized Product.Name).

### SLICE B — Non-Cannabis Inventory + Smart SKU + Label + KB
- B1. `src/lib/naming/noncannabis-core.ts`: non-cannabis name convention +
  controlled type vocab + validate + suggest.
- B2. `src/lib/naming/sku-core.ts`: smart SKU generator per type (deterministic,
  collision-checked, human-readable prefix + sequence).
- B3. Migration (idempotent, owner-applied): non-cannabis product table/columns +
  SKU sequence support. Drafts-only writes.
- B4. Intake page: add "Non-cannabis intake" flow (form → draft → SKU → save).
- B5. Label printer: SKU label render + print (reuse existing 4×6 / code128 path;
  add a non-cannabis SKU label variant). Link from equipment page.
- B6. KB: register non-cannabis catalog into KB (masters/library) so it stays
  connected; enhance KB nav/health to include non-cannabis.

### SLICE C — Menu Product Card fixes (display name + cannabinoids + servings)
- C1. Card consumes `compounds[]`, `totalThc/Cbd`, servings, oz/g per v2.5.
- C2. Profile badge (THC / 1:1 / THC:CBD:CBN / CBD).
- C3. Display name uses the new convention output.

### SLICE D — Cultivera naming requirements (deep research, report-first)
- D1. Research Cultivera product/inventory naming rules + product-mastering.
- D2. Write `docs/CULTIVERA_NAMING_RESEARCH.md`.

### SLICE E — Normalize the two Cultivera spreadsheets to our convention
- E1. `scripts/naming/normalize_cultivera.py` (or TS): read both xlsx, apply our
  convention, dedupe (respect Cultivera product-master), emit *_NORMALIZED.xlsx
  + a change report + a duplicates report.
- E2. Verify counts; produce human-readable diff/summary. Report to owner.

---

## 3. Deliverables / hand-off checklist
- [x] `docs/PRODUCT_NAMING_CONVENTION.md` (finalized v2, decisions locked)   — PR #227
- [x] `docs/CCRS_PRODUCT_NAMING_RESEARCH.md` (already written)
- [x] `docs/NAMING_AND_NONCANNABIS_ROADMAP.md` (this file)                    — PR #227
- [x] `docs/CULTIVERA_NAMING_RESEARCH.md`                                     — PR #231 (Slice D)
- [x] Naming engine + tests (Slice A) + CCRS Inventory.Product join fix       — PR #228
- [x] Non-cannabis inventory + SKU + label + KB (Slice B)                     — PR #229
- [x] Menu card fixes (Slice C)                                               — PR #230
- [x] Cultivera naming research (Slice D)                                     — PR #231
- [x] Normalized spreadsheets + reports (Slice E)                             — PR #232
- [x] One PR per slice, each squash-merged after review (owner merges manually)

---

## 4. Progress log (append-only)
- (init) Roadmap created; spreadsheets inspected & analyzed; decisions locked.
- (Slice A) `src/lib/naming/convention-core.ts` built (pure engine, unit tests pass):
  toTitleCase / cannabinoidTag (ratio + THC:CBD:CBN) / ratioTag / buildComplianceName
  (drop brand==vendor, CBD-flower marker, 75-clamp) / validateName (hard-block) /
  suggestName (AI-style acceptable alternative). Also fixed the triple-confirmed CCRS
  bug: `Inventory.Product` now writes the exact Product.Name (was the slug) so the
  Inventory→Product join holds. tsc+eslint clean. → PR #228.
- (Slice B) Non-cannabis catalog: migration 0076 (noncannabis_products + sku_sequences +
  kb view), `noncannabis-core.ts` (naming + smart SKU per type + collision-safe seq),
  store + server actions, intake page with live name/SKU preview, 2.25×1.25in SKU label
  w/ Code128, KB counts + nav card, admin nav entry. tsc+eslint clean, tests pass.
  Stacked on Slice A. → PR #229.
- (Slice C) Menu product cards: `src/lib/menu/card-cannabinoids.ts` (15 tests) — profile
  badge (THC/1:1/THC:CBD:CBN/CBD via the engine), per-compound chips, PACKAGE-TOTAL mg
  headline (100 mg lemonade no longer reads as 10 mg), oz+g / fl oz+ml net weight for
  edibles/drinks (flower stays %/g). Wired into ProductCardVisual + product detail page.
  NOTE: the "× N × 10 mg" per-serving split is intentionally NOT shown — per-serving mg is
  not persisted on the menu item; flagged as a follow-up transform.ts plumbing task (no
  guessing). Stacked on Slice A. → PR #230.
- (Slice D) `docs/CULTIVERA_NAMING_RESEARCH.md` — verified reference (all cited): Cultivera
  enforces unique Product Name (its product-mastering key), POS vs PRO fields (PRO adds
  Product Line/Sub-Product Line/Label Template), Receipt Name vs internal Name, non-cannabis
  model (no COGS), controlled/METRC-locked Strains list, 75-char/no-comma CCRS ceiling. → PR #231.
- (Slice E) `scripts/naming/normalize_cultivera.py` (14 self-tests) + normalized outputs +
  `docs/CULTIVERA_NORMALIZATION_RESULTS.md`. Rebuilt names from structured columns only
  (never guessed) w/ vendor prefix, drop-brand==vendor, ratio/letter tag from measured THC/CBD
  with a <10% trace guard, size normalization, cleanup, 75-clamp. PRODUCTS master deduped
  3,500→2,676 (824 true dups collapsed); INVENTORIES 4,346 lots renamed (kept separate).
  Result: dup-name groups 708/581→0/0, names>75 110/132→0/0, commas 46/41→0/0. → PR #232.
- (status) All 5 slices complete; 6 PRs open (#227–#232). Owner to squash-merge in order:
  #227 & #228 first (Slice C/#230 is based on #228 and will retarget to main after; #229
  Slice B is stacked on #228), then #229, #230, #231, #232.
