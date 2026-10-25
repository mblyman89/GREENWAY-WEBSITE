# Part 19 — Two-week rehearsal plan: Cultivera products through CCRS (R74 S46, 2026-10-25)

**The question (owner, Round 26):** "all files failed … is this a failure due to my doing tests with cultivera imported products, or if there are real errors that will hold back real data … the best most practical way to test this pipeline with cultivera products so i can see if we will be able to do it for real in two weeks."

**The answer in one line:** no real errors. The 10/25 upload sent CCRS the exact 10/20 files a second time, and CCRS refuses the same data twice. The 10/20 run had already shown that the Cultivera-imported products, lots, adjustments and sales are accepted. What is left is to prove it on fresh activity, and to get production's identity data ready.

## A. What happened on 10/25 (verified on the bytes)

- The six files sent on 10/25 have the same md5 as the six 10/20 files (`evidence/2026-10-20-real-upload/sent`). Even the names are the 10/20 names (`…_20261020165828` … `…165833`) and `SubmittedDate,10/20/2026`.
- A fresh export would not produce those bytes. The hub writes today's date in `SubmittedDate`, and the ledger now routes the 10/20 records as already filed. So the files came from a re-download of stored files: the old zip on disk, or "Download exact file" on the CCRS files list.
- CCRS answered every row with "this already exists":
  - Duplicate External Identifier: Area, Product, Inventory and Adjustment.
  - Duplicate Strain: benign.
  - "Duplicate Sale for Licensee" on all 7 sale lines. This is the first time we have received that text; it answers U-07.
- Every one of those rows was accepted on 10/20. No message points at a data defect.

**What to do with the 6 emails:** once S46 is live, open each one and press **Apply error file**. When every row ties to a file CCRS already answered, the hub sets the email aside with the reason and writes nothing to the ledger. If Apply instead says it recorded something, a 10/20 file was still marked "uploaded". That is harmless in PREprod: press "Settle PREprod duplicates". You can also simply **Set aside** each email with the reason "re-upload of the 10/20 files".

## B. What the code does right (audited)

| Area | Status |
|---|---|
| Same bytes are never emitted twice | The outbox keys on sha256 per env (0248). It serves stored bytes under the stored name, and the README now says DO NOT UPLOAD when CCRS already answered them (S46). |
| A sale line CCRS holds is never Inserted again | `routeSaleInserts` (R5-1) treats held lines as "already held" and does not send them. |
| Lots accepted on 10/20 now route as Update | The ledger holds them as filed. An accepted later Sale/Adjustment proves a lot (0284), and the PREprod settle button covers the rest. |
| Pacing and dependencies | `ccrs_mark_uploaded` refuses while an earlier file is unanswered or a named product, strain, area or lot is not held (0249). |
| Error emails | They are read from the mailbox, matched row by row, and every known message has a grounded fix. Unknown text gets an examiner draft. |
| Excise and sales tax (checked on the 10/20 Sale file) | Excise is 36.9–37.0% of (price − discount) on every line, which is the 37% rule `[G L1377]` within cent rounding. Sales tax is about 6.8% of (price − discount + excise). |
| Sale grouping | A ticket keeps one SaleExternalIdentifier, one SaleType and one SaleDate, with a unique detail id per line `[G L1392-L1397]`. GWY-93E5RV (2 lines, with discounts) shows this. |
| Customer returns | Sent as adjustment reason `Other`, with the ADD direction written in the detail. Quantity is never negative `[G L1119]`. Accepted on 10/20. |

## C. Real risks for 11/08 (these could hold back real data)

1. **Production identity after 9/18 (U-30), the biggest risk.** The production ledger seed is the Service Desk copy current through 2026-09-18. Anything Cultivera filed after that date is not in it:
   - Lots received from 9/19 onward route as **Insert** and come back as Duplicate External Identifier, so they are held back as uncertain.
   - Products are matched by exact name (U-12), so a product Cultivera filed after 9/18 is unknown too.

   **Do now:** email the examiner (servicedesk@lcb.wa.gov) for a fresh copy of the production data. Ask that it be pulled **after Cultivera's final upload (11/07)** so it arrives in the week of 11/08. Load it on the CCRS Records page (0298). Anything held back in the first week goes out in the next upload; the "still owed" list (S39) tracks it.
2. **Two uploaders for one week (U-61).** If Cultivera's 11/07 upload holds any sale dated 11/01 or later, our 11/08 upload gets "Duplicate Sale for Licensee" on those lines. You now know exactly what that looks like. Get Cultivera's written confirmation that its last upload covers 10/25–10/31 only.
3. **Strain names carry Cultivera product text.** Examples: "Trophy Wife LR", "GG #4 LR", "Golden Pineapple LR". CCRS accepts them, but in production they create new strain records with the suffix. This is cosmetic, not a refusal. Tidy the strain names on the onboarding page before 11/08 if you care.
4. **Descriptions are cut at 250 characters.** The exporter caps them, for example "…mellow ev". This is not an error.
5. **Excise rounding.** Lines with a discount land at 36.93%. This was accepted on 10/20. Keep watching for "CannabisExciseTax does not equal 37% of UnitPrice" `[G L1377]`; it has never been received.

## D. The two-week plan

**Rule for every upload: upload only files from the zip you just downloaded, once each.** "Download exact file" on an answered file is for your records. It now carries a warning, and the zip README says DO NOT UPLOAD for repeats.

**Week 1: Mon 10/26 – Sat 10/31 (PREprod, test activity on Cultivera products)**

1. Make new activity on Cultivera-imported products, on dates after 10/20:
   - 3–5 register sales of **different lots than 10/20**, including one multi-line ticket with a discount;
   - one customer return;
   - one destruction adjustment;
   - if possible, receive one new vendor manifest.
2. Compliance → CCRS, env **PREprod**. Export a range that covers those dates and read the README. The "held back" list should be empty or explained.
3. Upload in the README order:
   1. Strain, then Area, then Product.
   2. Wait for the emails, or 10 minutes.
   3. Inventory, then wait again.
   4. InventoryAdjustment, then Sale.
4. Press **Mark uploaded** after each file. When the emails arrive, press **Apply** on each:
   - Duplicate Strain is benign.
   - Duplicate External Identifier on Cultivera lots never filed in PREprod is expected (PREprod does not hold Cultivera's history). Press **Settle PREprod duplicates**.
   - Anything else gets a fix list in the strategy report.
5. Expected result: Product, Adjustment and Sale all succeed, and Inventory succeeds or is settled. Repeat once mid-week if anything needed a fix. This proves the Update path: the second export routes the settled lots as Update.

**Week 2: Sun 11/01 – Sat 11/07 (live on the new system, PREprod dry run of real data)**

1. Wed 11/04: export **PREprod** for 11/01–11/03, the real first days of sales, and upload it. This is the closest test of the production upload.
2. Sat 11/07, after close: check the production card.
   - The prod ledger is loaded (E53 refuses otherwise).
   - The held-back list is understood.
   - Cultivera has confirmed its 11/07 upload holds nothing dated 11/01 or later.

**Sun 11/08: production**

1. Export **production** for 11/01–11/07 and upload in the README order. Mark uploaded, then Apply each email.
2. Any Duplicate External Identifier means CCRS holds an id our seed lacks (U-30). Those ids are held back automatically and settled by the fresh Service Desk copy. Every other record is filed.
3. After the first success, remove Cultivera as integrator (Part 07 §D step 6).

## E. Go / no-go for 11/08

- [ ] One full PREprod run on **fresh** Cultivera activity with only benign or settled answers (week 1).
- [ ] One PREprod run of real 11/01+ data (week 2).
- [ ] Fresh production Service Desk copy requested (or the plan to merge it in week 1 of production is accepted).
- [ ] Cultivera's written confirmation for U-61.
- [ ] Production ledger loaded; the README's held-back list is reviewed.

Part 07 §C sets "two consecutive weeks with zero error emails" as the exit criterion. Benign Duplicate Strain and PREprod-only duplicates do not count against it.
