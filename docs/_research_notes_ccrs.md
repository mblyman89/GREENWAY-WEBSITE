# CCRS Research — VERIFIED FACTS (source: lcb.wa.gov, scraped 2026-07-01)

## Becoming "your own reporting entity"
- Two distinct paths:
  1. **SELF-REPORT (default for a single retailer):** any licensee logs into CCRS at
     https://cannabisreporting.lcb.wa.gov/ with their OWN SAW (soon WA.gov) account and uploads
     their own CSV files. NO integrator application required. This is what replaces paying Cultivera.
  2. **THIRD-PARTY INTEGRATOR:** only needed to report ON BEHALF OF OTHER licensees (what Cultivera/Dutchie do).
     Requires LIQ-1455 "CCRS System Access Application" emailed to examiner@lcb.wa.gov with: integrator
     contact info, statement of services, list of LCB licensee clientele under contract, blank contract template.
     Vetting confirms: legally registered business + business need to report on behalf of a licensee + working with those licensees.
     Licensee must then "unlock the door" by assigning the integrator to EACH license in CCRS (only the active admin can assign/remove).
     THE LICENSEE REMAINS RESPONSIBLE FOR REPORTED CONTENT regardless.

## HARD TECHNICAL CONSTRAINTS (change architecture)
- **NO API.** "Does CCRS allow integrators to use an API? A: No. There is no API for CCRS." → CCRS is
  file-upload ONLY (CSV via web portal after login). No real-time push. Our system can only GENERATE
  correct CSVs; a human uploads them (or a future SFTP/automation, but the portal is the sanctioned path).
- **No cloud storage / no data pull.** No direct read of prior CCRS data; to see what was reported you file a Public Records request.
- File size: keep ≤ 1 GB (max 2 GB, slower). Filename referenced in PST.

## REPORTING CADENCE (CORRECTS earlier "no fixed weekday" note)
- **Weekly = Sunday–Saturday. Due no later than the following SUNDAY for the previous week.** More frequent is allowed.
  No "no-change" report exists — if nothing new, nothing is filed.
- **Monthly LIQ-1295 (Retailer Sales & Excise Tax):** retailers MUST file monthly even with no sales, and pay by the tax due date.
  Failure to report/pay = grounds to suspend/revoke (WAC 314-55-092(2)). (Earlier-verified: due the 20th of following month.)

## SALES.CSV SEMANTICS (verified)
- When QTY > 1 in a row, Discount and Taxes reflect the ENTIRE transaction; UnitPrice is price of ONE unit before discount/tax.
- "Other Tax" = 37% Excise (required for retail sales). SalesTax example 10%.
- Medical exemption: sale is "RecreationalMedical"; both sales & excise tax = $0.00. A tax exemption is NOT a discount and is not optional.
  Requires: store DOH medical endorsement + card holder in MCAD database + product marked "Medically Compliant".
- Returns: DELETE the Sale identifier from CCRS + report the inventory id on an Inventory Adjustment as a return (with reason).
- UnitWeightGrams = weight of sellable unit excluding packaging; never exceeds consumer carry limit.
- Infused pre-rolls are categorized as CONCENTRATES (subject to concentrate transaction limits).

## MANIFESTS (verified)
- Only valid manifests are the PDFs CCRS generates after you submit Manifest.CSV. POS-generated manifests are NOT accepted.
- No contingency manifest option.

## LOGIN TRANSITION
- SAW → WA.gov single sign-on. CCRS moves to WA.gov Oct 2026; make a WA.gov account at manage.login.wa.gov.

## IMPLICATION FOR OUR POS
- Offline capture is fine and even necessary; sync target is OUR Supabase, NOT CCRS directly.
- CCRS remains a periodic (weekly) BATCH CSV EXPORT that a human uploads. Our Slice-105 gate already guarantees well-formed files.
- So "sales data continues to flow into CCRS accurately after internet is restored" = offline sales sync to Supabase → included in the next weekly CSV export. There is no live CCRS pipe to fall back to; there never was one.
