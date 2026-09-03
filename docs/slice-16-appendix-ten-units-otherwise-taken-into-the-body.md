# Appendix to SLICE 16 — "Ten units of a cannabis-infused product otherwise taken into the body"

**Prepared for:** Michael Lyman, Greenway Marijuana
**Date:** 2026-09-03
**Status:** Explainer and recommendation. **No code was written for this rule in SLICE 16.**

You asked:

> *"tell me more about the other issue you flagged about the ten units of a cannabis
> infused product otherwise taken into the body. I don't understand what that means and
> what we would need to do to enforce it or implement it or comply with it in some way."*

Here is the full answer, from primary sources only.

---

## 1. Where the phrase comes from

It is the fourth item in the single-transaction limit list — the same list that gives us
1 ounce of flower and 7 grams of concentrate. **WAC 314-55-095(1)(d)(i)**, verbatim:

> (A) One ounce of useable cannabis;
> (B) Sixteen ounces of cannabis-infused product in solid form;
> (C) Seven grams of cannabis concentrates;
> **(D) Ten units of a cannabis-infused product otherwise taken into the body;**
> (E) Seventy-two ounces of cannabis-infused product in liquid form, unless the
> cannabis-infused product in liquid form is packaged in individual units containing no
> more than four milligrams of active delta-9 THC per unit;
> (F) Two hundred mg of active delta-9 THC within a cannabis-infused product in liquid
> form if the product is packaged in individual units containing no more than four
> milligrams of active delta-9 THC per unit.

So (D) is a sibling of the limit we just built in SLICE 16. Same subsection, same
sentence structure, same enforcement consequences if breached.

## 2. What it actually means

The phrase is not left to interpretation. The LCB defines it in the definitions section
of the same chapter. **WAC 314-55-010(40)**, verbatim:

> **"Product(s) otherwise taken into the body" means a cannabis-infused product for human
> consumption or ingestion intended for uses other than inhalation, oral ingestion, or
> external application to the skin.**

Read that as a process of elimination. The rule is defined by what it is **not**:

| Route of administration | Covered by (D)? | Which limit applies instead |
| --- | --- | --- |
| Inhalation — smoking, vaping, dabbing | **No** — explicitly excluded | 1 oz flower (A) or 7 g concentrate (C) |
| Oral ingestion — eating, drinking, swallowing, sublingual tinctures | **No** — explicitly excluded | 16 oz solid (B), 72 oz liquid (E), or the new 200 mg beverage rule (F) |
| External application to the skin — lotions, balms, salves, transdermal patches | **No** — explicitly excluded | Liquid infused (E) in our system |
| **Everything else that enters the body** | **YES — this is (D)** | **Ten units, regardless of weight or THC content** |

In practice, in the Washington retail market today, category (D) means essentially one
thing: **suppositories** (rectal and vaginal). Those are cannabis-infused products
consumed by the human body, they are not inhaled, they are not swallowed, and they are
not applied to the skin's surface. They fall through every other category and land in (D).

Two things worth knowing, because they are the common misreadings:

**Transdermal patches are NOT in this category.** A patch is applied to the skin, which
the definition explicitly excludes. Patches count as infused product in liquid form under
(E) — 72 ounces. I mention this because "patch" *feels* like an unusual route of
administration and people group it with suppositories. The rule text does not.

**Sublingual tinctures are NOT in this category either.** A tincture held under the tongue
is oral ingestion, also explicitly excluded. Tinctures are liquid infused product under
(E). Our code already maps `tincture` → `liquid_edible`, which is correct.

## 3. The unusual thing about this limit: it counts ITEMS, not amount

Every other limit in the list is an amount — ounces, grams, or (since SLICE 16)
milligrams of THC. This one counts **units**. Ten of them. It does not matter whether a
suppository contains 10 mg of THC or 100 mg, and it does not matter what it weighs. Ten
is ten.

That makes it, mechanically, the **simplest limit in the entire statute to enforce**.
There is no unit-weight conversion, no per-serving arithmetic, no ounce/gram convention
question, and none of the container-versus-serving subtlety that made SLICE 16 delicate.
It is a count of line-item quantities.

It also makes it the easiest to get wrong in the opposite direction: because "ten units"
sounds trivially small, it is easy for a system to never think about it at all — which is
exactly the situation we are in right now.

## 4. Where Greenway stands today — verified, not assumed

I grepped the codebase rather than relying on memory.

**The limit is not implemented anywhere.** There is no `otherwise_taken` bucket, no
ten-unit rule, and no reference to WAC 314-55-095(1)(d)(i)(D) in any enforcement path.
The register would not stop a sale of fifty suppositories today.

**The system does know suppositories exist.** They are recognized in three places:

- `src/lib/ai/kb/product-categories-data.ts` has a `suppository` category (grouped under
  `topical`) for the AI concierge.
- `src/lib/inventory/website-category-resolver.ts` maps a CCRS EndProduct inventory type
  containing `"suppository"` or `"transdermal"` to the website category `topical`. The
  code comment records this as **"owner C"** — a decision you made in an earlier slice.
- `src/lib/medical/medical-sale-core.ts` lists suppositories among the forms permitted to
  carry High-THC compliant labelling for recognition-card holders.

**So here is the actual current behaviour, which is the important part:** a suppository
resolves to website category `topical`, and `categoryToBucket("topical")` returns
`liquid_edible`. A suppository sold at Greenway today counts toward the **72-ounce liquid
limit**, not toward a ten-unit limit.

That is a real gap. A suppository weighs a few grams. You would have to sell somewhere in
the region of several hundred of them before the 72-ounce liquid bucket noticed — while
the statute caps the transaction at **ten**.

I want to be precise about the size of the risk, though: this is only a live exposure
**if Greenway actually stocks suppositories.** If you do not carry them, the gap is
theoretical and stays theoretical until the day a distributor offers you some.

**That is a question only you can answer, and I have not assumed it either way.**

## 5. What implementing it would take

Substantially less work than SLICE 16, for a specific reason: SLICE 16's difficulty was
almost entirely about *qualification* — proving a beverage was packaged in 4 mg units
required a new intake flag, a new database column, a validation guard, and a review
workflow, because no existing data could prove it. Category (D) needs none of that. The
route of administration is a property of the product form, and the product form is
already in the CCRS inventory type we import.

The work would be roughly:

**One:** add `otherwise_taken` as a sixth bucket in `sales-limits-core.ts`, with a third
unit type alongside grams and milligrams — `units`. The `LIMIT_BUCKET_UNITS` map built in
SLICE 16 already exists precisely so a non-gram bucket can be added without every
formatter downstream silently rendering it as a weight. That groundwork is done.

**Two:** set the recreational limit to 10 and — and this needs checking against
WAC 314-55-095(2), not assumed — the medical limit. The medical subsection tripled four
of the five gram buckets and did **not** triple the 200 mg beverage cap, so the pattern is
genuinely not predictable. It has to be read.

**Three:** split `suppository` out from `topical` in `categoryToBucket()`. This is the
one genuinely delicate step, because it changes existing behaviour that you signed off on
("owner C"). Suppositories would move from the 72-ounce liquid bucket to the new ten-unit
bucket. Transdermal patches, which currently share that mapping, must **stay** on liquid —
so the CCRS type mapping has to distinguish them rather than treating "suppository or
transdermal" as one case, as it does today.

**Four:** the same truth-surface work SLICE 16 needed — the settings screen, the AI
concierge, the public medical table, the compliance bible, and the staff reference that
tells budtenders which products count toward which limit.

**Five:** tests, and a mutation run to prove the tests have teeth.

My estimate is that this is a meaningfully smaller slice than SLICE 16 — no migration for
a new product fact, no intake workflow, no review queue. The bulk of it is the bucket
plumbing and the truth surfaces, both of which now have a worked example to follow.

## 6. My recommendation

**Make it its own slice, and only if you stock the products.**

I would not have bolted it onto SLICE 16, for three reasons. It touches a different
subsection of the rule with a different unit of measure. It requires reversing a mapping
decision you personally made, which deserves its own conversation rather than being
buried in a beverage slice. And SLICE 16 is already large — the temptation to keep adding
"one more related thing" is exactly how a well-tested change becomes an untested one.

**The question I need you to answer first:** *does Greenway currently stock, or plan to
stock, cannabis suppositories?*

- **If yes** — this should be scheduled soon. The current behaviour is not just missing a
  limit, it is applying the *wrong* limit, and "exceeding transaction limits" is its own
  enforcement category under WAC 314-55-522 (Category III: $1,250 and escalating
  suspensions).
- **If no** — I would log it as a known, documented gap and revisit it the moment a
  supplier offers you the category. There is no compliance exposure from a rule that
  governs products you do not sell, and building enforcement for an empty category is the
  kind of over-building you rightly flagged.

Either way, the fact that it is now written down and sourced means it cannot be forgotten.

## 7. Sources

1. **WAC 314-55-095**, *Cannabis servings and transaction limitations* —
   `https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-095`. WSR 24-21-051, filed
   10/9/24, effective 1/7/25. Subsection (1)(d)(i)(D) quoted verbatim in §1.
2. **WAC 314-55-010**, *Definitions* —
   `https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-010`. Subsection (40) quoted
   verbatim in §2. Same WSR 24-21-051 filing.
3. **WAC 314-55-522** — violation categories and penalty schedule, cited in §6.
4. Codebase state in §4 established by direct grep of `src/`, `supabase/` and `tests/`
   on the SLICE 16 branch, not from memory.
