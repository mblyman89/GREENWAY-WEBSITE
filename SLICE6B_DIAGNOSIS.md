# SLICE 6B — DIAGNOSIS BEFORE CODE

Owner asked for SLICE 6B: the 771 rejected rows the Fact Review screen shows
but cannot act on. Before writing a line of production code I measured what
those 771 rows actually ARE, from the owner's own uploaded workbooks, using the
REAL transformer. Nothing below is inferred.

Grounding scripts (temporary, deleted after use):
`scripts/pos/slice6b-ground.ts`, `-ground2.ts`, `-ground3.ts` against
`268245__September-01-2026_Products.xlsx` (3,541 rows) and
`CACA40__Inventories-September-01-2026.xlsx` (4,284 rows).

---

## THE MEASURED TRUTH

```
items                     3333
hidden (all)               771
hidden no_product_master   771      <-- ALL of them, one single reason
hidden any other reason      0
```

Every single rejected row carries `hidden_reason = "no_product_master"`
(`transform.ts:853`). There is no second reason mixed in.

```
distinct inventory product keys   3626
unmatched against Products         801
```

801 distinct inventory keys collapse into 771 menu items (the transformer
merges same-identity rows at `transform.ts:840`).

---

## THE DECISIVE QUESTION

`transform.ts:260` matches inventory to products with

```ts
function comparableName(value: unknown) { return normalizeWhitespace(value).toLowerCase(); }
```

That is an EXACT string match. So there were two completely different worlds
this slice could be in, and they demand opposite solutions:

- **(a)** the products really are absent from the Products workbook
  → the owner must create product-master rows. SLICE 6B = a worklist + an
  export he can act on.
- **(b)** the products ARE in the workbook but the exact-match is too strict
  → the transformer is stranding sellable product and SLICE 6B = a matching
  layer. A worklist would be busywork for a bug.

**I measured it rather than assuming. The answer is (a).**

### Test 1 — loose name matching (characterisation only)

```
would match after punctuation-normalise :   1
would match after size-suffix strip     :  35
GENUINELY ABSENT from Products          : 765
```

### Test 2 — the 35 "size-suffix" matches are a TRAP

Looking at the actual rows, stripping the size suffix matches DIFFERENT
PRODUCTS:

```
Downtown Flower Hassel Hoth - 28g   ->  downtown flower hassel hoth - 7g
Coastal Growers Flower Lemon OG 7g  ->  coastal growers flower lemon og 14g
royal kind Flower Super boof - 28g  ->  royal kind flower super boof - 3.5g
```

Verified directly against the Products workbook — for "hassel hoth" there is
exactly ONE product row and it is the 7g:

```
--- PRODUCTS containing: hassel hoth => 1
      Downtown Flower Hassel Hoth - 7g | PkgSize 7.000 | UOM Grams
```

A 28g jar is not a 7g jar. Auto-matching these would write a wrong package
size onto a cannabis product — inventing data, violating standing rule 3 and
data-governance Rule 3.1. **Rejected as a fix.**

### Test 3 — SAFE matching only (name normalised AND package size AGREES)

Re-measured using the transformer's OWN unit normaliser
(`transform.ts:419 parsePackageSize`: `grams?`→`g`, `ounces?`→`oz`,
`milligrams?`→`mg`, `each|units?`→`ea`) so both workbooks are compared on the
same footing:

```
SAFE auto-match (name+size agree) :   3  (units 14)
name matches but SIZE DIFFERS     :   0
no name match at all              : 798
units NOT safely recoverable      : 7998
```

> Honest correction: my first version of this measurement had a bug in MY OWN
> script — a hand-written grams regex `(gram|g)\b` that fails on "28.00 Grams"
> (the `\b` sits before the "s"), which reported an obviously-false
> "PkgSize parsed: 0/801". I did not report that number. I replaced my regex
> with the transformer's own parser and re-measured.

**3 of 801.** A matching layer would recover 0.4% of the problem and risk
mis-sizing the rest. **SLICE 6B is therefore NOT a matching engine.**

---

## WHAT IS ACTUALLY STRANDED

```
stranded keys        801
stranded units      8012
stranded COST  $45,250.66   (units x Cost, from the inventory workbook)
medical-flagged keys 375
keys WITH stock > 0  801  of 801   <-- every one is real, sellable product
keys with ZERO stock   0
```

Every one of the 771 hidden items has stock on hand. This is not stale data —
it is **$45,250.66 of physical inventory that cannot appear on the menu.**

Concentration (a brand is one vendor conversation):

```
  35  Lifted        30  PICC          29  Torus        27  Ceres
  23  Mfused        20  Fire Bros     18  Ooowee       17  Heavenly Buds
```

By category: 137 Infused Pre-roll, 126 Pre-roll, 121 Flower, 76 Disposable
Cartridge, 65 Cartridge, 30 Beverage, 29 Rosin, 25 Edible …

---

## CAN WE PRE-FILL THE PRODUCT-MASTER ROW FROM INVENTORY?

The inventory workbook already carries most of what a Products row needs:

```
Brand    present: 796/801
Strain   present: 801/801
Category present: 801/801
InvType  present: 801/801
Price    present: 788/801
```

So the worklist can hand the owner a nearly-complete row **transcribed from
his own inventory export** — not invented. Blank stays blank (5 brands, 13
prices), flagged rather than guessed.

---

## THE DELIVERY CONSTRAINT THAT DECIDES THE FORMAT

From `docs/CULTIVERA_PRODUCT_UPLOAD.md` (existing, verified, in-repo):

> "One batch-upload sheet the owner sends to the Cultivera rep so Cultivera can
> rename every product in a single pass (**Cultivera does not allow the owner to
> upload their own sheets — the rep does the batch upload**)."

**The owner cannot self-serve product masters.** A screen that only says "go
add 801 products" is useless to him. The deliverable has to be a
**rep-ready sheet**, in the same column shape the rep already accepts, plus the
on-screen worklist to track it. This reuses an established workflow rather than
inventing a new one (standing rule 4).

---

## DEFECT — why the owner "can not fix or do anything with them at all"

`facts/page.tsx:292-318` renders the Rejected section as **name + notes only**,
inside a collapsed `<details>`, capped at `max-h-96`. No form, no export, no
grouping, no counts of what is at stake. It is display-only by construction.

The rows are NOT blocking publishing — they are documented rejects and the
reconciliation already balances (`3333 = 2562 + 771`). But nothing tells the
owner that, so the screen reads as 771 broken things he cannot touch.

---

## THE ONE SLICE (SLICE 6B)

Build the missing-product-master worklist, and ONLY that:

1. A PURE core that turns hidden `no_product_master` rows into a grouped,
   ranked worklist (by brand = one vendor conversation), carrying units,
   stranded cost in MINOR UNITS, and the transcribed-from-inventory draft
   fields — with blanks left blank and flagged.
2. A worklist screen at `/admin/menu-imports/[id]/missing-products` that says
   plainly this does NOT block publishing, and shows what it costs.
3. A CSV export in the Cultivera rep's column shape so the owner can actually
   get them created — completeness-checked, refusing to emit a partial file.
4. Make the Rejected section on Fact Review point at it instead of dead-ending.

NOT in this slice (reported, not silently dropped):
- Any automatic name matching (measured: recovers 3 of 801, risks wrong sizes).
- SLICE 5C — the remaining cap-relevant reads (owner deferred).
- SLICE 7 — enrichment worklists.
