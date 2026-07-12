# MEDICAL CANNABIS COMPLIANCE — WA STATE (AI REFERENCE)

> AUTHORITATIVE, AI-OPTIMIZED reference for Greenway Marijuana (WA I-502 retailer,
> license 413541, Port Orchard) — everything CCRS + DOH + LCB for the medical
> cannabis pipeline. Structured as FACTS with citations so an AI (or a human)
> can apply rules without re-research. Verified against primary sources on
> 2026-07-12. Companions: `docs/medical-doh-requirements.md` (Slice 28 research),
> `docs/medical-authorization-intake.md` (intake workflow).

---

## 1. SYSTEM OF RECORD MAP (who owns what)

| System | Owner | What it holds | Retailer access |
|---|---|---|---|
| **MCR** (Medical Cannabis Registry, replaced "Airlift" 2025-06-30) | WA DOH | Patient/DP registrations, recognition cards, UPIDs, photos | SAW login + MFA. **NO retailer API.** Consultants create/renew/replace cards; budtenders verify cards at sale time. |
| **CCRS** | WSLCB | Traceability + weekly Sale.csv uploads (CSV only, no API) | Manual CSV upload. Medical sales report `SaleType=RecreationalMedical` with exempted tax as $0. |
| **This back office** | Greenway | The RECORD of what staff validated: `patient_authorizations`, `medical_exempt_sales` (5-yr WAC ledger), `medical_product_registry` (DOH category per product), scans in private `medical-forms` bucket | Full. It never calls MCR/DOH directly — it records human-validated facts. |

FACT: There is no DOH/MCR retailer API. All MCR work (register patient, print
card, verify card) is a HUMAN action in the MCR web app; our system records the
result (`in_doh_database`, `mcr_validated_at`, UPID, card dates).

---

## 2. ROLES (WAC 246-72 / DOH)

- **Certified Medical Cannabis Consultant** — DOH credential (chapter 246-72
  WAC). Only a consultant may register a patient in the MCR and create/renew/
  replace recognition cards. A medically endorsed store must have a certified
  consultant on staff.
- **Budtender / employee** — may VERIFY a presented recognition card in the MCR
  at sale time (read-only validity check).
- **Store owner/delegate** — manages consultant/employee MCR access.

Back-office permission: `medical.manage` (owner/admin/manager) gates all card
issuance/status actions; every mutation is audited (`recordAudit`).

---

## 3. THE RECOGNITION CARD (RCW 69.51A.230)

Card data we must capture (mirrors `patient_authorizations`):
- **UPID** — randomly generated unique patient identifier (from the MCR).
- **Effective date** + **Expiration date**.
- **Holder type**: `patient` | `designated_provider`.
- Whether the holder is **in the MCR** (`in_doh_database`) — exemptions require it.

Lifecycle facts:
- Authorization (and therefore the card) is valid **up to 1 year** for adults,
  **up to 6 months** for minors (<18) — RCW 69.51A.030. The card expires WITH
  the authorization form.
- Registration is **voluntary for adults 18+** (but no registration = no tax
  benefits). Ages **18–20 MUST register** to buy at all (and only at endorsed
  stores). **Minors (<18) must register** and their parent/guardian is the DP.
- Renewal = new authorization from the practitioner → consultant renews in the
  MCR → new card. "Compassionate care renewal" lets the DP renew for a
  homebound patient when the practitioner marked eligibility on the form.
- Replacement (lost/stolen): consultant verifies identity, finds patient in
  MCR, issues new card. Minimum **$1 fee** (RCW 69.51A.230(10)); store may
  charge more.
- The DP must be 21+ and holds an IDENTICAL authorization with original
  signatures.

### Issuance gate (DOH 608-048) — all enforced in `validateAuthorizationIssuance`
1. Form fully completed & signed by an authorized health care practitioner.
2. Printed on **tamper-resistant paper** with ≥1 security feature.
3. **Identity verified** — full legal name (no nicknames), physical street
   address (no P.O. box), matched against state ID.
4. **Embossed RCW 69.51A.030 medical cannabis seal** visible.

PLUS data-integrity rules: UPID required when `in_doh_database`; effective ≤
expiration; not already expired at issuance; valid holder type. Any failure →
DO NOT issue; refer the patient back to the practitioner.

Consultant intake procedure (DOH FAQ, verbatim sequence):
review form → compare to state ID → photograph patient (and DP) → enter form
data + photo into MCR → **generate, print and laminate** the card → return the
form, ID, and card to the patient. Our flow: `/admin/medical/intake` (scan on
Canon PIXMA TS3522 → checklist → issue → print at `/admin/medical/card/[id]`
→ laminate on the Scotch Thermal Laminator → "mark printed").

---

## 4. DOH-COMPLIANT PRODUCTS (chapter 246-70 WAC)

Products tested to 246-70 standards bear a DOH logo and fall into EXACTLY one
category (modeled in `medical_product_registry.doh_category`):

| Category | Serving/pkg caps | Who may buy | Where |
|---|---|---|---|
| `general_use` | ≤10 mg THC/serving; ≤10 servings & ≤100 mg THC/pkg | Anyone 21+ (taxed); registered patients/DPs (tax-free) | Any licensed store |
| `high_thc` | >10–50 mg THC/serving; ≤10 servings & ≤500 mg/pkg. ONLY capsules, tablets, tinctures, transdermal patches, suppositories | **ONLY registered patients 18+ / DPs with a valid recognition card** | **Endorsed stores only** |
| `high_cbd` | Concentrates ≤2% THC & ≥25× CBD; edibles ≤2 mg THC & ≥5× CBD/serving; topicals ≥5× CBD. No smokables | Anyone 21+ (**sales-tax-free for anyone**); patients/DPs (also excise-free) | Any licensed store |

HARD GATE: a `high_thc` product may NEVER be sold to a non-cardholder. This is
statutory — no manager override exists.

Registry durability: `menu_items.doh_compliant` (migration 0040) is per
menu-version and wiped on every menu re-import — it is DEPRECATED and unused.
The durable source of truth is `medical_product_registry`, keyed by the STABLE
POS product key (`menu_items.source_item_id` = `order_lines.product_id`).
Staff verify the DOH logo on the physical package before registering.

---

## 5. THE TWO TAX EXEMPTIONS (do not conflate)

Rates (single source of truth `order-pricing-core.ts`): excise 3700 bps (37%),
sales 650+280 = 930 bps (9.3%). Money in minor units (cents).

### 5a. Sales tax (9.3%) — RCW 82.08.9998
Exempt ONLY for:
- (a) **246-70 COMPLIANT products** sold by an ENDORSED retailer to a
  **cardholder** (patient/DP with recognition card);
- (b) products with **≤0.3% THC** sold by an endorsed retailer to a cardholder;
- (c) **High-CBD compliant** products — sales-tax-free **for ANYONE**;
- (d)/(e) practitioner topicals / cooperatives (not applicable to retail).

⚠ CORRECTED 2026-07-12: an earlier repo rule ("carded patient ⇒ sales tax
exempt on ANY cannabis") was WRONG and would under-collect sales tax on
non-compliant products. The statute limits the exemption to compliant/low-THC
products. `computeMedLineTax` now requires `dohCompliant` for the carded sales
exemption (or `highCbd` for the anyone-exemption).

### 5b. Excise tax (37%) — RCW 69.50.535(2) / WAC 314-55-090(1)
Exempt ONLY when ALL THREE hold:
- (a) seller holds a valid **medical endorsement** (RCW 69.50.375) and complies
  with WAC 314-55-080;
- (b) buyer is a qualifying patient/DP with a **valid recognition card AND is
  in the database** (MCR);
- (c) the product is a 246-70 **compliant product tested to 246-70 standards**.

SUNSET: the excise exemption ends **2029-06-30** (WAC 314-55-090(6)).

Summary matrix (endorsed store):

| Buyer | Product | Sales tax | Excise |
|---|---|---|---|
| Carded patient/DP (in MCR) | 246-70 compliant (any category) | EXEMPT | EXEMPT |
| Carded patient/DP | NOT compliant | due | due |
| Anyone 21+ | `high_cbd` compliant | EXEMPT | due |
| Anyone 21+ | anything else | due | due |

---

## 6. REQUIRED RECORDS — EVERY excise-exempt sale (WAC 314-55-090(2), keep 5 years)

Per exempted sale, retain (verbatim from the WAC):
- (a) **Date of sale**;
- (b) from the recognition card: **(i) UPID, (ii) effective date and expiration
  date**;
- (c) **SKU / unique product identifier** of the compliant product;
- (d) **Sales price** of the compliant product.

WAC 314-55-090(3): if the LCB asks and you cannot produce these records, the
excise "shall be presumed to have been incorrectly exempted" and YOU remit it,
plus possible WAC 314-55-092 penalties. This is why `recordExemptSale` HARD
BLOCKS an incomplete excise-exempt row (`verifyExemptSaleRecord`) and why the
completion gate refuses to complete a medical order whose ledger rows cannot
be written.

Table: `medical_exempt_sales` (migration 0040). Conventions:
- **S-8 LINE MATCHING**: `product_sku` MUST equal the sold order line's
  `product_id` (POS product key). The CCRS Sale.csv and wa-tax report join
  exempt records to lines by `(order_id, product_sku)` to zero exactly the
  covered line's tax.
- `sales_price_minor` = the line's PRE-TAX base (register prices are
  tax-inclusive; the base is backed out with the category divisor and rounded
  once) × quantity.
- `excise_amount_exempt_minor` = 37% of that base when excise-exempt.
- The scanned authorization form (private `medical-forms` bucket) is part of
  the retained record.

---

## 7. PURCHASE / POSSESSION LIMITS

Carded patient/DP in the MCR — **3× recreational** purchase limits
(WAC 314-55-095(2)(d), encoded in `sales-limits-core.MEDICAL_LIMITS`):
- 3 oz usable cannabis (84 g)
- 48 oz solid infused (1360.8 g; settings default 1344 g — owner-tunable)
- 216 oz infused liquid (6048 g)
- 21 g concentrate

Recreational: 1 oz / 16 oz / 72 oz / 7 g. Possession (not sale): registered
patient may possess up to 3 oz and grow 6 plants + 8 oz from them (practitioner
may authorize up to 15 plants / 16 oz).

POS behavior: online placement runs a SOFT check (flag, don't refuse a
reservation); the → completed transition is the HARD gate
(`enforceSalesLimitForSale`). Orders with a VALID attached recognition card
evaluate against `"medical"` limits; everything else `"recreational"`.
Manager override = separate `sales_limit.override` permission + written
reason, logged. The high-THC gate has NO override.

---

## 8. CCRS REPORTING OF MEDICAL SALES

- An order is medical (SaleType `RecreationalMedical`) when it has
  `medical_exempt_sales` rows (`saleTypeForOrder` — the schema-grounded
  signal; there is no `orders.medical` column).
- Exempted taxes report as $0.00 on the covered line (sales tax and/or the 37%
  excise "CannabisExciseTax"/OtherTax column) so Sale.csv matches the register
  and the LIQ-1295 Box 2 deduction.
- A medical order whose lines match NO exempt record by SKU reports FULL
  recreational taxes (fail-safe) and the export surfaces a warning.

---

## 9. END-TO-END PIPELINE (what staff do; what the system enforces)

1. **Intake** (`/admin/medical/intake`): scan form (Canon PIXMA TS3522) →
   DOH 608-048 checklist → UPID + dates → consultant registers patient in MCR
   (human, no API) → issue → print card → laminate (Scotch) → mark printed.
   Server: `createAuthorization` (blocks on `validateAuthorizationIssuance`),
   scan to private bucket, audited.
2. **Register DOH products** (`/admin/medical`): verify the DOH logo/category
   on the package → add the product to `medical_product_registry` with its
   246-70 category. Drafts-only AI/heuristic may SUGGEST a category from the
   name; a human confirms from the physical package.
3. **Sell** (order detail page): staff attach the patient's recognition card to
   the order (search → validate). Panel shows per-line exemption plan (which
   lines are compliant, what tax is exempted, high-THC eligibility).
4. **Complete** (compliance gate, in order): sales-hours → money recompute →
   card re-validated on the completion date (`authorizationValidityAt`) →
   high-THC gate (no override) → sales limits (medical when carded) → WAC
   314-55-090(2) exempt-sale rows WRITTEN (idempotent per order; failure
   blocks completion) → status flips; audited.
5. **Report**: `/admin/medical` (ledger + endorsement), `/admin/reports/medical`
   (expiry pipeline, exempt value, card-validity audit, exports), CCRS Sale.csv
   (RecreationalMedical + zeroed taxes), compliance health (record
   completeness).

---

## 10. INVARIANTS (never violate)

1. NO exemption without a card that is: status `active`, `in_doh_database`,
   has a UPID, and within [effective, expiration] ON THE SALE DATE
   (`cardValidity` — the single source of truth).
2. NO excise exemption on a non-compliant product; NO sales-tax exemption on a
   non-compliant product (except high-CBD-for-anyone, and ≤0.3%-THC-for-
   cardholders).
3. NO high-THC product to a non-cardholder — hard block, no override.
4. NO excise-exempt sale without a complete WAC 314-55-090(2) record row;
   retain 5 years; never delete.
5. NO store exemptions at all unless `medical_endorsement_config.is_medically_
   endorsed` is true; excise exemption dies 2029-06-30.
6. The system records human-validated MCR facts; it never claims to have
   checked the MCR itself.
7. PHI stays in staff-only storage (private bucket, RLS `is_staff()`); MCR
   data confidentiality per RCW 69.51A.230 / RCW 42.56.625.
8. Money in minor units; tax rates from `order-pricing-core.ts` constants.

---

## CITATIONS (verified 2026-07-12)

- WAC 314-55-090 — Medical cannabis patient excise tax exemption (eff.
  2024-10-12; scraped verbatim: conditions, 5-yr records, presumption, sunset).
- RCW 82.08.9998 — sales-tax exemptions (scraped verbatim: compliant products
  to cardholders; ≤0.3% THC; high-CBD to anyone; records duty in subsec. (2)).
- RCW 69.50.535 — excise tax + exemption; RCW 69.50.375 — medical endorsement.
- RCW 69.51A.230 — recognition cards, UPID, $1 fee; RCW 69.51A.030 —
  authorization validity (1 yr adult / 6 mo minor); RCW 69.51A.220 — minors.
- Chapter 246-70 WAC — DOH compliant-product standards; DOH "Medical Cannabis
  Product Compliance" page (categories, caps, who-can-buy — scraped).
- DOH "Medical Cannabis Patient FAQ" (scraped: MCR roles, consultant intake
  sequence, renewal/replacement, registration rules by age).
- DOH 608-048 — retailer's guide to validating the authorization form.
- DOH 608-050 — HB 1453 excise-exemption FAQ.
- WAC 314-55-095 — purchase limits (3× for carded); WAC 314-55-087 — records.
