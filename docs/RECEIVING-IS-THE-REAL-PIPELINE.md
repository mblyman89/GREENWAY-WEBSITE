# Receiving intake is the real pipeline. Cultivera is a one-time import.

**Owner directive, verbatim:**

> "the cultivera menu import is a one time event and will never be used again
> after. our system receives products via receiving intake. every task i feel
> like the hyper focus is on cultivera and the real system is overlooked and
> neglected. we are not building a system around cultivera, we have built our
> own system."

> "look at cultivera as crap data we need to get into our amazing software and
> stop looking at cultivera menu import as the way products enter our system."

This document is the standing answer to "where do products come from?" so no
future session has to guess, and so nobody re-centres the work on Cultivera.

---

## The rule

**RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY.** Permanently.

    vendor manifest / invoice  ->  receiving intake  ->  inventory_lots
                                          |
                                          +-> mastering -> staged menu -> published menu -> POS/cart

- `src/lib/inventory/intake-*` and `intake-store.ts` are **critical, permanent
  infrastructure.** They run every time a truck arrives, forever.
- `src/lib/purchasing/cultivera-*` is a **one-time migration tool.** It exists
  to drag historical vendor-menu data into our system once. After the
  changeover it is dead weight, kept only for provenance.

**Cultivera is crap data we import once. It is not an architecture.** When a
task says "brand" or "product" or "price", the pipeline that matters is
receiving intake. Cultivera gets a fix only when it blocks the one-time import.

## Priority order for any pipeline work

1. **Receiving intake** — the real door. Fix here first, always.
2. Mastering / staging / publish — what receiving feeds.
3. POS, cart, promotions — what the menu feeds.
4. **Cultivera — last, and only for the one-time import.**

## The defect this rule was written to catch (measured, not assumed)

SLICE T1 unified five duplicate brand matchers behind
`src/lib/promotions/brand-match-core.ts`. Every one of those five lived in the
**promotions/menu** half of the system, which is fed by the Cultivera-era
import path. The **receiving intake** resolver was never touched, because
nobody looked at it.

`resolveBrandId` (`src/lib/inventory/intake-store.ts`) matched with:

    .ilike("display_name", label)

Postgres `ILIKE` **with no wildcard metacharacters is an exact match that
ignores case only.** It does not ignore doubled interior spaces, hyphens,
punctuation, or a trailing space. `brandKey()` ignores all of them.

Measured by `scripts/recon/receiving-brand-gap.py` against the 168 real brand
records in `back-office/GREENWAY WEBSITE/database/vendors`:

    brands read from back-office database        : 168
    realistic manifest spellings tested          : 771
    resolved by ILIKE (receiving intake today)   : 318  (41.2%)
    resolved by brandKey (promotions matcher)    : 771  (100.0%)
    MISSED by receiving, caught by brandKey      : 453

Spellings receiving intake silently failed to resolve include
`'Agro  Couture'` (doubled space), `'Agro-Couture'`, `'AgroCouture'`, and
`'Thunder Chief '` (trailing space).

### Why that mattered in dollars

`inventory_lots` stores **`brand_id` only — there is no `brand_name` column**
(migration `0023`, line 92). The brand text a customer and the discount engine
eventually see is looked up *from that id*
(`src/lib/inventory/catalog-drafts.ts` selects `brands.display_name`
`.eq("id", lot.brand_id)`).

So the failure chain was:

1. vendor sends `Phat  Panda` (doubled space) on the manifest
2. `ILIKE` finds no exact-ignoring-case match -> `brandId = null`
3. lot is inserted with `brand_id: null` — **no error, no warning**
4. `catalog-drafts` has no `brand_id`, so `brand_name` is `null`
5. the item reaches the menu **unbranded**
6. Top Shelf Thursday asks `brandInList(brands, line.brand)` -> `false`

**The item is silently left off the brand deal, and the customer is charged
full price.** T1's unified matcher could not save it, because the brand was
already destroyed at the receiving door, hours earlier.

This is precisely the owner's point: the real engine was neglected while the
Cultivera-fed half got the attention.

## The fix

`src/lib/inventory/brand-resolve-core.ts` — a PURE decision layer that reuses
`brandKey()` from `brand-match-core.ts`, so receiving intake and promotions
**cannot drift apart again by construction**. `resolveBrandId` now:

1. tries the fast exact `ILIKE` path (unchanged, still one indexed query);
2. on a miss, pages the brand list and matches on `brandKey`;
3. requires a **unique** squeezed match before accepting it;
4. **refuses to guess** when one squeezed key maps to two different brands, and
   reports the ambiguity for a human instead (rule 3: drafts-only, never
   silently invent).

### Two ambiguities that prove step 4 is required

The same measurement found four `brandKey` merges in the real data. Two are one
company spelled two ways, and two are **different vendors**:

    420bar        SAME vendor       ['4.20 Bar', '420 Bar']
    rayslemonade  SAME vendor       ["Ray's Lemonade", 'Rays Lemonade']
    hightide      DIFFERENT vendors ['High Tide'  @ NORTHWEST HARVESTING CO,
                                     'HighTide'   @ NALLEY VALLEY PARTNERS LLC]
    subx          DIFFERENT vendors ['SUBX'       @ SUBX,
                                     'Sub X'      @ INDEPENDENT / UNLISTED VENDOR]

Verified by reading each `brand.json`. `High Tide` / `HighTide` and
`SUBX` / `Sub X` squeeze to one key but belong to **two different vendors**, so
a blind squeeze would attach a lot to the wrong company. That is why the
resolver takes a squeezed match only when it is unambiguous, and why
`vendorId`, when known, is applied as a filter first.

Note the scope difference, deliberately: promotions may squeeze freely, because
matching `High Tide` and `HighTide` to the same *deal* is harmless. Receiving
assigns **ownership of physical inventory**, so it must be strict.

## Never again

- `tests/compliance/receiving-is-the-real-pipeline.test.ts` fails if
  `resolveBrandId` stops using the shared `brandKey`, i.e. if receiving and
  promotions ever drift apart again.
- Standing rule 11 in `AGENTS.md` states the pipeline rule.
- Header comments in `intake-store.ts`, `brand-resolve-core.ts`,
  `cultivera-menu-core.ts`, `cultivera-store.ts`, and `import-service.ts` state
  it at the point of use.
