# Leafly × Cultivera remediation — issue register and roadmap

**Branch:** `feat/leafly-cultivera-remediation`
**Opened:** 2026-09-21
**Baseline:** `3f53bfa6` (PR #1191, "Leafly: fix the full-menu push failure, add item deletion")

This document exists because the owner asked for it in these words:

> "please record all these issues, then create a roadmap strategy so we dont drift from these
> issues. recon the code and anchor lines to authoritative leafly text and docs, make sure you
> link the docs to the fixes so there is no confusion about what we are fixing and why."

Every finding below is anchored to (a) a **file and line in this repository** and (b) where the
behaviour is dictated by Leafly, **the vendored authoritative specification**, not prose. The
vendored specs are byte-verified copies of Leafly's live published schemas; see
`docs/leafly-specs/SOURCES.md` for the retrieval URLs and md5 sums.

Authoritative anchors used throughout:

| Anchor | What it is | Retrieved |
|---|---|---|
| `docs/leafly-specs/schemas/v2-items.json` | The POST/PUT `items` contract. Field names, types, enums, required flags. | 2026-09-17, md5 `1f57b1f657a233f7d39f0ef89218685c` |
| `docs/leafly-specs/schemas/v2-show.json` | The **read-back** contract (`GET …/menu`). A *different* contract — do not use it to decide what to POST. | 2026-09-17 |
| `docs/leafly-specs/menu-integration-v2.openapi.json` | Operations, paths, auth. | 2026-09-17 |
| `docs/leafly-menu-api-v2.md` | Our prose digest **of** the above. Never the source of truth on its own. | — |

---

## 0. The one-paragraph summary

The owner's menu is Cultivera-imported legacy data. The 124 remaining full-menu-push errors are
**not 124 unrelated problems**. They are one defect, repeated: a product whose sizes are genuinely
different in our system (`1g`, `3g`, `5g`) is described to Leafly as `1 each` for **every** size,
because Leafly permits only `each` for that product's type. Leafly identifies a size by nothing but
`amount` + `unit`, so all sizes of that product collapse into one and the rest are silently
discarded. This was **proved, not guessed** — see FINDING J-1, where the real variant ids from the
owner's own error message were decoded back to their source data.

---

## FINDING J-1 — The 124 errors are ONE defect with a decodable cause *(ask 7)*

### What the owner saw

> `items[101].variants: 2 sizes of this item are all described to Leafly as "1 each"
> (pos-45c6e282e0e8-cca24072824d, pos-45c6e282e0e8-00de6c9e8f2c) … and 119 more`

### The evidence

Variant ids are not opaque. `src/lib/pos/transform.ts:1044` builds them:

```ts
id: `${itemId}-${stableId(variant.package.label, variant.priceMinorUnits, variant.medical ? "medical" : "adult")}`
```

and `src/lib/pos/transform.ts:266`:

```ts
function stableId(...parts: unknown[]) {
  return crypto.createHash("sha1").update(parts.map((p) => collapseKeyPart(p)).join("|")).digest("hex").slice(0, 12);
}
```

That is a **reversible-by-search** function over a small domain. Replaying the exact algorithm and
enumerating candidate `(label, price, medical)` triples recovered an exact SHA-1 match for **all
five** suffixes the owner pasted:

| Suffix from the owner's error | Decoded source data | Hashed key |
|---|---|---|
| `cca24072824d` | label `1g`, price `$12.00`, **medical** | `1g\|1200\|medical` |
| `00de6c9e8f2c` | label `3g`, price `$33.00`, **medical** | `3g\|3300\|medical` |
| `feda4c3b3628` | label `5g`, price `$45.00`, **medical** | `5g\|4500\|medical` |
| `28e453b71118` | label `1g`, price `$12.00`, adult | `1g\|1200\|adult` |
| `34e5d01d3909` | label `5g`, price `$45.00`, adult | `5g\|4500\|adult` |

**This changes the diagnosis completely.** The error message says these are
*"2 sizes … all described to Leafly as 1 each"*, which reads as though the labels were junk. They
are not junk. They are `1g`, `3g` and `5g` — clean, real, distinct weights. The data is **fine**.

### Why they collapse anyway

`src/lib/leafly/payload-core.ts:452-467`:

```ts
export function variantAmountAndUnit(itemType, label) {
  const legal = LEAFLY_TYPE_UNIT_MATRIX[itemType].variantUnits;
  const parsed = weightToLeaflyAmount(parseWeightFromLabel(label));
  if (parsed !== null && legal.includes(parsed.unit)) return parsed;   // ← "g" must be legal
  if (legal.includes("each")) return { amount: 1, unit: "each" };      // ← otherwise 1 each
  return null;
}
```

The weight **is** parsed correctly (`parseWeightFromLabel("3g")` → `{unit:"g", value:3}`). It is
then **thrown away** because `g` is not a legal unit for that item's type. Per Leafly's own schema,
embedded verbatim in the `variant.unit` description in `docs/leafly-specs/schemas/v2-items.json`:

| Type | Valid `variant.unit` |
|---|---|
| Accessory, Seeds, Clone, Edible, **PreRoll**, **Topical**, Other | `each` |
| Flower | `g`, `oz` |
| Concentrate, Cartridge | `each`, `g` |

So a **PreRoll** or **Topical** or **Edible** priced in grams has nowhere to put the `3`. Every size
becomes `1 each`, and `src/lib/leafly/variant-identity-core.ts` correctly reports the collision.

The affected products are overwhelmingly gram-labelled items funnelled to an each-only type —
`preroll`, `infused-preroll`, `blunt`, `infused-blunt`, `preroll-pack` all map to `PreRoll`
(`payload-core.ts:217-222`), and `PreRoll` is each-only.

### Why the current error message is actively misleading

It tells the owner two sizes "are all described as 1 each" and, via `remedyForCollision()`, that
they must be **split into separate products**. For a 1g/3g/5g pre-roll pack that is the **wrong
remedy** and a large amount of pointless manual work: the sizes are real and distinguishable, and
Leafly can be told them — just not in `variant.unit`.

### The lawful blanket fix

Leafly's `item.name` is free text (`minLength: 1`) and `item.id` is "unique to all items in the
menu". Two lawful, spec-legal options exist, and **neither invents data**:

1. **Type re-funnel where it is honest.** A gram-denominated *concentrate* or *cartridge* may use
   `unit: "g"` — the matrix permits it. Any item whose category maps to `Concentrate`/`Cartridge`
   and whose label carries a real weight should already be taking the `g` branch; where it is not,
   that is a category-mapping defect worth correcting at the source.
2. **Size-suffixed sibling items** for genuinely each-only types. One Leafly item per size, id
   `…-<variantsuffix>`, name `"<name> — 3g"`. This is the *same* remedy `remedyForCollision()`
   already recommends, but applied **mechanically and in bulk** instead of by hand, and with the
   size text taken from the **real label we already hold**, never invented.

Because the label is already parsed and available, this is a transformation of data we **have**,
not a fabrication. That is the distinction that makes a blanket fix safe here.

> **Non-negotiable:** the blanket fix must never silently drop a size. Dropping a size on a cannabis
> menu is a pricing decision and belongs to the shop. Current behaviour already refuses to do this
> (`variant-identity-core.ts`, "WHAT IT DELIBERATELY DOES NOT DO") and that stays.

---

## FINDING J-2 — "Suggest a sample" is deterministic AND biased toward failure *(asks 1, 2)*

The owner reported the previously-successful 8 products now refuse to send.

`src/lib/leafly/selection-core.ts:613` `buildRepresentativeSample()` is **deterministic by design**:

> "breaking every tie by id so two runs on the same feed always produce the same sample. A sampler
> that returned a different set each time would make a failed read-back impossible to reproduce."

That rationale is sound, but it has two consequences the owner is living with:

1. **It can never suggest a different 8.** Same feed in → identical 8 out, forever. This is exactly
   ask 2.
2. **It actively prefers the products that fail.** The scoring at `selection-core.ts:634-642`
   awards `+60` for `item.variants.length > 1`. A multi-variant item of an each-only type is
   *precisely* the shape that produces a `1 each` collision (FINDING J-1). The sampler is
   optimising for the defect.

It is also **contract-blind**: it scores richness, never whether the item would pass
`validateLeaflyPayload`. So it can, and does, hand the owner a sample that cannot be sent.

**Fix direction:** keep determinism *reproducible* but make it *steerable* — a seed/rotation input
so "suggest another" yields a genuinely different set while any given seed stays replayable. Score
contract-passing items **up** and known-failing items **down**, and when a failing item is included
deliberately (for coverage), label it as failing and attach a fix link.

---

## FINDING J-3 — Product ids are the only identifier offered *(ask 5)*

> "i don't understand product ids, nor are they a useful way to identify products"

He is right, and the data to do better **already exists**. Verified against the real schema
(`supabase/migrations/0002_slice2_pos_import.sql:105-138`), `menu_items` carries:

`source_item_id`, `name`, **`product_name`**, **`brand_name`**, **`vendor_name`** *(indexed,
line 136)*, `category`, `strain_name`, `price_label`, `hidden`

and `menu_variants` (line 141-152) carries **`label`**, `price_minor_units`, `inventory_level`.

**Barcode — the honest answer.** There is **no barcode column on `menu_items`**. `barcode` exists
only on `noncannabis_products` (`0111_noncannabis_inventory_ops.sql:36`). For cannabis product the
equivalent identifier is the **Cultivera barcode stored as `inventory_lots.lot_code`**, joined by
`inventory_lots.pos_product_key = menu_items.source_item_id` (`0023_pos_inventory_lots.sql:95`).
`src/lib/pos/import-lot-core.ts:18-21` documents this from the real export:

> "Barcode is ALWAYS populated (e.g. `GF42802505795142`) and is the identifier Cultivera (a CCRS
> integrator) filed with CCRS — 3,870 unique values"

So the owner **can** have name + brand + vendor + barcode. It requires a join, not a new column.

**The gap in the code:** `SyndicationItem` (`src/lib/syndication/menu-feed-core.ts:38-81`) carries
`name`, `brand`, `category`, `strainName` — but **no `vendor`** and **no barcode**, and
`SyndicationVariant` carries `label` which is **never sent to Leafly** and never shown in an error.
Every downstream message is therefore id-only because that is all it was handed.

---

## FINDING J-4 — Credentials amnesia is a process-local cache on serverless *(ask 8)*

> "two clicks of the same button, one worked, the second time failed"

`src/lib/leafly/config.ts`:

```ts
let overrideCache: LeaflyOverrides | null = null;          // module-level = per-lambda-instance
export function getLeaflyConfig(overrides?) {
  const o = overrides ?? overrideCache;
  if (!o) return envConfig();                              // silent fallback to env
  …
}
```

On Vercel each serverless instance has its own module scope. A second click routed to a cold or
different instance sees `overrideCache === null` and silently reports "not configured".

**A second, independent cause:** `refreshLeaflyConfig()` in `src/lib/leafly/runtime.ts` wraps the DB
read in `try { … } catch { setLeaflyOverrideCache(null); }` — a transient DB blip **silently
downgrades to env vars**.

**Unguarded call sites** — `isLeaflyConfigured()` called with no `await refreshLeaflyConfig()` in
scope: `src/app/admin/integrations/leafly/actions.ts:97, 492, 553, 720` and
`src/app/admin/integrations/leafly/selection-actions.ts:265`.

The correct pattern already exists one file away — `describeLeaflyReadinessAsync()`
(`src/lib/leafly/push.ts:132`) awaits the refresh first. The sync `isLeaflyConfigured()`
(`push.ts:127`) does not.

---

## FINDING J-5 — Quarantine exists but never offers itself *(ask 4, 7)*

> "it did not give me the option to send the good products and withhold the bad ones"

The capability **shipped** in Task I: `src/lib/leafly/quarantine-core.ts`, `decideQuarantine()`,
policy `"block" | "quarantine"`, surfaced in `SyncSettingsPanel.tsx`. It defaults to `"block"` —
a deliberate Task I decision.

The defect is **discoverability**: the 124-error message never mentions that the option exists or
where to change it. A feature the owner cannot find is a feature that does not exist. The failure
message must name the setting and link to it.

`QUARANTINE_MAX_SHARE_PERCENT = 25` also matters here: 124 failures out of ~400 items may exceed
the 25% ceiling and be refused as `too_widespread`. That must be explained, not silently applied.

---

## FINDING J-6 — No usable view of what is on the Leafly menu *(ask 6)*

> "we can push the read the menu back button, but it doesn't really give very useful information"

Read-back machinery exists (`src/lib/leafly/readback-core.ts`, and the response contract
`docs/leafly-specs/schemas/v2-show.json`). Deletion is id-entry only
(`src/lib/leafly/delete-request-core.ts`, `MAX_DELETE_IDS = 200`) — the owner must **type ids he
cannot read**. The owner explicitly delegated the design here.

**Fix direction:** a browsable, searchable, multi-select table of what Leafly actually holds, keyed
on human identifiers (name / brand / vendor / barcode / size), with ids used internally only.

---

## Roadmap — ordered so nothing drifts

Ordered by *dependency*, not by the order the asks were written. Items marked **⛏ blocker** unblock
later work.

| # | Work | Addresses | Depends on |
|---|---|---|---|
| **R1 ⛏** | **Product identity core** — one pure module resolving `id → {name, productName, brand, vendor, barcode, category, size, price}`, sourced from `menu_items` + `menu_variants` + `inventory_lots.lot_code`. | ask 5 | — |
| **R2 ⛏** | **Credentials durability** — refresh-before-check everywhere; stop silent env downgrade on DB error; distinguish "not configured" from "could not determine". | ask 8 | — |
| **R3** | **Human-readable messages** — rewrite validation, quarantine, potency and delete messages to lead with name/brand/vendor/barcode/size; id demoted to a parenthetical. | ask 5 | R1 |
| **R4** | **Fix deep links** — `/admin/products/{source_item_id}` (verified to exist: `src/app/admin/products/[key]/page.tsx:60-66`, keyed by `source_item_id`). Attach to every failure. | asks 3, 4, 7 | R1 |
| **R5** | **Collision remediation planner** — classify each collision as *re-funnelable* (Concentrate/Cartridge → `g`) or *needs sibling items*; propose a **bulk** plan from the real labels; preview before apply; never drop a size. | ask 7 (blanket fix) | R1, R3 |
| **R6** | **Skip-the-bad-ones, surfaced** — offer partial send at the point of failure and name the quarantine setting in the message. | asks 4, 7 | R3, R4 |
| **R7** | **Intelligent sampler** — seeded rotation ("suggest another"), contract-aware scoring, failures labelled with fix links. | asks 1, 2, 3 | R3, R4 |
| **R8** | **Enterprise delete UI** — searchable/filterable read-back table, multi-select, human identifiers, id-free interaction. | ask 6 | R1, R3 |

### Standing constraints (apply to every item)

- **Never invent product data.** A size, weight, potency or barcode that is not in the source data
  does not get created to satisfy a schema. Refuse and explain instead.
- **Never silently drop a size or a product.** Withholding is always reported.
- Pure cores are `*-core.ts`: zero runtime imports, no React/DOM/`server-only`/I/O, embedded
  `__run*Tests()`, registered in `scripts/compliance/run-pure-selftests.ts` with an assertion floor.
- Every new core gets a `tests/compliance/` suite **and** two rounds of mutation testing with a
  no-op CONTROL mutant that must survive.
- Anchor to `docs/leafly-specs/` (machine-readable), never to prose alone.

---

## Reproduction artefact

The suffix decode in FINDING J-1 is reproducible. The script replays `stableId()` verbatim and
reports **only exact SHA-1 matches** — it prints "NO MATCH" rather than a nearest guess, which is
why the first (narrower) run honestly reported three unknowns before the search space was widened.

---

## Delivery status — R1 through R8

All eight roadmap items are implemented end to end: pure core, server action, **and** a screen that
reaches them. The last column is the one that matters, because a core with no caller changes
nothing the owner can see.

| # | Core | Server | UI | Where |
|---|---|---|---|---|
| R1 | `product-identity-core.ts` (94) | `identity-server.ts` | used by every message | name → brand → vendor → barcode, id last |
| R2 | `readiness-gate.ts` | `config.ts`, `runtime.ts` | all gated actions | refresh-then-check |
| R3 | `sendability-core.ts` (103) | `selection-server.ts` | `sendability-panel.tsx` | failures led by name |
| R4 | `fixHrefFor()` | `triageLeaflySelection` | "Fix this product" buttons | `/admin/products/{source_item_id}` |
| R5 | `collision-remedy-core.ts` (76) | `remedyPlan` | blanket-fix preview | describes before applying |
| R6 | `triageSendability` | `pushLeaflyPassingOnlyAction` | "Send the N that pass" | 4 safety properties |
| R7 | `sample-rotation-core.ts` (49) | `suggestRotatingSampleAction` | "Suggest another 8" | round counter, not random |
| R8 | `menu-browser-core.ts` (70) | `menu-browser-server.ts` | `menu-browser-client.tsx` | search by name/vendor/barcode |

Verification at delivery: `tsc --noEmit` clean; ESLint clean; **392 pure assertions** across five
cores; **100** compliance tests in `leafly-cultivera-remediation.test.ts`; full suite **16,906
passing / 0 failing** across 636 files.

### A constraint discovered during the work

`getLeaflyMenu()` (`src/lib/leafly/push.ts:771-783`) **refuses outside the sandbox** — Leafly
answers 405 in production. A delete UI that depended on live read-back would therefore work in
testing and be dead on the day it was needed. `menu-browser-server.ts` tries the read-back, falls
back to our own record of what we published, and **labels which source produced the list**. The
fallback is honest but weaker (it cannot see a product that reached Leafly another way), and the
banner says so rather than implying authority it does not have.

---

## Incident — a guessed constant that passed its own tests

Recorded because it is the most instructive failure in this task and the standing rule is *never
guess, never assume*.

**What happened.** Building the triage, I needed the validator's error codes. Instead of reading
`payload-validate-core.ts`, I wrote plausible ones from memory: `variant_size_collision`,
`missing_name`, `duplicate_variant_id`. The real code is **`variant_size_indistinguishable`**;
`variant_size_collision` does not exist anywhere in the codebase.

**Why nothing caught it.** It type-checked, and the unit tests passed — because the tests asserted
against *the same invented constant*. A test that shares its subject's assumption cannot falsify
it. Every layer agreed with every other layer and all of them were wrong together.

**What it would have cost.** In production all 124 of the owner's real errors would have fallen
through to `unknown`, the blanket fix would never have been offered, and the panel would have said
"we do not recognise this problem" about the single most common defect on his menu — while looking
fully green in CI.

**The fix, in order.** Enumerate all **57** real codes programmatically from the validator source;
rewrite the three code lists against that enumeration; **delete the substring fallbacks** (they
would have matched `variant_id_duplicate` as a bulk-safe product fix, which is a *worse* failure
than not matching at all, because it offers a confident wrong repair); add the `system_defect`
class for codes that are our bug rather than the owner's data.

**The permanent guard.** A compliance test re-derives the emitted codes from the validator on every
run and fails if anything in `RECOGNISED_DEFECT_CODES` is not really emitted. Guessing this class
of constant again is now a red build, not a silent production defect.

```
it("every code the triage claims to recognise is REALLY emitted by the validator", ...)
```

**The same lesson, twice more.** A mutation harness reported its CONTROL mutant as KILLED because
its failure detector grepped for `/[0-9]+ failed/`, which matched the self-tests' own healthy
output line `94 passed, 0 failed`. A harness whose CONTROL fails proves nothing about the mutants
it "killed", so detection was moved to process exit codes. Separately, two guards tripped on
comment prose rather than code — including one that tripped on the paragraph *explaining why*
`Math.random()` was rejected. All three are the same underlying mistake: **checking the text that
describes the behaviour instead of the behaviour.**

---

## R7 closed — the collision is now REPAIRED, not merely reported

Everything above this line diagnosed the 124 errors. Nothing fixed one. `planRemedies()`
*described* a remedy and had **no apply path anywhere in the tree**, so every one of the owner's
collisions was still live on `main` after the diagnosis shipped.

Two pure cores close it, in a deliberate order.

| Stage | Module | What it does | When it applies |
|---|---|---|---|
| 1 | `collision-apply-core.ts` | Corrects `amount`/`unit` in place | Type allows a weight (Flower, Concentrate, Cartridge), **or** the labels record real pack counts (`2pk`, `10pk`) |
| 2 | `collision-split-core.ts` | Lists one product as several products, one per size | Each-only type whose sizes differ by **weight** — the owner's actual case |

**Why that order and never the reverse.** Splitting changes what a shopper sees; correcting an
amount does not. So the cheap, invisible fix is exhausted first. Run the other way round, a Flower
item labelled 1g/3g/5g — which stage 1 fixes perfectly by restoring the real weights — would be
shattered into three products for no reason.

**Why splitting is lawful, from Leafly's own schema.** `items` is an unconstrained array;
`item.id` need only be unique and stable (a deterministic `${parentId}--${slug(label)}` is both);
and decisively `variant.id` *"Takes precedence over top-level id for order integration purposes"*.
Each split product keeps its **original variant id untouched**, so an incoming order still resolves
to the same POS variant. **Splitting cannot break ordering.**

**Measured end to end**, real feed → real builder → real validator, across all ten funnel types:
`variant_size_indistinguishable` goes to **zero**, with **no new violation of any other code**,
every variant surviving exactly once, and no price, stock, unit or id changed.

Wired into `pushLeaflySelection({ repairCollisions })` — **off by default**, applied after
`applyLeaflySettings` (so it measures what is really about to be sent) and **before**
`assertLeaflyPayloadValid` (so the validator, not the repair, is the judge of success). The repair
can never mask a failure.

### Finding J-2 — an assumption that would have written a wrong weight onto cannabis

The first draft of the server bridge paired source to built variants **by position**, justified by
a confident comment claiming the built variant id was a re-derived hash, and that `toLeaflyItem`
preserves variant order. Both halves were false:

* `toLeaflyVariant()` emits `id: String(v.id)` — the **source id, copied verbatim**. The
  `${itemId}-${stableId(...)}` shape is minted far upstream in `toMenuItem()`. A direct lookup hits.
* `variantsFor()` **drops** variants in two places (the low-stock withhold rule, and an unreadable
  weight on a weight-only type). Either drop shifts every later index.

Measured harm: for labels `["1g", "MYSTERY BAG", "5g"]` the middle variant is rejected, and
positional pairing then reports the surviving **5g** variant's label as **"MYSTERY BAG"**.

The bridge now joins **by id only, with no positional fallback** — a fallback here would be a
silent guess, and a silently guessed weight is the worst output this module could produce. All four
facts are pinned by tests so the wrong assumption cannot return.

**The lesson, again:** the comment was more confident than the code was true. Both claims took one
script to disprove.

### Verification

* `collision-apply-core` 76 assertions · `collision-split-core` 65 assertions — both registered
  with floors in the pure self-test runner.
* Mutation-tested: CONTROL **SURVIVED**, and **11/11** mutants **KILLED** (missing-label guard,
  duplicate-label guard, id-clash guard, variant-id rewrite, reprice, size-drop, name
  disambiguation, unstable id, assumed-clean, medical dimension, id seeding).
* `tests/compliance/leafly-collision-apply.test.ts` — 41 tests, including a **drift guard** parsing
  the unit matrix out of the published `v2-items.json` markdown table rather than trusting our copy.
* Suite-level mutation check: breaking `clean` or drifting the matrix makes the new suite **fail**
  (1 and 6 tests respectively) — the tests were tested.
* Full run: **637 files, 16,947 tests, 0 failures.** `tsc --noEmit` clean, `eslint` clean.

One further self-inflicted lesson: a test in this very file originally asserted the absence of a
field with a regex that **could never fail**. It was replaced with one that runs the join and
asserts the emitted variant carries exactly the six v2 fields. Same mistake as the incident above —
*checking the text that describes the behaviour instead of the behaviour.*

---

## TASK J — the owner's four follow-up questions (asks 1–4)

The owner asked four things after the collision repair merged: how do I delete products and what is
left to build; are the fix-and-edit redirect buttons ready; can the full menu be sent while
withholding the bad ones; and what did "stage 2 changes how your menu looks to shoppers" mean.

Each was treated as a claim to be **verified or refuted**, not a feature to be described.

### Finding J-5 — the fix buttons work, and had a latent 404 one wiring change away

The id chain was followed through six files by reading source, not by assuming:

`menu_items.source_item_id` → `feed-source.ts` → `menu-feed-core.ts:157` → `payload-core.ts:755`
→ `payload-validate-core.ts:517` → `sendability-core.ts:377 fixHrefFor(id)` → `/admin/products/[key]`
→ `getItemBySourceKey()` → `.eq("source_item_id", key)`.

**The chain closes.** Ordinary fix buttons work.

But `collision-split-core.ts` mints `${parentId}--1g` ids that exist on Leafly and **not** in
`menu_items`. A fix button for a split listing would have 404'd. It was latent only because
`triageLeaflySelection` validates the **unrepaired** payload (`selection-server.ts:493`) — luck of
ordering, not design, and it would have ended the moment the repair reached the UI, which is exactly
what this task did.

`fix-link-core.ts` (58 assertions, floor 52) closes it: known-set check **first** (so a real id
containing `--` stays `direct`), then split→parent, then synthesized→item, then **refuse with
`href: null`** rather than emit a link that might be wrong.

### Finding J-6 — "withhold the bad ones" already existed and REFUSED on this owner's menu

`invalidItemPolicy: "quarantine"` predated the request. Measured through the **real** builder,
**real** validator and **real** quarantine decision (19/19 assertions):

| Menu | Bad | Share | Outcome |
|---|---|---|---|
| 600 | 60 | 10% | proceeds — sends 540, names 60 |
| 600 | 200 | **33.3%** | **REFUSES — nothing sent** |
| 600 | 200 | 33.3% | **repair first → 1000 items, 0 bad, nothing withheld** |

`QUARANTINE_MAX_SHARE_PERCENT = 25` with a `>=` comparison. The owner's real case (124 failures)
sits **above** the ceiling, so the pre-existing feature would have produced an error and nothing
else. Boundary verified at exactly 25% (refuses) and 24.8% (proceeds).

**The shortcut was considered and rejected.** Raising the ceiling would have shipped a green
report over a builder defect. The ceiling is a correct alarm; the honest fix is to remove the
*cause* before the alarm is consulted. `TARGETED_PUSH_MAX_ITEMS = 250` also makes the targeted
picker structurally incapable of carrying a several-hundred-product menu — hence a separate
whole-menu path rather than a flag on the existing one.

### Finding J-7 — the preview promised names and delivered counts

`buildFullMenuDecision` computed `ItemSplit.products` — the exact product names a shopper would
see — and then **discarded them**, returning only `splitItemCount` / `createdItemCount`. The
preview's own docstring promised it "lists the products that would be created by a split, **by
name**". A count cannot answer *"what will my shoppers see?"*.

`split-preview-core.ts` (87 assertions, floor 80) is the shape that carries them out: current name
beside created names, per-listing price and stock joined **from the pre-split payload** (so the
preview can still reveal a price the split altered, rather than agreeing with it by construction),
refusals included as part of the preview, stable alphabetical order with an id tiebreak, and a
missing price stated in words rather than rendered as `$0.00`.

Its prose deliberately contains none of "stage 1", "stage 2", "collision", "variant", "payload" or
"split" — those are our words for our defect; the owner asked what it does to his shop.

### Finding J-8 — the deliberate omission that would have been a lying checkbox

`repairCollisions` is wired into `pushLeaflySelectionAction` (which repairs after settings and
before `assertLeaflyPayloadValid`, so the validator judges the repaired payload) and is
**deliberately not** offered on `pushLeaflyPassingOnlyAction`.

That path derives its ids from `triageLeaflySelection`, which validates the **unrepaired** payload.
Every colliding product is therefore already excluded from `sendableIds` before a repair could run.
The flag would have repaired a set with nothing repairable left in it — looking like a feature,
doing nothing, and leaving the products it claimed to fix off the menu. A test fails if anyone adds
it, and a companion test pins the triage ordering that makes the reasoning true.

### Safety properties of the new whole-menu send

* **PUT only, hard-coded, no POST path exists.** A POST of a deliberately-withheld menu would
  instruct Leafly to DELETE every held-back product — turning "hold this back" into "destroy this".
* Sync state is written **only** for sent items; withheld ids are left untouched rather than
  written (which would claim Leafly holds them) or deleted (which would make the next PUT sync
  issue a DELETE for a product that may still be live).
* A sync-state write failure never turns a live publish into a reported failure.
* Preflight still **throws** rather than withholding — a structural feed fault cannot be fixed by
  omitting products.
* Rules F1–F4: never report success for an empty send; never withhold without naming; never
  proceed on unattributed errors; the ceiling still applies, measured **after** repair.
* The repair is **off by default** everywhere, and the UI clears a stale preview when the toggle
  changes, so the button can never do something other than what was previewed.
* The audit trail records created listings **by name** (`splitCreatedListings`), not as a count —
  a shopper-orderable listing that appears in no log is unanswerable six weeks later.

### Verification

* `fix-link-core` 58 · `full-menu-core` 69 · `split-preview-core` 87 — all registered with floors
  in the pure self-test runner; **ALL PURE SELF-TESTS PASSED**.
* `tests/compliance/leafly-full-menu.test.ts` — **80 tests**, built through the real builder,
  real validator and real split engine.
* Mutation round 1 (cores/server): **18/18** should-kill **KILLED**, CONTROL **SURVIVED**.
* Mutation round 2 (preview, server wiring, UI, picker): **24/24** should-kill **KILLED**,
  CONTROL **SURVIVED**.

**Four mutants survived round 2 on first run — every one was a test matching the right words in the
wrong place**, and they are worth recording because they are the same mistake in four costumes:

1. "the prose reassures about orders" was satisfied by `ordering ids` in an **earlier sentence**, so
   deleting the actual reassurance went unnoticed.
2. "refusals reach the preview" was satisfied by `repaired.refusals.length` used a few lines earlier
   to build `refusalCount` — the loose `toMatch` hit the wrong occurrence.
3. "the panel calls the preview action" was satisfied by the **import statement**. An import proves a
   file knows a name; only an `await` at a call site proves it runs it.
4. "the refusal names a next step" was reading the **checkbox label** higher up the file, which
   shares wording — so the whole explanation could have been replaced with "Too widespread." and the
   test would have passed.

All four are now scoped to the call site or the branch, and assert the **substance** (the promise
that orders still resolve; the specific `previewSplits({...})` arguments; an `await`; the advice
inside the refusal branch) rather than the vocabulary. This is the third recurrence in this file of
one lesson: *checking the text that describes the behaviour instead of the behaviour.*
