# Medical Cannabis — DOH / LCB Requirements (authoritative research)

> Source-grounded reference for Slice 28. Follow precisely. Citations below.

## The database (MCR)

As of **June 30, 2025**, the DOH "Medical Cannabis Authorization Database" is the
**Medical Cannabis Registry (MCR)** — it replaced the prior "Airlift" system.
Patients/Designated Providers hold a **recognition card**. Store roles:

- **Certified Medical Cannabis Consultant** — creates, corrects, renews, replaces
  recognition cards in the MCR; prints laminated cards for patients.
- **Store owner/delegate** — adds/removes consultants and employees.
- **Budtender** — verifies a presented recognition card in the MCR at sale time.

Access requires a Washington **SAW** account with MFA + the MCR app added.
(Source: DOH "Medical Cannabis Registry" page.)

> NOTE: The MCR has no public retailer API. Validation is performed by staff
> logging into the MCR and entering the card number. Our system therefore stores
> the **validation result** a consultant/budtender records — it does not call the
> MCR directly.

## Recognition card data (what we store)

Per **WAC 314-55-090(2)** and **RCW 69.51A.230**, a recognition card has:

- **Unique patient identifier** — a randomly generated unique number.
- **Effective date** and **Expiration date**.
- Card holder type: **patient** or **designated provider (DP)**.

## Two distinct tax exemptions (do not conflate)

| Exemption | Rate | Applies when |
|---|---|---|
| **Sales tax** | 9.3% | A registered patient/DP (in MCR) buys **ANY** cannabis at a medically-endorsed store. (Also: High-CBD WAC 246-70-040 products are sales-tax-free for anyone.) |
| **Excise tax** | 37% | ALL THREE: (a) medically-endorsed retailer; (b) buyer is patient/DP with a **valid recognition card in the MCR**; (c) product is **DOH-compliant** per WAC 246-70-040 (tested to 246-70 standards, bears DOH logo). |

So a carded patient buying a non-DOH-compliant product: **sales tax exempt, excise still applies.**
A carded patient buying a DOH-compliant product: **both exempt** → `RecreationalMedical`, $0 both taxes (matches existing CCRS handling).

(Sources: HB 1453 FAQ DOH 608-050; WAC 314-55-090.)

## Required records for each EXCISE-exempt sale (retain 5 years)

Per **WAC 314-55-090(2)** (and LCB WAC 314-55-087 recordkeeping):

1. **Date of sale**
2. From the recognition card: **unique patient identifier** + **effective date** + **expiration date**
3. **SKU / unique product identifier** of each exempted product
4. **Sales price** of each exempted item

If a retailer cannot produce these records on LCB request, the excise tax is
**presumed incorrectly exempted** and the retailer must remit it (penalties may
apply per WAC 314-55-092). We therefore log a durable, auditable record for every
excise-exempt sale.

## Authorization-form validation (before issuing a card)

The consultant must confirm (DOH 608-048):

- Form fully **completed and signed** by a health care practitioner.
- Printed on **tamper-resistant paper** with ≥1 security feature (hidden "VOID",
  anti-copy watermark, erasure security, chemical reactant stain, UV fibers).
- **Proper identification**: full legal name (no nicknames), physical street
  address (no P.O. box) for patient and DP; DP requires identical authorizations
  with original signatures.
- **Embossed RCW 69.51A.030 medical cannabis seal** visible.

If any requirement cannot be verified → **do not create a card**; refer the
patient back to their practitioner.

## Recognition-card benefits / possession limits (carded, in MCR)

- Sales-tax-free purchases at endorsed stores.
- 37% excise exemption on DOH-compliant product.
- **3× standard purchase limits**: 3 oz usable, 48 oz solid (eaten/swallowed),
  216 oz infused liquid, 21 g concentrate.
- Possess up to 6 plants and 8 oz usable (practitioner may authorize up to 15
  plants / 16 oz).

## Sunset

The 37% excise exemption is effective **until June 30, 2029** (WAC 314-55-090(6)).

## Citations

- DOH, *Medical Cannabis Registry* (MCR), accessed 2026-06-30.
- DOH 608-050, *Medical Cannabis Excise Tax Exemption — HB 1453 FAQ* (July 2024).
- DOH 608-048, *A Cannabis Retailer's Guide to Validating the Medical Cannabis
  Authorization Form* (July 2024).
- WAC 314-55-090, *Medical cannabis patient excise tax exemption* (eff. 2024-10-12).
- RCW 69.51A.230 (unique patient identifier / recognition card).
- RCW 69.50.535 (excise tax + exemption sunset 2029-06-30).
