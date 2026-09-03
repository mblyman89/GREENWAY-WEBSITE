# GREENWAY COMPLIANCE BIBLE — WA Cannabis Retail (AI-Ready Master Reference)

> **Purpose.** Single authoritative reference for building and auditing the Greenway
> POS/back office (WA I-502 retailer, Port Orchard, license 413541). Compiled from
> primary sources only (LCB, DOH, RCW/WAC at app.leg.wa.gov, vendor documentation)
> during the 2026 mission-critical compliance audit. Every statement below was
> verified against the cited source — NEVER GUESS. Companion documents:
> `docs/GAP_AUDIT.md` (findings) and `docs/COMPLIANCE_ROADMAP.md` (fix slices).
> Research corpus: `/workspace/research` (WAC/RCW/DOH full texts + CCRS guides + notes).

---

## PART 1 — CCRS (Cannabis Central Reporting System)

### 1.1 What CCRS is
- LCB's traceability system since Dec 2021 (replaced Leaf Data Systems).
- **CSV upload only — there is NO API.** Files are uploaded through the CCRS portal
  (cannabisreporting.lcb.wa.gov) via SAW login, or by a vetted third-party integrator.
- **Weekly reporting**: reporting week = Sunday–Saturday, files due by the following Sunday.
- Retailers submit up to **7 file types**: `Area`, `Strain`, `Product`, `Inventory`,
  `InventoryAdjustment`, `InventoryTransfer`, `Sale`. Area only when rooms change.
- Upload returns ONLY a timestamp — **no positive confirmation, no transaction id**;
  LCB does not retain file copies. Error replies arrive by EMAIL, hours to days later,
  with scrambled filenames. Re-upload is the only remediation ⇒ row keys must be
  idempotent and the licensee must keep an immutable archive of every generated file
  (name, timestamp, row counts, checksum, status). (Source: OpenTHC field report + LCB guide.)
- Order-of-operations dependencies: Inventory rejected until Product exists; lab data
  rejected until Inventory accepted; transfer records depend on the SUPPLY side having
  reported first (a vendor's failure can block the retailer).
- **LabTestExternalIdentifier is mandatory since Oct 1, 2025.**
- **Integrator liability rule (lcb.wa.gov/ccrs/integrators):** "If a third-party
  integrator provides CCRS reporting services for licensees, the licensee remains
  responsible for the content reported." Greenway carries the liability no matter what
  software generates the files. Greenway may upload its own CSVs under its own portal
  login without integrator vetting (LIQ1455 only applies if the software serves others).

### 1.2 File mechanics (Upload User Guide, June 2025 revision)
- File naming: `<type>_<LicenseNumber>_YYYYMMDDHHMMSS.csv` (e.g. `sale_413541_20260107123000.csv`).
- Three header lines above the column-header row: `SubmittedBy` (text 35),
  `SubmittedDate` (MM/DD/YYYY), `NumberRecords` (MUST equal data-row count).
- Common columns on every file: `LicenseNumber`, `ExternalIdentifier`, `CreatedBy`,
  `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation` (**Insert | Update | Delete**).
- Dates MM/DD/YYYY. No `$`, parentheses, or negative money values. Commas inside values
  break the join keys (Product.Name is capped at 75 chars and doubles as a key —
  the codebase bans commas in names for this reason).

### 1.3 Sale.csv (retail) — authoritative field spec
| Column | Rule |
|---|---|
| LicenseNumber | required, numeric 6 |
| SoldToLicenseNumber | wholesale only — blank for retail |
| InventoryExternalIdentifier | required; must already exist in CCRS inventory |
| PlantExternalIdentifier | blank for retail |
| SaleType | `RecreationalRetail` \| `RecreationalMedical` \| `Wholesale` |
| SaleDate | MM/DD/YYYY |
| Quantity | decimal, consistent UOM, no negatives |
| UnitPrice | price of ONE unit BEFORE discount/taxes |
| Discount | whole-line for qty>1; **never below acquisition cost** |
| SalesTax / RetailSalesTax | state+local combined, whole-line |
| OtherTax / CannabisExciseTax | REQUIRED retail; = 37% of (UnitPrice×qty − discount); **0 for valid medical-exempt** |
| SaleExternalIdentifier | transaction id, same across all lines of one sale |
| SaleDetailExternalIdentifier | unique per line within a sale |
| Operation | Insert/Update/Delete |

- LCB worked example: QTY=3, UnitPrice=$5.00, Discount=$3.00, SalesTax(10%)=$1.20, OtherTax(37%)=$4.44.
- **Returns:** DELETE the sale identifier, then report an InventoryAdjustment (return).
  Never negative-sell.
- Destruction/waste: InventoryAdjustment with destruction reason (45-day quarantine
  notice per WAC 314-55-097 before destruction).

### 1.4 Manifests / transport
- Transport requires a **CCRS-generated printed manifest** with the product at all times
  (WAC 314-55-085); transport records kept 3 years; direct routes; sealed packages;
  locked compartment fixed to vehicle; transporter 21+ and badge-carrying.
- WA has no central manifest exchange, so the industry uses the **WCIA JSON manifest**
  format (POSaBIT + WCIA; Cultivera participates) for vendor↔retailer manifest data.
  Greenway's intake already consumes Cultivera/WCIA transfer JSON (incl. `Is Medical`
  flag → DOH-compliant auto-flag pattern used by Cultivera).

---

## PART 2 — Taxes (excise + sales) and LIQ-1295

### 2.1 Cannabis excise — RCW 69.50.535
- **37% of the selling price** on each retail sale of cannabis products.
- Separate from and in addition to sales tax; NOT part of the base to which sales tax applies.
- **Must be separately itemized from state/local sales tax on the receipt.**
- Tax must be reflected in the price list / quoted shelf price and in any price advertising
  (⇒ tax-inclusive card pricing on the menu is compliant so long as the receipt itemizes).
- Held in trust; personal liability for uncollected/unremitted tax; "selling price" is
  true value when consideration is not indicative of value (anti-sweetheart-pricing).
- **Medical exemption (until June 30, 2029, RCW 69.50.535(2)/(4)):** exempt only when ALL
  THREE hold: (1) medically endorsed retailer, (2) qualifying patient/provider with a
  **valid recognition card in the DOH database**, (3) product is **DOH-compliant**
  (ch. 246-70 WAC). The exemption is NOT a discount — it zeroes the excise.

### 2.2 Sales tax
- State 6.5% + Port Orchard local 2.8% = **9.3% combined** on cannabis AND general goods.
- **RCW 82.08.9998 medical sales-tax exemption:** (a) DOH-compliant products sold by an
  endorsed retailer to a cardholder; (b) ≤0.3% THC products to cardholders; (c) high-CBD
  compliant products by an endorsed retailer **to any person**; seller keeps eligibility
  records; DOR provides a separate reporting line.
- Industry treatment (Dutchie benchmark): taxes computed on **net (post-discount)** total;
  4-rate matrix = {MED, REC} × {sales, excise} driven by product flags
  (DOH-approved / High-CBD) + customer type + category→tax mapping.

### 2.3 LIQ-1295 monthly tax report (LCB Cannabis Tax Reporting Guide, © 2026)
- Due by the **20th of the following month** (next business day if weekend/holiday),
  **even if no sales**. POS/integrator monthly report does NOT satisfy the filing.
- Report: total cannabis product sold (incl. medical), total exempt medical sold,
  over-collected excise that cannot be returned (cell 8).
- **2%/month late penalty** (WAC 314-55-092); failure to report/pay = grounds for
  suspension/revocation.
- "Retailers are responsible for paying uncollected excise tax if the tax rate is not
  correctly set up in their systems." ⇒ a POS misconfiguration is licensee liability.
- Revisions: cannabistaxes@lcb.wa.gov; credits only within 24 months; requires original
  report + supporting POS report + revised report + explanation.
- Payment: ACH (Retail Lockbox), CCRS "Make a Payment", mail, in person; cash needs an
  approved waiver else 10% penalty.
- Contacts: examiners@lcb.wa.gov / (360) 664-1614 (inventory/manifest/sale corrections);
  cannabistaxes@lcb.wa.gov / (360) 664-1789.

### 2.4 Medical-exempt sale records (WAC 314-55-090, filed 9/11/24)
- Retain **5 years** (314-55-087) for EVERY exempt sale: date of sale; unique patient
  identifier + card effective/expiration dates; SKU/unique product identifier; sales price.
- Missing documentation ⇒ exemption presumed incorrect ⇒ retailer remits the 37% + penalties.
- Monthly LCB checks: endorsement active; card active in database; product DOH-compliant.

---

## PART 3 — Core retail WAC/RCW rules the POS must enforce

### 3.1 Sales limits — WAC 314-55-095 (eff. 1/7/2025) / RCW 69.50.360
Single-transaction maxima (the POS MUST refuse or manager-gate beyond these):
| Bucket | Recreational | Medical (DOH database cardholder, RCW 69.51A.210) |
|---|---|---|
| Useable cannabis | 1 oz (28 g) | 3 oz (84 g) |
| Solid-form infused (edibles) | 16 oz (448 g) | 48 oz (1,344 g) |
| Liquid-form infused | 72 oz (2,016 g) | 216 oz (6,048 g) |
| Concentrates | 7 g | 21 g |
| **Low-THC infused liquid** (packaged in individual units of ≤ 4 mg active Δ9-THC) | **200 mg active Δ9-THC** | **200 mg active Δ9-THC** — *NOT tripled* |

**Low-THC beverage bucket (added 2024 c 9 s 1 / SHB 1249; WAC 314-55-095(1)(d)(i)(E)–(F)
and (2)(d), eff. 1/7/2025).** Subsection (E) caps liquid infused product at 72 oz
*"unless the cannabis-infused product in liquid form is packaged in individual units
containing no more than four milligrams of active delta-9 THC per unit"*; subsection (F)
then authorizes *"Two hundred mg of active delta-9 THC within a cannabis-infused product
in liquid form ... if the product is packaged in individual units containing no more than
four milligrams of active delta-9 THC per unit."* Three consequences the POS must honor:
1. **Exclusive, not additive.** A qualifying line counts toward the 200 mg bucket and
   contributes **nothing** to the 72 oz bucket. The word in (E) is *"unless."*
2. **Per CONTAINER, not per serving.** One can = one unit; a 4-pack = 4 units. A single
   16 mg bottle labelled *"4 servings × 4 mg"* is one 16 mg unit and does **not** qualify.
3. **Medical does not triple.** WAC 314-55-095(2)(d) reads *"and up to 200 mg"* — the
   identical figure. 600 mg would be an over-sale on every medical transaction.

Possession follows automatically: **RCW 69.50.4013(3)(a)** legalizes possession of amounts
*"that do not exceed those set forth in RCW 69.50.360(3)"*, and 69.50.360(3)(d) is this
same provision. (Do not confuse it with **RCW 69.50.4013(4)(a)(iv)**, which states *100 mg*
— that is the non-commercial adult **gifting** allowance, not a retail limit.)

Combination purchases must respect each bucket. Non-database authorization holders get
**only recreational amounts**. Violations = Category III (WAC 314-55-522): $1,250 →
escalating suspensions — "exceeding transaction limits" is an enforcement category of its own.

### 3.2 No free / below-cost cannabis — RCW 69.50.357, WAC 314-55-017/-018/-523
- Retail may sell ONLY useable cannabis, concentrates, infused products, paraphernalia,
  lockable boxes. No free product to consumers (lockable-box donations are the sole,
  narrow exception — no purchase condition allowed).
- **"Illegally given away or sold below acquisition cost" is a Category IV violation**
  ($500 → 5-day/$1,250 → …). CCRS Sale.csv `Discount` may never take a line below
  acquisition cost. BOGO/100%-off cannabis promos are non-compliant.
- Conditional sales, credit purchases (Cat IV), and industry-member money/gift flows
  are prohibited (limited sample rules aside).

### 3.3 Samples — WAC 314-55-096 (retailer-relevant)
- Vendor (trade) samples TO retailer staff for product-knowledge: quarterly caps;
  retailers may provide **internal quality-control samples to employees** within strict
  per-quarter statutory ceilings; customers may NEVER receive free samples at retail.
  Retail sampling violations = Category IV per 314-55-523 ($1,250 first, tiered).
  (Codebase: `admin/compliance/samples` hard-enforces trade 30/employee-qtr, IQC 50/25,
  active-employees-only, ceilings only lowerable — POSITIVE CONTROL.)

### 3.4 Age / ID — RCW 69.50.357, LCB acceptable-ID page (© 2026)
- No one under 21 on premises; exceptions ONLY for endorsed stores: 18–20 patients with
  recognition card; <18 patients with card must be accompanied by designated provider and
  MAY NOT purchase (provider buys). No under-21 employees. $1,000/violation (Cat VI).
- Acceptable ID must be valid (unexpired) with DOB, signature, photo: US/territory/DC
  DL/permit/ID; Canadian province DL/ID; WA temporary DL; US Armed Forces ID; Merchant
  Marine ID; passport/passport card/Global Entry/green card/NEXUS; WA Tribal Enrollment
  Card (no expiration required).
- **High-THC health-risk notice at POS** required since 12/31/2024 (DOH content: risks of
  high THC, higher risk under 25 & mental-health conditions, quitting resources).

### 3.5 Hours — WAC 314-55-147
- Retail sales only **8:00 a.m.–12:00 a.m. (midnight)**. Violation Cat V ($500 first).
  POS should block completing sales outside the window.

### 3.6 Records — WAC 314-55-087 (Category IV if violated)
- **THE RULE: a five-year period**, on premises. WAC 314-55-087(1) (current text, WSR
  24-19-040, filed 9/11/24, effective 10/12/24): records "must be kept and maintained on
  the licensed premises for a five-year period and must be made available for inspection
  if requested by an employee of the LCB". The period was THREE years before that
  amendment; anything in this repo still saying three years is stale.
- **OUR POLICY: retain at least six years.** That extra year is a deliberate margin of
  safety (it also covers the federal §6501(e)(1) six-year assessment window for a
  substantial omission of gross income) — it is NOT what the WAC says. Do not cite six
  years to a regulator as the requirement.
- Covered classes: purchase invoices, bank statements, accounting/tax records, contracts,
  employee records, inventory records, theft records, donated product records,
  **detailed sales records**.
- Consequence for the POS: sales/inventory/till data may never be hard-deleted inside
  the retention window; "reset" tooling must be guarded; COAs archived and retrievable.

### 3.7 Security & traceability — WAC 314-55-083
- ID badges (trade name, legal name, photo) worn by licensee/employees at all times;
  visitor badges + log retained 3 years.
- CCTV ≥640×470, fixed cameras, continuous 24h @ ≥10fps, NIST-stamped, covering all POS
  areas/entrances/exits/storage, **45-day retention**, copies on request.
- Traceability must be COMPLETELY up to date including: transport events, THEFT, complete
  inventory, **all point-of-sale records**, **excise-tax records incl. medical-exemption
  records**, samples of all kinds.

### 3.8 Signage — WAC 314-55-086
- Under-21 sign at each entry (endorsed variant for endorsed stores);
  pregnancy/breastfeeding warning at EACH point of sale; no-consumption notice at main
  entrance; master license posted; firearms-prohibited signs. Missing signs Cat V ($250).

### 3.9 Advertising — WAC 314-55-155 / RCW 69.50.369
- No content appealing to minors; no medical/therapeutic/curative claims; no false or
  misleading statements; mandated health warnings on advertising; the website/menu is an
  advertising surface. Required warning language (footer block in the codebase matches):
  "This product has intoxicating effects and may be habit forming. Marijuana can impair
  concentration, coordination, and judgment. Do not operate a vehicle or machinery under
  the influence of this drug. For use only by adults 21 and older. Keep out of the reach
  of children." Advertising violations Cat V ($1,250).

### 3.10 Violation/penalty framework (2-yr lookback; WAC 314-55-505…-540)
- Cat I (cancellation on 1st): diversion to/from unlicensed parties, out-of-state transport.
- Cat II: furnishing under-21; transport w/o manifest; **failure to use/maintain
  traceability** ($1,250 → cancel); obstruction/misrepresentation.
- Cat III: **exceeding transaction limits**; surveillance failures; unauthorized products.
- Cat IV: **recordkeeping (087)**; **free/below-cost cannabis**; credit purchases;
  packaging/labeling; **retail sampling violations**; insurance.
- Cat V: hours; advertising; badges; signs; returns violations; traceability (5-day/$2,500 first).
- Cat VI ($1,000 statutory): minor frequenting; under-21 employee; on-premises consumption;
  unauthorized products (RCW 69.50.357 catch-all).
- **Mitigating factor (314-55-509): "demonstrated business policies and practices that may
  reduce risk"** — documented POS compliance controls are a formal penalty mitigator.
- Summary suspension possible for public safety (314-55-506/-507/-540).
- Discontinue business: written notice if closing >30 days; inventory disposal at fair
  market value to approved licensee; below-cost sales prohibited (314-55-135).

---

## PART 4 — Medical (DOH) requirements

### 4.1 Endorsement duties — WAC 314-55-080, RCW 69.50.375
- Certified medical cannabis consultant on staff (ch. 246-72 WAC); consultation hours
  POSTED with store hours; ALWAYS keep DOH-compliant product in stock or on order;
  database entry + recognition-card issuance capability; keep exempt-sale validity
  records ≥5 yrs; employee training (database procedures, cards, strain/THC/CBD/ratio
  knowledge); no on-site medical use; no marketing attractive to minors; no
  diagnosing/curing claims. Noncompliance ⇒ endorsement discontinued after 7–30 day cure.

### 4.2 Recognition cards & database — RCW 69.51A.230, WAC 246-71
- Card: unique patient id, photo (taken at retailer), authorized amounts,
  effective/expiration dates, authorizing professional. **Adult cards valid 1 year,
  minor cards 6 months**; renewal requires new health-care-professional exam.
- ONLY a certified consultant employed by an endorsed outlet may enter patients into the
  database (WAC 246-71-020); consultant verifies authorization form validity, photo ID,
  designated-provider-unlinked check. LCB uses the database to verify excise exemptions;
  DOR for sales-tax exemptions.
- Default database amounts: 3 oz useable / 48 oz solid / 216 oz liquid / 21 g concentrate.

### 4.3 Compliant products — WAC 246-70-040/-050
| Class | Limits | Forms | Who may buy | Where |
|---|---|---|---|---|
| General Use | ≤10mg THC/serving, ≤10 servings, ≤100mg/unit | any | any 21+ AND 18–20 cardholders | any retail |
| High THC | >10–50mg/serving, ≤500mg/unit | ONLY capsules/tablets/tinctures/patches/suppositories | cardholding patients 18+/providers ONLY | endorsed stores ONLY |
| High CBD | extracts ≤2% THC & ≥25× CBD; edibles ≤2mg THC & ≥5× CBD/serving | — | any adult 21+ (and 18–20 cardholders) | endorsed |
- Labels carry "Chapter 246-70 WAC Compliant – <class>" + DOH logo.
- Extra QA for compliant products: pesticide + heavy-metal screening (mycotoxin when
  microbial testing required) — WAC 246-70-050.
- Cultivera/WCIA pattern: `Is Medical` in the transfer JSON auto-flags DOH-compliant at
  intake; manual toggle with visual badge; once flagged, no excise to valid cardholders.

---

## PART 5 — POS industry benchmark (what "good" looks like)

Full vendor research: `research/notes/phase2-pos-industry.md`. Consolidated 26-point
checklist (§12) summarized:

**CCRS/WA-specific:** auto-generate all 7 CSVs with exact headers/naming/PST timestamps;
range-scoped Sale/Adjustment/Transfer vs changed-row reference files + full-reset recovery
dump; grouped upload order with error-gating (refs → inventory → transactions); pre-flight
validation screen that BLOCKS submission and links each defect to its fix (Dutchie);
immutable submission archive + CCRS error-reply ingestion matched back to submissions
(names get scrambled); POS↔state inventory reconciliation report (BLAZE "Compliance
Difference"); submission activity log UI (BLAZE "Compliance Task Manager"); WCIA JSON
manifest import/export + PDF fallback; destruction workflow; LabTestExternalIdentifier.

**Tax/medical:** 4-rate matrix from product DOH/High-CBD flags × customer type; excise
separately itemized; net-of-discount tax; dedicated WA tax report (excise vs sales by
product type) feeding LIQ-1295; per-sale card validity capture with 5-yr retention;
card-expiration reminders.

**Back office:** purchase-limit enforcement with equivalency gauge (Cova); ID-scan
age verification + age-verification report; Z-report/cash summary/over-short; voids &
returns audits; payment-type-change audit; inventory snapshot-by-date, roll-forward,
adjustments audit with reason codes, batch recall report; login/permissions audits;
per-shift drawer reconciliation; granular RBAC; offline mode; sales-hours enforcement;
SOC-2-grade security posture; audit logging everywhere.

**Cadence benchmarks:** Dutchie auto-reports to CCRS every 5 minutes; POSaBIT 3×/week;
weekly is the legal minimum. Market pricing context: $500–$1,500/mo/location.

---

## PART 6 — System inventory cross-reference (where things live in the repo)

Full AI-ready inventory with per-file findings: `research/notes/phase3-system-inventory.md`
(kept outside the repo; summarized here for navigation).

- **CCRS encoding:** `src/lib/compliance/ccrs-batch-core.ts` (pure spec encoder),
  `ccrs-batch.ts`, `ccrs-sales.ts`; **submit hard-gate** `assertCcrsBatchSubmittable`
  (Slice 105) fails CLOSED at the export route — the most important gate in the system.
- **Sales limits:** engine `src/lib/compliance/sales-limits-core.ts` (+ settings
  `sales-limit_settings`, migration 0045); POS gate `sales-limits.ts#enforceSalesLimitForSale`
  (⚠ unwired — GAP_AUDIT H-1).
- **Taxes:** `src/lib/reports/wa-tax.ts` (excise math), `tax_settings` (0030/0033),
  LIQ-1295 xlsx generation at `admin/reports/compliance/excise-export`.
- **Orders/money:** `src/app/api/orders/route.ts` → `src/lib/orders/orders-store.ts`
  (⚠ client-supplied money — GAP_AUDIT H-2); cart math `src/components/cart/CartProvider.tsx`.
- **Intake/traceability:** `src/lib/inventory/intake-store.ts` (finalize path runs the
  Slice-107 lot activation gate: failed/missing lab ⇒ quarantine), COA archive, WCIA JSON.
- **Medical:** migrations 0040/0060, `admin/medical/*` (medical.manage), medical report in
  `src/lib/reports/operations.ts` (card-validity audit control).
- **Advertising guardrails:** `src/lib/ai/compliance.ts` (single source of truth),
  KB banned phrases, crawler mirror `crawler/app/compliance.py` (⚠ drift — M-2).
- **Samples:** `admin/compliance/samples/actions.ts` (hard caps — positive control).
- **Audit trail:** `recordAudit` on every mutation; anomaly engine `audit-anomaly-core.ts`.
- **Auth/RBAC:** `admin/layout.tsx` + per-page/action `requirePermission`; passkeys
  (webauthn, 5-min single-use challenges); last-owner lockout protection.
- **Docs:** `docs/CCRS_*` (prior self-audits), `docs/MIGRATIONS_TO_RUN.md`.

---

## PART 7 — Non-negotiable POS invariants (derived; enforce in code + tests)

1. **No sale over WAC 314-55-095 limits** without a permission-gated, audited override.
2. **No cannabis line at $0 or below acquisition cost** — ever (promo, loyalty, BOGO, tier).
3. **Money is computed server-side** from the published menu; client input is a claim, not a fact.
4. **Excise = 37% of net selling price**, itemized separately on every receipt; medical
   exemption only with endorsement + valid card + DOH-compliant product, and every exempt
   sale keeps {date, patient id, card dates, SKU, price} for 5 years.
5. **Every CCRS file passes the Slice-105 gate** before it can be zipped; every submission
   is archived immutably with checksums; errors are ingested and reconciled.
6. **Nothing that is a WAC 314-55-087 record can be hard-deleted** inside 6 years
   (the rule requires five; we hold six by policy).
7. **No lot becomes sellable** without passing the lot-activation gate (lab pass + external id).
8. **All staff mutations are permission-gated and audited**; compliance-sensitive settings
   (limits, tax rates, license) are owner-only and high-sensitivity in the anomaly engine.
9. **All public marketing copy passes checkCompliance** at generation AND at accept/publish.
10. **Sales only 8am–midnight Pacific**; all business-day logic pinned to America/Los_Angeles.

— END OF BIBLE —
