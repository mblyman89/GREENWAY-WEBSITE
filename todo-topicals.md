# Topicals round — recon (measured, nothing assumed)

## The question Michael asked

> "I want to do the industry standard practice for topicals. **I am guessing
> that will mean moving it out of liquid edibles.** Let's completely fix liquid
> edibles first, then we will fix topicals."

He labelled the second sentence a GUESS himself. Standing rule says build from
fact, so the guess gets checked before it gets built.

## What the statute actually says (retrieved, not remembered)

WAC 314-55-095(1)(d)(i)(E), current text effective 1/7/2025, verified against
Cornell LII:

> "72 ounces of cannabis-infused product in liquid form **for oral ingestion or
> applied topically to the skin**, unless the product is packaged in individual
> units containing no more than 4 milligrams of active delta-9 THC per unit"

Topicals are named IN clause (E), sharing ONE bucket with oral liquids. There
is no separate topical transaction limit anywhere in 314-55-095. The medical
column (2)(d) lists useable / solid / concentrate / liquid only.

**Therefore moving `topical` to its own bucket would INVENT a limit the statute
does not contain, and would stop a salve and a drink from sharing the 72 oz
bucket the law says they share.** That is the permissive direction — it would
let a customer buy 72 oz of drink AND a pile of salve in one transaction.

So the guess is wrong, and the current bucketing is RIGHT. Recorded here
because the next person will have the same instinct.

## What IS wrong — measured

### Defect T1 (LIVE, blocking, and I shipped it in L5)
`LIQUID_VOLUME_TYPES = {"Liquid Edible", "Tincture"}` excludes `"Topical"`,
but `assessReceivingVolume` gates on `categoryToBucket(...) === "liquid_edible"`,
which `topical` DOES satisfy. The two disagree. Measured:

| product name | derived ml | gate fires | approval |
|---|---|---|---|
| Fairwinds Flow Cream 2oz | null | YES | **REFUSED** (weight known: 56.699 g) |
| Ceres Wellness Balm 1.7oz | null | YES | **REFUSED** (weight known: 48.194 g) |
| Green Revolution Sublime Salve 30g | null | YES | **REFUSED** (weight known: 30 g) |
| Zoots Releaf Balm 50ml | 50 | no | approves |
| Massage Oil 8 fl oz | 236.588 | no | approves |

A weight-labelled salve CANNOT be onboarded. The receiver is asked for a volume
that does not exist on the package, and converting oz->ml needs a density
nobody has. The gate refuses and there is no honest answer. This blocks real
receiving TODAY.

### Defect T2 (permissive, the one that costs compliance)
A topical whose size nothing establishes (e.g. "Fairwinds Relief Balm") gets
NO volume at injection, because injection only derives/records volume for
`LIQUID_VOLUME_TYPES`. At the register it falls back to
`DEFAULT_UNIT_GRAMS["topical"] = 28`, so **72 packages of any size sell** —
the exact defect the whole liquids round existed to kill, still live on the
topical shelf.

Measured: qty 72 -> used 2129.292 ml = exactly the cap, EXCEEDED=false;
qty 73 -> exceeded. Identical to the pre-L4 liquid bug.

### Not a defect — the weight carry-across is exact
`lineMl` falls back to `(grams / 28) * 29.5735`, so an ounce-labelled topical
meters at exactly 72/oz as before. Verified: 1oz->72, 1.7oz->42, 2oz->36,
4oz->18, 8oz->9. NO density is assumed anywhere. This is correct and must not
be "fixed".

## OWNER DECISION (locked this turn)

> "lets keep topicals in the same liquids bucket, and yes, please fix the two
> defects."

So the statutory reading stands: `topical` STAYS in `liquid_edible`. The two
defects below are the work.

### Defect T3 (found while fixing T2 — BIGGER than T2, and it is about DRINKS)
T2's root cause is not topical-specific. Injection's whole fact block is gated
on `MG_FACT_TYPES.has(invType)`, and `LIQUID_VOLUME_TYPES` is a second
hand-maintained list. Measured every inventory type that resolves into the
ml-metered bucket:

| inventoryType | resolved cat | in MG_FACT_TYPES | in LIQUID_VOLUME_TYPES |
|---|---|---|---|
| Liquid Edible | edible-liquid | yes | yes |
| Tincture | edible-liquid | yes | yes |
| **Beverage** | edible-liquid | **no** | **no** |
| **Soda** | edible-liquid | **no** | **no** |
| **Shots** | edible-liquid | **no** | **no** |
| **Liquid Infused Edible** | edible-liquid | **no** | **no** |
| **Other Liquid Edible** | edible-liquid | **no** | **no** |
| **Topical / Bath Salts / Roll On** | topical | **no** | **no** |
| **Suppository / Transdermal Patch** | topical | **no** | **no** |
| Topical Ointment | topical | yes | no |

So a product typed **Soda** or **Beverage** — an ordinary drink — gets NO
volume derived at injection even when its name states one. At the register it
falls back to 28 g/unit: measured, 72 units passes at exactly the cap, 73
fails. A 12 fl oz soda x 72 = 864 fl oz against a 72 fl oz cap: **12x over.**

The liquids round did NOT fully close the oversell. It closed it for two
inventory-type strings out of eleven that reach the bucket.

FIX DIRECTION: scope must be derived from the BUCKET (`categoryToBucket(...)
=== "liquid_edible"`), which is the thing the limit actually keys on, not from
a hand-maintained list of type strings that silently omits most of the shelf.

## Plan

- [ ] T1: teach the receiving gate that a WEIGHT-labelled topical is already
      measured. The bucket is metered in ml, but a salve's own ounce-count
      carries across exactly, so a known net weight is a complete answer.
      Gate must fire ONLY when neither a volume NOR a weight is establishable.
- [ ] T2: make the volume/weight fact actually reach the menu for topicals,
      so the 28 g default stops being the silent fallback.
- [ ] Keep `topical` in `liquid_edible`. Replace the "will fail loudly when
      topicals move" marker with the STATUTORY reason it must not move.
- [ ] Tests + mutation harness + PR.
