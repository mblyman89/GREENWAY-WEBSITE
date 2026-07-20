# Chapter 03 — The Medical Program (intake → card → exempt sale → 5-year ledger)

> **Status:** COMPLETE (traced line-by-line against main @ `9a63c8b1`)
> **Primary files:**
> `src/lib/medical/tax.ts` (the two tax exemptions, card validity, DOH 608-048 checklist, purchase limits)
> `src/lib/medical/medical-intake-core.ts` (statutory expiration math, age classes, MCR card-number shape)
> `src/lib/medical/medical-authorization-core.ts` (issuance validation + point-in-time validity)
> `src/lib/medical/medical-sale-core.ts` (per-line exemption decisions, order plan, ledger drafts)
> `src/lib/medical/exempt-sale-record-core.ts` (WAC 314-55-090(2) record completeness)
> `src/lib/medical/store.ts` (cards, scans, endorsement config, exempt-sale writes)
> `src/lib/medical/sale-store.ts` (DOH product registry, card↔order attachment, idempotent ledger)
> `src/app/admin/medical/actions.ts` (guided intake + card lifecycle server actions)
> `src/lib/orders/completion-gate.ts` (the enforcement point — every sale passes through it)
> `src/lib/pos/medical-pos-core.ts` (register-side card capture + medical pricing — see also ch.02 §6)
> `src/lib/pos/medical-testmode-core.ts` (per-device endorsement simulation for rehearsal)

Washington's medical cannabis program (RCW 69.51A, WAC 246-70, WAC 314-55-090/095)
gives carded patients two money benefits (a sales-tax exemption and a 37%-excise
exemption, each with its own strict conditions) and one quantity benefit (3×
purchase limits). It also imposes two obligations on the store: sell High-THC
products ONLY to valid cardholders, and keep a 5-year record of every
excise-exempt sale. This chapter documents how each of those five things is
implemented, in the order a patient experiences them.

**Important context:** Greenway is NOT yet medically endorsed by the LCB. The
endorsement flag comes from the `medical_endorsement_config` DB row (§2). Until
the owner obtains the endorsement and sets that row, the excise exemption never
fires in production; a per-device TEST MODE exists so the flow can be rehearsed
(§10).

---

## 1. The two exemptions — the single most important rule in this chapter

`src/lib/medical/tax.ts` is the authority. Its header and `computeMedLineTax`
(tax.ts:78) encode the KEY RULE (corrected 2026-07-12 — the file itself notes
the correction, because an earlier "carded ⇒ sales-tax exempt on ANY cannabis"
rule under-collected sales tax):

**Sales tax (9.3%, RCW 82.08.9998)** comes off a line ONLY when:
- the product is DOH-compliant (chapter 246-70 WAC) **and** the buyer holds a
  valid recognition card at an endorsed store — RCW 82.08.9998(1)(a); **or**
- the product is a compliant **High-CBD** product, sold to ANYONE at an
  endorsed store — (1)(c).
- A card alone exempts NOTHING on a non-compliant product (tax.ts:87–95).

**Excise tax (37%, WAC 314-55-090)** comes off a line ONLY when ALL of:
endorsed store **and** valid carded buyer **and** DOH-compliant product
(tax.ts:97–101 — `exciseExempt = exciseApplies && carded && line.dohCompliant`).
The plan layer (§7) additionally enforces the statutory sunset: after the
configured `exciseExemptionUntil` date (default `2029-06-30`, WAC
314-55-090(6); medical-sale-core.ts:161, store.ts:99) the excise exemption
stops firing regardless of card and compliance.

Both exemptions therefore require `medicallyEndorsed` to be true. `carded` is
computed as `endorsed && med.cardValidInDatabase` (tax.ts:85) — the endorsement
is a hard AND, not a default. All money is minor units (cents); rates are basis
points (`applyBps`, tax.ts:41). `computeMedCart` (tax.ts:127) aggregates and
counts `exciseExemptLineCount` — the lines that will need 5-year ledger rows.

**Purchase limits** (tax.ts:205, `MEDICAL_PURCHASE_LIMITS`): 3 oz usable /
48 oz solid edible / 216 oz liquid / 21 g concentrate — exactly 3× the
recreational limits declared beside them (tax.ts:212) per WAC 314-55-095(2)(d).

## 2. The endorsement config — one DB row gates everything

`getMedTaxSettings` (src/lib/medical/store.ts:67) reads
`medical_endorsement_config` and returns `medicallyEndorsed` plus the tax
rates. `getEndorsementConfig` (store.ts:82) additionally exposes
`exciseExemptionUntil` (store.ts:85, mapped at :99). Every consumer — the
register menu bundle, the order-detail preview, and the completion gate — reads
the same row, so flipping the endorsement on (after the LCB grants it) turns
the whole program on everywhere at once, with no code change.

## 3. Card validity — one function decides, everywhere

`cardValidity` (src/lib/medical/tax.ts:177) is the single source of truth for
"does this card grant exemptions on this date":

1. `status` must be exactly `active` (revoked/expired/unknown ⇒ invalid, with
   the status named in the reason);
2. `inDohDatabase` must be true (the card must be in the MCR);
3. `uniquePatientIdentifier` (UPID) must be present — without it the WAC
   314-55-090(2) ledger row cannot be written;
4. today must fall inside `[effectiveOn, expiresOn]` (tax.ts:181–183).

`authorizationValidityAt` (src/lib/medical/medical-authorization-core.ts:124)
layers `expiringSoon` / `daysUntilExpiry` (30-day soft warning) on top of the
same base verdict — it never loosens it. The completion gate calls this
wrapper (completion-gate.ts:154), so an expired-yesterday card blocks
completion today even if it looked valid when attached.

> **Finding GW-009 (🟡, logged in `../FINDINGS.md`):** the date compare at
> tax.ts:181 uses `onDate.toISOString().slice(0, 10)` — the **UTC** calendar
> day — while the store operates on Pacific time. Same UTC-day convention at
> the exempt-sale `sale_date` stamps (store.ts:383, completion-gate.ts:178)
> and the DB default (`current_date`, migration 0040_medical_doh.sql:89). The
> drift direction is fail-safe (a card is treated as expired up to 8 hours
> EARLY on its last evening; it never gains extra validity), but evening sales
> near a month boundary land their ledger rows in the adjacent reporting
> period. The Pacific-day helpers used by returns/voids (ch.05) are the
> pattern to migrate to.

## 4. Intake — issuing a recognition card in the store

Greenway's certified medical consultant issues cards in-store via the guided
wizard (`GuidedIntakeWizard`, src/components/admin/medical/GuidedIntakeWizard.tsx —
Task P), a five-step hand-holding flow: patient (:138) → paper authorization
form DOH 630-236 (:248) → work in the MCR (:295) → record the card (:361) →
print & laminate (:452, appears after issuing).

The server action `guidedIntakeAction` (src/app/admin/medical/actions.ts:59)
feeds `createAuthorization` (src/lib/medical/store.ts:197), which enforces
`validateAuthorizationIssuance`
(src/lib/medical/medical-authorization-core.ts:61, called at store.ts:205)
BEFORE any row is written:

- **All four DOH 608-048 checks** must be attested (`canIssueCard`,
  tax.ts:198: form complete/signed, tamper-resistant paper verified, identity
  verified, embossed/raised seal verified) — one unchecked box refuses
  issuance;
- holder type must be `patient` or `designated_provider`;
- a **UPID is required whenever `inDohDatabase` is true** (the error text says
  why: the exemption ledger needs it);
- dates must be valid ISO, effective ≤ expiration, and the card must not
  already be expired at issuance.

The statutory expiration ceiling is pure math in
`src/lib/medical/medical-intake-core.ts`: `maxExpirationFor` (:79) = the
authorization's issue date + **1 year** (adult) or **+6 months** (minor),
month-end clamped (`addMonthsClamped`, :34) per RCW 69.51A.230(4)(a).
`checkIntakeDates` (:113) blocks: missing/invalid dates, expiration on/before
effective, expiration already past, authorization issued in the future,
effective date before the form was issued, and any expiration beyond the
statutory maximum. `classifyPatientAge` (:66) drives the minor/adult ceiling;
`checkCardNumber` (:165) shape-checks the MCR card number.

Card lifecycle after issuance (all in actions.ts / store.ts):

- `attachScanAction` (:186) → `attachFormScan` (store.ts:271) stores the
  authorization-form scan in a **private** bucket; viewing goes through
  `signedFormScanUrl` (store.ts:303) — a 5-minute signed URL, never a public
  link.
- `markCardPrintedAction` (:206) → `markCardPrinted` (store.ts:311) records
  the print-and-laminate step.
- `validateMcrAction` (:214) → `recordMcrValidation` (store.ts:337) stamps the
  periodic "verified in the MCR" re-check with the actor.
- `setCardStatusAction` (:27) → `setAuthorizationStatus` (store.ts:323); an
  unknown status string is coerced to `revoked` — corruption fails SAFE
  (toward no exemption).
- `createAuthorization` retries on Postgres `42703` (undefined column) by
  dropping the migration-0114 polish columns (store.ts:238–252), so a
  pre-0114 database still issues cards rather than erroring.

## 5. The DOH product registry — which products are "compliant"

`medical_product_registry` (migration 0113_medical_pipeline.sql) stores the
durable chapter 246-70 category per product, keyed by the **POS product key**
(the same `product_id` the register sells by). Categories
(`DOH_CATEGORIES`, src/lib/medical/medical-sale-core.ts:44): `general_use`,
`high_thc`, `high_cbd`. `suggestDohCategory` (:78) offers a name-based hint;
staff confirm in the back-office registry UI
(src/components/admin/medical/DohProductRegistry.tsx), writing through
`upsertDohProductAction` / `removeDohProductAction` (actions.ts:238/:272).
`getMedicalRegistryForKeys` (src/lib/medical/sale-store.ts:72) is the read the
completion gate uses. A product NOT in the registry is simply not compliant —
no exemption, and no High-THC restriction either (High-THC status only exists
by registry entry).

## 6. The register side (bridge to chapter 02)

On the iPad, `src/lib/pos/medical-pos-core.ts` handles the card capture and
preview pricing during a sale (full sale-flow context in ch.02 §6):

- `validateCardCapture` (:97) — the budtender types the card facts (UPID,
  effective/expires, holder) and must attest "verified in the DOH database";
- `medicalAgeAllowed` (:139) — 18–20 year olds may buy ONLY with a valid card
  (recreational is 21+);
- `applyMedicalPricing` (:190) — the register's preview of the two exemptions,
  computed with the same `computeMedLineTax` rules against the bundle's
  `medical` block (registry + endorsement shipped in the menu bundle);
- `medicalCardBadge` (:274) — the on-screen card status chip;
- `validateMedicalSaleBlock` (:297) — shape-checks the `medical` block that
  rides the sale envelope to the server.

At sync, the card capture event is processed by `processCardCapture`
(src/lib/pos/sync-store.ts:1012); a pre-0121 database rejects card-capture
events with a precise message naming `0121_pos_medical.sql`
(sync-store.ts:233–239). When a sale envelope references a card, sync resolves
it via `findAuthorizationByUpid` and attaches it with `attachCardToOrder`
(sale-store.ts:148/:170, called at sync-store.ts:634) BEFORE the completion
gate runs — so the gate always judges the durable server-side card, never the
register's typed-in copy.

## 7. The completion gate — where the law is actually enforced

Every sale — register sync, pickup handover, back-office completion — runs
`runCompletionGate` (src/lib/orders/completion-gate.ts). Its medical section
(completion-gate.ts:146–228) executes five steps in order:

1. **Re-validate the attached card on the completion date**
   (completion-gate.ts:152–158) via `authorizationValidityAt`. An
   attached-but-invalid card BLOCKS completion — staff must fix the card or
   detach it so the sale knowingly completes as recreational. No silent
   downgrade.
2. **Build the exemption plan from stored lines**
   (`buildOrderExemptionPlan`, medical-sale-core.ts:210; called at
   completion-gate.ts:174) using the durable registry
   (`getMedicalRegistryForKeys`), the endorsement config, and the sunset date
   (`exciseExemptionUntil ?? "2029-06-30"`). This is the SAME pure math the
   order-detail preview shows (`decideLineExemption`,
   medical-sale-core.ts:118) — no drift between what staff saw and what the
   gate enforces.
3. **High-THC hard gate** (completion-gate.ts:183–187): any
   `plan.highThcViolations` refuses the sale, naming the products and citing
   chapter 246-70 WAC. The message states plainly: **there is no override for
   this rule.**
4. **Sales limits** (completion-gate.ts:191–206): a valid attached card
   evaluates the cart against the 3× medical limits, otherwise recreational
   (WAC 314-55-095(2)(d)); a manager override with a logged reason exists for
   the limit gate only where `overridePermitted` allows it.
5. **Write-or-block the exemption ledger** (completion-gate.ts:209–227): when
   a valid card claimed exemptions (`plan.claimedLineCount > 0`),
   `buildExemptSaleDrafts` (medical-sale-core.ts:292) turns the plan into
   ledger drafts and `recordExemptSalesForOrder` must succeed. The refusal
   text quotes the stakes: without the record the exemption "shall be presumed
   to have been incorrectly exempted" and the store remits the tax plus
   penalties (WAC 314-55-090(3)). **Ledger write failure = the sale does not
   complete.**

## 8. The 5-year ledger (`medical_exempt_sales`)

**Write path.** `recordExemptSalesForOrder` (src/lib/medical/sale-store.ts:279)
is idempotent delete-then-write: it first deletes any rows from a prior
completion attempt of the same order, then writes each draft through
`recordExemptSale` (src/lib/medical/store.ts:373). Before persisting, every
EXCISE-exempt row passes the Slice 103 completeness guardrail
(`verifyExemptSaleRecord`, src/lib/medical/exempt-sale-record-core.ts:52):
date + UPID + card effective/expiration + product + price must all be present
— the row must survive a 5-year audit (WAC 314-55-090(2)). Sales-tax-only
rows (`exciseTaxExempt === false`) are recorded but not held to the ledger
standard (store.ts:378 comment). `clearExemptSalesForOrder`
(sale-store.ts:267) is the reversal primitive.

**S-8 join convention** (documented at ccrs-sales.ts:242–245 and on
`recordExemptSale`): `product_sku` MUST equal the order line's `product_id`
(the POS product key). Every downstream reader joins on
`(order_id, product_sku)`.

**Read paths** (who consumes the ledger):

| Reader | Where | What it does |
| --- | --- | --- |
| CCRS Sale.csv | src/lib/compliance/ccrs-sales.ts:237–269 | Orders with exempt rows export `SaleType = RecreationalMedical` per line (B1) |
| LIQ-1295 excise return | src/lib/compliance/excise-return.ts:138 | Medical-exempt sales feed the endorsement lines of the monthly LCB return (template cell map verified against LIQ-1295 R 7.24) |
| WA tax reports | src/lib/reports/wa-tax.ts:302–316 | Exemption amounts joined into sales/B&O math |
| Medical report | src/lib/reports/operations.ts:670 (`getMedicalReport`) | Exempt-sale listing + `cardValidityIssues` audit (:741–791) flagging sales where the card was expired at sale time |
| Compliance health | src/lib/compliance/compliance-health.ts:228 | Cross-checks ledger consistency |
| Back office | store.ts:418 `listExemptSales`, :433 `medicalSummary` | Browse + program dashboard |
| Void (ch.05) | src/lib/pos/void-store.ts:383 | DELETES the order's rows — a voided sale never happened, so the ledger must not contain it |

Note on internal consistency: the excise return's `monthRange`
(src/lib/compliance/excise-return-core.ts:139) computes **UTC** month bounds —
consistent with the ledger's UTC `sale_date` stamps today, and both should
move to Pacific together when GW-009 is fixed.

## 9. Patient-facing honesty

The public medical page (src/components/medical/MedicalProgramContent.tsx)
hard-codes the statutory mechanics as fixed copy — only the hero/intro is
CMS-editable — so a content edit can never overpromise. Its stated HONESTY
RULES mirror tax.ts exactly: sales tax waived only on DOH-compliant product,
excise only for carded patients on compliant product while the exemption
window is open, elevated limits only for carded patients in the database, and
**no medical/therapeutic claims anywhere** (WAC 314-55-155). The limits table
renders from the same `purchaseLimitRows`
(src/lib/medical/purchase-limit-display-core.ts:30) constants the register
enforces.

## 10. TEST MODE — rehearsing without the endorsement

Slice 5 (`src/lib/pos/medical-testmode-core.ts`) lets the owner rehearse a
medical sale before the LCB endorsement exists:

- Per-device localStorage flag `gw-pos-medical-testmode`
  (`MEDICAL_TESTMODE_KEY`, :45); ONLY the exact string `"on"` enables it —
  anything else (corruption, legacy values) degrades to OFF
  (`parseMedicalTestMode`, :53). **Fails safe: a corrupted flag can never
  silently drop real tax.**
- `applyMedicalTestMode` (:88) flips `bundle.medical.endorsed` to true ONLY
  when the bundle ALREADY carries a `medical` block — it never fabricates one,
  and with the flag off it returns the bundle untouched (same reference).
- It is render-time only: **it never touches the server or the database.** The
  server-side completion gate still reads the real
  `medical_endorsement_config`, so a test-mode register cannot complete a
  really-exempt sale.
- RegisterShell shows a loud "⚠️ MEDICAL TEST MODE" banner whenever it is
  active (`medicalTestModeBannerActive`, :103) so it can never be mistaken for
  the real endorsement.
- Every per-sale requirement still runs under test mode: card capture, the
  DOH-database attestation, expiry checks, High-THC gating, 3× limits, and
  the record capture (module header, "SAFETY POSTURE").

## 11. What SHOULD never happen (the owner's watchlist)

1. **Sales tax dropped on a non-compliant product just because the buyer has a
   card.** Compliance (registry entry) is required for BOTH exemptions.
2. **Any exemption granted while the store is not endorsed** (outside test
   mode's on-screen preview). The endorsement flag is a hard AND.
3. **The 37% excise dropped after the statutory sunset date**, or for an
   uncarded buyer, or on a non-compliant product.
4. **A High-THC product sold to anyone without a valid recognition card** —
   through ANY path (register, pickup, back office). There is no override.
5. **A sale completing with an attached card that is expired, revoked, not in
   the MCR, or missing its UPID.** The gate re-validates on the completion
   date; the fix is on the patient's profile, never a silent downgrade.
6. **An excise-exempt sale completing without its ledger row.** Write-or-block
   is the rule; if the write fails, the sale must refuse.
7. **A ledger row missing date, UPID, card dates, product, or price** — the
   completeness guardrail must refuse it.
8. **A card issued with any DOH 608-048 checkbox unchecked**, without a UPID
   while marked in-MCR, already expired, or expiring beyond the statutory
   +1yr/+6mo ceiling.
9. **A minor's card expiring more than 6 months after the authorization was
   issued.**
10. **An 18–20 year old completing a recreational sale**, or being refused a
    medical sale with a valid card.
11. **A carded patient limited to recreational quantities**, or an uncarded
    buyer granted 3× limits.
12. **A voided medical sale still present in `medical_exempt_sales`** (ch.05
    deletes the rows), or a completed exempt sale missing from the CCRS
    export's `RecreationalMedical` signal.
13. **The authorization-form scan reachable by public URL.** Access is a
    5-minute signed URL from a private bucket, always.
14. **An unknown card status treated as anything but revoked.**
15. **Medical test mode surviving invisibly** — the banner must show whenever
    it is on, and it must never alter a server-side decision.
16. **The preview and the gate disagreeing** — both run the same pure plan
    math; a discrepancy between the order-detail preview and a completion
    refusal is a bug.
17. **Exemption math on gross-of-discount prices.** The plan builds from
    stored line prices (post-discount, minor units).
18. **A patient-facing page promising a discount the register would not give**
    — the public copy's mechanics are fixed and mirror tax.ts.

## 12. Findings from this chapter

- **GW-009 (🟡 Low, OPEN):** UTC-vs-Pacific calendar-day drift in
  `cardValidity` and the exempt-sale `sale_date` stamps (details in
  `../FINDINGS.md`). Fail-safe direction; fix is a small pacific-day helper
  slice, no backfill required.
