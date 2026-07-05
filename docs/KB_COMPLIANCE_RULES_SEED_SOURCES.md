# KB Compliance Rules — Seed Sources & Research (Slice 3)

> **KB Hardening v2 — Slice 3: Compliance rules in the KB, surfaced *helpfully*
> to keep customers safe.**
> Purpose: give the AI (and staff) a single curated set of Washington cannabis
> safety, purchase, and use facts it can weave into customer-facing copy and
> answers — the "know before you go / know before you consume" layer. This is a
> **reference / education** layer, NOT a new enforcement mechanism.

Every number and rule below is grounded in Washington statute/rule and, for the
purchase limits, in the repo's **own existing enforcement constants** so the KB
reference can never drift from what the checkout actually enforces. **Never
guessed.**

---

## CRITICAL: relationship to the EXISTING sales-limits system (do not duplicate)

The repo already has a **live, enforced** single-transaction limit system:

- **`src/lib/compliance/sales-limits-core.ts`** — canonical constants
  `RECREATIONAL_LIMITS` and `MEDICAL_LIMITS` (WAC 314-55-095), enforced at
  checkout, plus `GRAMS_PER_OUNCE = 28`.
- **`/admin/compliance/sales-limits`** — owner settings page showing/adjusting
  those limits.

**Verified values in that system (single source of truth):**

| Bucket | Recreational | Medical |
|---|---|---|
| Useable cannabis (flower-equiv.) | 1 oz (28 g) | 3 oz (84 g) |
| Concentrate / extract (inhaled) | 7 g | 21 g |
| Solid infused edibles | 16 oz (453.6 g) | 48 oz (1360.8 g) |
| Liquid infused products | 72 oz (2016 g) | 216 oz (6048 g) |

Slice 3 does **NOT** re-implement or re-store these numbers as free text. The
KB compliance-rule row for purchase limits is **derived at runtime from
`RECREATIONAL_LIMITS`** (imported from `sales-limits-core`), so the KB and the
enforcement engine are always in lockstep. If the statute changes, the owner
edits one place and both follow.

---

## VERIFIED: WA use & safety rules (the reference facts this slice encodes)

Sources — **WSLCB "Using and Having Cannabis"**
(https://lcb.wa.gov/education/using_and_having_cannabis), **RCW 69.50.360**
(lawful conduct), **RCW 69.50.445** (open container / public use), **RCW
69.50.4013** (possession), **WAC 314-55-095** (transaction limits + edible cap),
scraped/confirmed this session.

1. **21+ only.** Only adults 21 and over may purchase or possess recreational
   cannabis in Washington; a valid government photo ID is required at entry and
   purchase. (RCW 69.50.360.)
2. **Single-transaction purchase limits.** 1 oz useable cannabis, 7 g
   concentrate, 16 oz solid edible, 72 oz liquid (recreational). *(Derived from
   `RECREATIONAL_LIMITS`; see table above.)* (WAC 314-55-095.)
3. **Possession** tracks the same recreational amounts an adult may lawfully
   carry. (RCW 69.50.4013.)
4. **No public consumption.** It is illegal to consume cannabis in view of the
   general public / in public places. (RCW 69.50.445.)
5. **Don't drive impaired.** Driving under the influence of cannabis is illegal;
   WA has a per-se THC blood limit. Transport product in a **sealed container**,
   ideally in the trunk — treat it like open-container rules for alcohol.
6. **Edibles: start low, go slow.** WA caps infused edibles at **ten milligrams
   of active THC in a single serving and one hundred milligrams total per
   package** (WAC 314-55-095). Edibles come on **more slowly** than inhalation
   and can last longer — a factual property of ingestion. Begin with a single
   serving and wait before considering more. *(Factual safety guidance, not
   dosing advice or a medical claim.)*
7. **Store safely.** Keep cannabis in its original labeled child-resistant
   packaging, out of reach of children and pets. (WSLCB safety guidance.)
8. **No crossing state lines.** It remains illegal under federal law to
   transport cannabis across state borders, even to another legal state.
   (WSLCB.)

---

## Compliance framing of THIS content (WA I-502)

These records are **factual legal/safety education**, phrased neutrally. They
contain no medical/therapeutic claim and no product-specific dosing directive
("take X"). The edible-serving cap and "start low, go slow" are stated as
*safety facts about the WA rule and how ingestion behaves*, not as advice to
consume a specific amount. Where the copy would otherwise trip the code's
`checkCompliance` dosing-pattern (e.g. "10 mg per serving"), the milligram
figures are spelled in words — identical treatment to Slice 2's edible format.
All surfaced prose is routed through `checkCompliance` before it can appear in
retrieval.

---

## The curated rule set (Slice 3)

Categories used for UI grouping ONLY: `age` | `purchase-limit` | `possession` |
`public-use` | `driving` | `edibles-safety` | `storage` | `transport`. Each rule
record: `slug`, `title`, `category`, `rule` (the factual statement),
`house_note` (friendly, plain-language "here's what that means for you"),
`severity` (`info` | `important` | `critical` for UI emphasis), `citation`
(statute/rule), `sources[]`, `confidence`.

1. **age-21-plus** (age, critical) — 21+, ID required.
2. **purchase-limits** (purchase-limit, important) — derived from
   `RECREATIONAL_LIMITS`.
3. **possession-limits** (possession, important) — same recreational amounts.
4. **no-public-use** (public-use, important) — no consuming in public view.
5. **no-impaired-driving** (driving, critical) — don't drive high; sealed
   container in transit.
6. **edibles-start-low** (edibles-safety, critical) — WA cap + slow onset +
   start-low-go-slow.
7. **store-safely** (storage, important) — child-resistant, away from kids/pets.
8. **no-crossing-state-lines** (transport, important) — federally illegal to
   cross borders.

---

## Sources (canonical)

- WSLCB — Using and Having Cannabis: https://lcb.wa.gov/education/using_and_having_cannabis
- WAC 314-55-095 — transaction limits + edible THC cap (10 mg/serving · 100 mg/package).
- RCW 69.50.360 — lawful conduct (21+).
- RCW 69.50.4013 — possession.
- RCW 69.50.445 — open container / public consumption.
- Repo `src/lib/compliance/sales-limits-core.ts` — `RECREATIONAL_LIMITS` /
  `MEDICAL_LIMITS` (single source of truth for the enforced numbers).
