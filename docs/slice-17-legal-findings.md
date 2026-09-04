# SLICE 17 — verified legal findings

Every quote below was scraped from the primary source during this slice (2026-09-03).
Nothing here is from memory or from the SLICE 16 appendix.

## 1. The recreational transaction limit — WAC 314-55-095(1)(d)(i)

> (1) For persons age 21 and older **and qualifying patients or designated providers who are
> not entered into the medical cannabis authorization database**, cannabis serving and
> transaction limitations are as follows: ... (d) Transaction limits. (i) A single
> transaction is limited to:
>
> (A) One ounce of useable cannabis;
> (B) Sixteen ounces of cannabis-infused product meant to be eaten or swallowed in solid form;
> (C) Seven grams of cannabis-infused extract or cannabis concentrate for inhalation;
> **(D) Ten units of a cannabis-infused product otherwise taken into the body;**
> (E) Seventy-two ounces of cannabis-infused product in liquid form for oral ingestion or
>     applied topically to the skin, unless the product is packaged in individual units
>     containing no more than four milligrams of active delta-9 THC per unit; and
> (F) Two hundred mg of active delta-9 THC within a cannabis-infused product in liquid form
>     if the product is packaged in individual units containing no more than four
>     milligrams of active delta-9 THC per unit.

**Ten units. Recreational. Counted as ITEMS, not weight and not THC.**

## 2. What the category means — WAC 314-55-010(40)

> (40) "Product(s) otherwise taken into the body" means a cannabis-infused product for human
> consumption or ingestion intended for uses other than **inhalation, oral ingestion, or
> external application to the skin**.

Three exclusions. Anything inhaled, swallowed, or rubbed on the skin is OUT.
What remains, in the products a Washington retailer can actually stock, is the
**suppository** (rectal / vaginal).

Two products people routinely mis-file into this bucket, and why they do not belong:

- **Transdermal patches** — applied externally to the skin. Excluded by the third clause.
- **Sublingual tinctures** — oral ingestion. Excluded by the second clause.

## 3. What a "unit" legally is — RCW 69.50.101

> "Unit" means an individual consumable item within a package of one or more consumable
> items in solid, liquid, gas, or any form intended for human consumption.

> "Package" means a container that has a single unit or group of units.

**This settles the counting rule and it settles it the same way the owner described the
4-pack of cans in SLICE 16.** A unit is the individual consumable item. A box of 6
suppositories is ONE package containing SIX units, and it consumes six of the ten.
It is not one unit because it is one box.

## 4. THE MEDICAL FINDING — WAC 314-55-095(2)(d)

The medical transaction subsection, verbatim and in full:

> (d) Transaction limitation. A single transaction by a retail store with a medical cannabis
> endorsement to a qualifying patient or designated provider who is entered into the medical
> cannabis database is limited to three ounces of useable cannabis, 48 ounces of
> cannabis-infused product meant to be eaten or swallowed in solid form, 21 grams of
> cannabis-infused extract or cannabis concentrate for inhalation, and 216 ounces of
> cannabis-infused product in liquid form meant to be eaten or swallowed, and up to 200 mg of
> active delta-9 THC within a cannabis-infused product in liquid form meant to be eaten or
> swallowed if product is packaged in individual units containing no more than four
> milligrams of active delta-9 THC per unit.

**"Otherwise taken into the body" does not appear.** The medical list enumerates five
categories: usable, solid, concentrate, liquid, and low-THC liquid. The sixth category from
(1)(d)(i)(D) is simply absent.

Note also (2)(a) and (2)(b) — the medical serving and package rules — say "eaten,
swallowed, **or applied**", where the recreational (1)(b) says "eaten or swallowed **or
otherwise taken into the body**". The phrase is used in subsection (1) and dropped in
subsection (2), consistently.

### How SLICE 17 resolves it

The rule does not grant a medical enhancement for this category, so **we do not invent one.
Medical stays at ten units.**

The alternative reading — tripling to thirty by analogy with the other buckets — would have
us authorize a sale the rule nowhere permits. That is the direction that creates violation
exposure. Declining to triple can only ever under-sell a patient, which is recoverable; a
patient can be told why. An over-sale cannot be un-rung.

This is the same call the house made in SLICE 16 when a fact was missing, and it is the same
call `qualifiesAsLowThcLiquid` makes for an unflagged product. Consistent.

The value is owner-tunable and **clamped at ten**, so the setting can only move downward. If
the LCB later issues guidance granting an enhancement, that is a one-line change to the
clamp ceiling plus a migration — deliberately not something a settings edit can do by
itself.

## 5. The RCW mirror is silent too — RCW 69.50.360(3)

> (3) Delivery, distribution, and sale, on the premises of the retail outlet, of any
> combination of the following amounts ... to any person 21 years of age or older:
> (a) One ounce of useable cannabis;
> (b) 16 ounces of cannabis-infused product in solid form;
> (c) 72 ounces of cannabis-infused product in liquid form unless ... four milligrams ...;
> (d) 200 milligrams of THC within a cannabis-infused product in liquid form if ...; or
> (e) Seven grams of cannabis concentrate

Five items. **No "otherwise taken into the body" category here either.** And because
RCW 69.50.4013(3)(a) defines lawful possession by reference to 69.50.360(3):

> (3)(a) The possession, by a person 21 years of age or older, of useable cannabis, cannabis
> concentrates, or cannabis-infused products in amounts that do not exceed those set forth in
> RCW 69.50.360(3) is not a violation of this section...

...the possession statute does not carry a figure for this category either.

**What this means for the build.** The operative retail rule is the WAC. WAC 314-55-095 is
adopted under the authority of RCW 69.50.342 and 69.50.345 (see the section's statutory
authority note), and 314-55-095(1)(d)(ii) is explicit that:

> A licensee or employee of a licensee is prohibited from conducting a transaction that
> facilitates an individual in obtaining more than the personal possession amount.

So the ten-unit cap in (1)(d)(i)(D) is the rule Greenway is held to at the counter,
regardless of the RCW's silence. We enforce ten. The RCW silence is a reason to be MORE
careful here, not less — there is no statutory safe harbor to fall back on.

## 6. A related package rule worth knowing — WAC 314-55-095(1)(b)

> (b) Single package. Any one single package of cannabis-infused product meant to be eaten or
> swallowed **or otherwise taken into the body** must not exceed 100 milligram of active
> delta-9 THC.

This is a PACKAGING limit that binds the processor, not a transaction limit that binds the
retailer. It is recorded here so nobody later confuses the 100 mg package ceiling with a
transaction cap. SLICE 17 does not enforce it; a compliant product arriving from a licensed
processor already satisfies it.

## 7. Effective date

WSR 24-21-051, filed 10/9/24, **effective 1/7/25** — the same rule revision that produced
the low-THC beverage carve-out built in SLICE 16. Current as of this slice.

## Sources

- WAC 314-55-095 — https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-095
- WAC 314-55-010 — https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-010
- RCW 69.50.360 — https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.360
- RCW 69.50.4013 — https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.4013
- RCW 69.50.101 — https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.101
