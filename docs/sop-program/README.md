# Greenway SOP Program

The final program on the rap sheet: write an enterprise-grade Standard Operating Procedure for every back-office operation, and use the writing as a full code audit.

| File | Purpose |
|---|---|
| [00-OWNER-REQUEST-VERBATIM.md](00-OWNER-REQUEST-VERBATIM.md) | The owner's request, word for word, plus derived constraints |
| [01-PROGRAM-CHARTER-AND-STORAGE.md](01-PROGRAM-CHARTER-AND-STORAGE.md) | Phases, the 8-step per-slice audit method, how SOPs will live in the Employee area, SOP template |
| [02-SOP-CATALOG-AND-ROADMAP.md](02-SOP-CATALOG-AND-ROADMAP.md) | All 21 SOPs mapped to code, slice order, owner answers (D1–D35 in 00) |
| [03-FINDINGS-LEDGER.md](03-FINDINGS-LEDGER.md) | Every bug, gap, weakness and hardening need found. **Recorded, not fixed.** |
| [04-CONCIERGE-COVERAGE-LEDGER.md](04-CONCIERGE-COVERAGE-LEDGER.md) | What the Greenway Concierge knows today and what it still needs |
| [05-GAP-REGISTER.md](05-GAP-REGISTER.md) | Things the owner wants that the system does not do yet, each with an interim paper procedure |

The SOPs themselves live in `docs/sop/`.

| SOP | Status |
|---|---|
| [SOP-01 Register Operations](../sop/SOP-01-register-operations.md) | v1.1 draft for owner review (slice SOP-01; D21 and F-03-4 fix applied in slice SOP-04) |
| [SOP-02 Master Till / Store Safe](../sop/SOP-02-master-till-safe.md) | v1.2 draft for owner review (slice SOP-02; D14–D19 applied in slice SOP-03, D21–D22 in slice SOP-04) |
| [SOP-03 End-of-Day Close & Deposit Bag](../sop/SOP-03-eod-close-deposit.md) | v1.1 draft for owner review (slice SOP-03; D21–D27 applied in slice SOP-04) |
| [SOP-04 Receiving Intake & Monthly CCRS Public Records Request](../sop/SOP-04-receiving-intake.md) | v1.1 draft for owner review (slice SOP-04; D29–D34 applied in slice SOP-05a) |
| [SOP-05a Inventory Core: Lots, Holds, Recalls, Expiry, Labels and Labs](../sop/SOP-05a-inventory-core.md) | v1.1 draft for owner review (slice SOP-05a; D36–D43 applied in slice SOP-05b) |
| [SOP-05b Non-Cannabis, Merch, Menu Publishing, Categories, Classification & Sell Price](../sop/SOP-05b-noncannabis-menu-classification.md) | v1.1 draft for owner review (slice SOP-05b; D45–D49 applied in the fix slice) |
| [SOP-06 Inventory Audits (owner), Cycle Counts & Daily Checklists](../sop/SOP-06-cycle-counts-audits-daily-checklists.md) | v1.1 draft for owner review (slice SOP-06; D54–D61 applied in slice SOP-15) |
| [SOP-15 Returns to Vendor, Customer-Return Disposition & Destruction](../sop/SOP-15-returns-vendor-destruction.md) | v1.0 draft for owner review (slice SOP-15) |

**Status:** SOP-00 complete (recon + roadmap). SOP-01 complete (Register Operations, docs only: 16 findings, gaps G-01…G-07). SOP-02 complete (Master Till / Store Safe, docs only: 13 findings, gaps G-08…G-12). SOP-03 complete (End-of-Day Close & Deposit Bag, docs only: 11 findings, gaps G-14/G-15, G-04 updated; owner decisions D14–D20; F-02-2 withdrawn, G-10 closed, G-11 approved). SOP-04 complete (Receiving Intake + monthly CCRS public records request, docs only: 21 findings incl. one S1 (F-04-2), gaps G-16…G-19; owner decisions D21–D28; F-03-4 SOP-01 half fixed). SOP-05a complete (Inventory Core, docs only: 17 findings incl. two S1 (F-05a-1, F-05a-2), gaps G-22…G-26, G-19 extended; owner decisions D29–D35 applied, SOP-04 revised to v1.1; SOP-05 split into 05a/05b per D35; open questions Q-05a-1…Q-05a-5). SOP-05a v1.1 (owner decisions D36–D43: expired-edible hard block G-24, adjustment reasons G-23, no typed cannabis cost G-27, Destructions page G-28, the professional 86 G-26; living SOPs D41; concierge covers every feature D42). SOP-05b complete (Non-Cannabis, Merch, Publish, Categories, Classification & Sell Price, docs only: 14 findings incl. two S1 (F-05b-1 register disconnect, F-05b-9 cannabis-line crossing), gaps G-29…G-32; open questions Q-05b-1…Q-05b-5). Fix slice after SOP-05b (D44–D53): CI authorship failure explained and prevented (charter §3 rule 11); SOP pins re-checked after the second performance merge (`main@e1fe84eb`); SOP-05a v1.2 (RSO, tincture, capsule in the expiry hard block; F-05a-20) and SOP-05b v1.1 (G-29 widened, G-30, G-30A, G-31, G-32 APPROVED; F-05b-14, F-05b-15; Q-05b-6 open). SOP-06 complete (Inventory Audits owner only (D50), Cycle Counts and daily checklists for every employee (D51); docs only: 16 findings incl. four S1 (F-06-1 no push to Cycle Counts, F-06-5b re-scan becomes second count, F-06-7 cutoff double-subtraction, F-06-13 disagreeing second count not blocked), gaps G-33…G-39, open questions Q-06-1…Q-06-8; paper daily checklists, forms 8.5–8.7). SOP-06 revised to v1.1 with owner answers D54–D61 (F-06-15…F-06-17, gaps G-40/G-41). SOP-15 complete (Returns to Vendor, Customer-Return Disposition & Destruction, D62; docs only: 18 findings incl. two S1 (F-15-1 vendor return reduces on-hand before the manifest, F-15-6 Destroy return lands in an Active sellable lot), gaps G-42…G-49, G-28 extended, open questions Q-15-1…Q-15-6; paper forms 8.1–8.6). Next: per the roadmap order, **SOP-16 CCRS Reporting & Uploads**.
