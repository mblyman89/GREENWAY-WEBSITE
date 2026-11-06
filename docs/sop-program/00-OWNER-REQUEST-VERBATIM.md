# SOP Program — Owner request, recorded verbatim (Standing Rule 1)

Recorded 2026-10-27 (Pacific), Slice SOP-00. Nothing below is paraphrased.

---

> I need you to help me draft very detailed standard operating procedures for every aspect of the back office. I want a sop for running the registers that can be used for the employees to help them learn the system, but also guide them when they need help. This should be something that lives in the employee page in the back office. It should be exportable and printable. I want it to explain in detail each function, every process, every hard block, every feature that can be used and how it should be used. Include anything else you think a professional enterprise grade system would add to make it as easy and foolproof as possible. It should include clocking in, counting the till, entering the amount, closing the till at the end of the shift. What to do with the money from their till, how to balance their till, everything. I want to also make sure the closing shift and closing day reports are built and can be exported and printed. It should have a feature that requires a second person to count the till and sign off on the accuracy of the count. There should be an end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe for depositing to the bank. I want to make sure the master till spreadsheet is built and to add to the sop the master till routine, count twice a day, once in the morning, once at night. Either morning or night employee can balance the master till using small bills from the little safe in exchange for big bills from the master. This should be exportable and printable. I want to include cleaning schedules, including dusting products and such. Checklists for daily tasks like cycle counts I initiate via the inventory audit feature. Add to the sop to utilize the creative studio to create banners, ads and marketing content, graphics for garments, etc. add to the sop product enrichment and how to do it, as well as vendor enrichment. There should be a sop for the receiving intake pipeline. There should be a sop for new hires and setting them up with access to the system. Sop for transferring product back to the vendor, sop for destroying products. Sop for Leafly integration, sop for CCRS uploads. Sop for inventory management. Sop for purchase orders and how to fetch the menu from Cultivera marketplace and growflow marketplace. Sop for online orders and how to manage them. Sop for connecting and reconnecting hardware. Sop for how to use digital content. Doing all of this should hopefully add value for my employees and myself, while at the same time giving me some peace of mind by having you go through every single pipeline and procedure auditing the code for quality and bugs and other such things. As you recon and audit to build these sop files, I want you to keep a detailed record of what you find. Does the logic look sound, are there any weaknesses, or faults, or areas that need hardening? Don't fix them yet, just identify everything as you go through it all. I want to build all of the various sop files, decide the right way to professionally and effectively store them in the employee branch of the back office for them to read or download or print. After we have audited the entire code base, we can then add in all of the sop files, and then talk strategy for patching any holes and squashing any bugs. For now, audit and recon, record the issues, and write the sop reports. This is a massive undertaking doing this, it's the absolute final task on the rap sheet. Everything is built and working great. We need procedures to follow. This is also a great opportunity to record what all is included in the greenway concierge ai service. We should be adding everything there is to know about the back office to it along the way. So keep track of what it knows and what it needs to have included still. We can work on adding in all the missing pieces. We should be adding in as many helpers as possible. Each page and function has helpers, but the global system wide helpers like the concierge might be lacking in knowledge that would be useful to have on hand. This is the best way to audit, and create accurate and full detailed procedures for us to follow. I need you to be extremely organized with this task. Maybe first, walk the file tree, understand the various branches, so you can write a proper all inclusive roadmap strategy for each sop to be created and incorporated into the employee management system. I want to work on one sop at a time. Full audit, full recon, then write up the sop, commit and push it to my GitHub. After all are safe on my repo, along with the notes, reports, documentation and other such records for the other tasks mentioned for us to strategize on once we have all sop file created. We can work on adding anything needed as a result of building these sop files, like if something isn't fully built out yet, we can discuss how we want to finish building it if we need it. Download the repo, read agents.md, the standing rules. Then begin the high level overview so you can get an idea of all the sop we will create. Gather all details you need to come back to me with a summary report about all the sop you will create, your strategy for the audit and reporting of all the things i need recorded and documented. Then a slice roadmap for how we will work through this huge list. This is a no code edits slice. Just gather everything you need to report back with a strategy for all sop files to be created and your strategy for building them all. Follow the standing rules and never guess. Thank you!

---

## Derived constraints (my reading — each traced to the words above)

| # | Constraint | Source phrase |
|---|---|---|
| C1 | SOP-00 is **docs only, no code edits** | "This is a no code edits slice." |
| C2 | Audit findings are **recorded, not fixed** until the whole program is done | "Don't fix them yet, just identify everything" |
| C3 | **One SOP per slice**: full audit → full recon → write SOP → commit + push | "I want to work on one sop at a time." |
| C4 | SOPs ultimately **live in the Employee area** of the back office, readable, downloadable, printable | "lives in the employee page … exportable and printable" |
| C5 | SOPs get **wired into the app only after** every SOP is written and safe on the repo | "After we have audited the entire code base, we can then add in all of the sop files" |
| C6 | A running **concierge coverage ledger** (what it knows / still needs) | "keep track of what it knows and what it needs to have included still" |
| C7 | SOPs describe **what exists**. Where a requested feature does not exist yet, the SOP says so and the gap goes to the ledger for a build decision | "if something isn't fully built out yet, we can discuss how we want to finish building it" |
| C8 | Never guess (Standing Rule 2): every SOP step is pinned to a file/line | "Follow the standing rules and never guess." |

---

## Owner reply after SOP-00 (recorded verbatim, Slice SOP-01, 2026-10-27 Pacific)

> Thank you. Vercel built the app no problem, all is good. For the register operations, please include every detail needed to fully explain how to ring sales and apply certain discounts. Why and how the system blocks and warns you. How to read the register screen and checkout screen and such. Everything they need to know to complete any and all sales. For the questions, Q1- no, I just want them to be available to the employees. I will have them read them, but the system doesn’t need to require anything from them. Q2- close only, and it can be any second employee. It doesn’t need to be a lead or manager. Q3- no, I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe. Q4- purchase orders is handled via Cultivera market place, a b2b marketplace. We are migrating away from their pos service. We will do a one time migration process and then use the new system going forward. The po builder using the crawler will continue to be allowed going forward and should have a proper sop explaining how to use it, and save the data we get from it. Q5- sorry I wasn’t more clear, I am referring to the digital assets page in the mktg & adv dropdown menu. It has all of the digital assets and content from all the enrichment and other content we generate. I want there to be an sop for how to use it properly, to clean it up and keep it organized. Now that I think about it, we should add an seo sop so we can stay on top of that too. Q6- $5. It should be an admin only screen placed in the most logical place to put it for me to interact with. Just warnings for now. Who, when, how much, their reason for why it’s over/ under (should be required to be input for over/ under). Q7- yes, please keep those separate. There are “users”, and “employees” not all users are employees. All employees are users. Please proceed with the first sop. Once you have finished, report back with a summary report. Keep the work safe. Follow the standing rules. Go above and beyond, go slow so you don’t miss anything. Document everything. thank you.

### Decisions derived from the reply (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D1 | **No acknowledgment gate.** SOPs are available to employees; the system requires nothing. Phase D drops the optional ack design. | "Q1- no … the system doesn’t need to require anything from them" |
| D2 | **Second-person count at till CLOSE only**, by **any** second employee (not role-restricted). | "Q2- close only, and it can be any second employee" |
| D3 | **Little safe has no tracked balance/target.** Record each master-till ↔ little-safe exchange: which big bills went OUT of the master into the little safe, and which small bills/coin came out of the little safe. | "Q3- no, I just want to know when big bills leave …" |
| D4 | **Cultivera:** POS service = one-time migration, then the new system. The **crawler PO builder stays** as an ongoing, allowed workflow; it gets its own proper SOP and its fetched data must be saved. | "Q4- … The po builder using the crawler will continue to be allowed going forward" |
| D5 | **SOP-12 = the Digital Assets page** (Mktg & Adv menu): how to use it, clean it up, keep it organized. | "Q5- … the digital assets page in the mktg & adv dropdown menu" |
| D6 | **New SOP: SEO.** | "we should add an seo sop" |
| D7 | **Over/short threshold = $5.** Warnings only (no block). New **admin-only** screen placed in the most logical spot. Shows who, when, how much, and a **required** reason whenever there is any over/short. | "Q6- $5 … admin only screen … reason … should be required" |
| D8 | **Keep the split:** register approvals use employee `job_role`; back-office permissions use the user `StaffRole`. All employees are users; not all users are employees. | "Q7- yes, please keep those separate" |
| D9 | SOP-01 must explain **every** detail of ringing every kind of sale, applying discounts, every block/warning (why + how), and how to read the register and checkout screens. | "include every detail needed to fully explain how to ring sales …" |

---

## Owner request for SOP-02 (recorded verbatim, Slice SOP-02, after SOP-01 merged as 0055f06c)

> Thank you! Please now begin the second sop, master till/ store safe. It’s probably in the code, but just in case it isn’t, there are three tills, two sales and one manager register. They are the ones with 167.5 in them. The master till has 1000. 32 tens, 64 fives, 318 ones, 95 quarters, 120 dimes, 100 nickels, and 125 pennies. If there isn’t already, there should be a page to enter the two daily counts. Make sure to record everything, document everything, pin and anchor anything. All inclusive reporting please. Follow the standing rules. Thank you!

### Facts and decisions derived (each traced to the words above)

| # | Fact / decision | Source phrase |
|---|---|---|
| D10 | **Three tills (cash drawers):** two sales registers + one manager register. Each till's float is **$167.50**. Total floats = 3 × $167.50 = **$502.50** (computed by script, `sop02/calc.py`). | "there are three tills, two sales and one manager register. They are the ones with 167.5 in them" |
| D11 | **Master till = $1,000.00**, standard composition: 32 × $10, 64 × $5, 318 × $1, 95 × 25¢, 120 × 10¢, 100 × 5¢, 125 × 1¢. Script-verified to total exactly $1,000.00 ($320 + $320 + $318 + $23.75 + $12 + $5 + $1.25). There are **no $20s or larger, no $2s and no $1 coins** in the standard master till. | "The master till has 1000. 32 tens, 64 fives, 318 ones, 95 quarters, 120 dimes, 100 nickels, and 125 pennies" |
| D12 | **Two daily counts of the master till must be enterable on a page.** If the page exists, SOP-02 documents it; if not, it is a gap (no build in the SOP program). | "If there isn’t already, there should be a page to enter the two daily counts" |
| D13 | Reporting standard for this slice: record and pin every claim to file/line, all-inclusive. | "record everything, document everything, pin and anchor anything. All inclusive reporting please" |

---

## Owner reply after SOP-02 + request for SOP-03 (recorded verbatim, Slice SOP-03, after SOP-02 merged as 3385bfa9)

> Thank you. Q02-1- yes you have that correct. Q02-2- anyone can count and record the master count. Q02-3- yes, it applies to the master as well. Q-02-4- id like the supply run screen built. A-02-5- yes correct. And I was wrong, it should be 300 in it. Please begin sop 3. In the summary report let me know what the next sop will entail. Follow the standing rules. Thank you!

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D14 | **Register change swaps go till ↔ master till.** The app's "safe" on the register swap screen means the $1,000 master till (resolves Q-02-1; SOP-02 §4.11 assumption confirmed). | "Q02-1- yes you have that correct" |
| D15 | **Any employee may count and record the master till count** (resolves Q-02-2). Today recording needs `inventory.manage` (`safe/actions.ts` L41), so this becomes a permission change for the build phase (finding F-02-10 / new gap G-13). | "Q02-2- anyone can count and record the master count" |
| D16 | **The $5 threshold and required reason (D7) apply to master till counts as well** (resolves the first half of Q-02-3). **Still open:** the half carried from SOP-01, whether a reason is required for *every* over/short or only over $5. D7's words ("should be required to be input for over/ under") are read as **every** over/short until the owner says otherwise. | "Q02-3- yes, it applies to the master as well" |
| D17 | **Build the supply-run screen** (resolves Q-02-4; gap G-11 moves from AWAITING OWNER to **APPROVED, queued for build**). Per charter C5 and the record-only rule it is not built inside the SOP slices; it is queued for the build phase. | "Q-02-4- id like the supply run screen built" |
| D18 | **The system's "Manager Till" is the manager register** of D10 (resolves Q-02-5). | "A-02-5- yes correct" |
| D19 | **Correction to D10: the manager register holds $300, not $167.50.** The two sales tills stay at $167.50. Floats: 2 × $167.50 + $300.00 = **$635.00**; with the $1,000 master till, $1,635.00 (computed by script). The code already sets the Manager Till to $300 (migration 0038 L177–184), so **F-02-2 is withdrawn as a defect** (code matches the owner). Gap G-10 is closed; only the misleading code comment (F-02-9) remains. *Interpretation note:* "it should be 300 in it" is read as the manager register, the only till whose amount was in question (F-02-2). Flagged in the SOP-03 report for confirmation. | "And I was wrong, it should be 300 in it" |
| D20 | **Begin SOP-03** (End-of-Day Close & Deposit Bag). The summary report must preview the next SOP. | "Please begin sop 3. In the summary report let me know what the next sop will entail." |

---

## Owner reply after SOP-03 + request for SOP-04 (recorded verbatim, Slice SOP-04, after SOP-03 merged as 5299660b)

> Thank you! Q-03-1- only over $5. Q-03-2- the manage float should be 300. The sales registers float should be 167.5. Q-03-3- yes, that is correct. Q-03-4- no second count at night, just the recount in the morning by any employee. A-03-5- anyone can seal the bag, I am the only one to take cash to the bank. Q-03-6- yes I plan on using tamper evident pre-numbered bags. Q-03-7- warning only please. Please proceed with sop-04, receiving. Please make sure to include the monthly CCRS public record request to ingest the states data for the benchmarks. Please go slow and be meticulous, this is a major branch of my operation. I want this sop to be extremely well explained and detailed set of procedures. Go above and beyond.  Follow the standing rules. Thank you.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D21 | **A written over/short reason is required only when the difference is over $5.00** (resolves Q-03-1, and the open half of Q-02-3 / D16). This replaces the "every non-zero difference" reading recorded in D16 and used in SOP-01 §4.30, SOP-02 §4.8 and SOP-03 §4.7. Differences of $5.00 or less are still written on the slip; no reason is required. Applies to till closes and master till counts (D16). | "Q-03-1- only over $5" |
| D22 | **Confirms D19.** Manager Till (manager register) float **$300.00**; each of the two sales register floats **$167.50** (resolves Q-03-2). | "the manage float should be 300. The sales registers float should be 167.5" |
| D23 | **Overnight, last night's counted deposit sits unsealed in the store safe until the morning recount** (resolves Q-03-3; SOP-03 §4.6 confirmed). | "Q-03-3- yes, that is correct" |
| D24 | **No second count at night.** One person completes the night sheet; the **morning recount by any employee** is the second count (resolves Q-03-4; SOP-03 §4.5/§4.10 confirmed). This is the deposit count only. D2's second-person sign-off at **till close** (SOP-01) is a separate control and is unchanged. | "no second count at night, just the recount in the morning by any employee" |
| D25 | **Any employee may seal the bag. Only the owner takes cash to the bank** (resolves Q-03-5). | "anyone can seal the bag, I am the only one to take cash to the bank" |
| D26 | **Tamper-evident, pre-numbered deposit bags will be used** (resolves Q-03-6; SOP-03 §3 assumption confirmed, "plan on" means it is being adopted). | "yes I plan on using tamper evident pre-numbered bags" |
| D27 | **When the deposit-bag screen is built, an undeclared bag gives a warning only and does not block the till close** (resolves Q-03-7; G-04 requirement 6). This departs from the books-98 design (`blockCloseForUndeclaredBags`, `safe-bag-core.ts` L212–226), which blocks. | "Q-03-7- warning only please" |
| D28 | **Begin SOP-04 Receiving.** It must include the **monthly CCRS public records request** that brings the state's data in for the **benchmarks**. Standard for this slice: slow, meticulous, extremely well explained and detailed, above and beyond. Receiving is "a major branch of my operation". | "Please proceed with sop-04, receiving. Please make sure to include the monthly CCRS public record request to ingest the states data for the benchmarks. Please go slow and be meticulous, this is a major branch of my operation. I want this sop to be extremely well explained and detailed set of procedures. Go above and beyond." |

## Owner reply after SOP-04 + request for SOP-05 (recorded verbatim, Slice SOP-05a, after SOP-04 merged as ac251766)

> thank you! Q-04-1- we need a way to accept less than what came in, please add this to the list of serious issues to fix. Q04-2- no, only managers will process manifests. Q04-3- no second count required, it should be highly suggested, especially for new vendors we havent received from before. Q04-4- only admin will file monthly requests, on the 10th of the month. yes it should be a standing monthly request, and I use the built in text provided in the ccrs benchmark page. it should be updated to include the month requested with a drop down for selecting a month or several months. so I dont have to change the text before sending the request. Q04-5- delete after 18 months, I think this is long enough right? what is the enterprise grade solution for this. I want to do what the pros do. Q04-6- delete should as "are you sure", I am not sure about the generate vendor leads or enrich kb. what do you mean by this? if there is an enterprise grade professional solution, just go with it. please proceed with the next SOP, inventory management. I want you to break this one up into two slices. commit work often out of the sandbox, it is unstable. protect the work. follow the standing rules and never guess. go above and beyond. thank you.

Follow-up from the owner, sent during the same slice:

> Sorry to stop you. When making a multi month request, each month is sent as its own zip file. So I can only upload one months zip file at a time. Please continue. Follow the standing rules. Thank you.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D29 | **Receiving less than what was shipped (a partial-quantity receive) must be built, and it is on the owner's list of serious issues to fix** (resolves Q-04-1). Gap G-16 becomes **APPROVED**. Finding F-04-1 is re-rated **S2 → S1** at the owner's direction. That fits the S1 definition (data integrity): the state's CCRS record and the shelf must agree on what was received. Until it is built, SOP-04 §4.11 (refuse the whole short line) stays in force. | "Q-04-1- we need a way to accept less than what came in, please add this to the list of serious issues to fix" |
| D30 | **Only managers process manifests** (resolves Q-04-2). No receiver-level Receiving access will be built. The Receiving screens stay on `inventory.manage` (owner, admin, manager; `roles.ts` L107), which is how it works today. *My reading, to be confirmed in Q-04-7:* a manager is responsible for every manifest, and another trained employee may help with the physical count. The manager makes every decision on screen and presses Finalize. | "Q04-2- no, only managers will process manifests" |
| D31 | **A second count at the dock is not required, but it is highly suggested, especially for a vendor Greenway has not received from before** (resolves Q-04-3). SOP-04 §4.9 and form 8.1 now say "strongly recommended; expected on a first delivery from a vendor". The app has no first-delivery marker today (searched `intake`, `inventory`), so form 8.1 asks the question on paper (gap G-21). | "no second count required, it should be highly suggested, especially for new vendors we havent received from before" |
| D32 | **Monthly CCRS public records request** (resolves Q-04-4): **(a)** only the **admin** files it; **(b)** it is filed on the **10th of each month**; **(c)** the owner wants it to be a **standing monthly request**; **(d)** the owner uses the **built-in text on the CCRS Benchmarks page** (`discovery/ccrs/page.tsx` L32–36). That is the proven wording, which resolves the "April/May wording" half of F-04-18. **(e)** The text should be updated with a **month drop-down that can select one month or several**, so the request needs no editing before sending (gap G-18 → **APPROVED** for this part); **(f)** in a multi-month request, **the WSLCB sends each month as its own zip**, so zips are uploaded **one month at a time**. That fits the code: each upload is labelled `CCRS monthly · YYYY-MM` from its dominant sales month (`aggregate.ts` L2347–2368; `discovery/actions.ts` L842–845). On (c), see the note under this table. | "only admin will file monthly requests, on the 10th of the month. yes it should be a standing monthly request, and I use the built in text provided in the ccrs benchmark page. it should be updated to include the month requested with a drop down for selecting a month or several months. so I dont have to change the text before sending the request" · "When making a multi month request, each month is sent as its own zip file. So I can only upload one months zip file at a time." |
| D33 | **Benchmark datasets are kept for 18 months, then deleted. Delete them the professional way: a written retention rule, carried out automatically, with notice, a hold and an audit trail** (resolves Q-04-5). Requirements are in gap G-20 (**APPROVED**). The analysis behind it is in the note under this table. | "Q04-5- delete after 18 months, I think this is long enough right? what is the enterprise grade solution for this. I want to do what the pros do." |
| D34 | **Delete must ask "are you sure?". For Generate vendor leads and Enrich KB, the owner delegated the call: "if there is an enterprise grade professional solution, just go with it."** (resolves Q-04-6). The professional solution adopted: **(a)** a delete confirmation that names the month and is **typed**, with the delete moved to the admin tier; **(b)** **show only the buttons that work for the kind of dataset**. On a monthly-zip card, **Compute benchmarks**, **Generate vendor leads** and **Enrich KB** are hidden and replaced by a pointer to **Draft vendor leads from these suppliers**. On a legacy CSV card they stay. Gap G-20 (**APPROVED**). What the two buttons do is in the note under this table. | "delete should as \"are you sure\", I am not sure about the generate vendor leads or enrich kb. what do you mean by this? if there is an enterprise grade professional solution, just go with it." |
| D35 | **Begin SOP-05 Inventory Management, split into two slices** (SOP-05a and SOP-05b). **Commit and push work often** to protect it from the sandbox: every working step is pushed to the slice branch on GitHub before the next one starts. The standard stays: never guess, above and beyond. | "please proceed with the next SOP, inventory management. I want you to break this one up into two slices. commit work often out of the sandbox, it is unstable. protect the work. follow the standing rules and never guess. go above and beyond." |

**Note on D32 (c), the "standing request" (sourced, not guessed).** Washington's model rules on the Public Records Act say: *"An agency must only provide access to public records in existence at the time of the request. An agency is not obligated to supplement responses. Therefore, if a public record is created or comes into the possession of the agency after the request is received by the agency, it is not responsive to the request and need not be provided. A requestor must make a new request to obtain subsequently created public records."* (WAC 44-14-04004(4), https://apps.leg.wa.gov/WAC/default.aspx?cite=44-14-04004). So the WSLCB **does not have to** honor a request for future months. The professional answer makes the monthly request automatic on Greenway's side, so it costs the admin about two minutes:
1. A recurring task on the 10th.
2. The built-in text with the month already filled in by the drop-down (G-18).
3. One click to copy.
4. A tracking-number field.

SOP-04 v1.1 also tells the admin to **ask the WSLCB once** whether they will accept a recurring request. If they agree, the 10th becomes a check that the month arrived instead of a filing. Either way, the reminder and the log stay.

**Note on D33, "is 18 months long enough?" (analysis).**
- **Yes, for what the data is used for.** 18 months always holds 12 months plus 6. Every month in the most recent half-year can be compared with **the same month last year** (seasonality: holidays, 4/20, summer), and the month-over-month trend (`benchmarks-history-core.ts`) has a year and a half to draw on.
- **Cost of deleting.** A deleted month disappears from the trend lines and from the "first appearance" check in supplier history (`supplier-history-core.ts` L7–28). So the cutoff should be a firm rule, not an ad-hoc click.
- **Legal view (my reading, not legal advice).** The five-year rule in WAC 314-55-087(1) covers Greenway's **own** business records: its purchase invoices, inventory, sales and transport records (https://apps.leg.wa.gov/WAC/default.aspx?cite=314-55-087). The benchmark datasets are statewide market data obtained under the PRA, so that rule does not appear to apply to them. Greenway's own receiving records (manifests, lots, the truck-day sheet) stay five years and are **not** touched by this rule.
- **"What the pros do"** (records-management practice, built into G-20):
  1. A written retention schedule: what is kept, for how long, counted from what date (the end of the data month).
  2. Deletion that happens automatically on schedule, not by memory.
  3. Advance notice (30 days) on the page before a month is removed.
  4. A **hold** flag the owner can set to keep a month past 18 months.
  5. An audit record of every deletion (who or what, which month, when).
  6. The raw zip kept outside the app on the **same** 18-month schedule, so copies don't outlive the rule.
  7. **Recommended option, not decided (Q-04-8):** keep the tiny month-level summary (one row of headline numbers per month) longer, so long-run trend lines survive while the detail is purged.

**Note on D34, "what do Generate vendor leads and Enrich KB mean?" (verified in code).** Both buttons belong to the **old** upload path, where the separate CSV files were uploaded one by one. They read tables that only that path fills:
- **Generate vendor leads** takes the top 50 wholesale sellers from `discovery_ccrs_licensees` and adds them to the Leads page as draft vendor leads (`discovery/actions.ts` L632–653; `benchmarks.ts` L365–432). That table is filled only by **Compute benchmarks** on an old-style CSV dataset (`benchmarks.ts` L298–309). **Compute benchmarks** refuses monthly zips (`actions.ts` L598–609).
- **Enrich KB** copies brand and product facts from `discovery_ccrs_products` into the knowledge base as drafts (`enrich-from-discovery.ts` L134, L261–). That table is filled only by the old CSV upload (`ingest.ts` L148), and that upload **already runs Enrich KB by itself** (`discovery/actions.ts` L549–583).
- **The monthly zip writes neither table** (it writes benchmarks, competitor, supplier, producer, days-on-hand and market-signal tables; `market-rollups.ts`). So on a monthly card **both buttons run and do nothing.** That is finding F-04-15.
- **The working equivalent:** **Draft vendor leads from these suppliers** on the Leads page (Market movers), which reads the monthly zip's supplier data (`DraftSupplierOutreachButton.tsx` L42; `discovery/actions.ts` L663–).
- **Why the professional fix is to show only working actions:** a button that silently does nothing teaches people to distrust the screen.

### Open questions raised by slice SOP-05a (awaiting the owner's words)

Asked in `docs/sop/SOP-05a-inventory-core.md` Appendix C. Each has an interim rule in that SOP until the owner answers; none is decided here.

| # | Question (short form) | Interim rule |
|---|---|---|
| Q-05a-1 | May Greenway sell product past its expiry or best-by date? Block or warn at the register? | Expired = not for sale: pull, quarantine, owner decides (SOP-05a §4.16) |
| Q-05a-2 | Who is the recall coordinator, and the back-up? | The owner; the on-duty manager in the owner's absence |
| Q-05a-3 | May a manager key a cannabis unit cost through Bulk fill? | Owner or admin only |
| Q-05a-4 | Remove Receive, Destruction and Recall removal from the adjustment reasons, and add Theft and Seizure? | Never use those three reasons |
| Q-05a-5 | Should an 86 stay until a manager restores it? | The manager checks every 86 the same shift |

---

## Owner reply after SOP-05a + request to finish SOP-05 (recorded verbatim, slice SOP-05b, after SOP-05a merged as 85dd6654)

> Thank you. Please finish the inventory management sop. Q-05a-1- hard block edibles and liquid edibles, warnings for everything else. Q-05a-2- admin. No back up. Just my manager and I. Q-05a-3- absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor. Q-05a-4- remove receive, for destruction and recall, how should it work on the lot detail page when using the destructions manager page in the back office? Should the destructions page handle marking those fields automatically? Add theft and seizure. Q-05a-5- what is an 86? I forget. Do the enterprise grade solution, the professional method. We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary. I want to upgrade the concierge to use all features including future ones we will build after the sop is finished. Follow the standing rules. Thank you.

Follow-up from the owner, sent during the same slice:

> sorry to stop you. i had another agent commit, push and merge work to the repo to help make the back office more responsive. please continue. follow the standing rules. thank you.

That merge (13 `perf(admin)` commits plus a test commit, ending at `827facb5`) moved the register files to `src/app/(site)/pos/`, added 6 lines to `inventory/page.tsx` after L280, and added 20 lines to `session.ts`. Every SOP pin into those files was re-checked against the code and moved (commit 250636ae). No behaviour that an SOP describes changed: the inventory page now starts two reads earlier, and sessions are cached per request. The labels, buttons, gates and messages are unchanged.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D36 | **Expired product at the register** (resolves Q-05a-1). An expired **edible** or **liquid edible** is **hard-blocked**: it cannot be sold, and there is no override. **Every other expired product gets a warning.** Gap G-24 becomes **APPROVED**. *My reading, to be confirmed in Q-05a-6:* "edibles and liquid edibles" means the CCRS inventory types **Solid Edible** and **Liquid Edible** (`ccrs-batch-core.ts` L250, L253). The open point is whether **Tincture**, **Capsule** and low-THC beverages count too. The code puts tinctures in the liquid-edible sales-limit bucket (`sales-limits-core.ts` L364–366). Until it is built, SOP-05a §4.16 uses a paper rule that follows this decision. | "Q-05a-1- hard block edibles and liquid edibles, warnings for everything else." |
| D37 | **The recall coordinator is the admin. There is no back-up.** (resolves Q-05a-2). The recall team is the owner and the manager. Form 8.4 drops the back-up line. Releasing a recall hold and notifying the LCB are the coordinator's job. *My reading, to be confirmed in Q-05a-7:* a manager may still **place** a recall hold, because that only protects customers. | "Q-05a-2- admin. No back up. Just my manager and I." |
| D38 | **Nobody keys a cannabis unit cost, ever** (resolves Q-05a-3). **The cost comes only from the vendor's CCRS manifest.** The code already takes it from the manifest line (`line_price ÷ qty`, `intake-parser.ts` L415–420) and locks it on the lot page (`lot-edit-core.ts` L33–45: `unit_cost_minor_units` is in `LOCKED_LOT_FIELDS`, L38). **Bulk fill → Unit cost** on cannabis lots is the one place it can still be typed (`bulk-fill-core.ts` L54). Finding F-05a-11 is re-rated **S3 → S1** at the owner's direction ("That's illegal"). New gap G-27 (**APPROVED**) removes it. A cannabis lot with no cost stays blank and is corrected from the manifest, never typed. | "Q-05a-3- absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor." |
| D39 | **Adjustment reasons on the lot page** (resolves Q-05a-4). **Remove Receive (add). Add Theft and Seizure.** The CCRS mapping for both already exists (`ccrs-inventory-adjustment-core.ts` L87–90). The owner asked how destruction and recall should work. **Answer (verified in code, recommended, Q-05a-8):** yes, Returns & Destruction should do it automatically, and in large part it already does. Scheduling moves the lot to Quarantine (`disposition.ts` L968–974). Completing posts the CCRS **Destruction** adjustment, which is atomic and cannot go below zero (L1050, L233–282), and sets **Destroyed** when the lot is empty (L1087–1095). Each step writes an audit row (`disposition/actions.ts` L185, L226, L251). So **Destruction** and **Recall removal** come off the lot page's reason list, and the lot page gets a **Schedule destruction** link to that page instead. Three defects stand in the way and are recorded as findings: **F-05a-17**, the destruction form lists only Active lots, so a Recalled or quarantined lot cannot be chosen (`disposition/page.tsx` L107); **F-05a-18**, scheduling overwrites **Recalled** with **Quarantine**, which lifts the register hold; **F-05a-19**, Cancel always sets the lot back to **Active** (`disposition.ts` L1189–1190). Gap G-23 is **APPROVED** for the reason changes, and gap G-28 is new. | "Q-05a-4- remove receive, for destruction and recall, how should it work on the lot detail page when using the destructions manager page in the back office? Should the destructions page handle marking those fields automatically? Add theft and seizure." |
| D40 | **The 86** (resolves Q-05a-5). It is answered in plain words in SOP-05a §4.12: **"86" is restaurant slang for "take it off the menu, we're out."** At Greenway it is the register link *"Shelf is empty? Mark out of stock…"* (`(site)/pos/SaleFlow.tsx` L4277). It has three reasons: shelf empty, damaged / unsellable, and wrong listing (`stock-flag-core.ts` L31). **The owner directed the professional method:** an 86 stays until its cause is cleared. The design is in gap G-26, now **APPROVED**. | "Q-05a-5- what is an 86? I forget. Do the enterprise grade solution, the professional method." |
| D41 | **The SOPs are living documents. When the app is fixed, the SOP is updated.** Every gap names the SOP sections it changes (the gap register's **SOP** column). Building a gap now includes revising those sections, adding a revision-history row and updating the concierge entry. Every SOP carries a reminder line (charter §3 rule 9). | "We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary." |
| D42 | **The concierge is upgraded to cover every feature, including future ones, once the SOP program is finished.** This is recorded as a program requirement (charter §3 rule 10; concierge ledger). Every SOP's concierge rows are the starting content. Any feature built later is not finished until its concierge entry exists. | "I want to upgrade the concierge to use all features including future ones we will build after the sop is finished." |
| D43 | **Finish SOP-05** (slice SOP-05b: non-cannabis, merch, menu publishing, classification and sell price), following the standing rules. | "Please finish the inventory management sop." · "Follow the standing rules." |

**Note on D40, the professional 86 (the method adopted in G-26).** The code's own design note names Toast's *"Quick Edit / 86 it"* as the model (`stock-flag-core.ts` L4). The professional method is to treat an 86 as an **exception with an owner and a cause**, not as a switch. That is the same discipline as the store's other holds (recall, quarantine). Greenway's 86 does not do these four things yet:
1. **The reason decides how it comes back.** **Shelf empty** clears itself only when **new stock is received** for that product. If the books show units but the shelf is empty, that is a counting difference: it becomes a **count task** (SOP-06), and the item stays off until the count is done. **Damaged / unsellable** and **wrong listing** never clear on their own. A manager clears them after disposing of the product (SOP-15) or fixing the listing.
2. **One queue.** Every open 86 appears in one list on Inventory → Issues, with who pressed it, when and why. The manager works the list every shift.
3. **A restore needs a manager and a reason,** and it is audited. That is the same rule as the current **Restore to sale** button (`restore-to-sale-store.ts`), extended to every 86.
4. **The 86 also takes the item off the website and online ordering.** The register 86 already does this today: it sets the published menu item to unavailable.

Today the app restores an 86 automatically whenever Active units are on file (`register-availability-core.ts` L318–421, finding F-05a-9), which is why point 1 needs building.

---

## Owner reply after SOP-05b + request for SOP-06 (recorded verbatim, fix slice and slice SOP-06, after SOP-05b merged via PR #1520)

> thank you! Q-05a-6- yes, same with rso too. Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system and on the register and on the menu. Q-05b-2- owner, admin, manager. Q05b-3- owner and admin. Q05b-4- refused outright, non cannabis should also be refused outright moving them into a cannabis type. non cannabis should be allowed to have their cost modified. Q-05b-5- yes, plan on the group of smaller fixes. blocked until the manifest cost is entered. for the next round, the inventory audits is specifically meant for owner only. the cycle counts and daily checklists are for all employees, admin, manger, sales. i want a very comprehensive sop written for me for setting up and pushing audits to the cycle counts page. please proceed with the next sop. complete all work before reporting back with a summary report. same as always, record all issues for future fixing, record all missing info for the concierge to be added. go above and beyond. follow the standing rules and never guess. thank you.

Follow-up from the owner, sent before SOP-06 began:

> sorry to stop you. I had another agent do more speed optimization on the back office. it was just way too slow. so main has moved a few times again. also, your last merge to git failed compliance. before you start this new sop, please fix the issues from last slice so it can be fully merged to main. after you have fixed the issue, push and merge. then begin sop-06. follow the standing rules. thank you.

### The compliance failure, and what was done (fix slice)

- **What failed.** The CI step `verify-commit-authorship.ts` (workflow `.github/workflows/compliance-tests.yml`) rejected two SOP-05b commits, `0b934d82` and `277e2a04` (on main as `700eec8d` and `1fd6f535`). Their author was `root@172.28.19.208`, not the project identity. **Cause:** a fresh sandbox shell had no git `user.email`, so git made one up from the machine name. The content of the commits was correct; only the author stamp was wrong.
- **Why main's history was not rewritten.** The two commits are already on `main`, and ten speed-up commits by the other agent sit on top of them (`827facb5..e1fe84eb`). Rewriting them would mean force-pushing over that work. The authorship check reads only the commits a pull request adds (`git merge-base origin/main HEAD`..`HEAD`), so commits already on main are not checked again. This was confirmed by running the check locally against main (*"no new commits to check"*).
- **Prevention.** The git identity is now set (global and repository) to the project identity. Two local hooks were added in the sandbox: one refuses a commit under any other identity, and one refuses a push that carries one. A new charter rule records it (charter §3 rule 11).
- **The re-pin.** The speed-up merge moved lines in `src/lib/inventory/store.ts` (+13 lines above `createAdjustment`), `src/lib/compliance/ccrs-batch.ts` (the live-lots read is now a paged wave, L1196–1207) and `src/lib/inventory/register-sellability-store.ts` (+13). Every SOP pin into those files was re-checked against the code at `main@e1fe84eb` and moved. Pins into files the merge did not touch were left alone, after checking (for example `discovery/ccrs/page.tsx`, `noncannabis/store.ts` and the Registers page are unchanged). No behaviour an SOP describes changed.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D44 | **The expiry hard block covers Solid Edible, Liquid Edible, Tincture, Capsule and RSO** (resolves Q-05a-6). Every other expired product gets a warning (D36). **Code fact that shapes G-24:** RSO has no CCRS type of its own; it is filed as **Concentrate for Inhalation** (`fact-extraction-core.ts` L890–894) and is the store category `rso` (migration `0035_inventory_category_types.sql` L103), counted in the concentrate limit bucket (`sales-limits-core.ts` L358). A block keyed only on the CCRS type would miss RSO, so G-24 keys on the store category as well (finding F-05a-20). | "Q-05a-6- yes, same with rso too." |
| D45 | **G-29 is APPROVED and widened**: every upgrade needed so non-cannabis goods are fully used in the system, on the register and on the menu. That includes the register scan and sale decrement (F-05b-1), cost of goods on keypad sales (F-05b-15), menu presence, voids, returns and reports. **G-32 (the group of smaller fixes) is APPROVED.** | "Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system and on the register and on the menu." · "Q-05b-5- yes, plan on the group of smaller fixes." |
| D46 | **Owner, admin and manager may change a non-cannabis price and cost** (resolves Q-05b-2; G-30 APPROVED). Whether this also widens the existing **Save cost** permission (owner and admin, from the earlier decision D-R3-1 cited at `roles.ts` L144–149) is not assumed; it is asked as Q-05b-6. | "Q-05b-2- owner, admin, manager." |
| D47 | **Only the owner and the admin may Remove a merch product** (resolves Q-05b-3). The app lets a manager do it today (`merch/actions.ts` L34, `inventory.manage`), so this is finding F-05b-14 and gap G-30A. | "Q05b-3- owner and admin." |
| D48 | **A cannabis-line crossing is refused outright, in both directions, with no override** (resolves Q-05b-4; G-31 APPROVED). Cannabis never into a non-cannabis category; non-cannabis never into a cannabis category or type. **Non-cannabis cost may be modified** (unlike cannabis, D38). | "Q05b-4- refused outright, non cannabis should also be refused outright moving them into a cannabis type. non cannabis should be allowed to have their cost modified." |
| D49 | **A cannabis sell price cannot be saved on a cost-unknown lot until the manifest cost is entered** (resolves the choice in Q-05b-5; part of G-32). Nobody, the owner included, sets a price on such a lot. | "blocked until the manifest cost is entered." |
| D50 | **Inventory Audits are owner only.** | "the inventory audits is specifically meant for owner only." |
| D51 | **Cycle counts and daily checklists are for every employee: admin, manager and sales (budtender).** | "the cycle counts and daily checklists are for all employees, admin, manger, sales." |
| D52 | **SOP-06 is a very comprehensive SOP on setting up audits and pushing them to the Cycle Counts page**, written after the fix is merged, with every issue recorded for future fixing and every missing concierge item recorded, going above and beyond, never guessing. | "i want a very comprehensive sop written for me for setting up and pushing audits to the cycle counts page." · "before you start this new sop, please fix the issues from last slice" · "go above and beyond. follow the standing rules and never guess." |
| D53 | **Fix the failed compliance merge first, push and merge, then begin SOP-06.** | "before you start this new sop, please fix the issues from last slice so it can be fully merged to main. after you have fixed the issue, push and merge. then begin sop-06." |

### Applied in slice SOP-06

- **D50, D51, D52 applied** in `docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md` v1.0 (verified at `main@c976c7e4`): §2 roles table, the owner-only set-up (§4.4–§4.7, §4.13–§4.19) and the every-employee count and checklists (§4.8–§4.12, §4.23, forms 8.5–8.7).
- **What could not be honoured in the app, recorded rather than guessed:** the push to the Cycle Counts page (*"i want a very comprehensive sop written for me for setting up and pushing audits to the cycle counts page"*) has no control today (F-06-1, gap G-33); SOP-06 §4.7 gives the paper interim.
- **New open questions for the owner:** Q-06-1 (auto-start counting on first entry?), Q-06-2 (may a counter press "I'm done"?), Q-06-3 (enforce a different person for the second count?), Q-06-4 (daily checklist tasks), Q-06-5 (which count schedule), Q-06-6 (cancel the old open sessions and held paper-interim audits?), Q-06-7 (+1 per scan?), Q-06-8 (standard counting hours). Listed in SOP-06 Appendix C.

---

## Owner reply after SOP-06 + request for SOP-15 (recorded verbatim, slice SOP-15, after SOP-06 merged via PR #1525)

> Thank you. Q-06-1- if you mean when I create an audit does it post to the cycle counts page automatically or by button press after creating the scoped audit? I am not sure, what is the enterprise grade approach? Please do what the pros would do. Q-06-2- yes, pressing I'm done should sent the cycle count back to the inventory audit page linking back to the one that initiated the count. It should notify me in the main /admin cockpit command center. Q-06-3- what second count? I am not sure I understand. I am the only one who will initiate a cycle count. Any employee may count inventory. Only one employee per scoped count. Q06-4-again I am not sure what is already included, if anything. Tasks should include cleaning, organizing, stocking, marketing content like website banners, flyers, newsletters, blog posts, social media posts, in store content, yard banners, inventory management like product enrichment, making sure products get heavily discounted before expiring. Plus any other small retail business daily duties that you think ought to be included as well. Use your professional expert judgement when adding value there. Q-06-5- we do a full inventory audit once per year at the end of the year. My plan for cycle counts is to issue small counts the employees can do everyday to keep inventory accurate. Something like a vendor per day, broken into chunks if a large vendor, or if small enough, to do on their own. The system should be smart enough to know that when they start the count and finish it, the sales in between should be reconciled. Or something along those lines that an enterprise grade solution would implement. I also want options for initiating intelligent cycle counts. Q-06-6- be canceled, we are not live yet. It's all test data. A-06-7- yes. Q-06-8- anytime during open hours. Please proceed with the next sop, returns and destructions. Again, make sure the ai concierge is taught all the things we will build and fix in the future, so it's preemptively prepared. We will rarely use these features, but they are necessary for our industry so we must have them and do them properly and accurately. Follow the standing rules. Thank you.

### What the professionals do (research behind D54, D58 and D61)

The owner asked twice for *"what the pros would do"* and *"something along those lines that an enterprise grade solution would implement."* Two systems were read at their vendor documentation; nothing below is from memory.

- **Oracle NetSuite, Inventory Count** (docs.oracle.com, NetSuite Online Help, section N2299731). A count is created, then **started** by a separate action, then counted, then **completed**, then approved or rejected. *"When you click Start on an Open status inventory count, NetSuite takes a snapshot of the on-hand count of the items to be counted."* *"Until an inventory count is completed, you cannot start a new inventory count for that item."* *"You cannot edit quantities or results of a count in Completed/Pending Approval status."* A rejected count returns to **Started** (counting).
- **Lightspeed Retail (R-Series), Inventory counts** (retail-support.lightspeedhq.com, article 229129948). *"Once at least one unit of an item has been counted, the QOH for the item will be recorded. When the inventory count is reconciled, differences between the recorded quantity and QOH will be taken into account."* *"Scan the same item multiple times to increase the counted quantity."* *"Sales or added inventory don't change a discrepancy."* *"If an item is partially counted, don't sell any uncounted units."*
- **The pattern both share:** (1) creating a count and releasing it to the floor are **two separate acts**; (2) the system's quantity is **snapshotted when counting starts**, not when the count is planned (Lightspeed goes further: per item, at the first unit counted); (3) the difference is *count − snapshot*, so sales and receipts after the snapshot **do not** create a false difference; (4) after the counter finishes, quantities lock and the reviewer approves or sends it back to counting; (5) one open count per item at a time.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D54 | **An audit reaches the Cycle Counts page only when the owner presses a release button after creating it** (resolves Q-06-1; G-33 **APPROVED**). This is the enterprise pattern: creating (planning) and releasing are separate acts (NetSuite *Start*), so the owner can review the scope before anyone sees it. The button is **Release to Cycle Counts**; it signs the release (who and when). The audit then shows on Cycle Counts as **ready to count**. It becomes **being counted** when the counter claims it and records the first lot (D56). The quantity snapshot is taken **per lot at the moment that lot is first counted**, not at creation and not at release (D58, Lightspeed). | "Q-06-1- … does it post to the cycle counts page automatically or by button press after creating the scoped audit? I am not sure, what is the enterprise grade approach? Please do what the pros would do." |
| D55 | **The counter's I'm done sends the count back to Inventory Audits, linked to the audit that started it, and notifies the owner in the /admin cockpit** (resolves Q-06-2; G-34 **APPROVED**). I'm done is enabled only when no lot is blank. It moves the audit to **in review**, removes it from Cycle Counts, locks the counts (NetSuite: no edits after Completed), and adds a **Needs your attention** item on the /admin cockpit (`src/app/admin/page.tsx` L249–251, built from `buildAttentionFlags`, `cockpit-core.ts` L138) that links straight to that audit's review page. The owner's **Send back to counting** reopens it (NetSuite *Reject*). | "Q-06-2- yes, pressing I'm done should sent the cycle count back to the inventory audit page linking back to the one that initiated the count. It should notify me in the main /admin cockpit command center." |
| D56 | **One employee per scoped count; the owner alone initiates; any employee may count. No second-person count.** (resolves Q-06-3). The "second count" in SOP-06 v1.0 was the app's automatic blind **recount** of a lot that is off by $50 or more (`inventory-audit-core.ts` L767–771). With one counter per count, the "ideally a different person" text is withdrawn. **Design (G-36, APPROVED):** the first employee to open a released count **claims** it (their name shows on Cycle Counts; nobody else can enter numbers); the automatic recount request becomes a **recount by the same counter before I'm done**, and if the owner wants a fresh count by someone else, the owner **sends the lot back** or plans a new audit (owner-initiated re-count). Today nothing enforces one counter: the sheet stores `counted_by` per line (`audit-hub-store.ts` L924–927) but accepts entries from anyone with `inventory.count` (finding F-06-15). | "Q-06-3- what second count? I am not sure I understand. I am the only one who will initiate a cycle count. Any employee may count inventory. Only one employee per scoped count." |
| D57 | **The daily checklists carry a full small-retail task catalog** (resolves Q-06-4; G-38 **APPROVED**): cleaning, organizing, stocking, marketing content (website banners, flyers, newsletters, blog posts, social media posts, in-store content, yard banners), inventory management (product enrichment; heavy discounts before expiry), plus professional additions chosen with expert judgement (security and cameras, ID checks, cash, compliance signage, online orders, safety, customer experience). Written into SOP-06 v1.1 forms 8.5–8.8. Every line names its SOP section, or says *owner-directed (D57)* when it is a store task no SOP covers yet. | "Tasks should include cleaning, organizing, stocking, marketing content like website banners, flyers, newsletters, blog posts, social media posts, in store content, yard banners, inventory management like product enrichment, making sure products get heavily discounted before expiring. Plus any other small retail business daily duties … Use your professional expert judgement when adding value there." |
| D58 | **Counting programme: one full wall-to-wall audit a year at year end; small daily cycle counts in between; sales during a count are reconciled automatically; intelligent generators to propose counts** (resolves Q-06-5). (a) **Annual**: a full count of every lot at the end of the year (new gap G-41). (b) **Daily**: about **one vendor per day**; a large vendor is split into chunks one employee can finish in a session; a small vendor is one count. (c) **Reconciliation** (G-35 **APPROVED**): each lot's books quantity is snapshotted when that lot is first counted, and the difference is *count − snapshot*; sales or receipts between the start and I'm done are listed per lot for the owner but do **not** change the difference (Lightspeed: *"Sales or added inventory don't change a discrepancy"*). (d) **Intelligent cycle counts** (new gap G-40): owner-selectable generators: vendor of the day (rotating), ABC value classes, exceptions (oversold, negative or zero-with-sales, recent adjustments, 86s), expiring soon, Cultivera-import flags, never counted / overdue; each proposes a scope that the owner releases (D54). (e) Q-06-5 asked which cadence: superseded by (b); the A/B/C cadences remain the risk ranking only. | "Q-06-5- we do a full inventory audit once per year at the end of the year. My plan for cycle counts is to issue small counts the employees can do everyday … a vendor per day, broken into chunks if a large vendor … The system should be smart enough to know that when they start the count and finish it, the sales in between should be reconciled … I also want options for initiating intelligent cycle counts." |
| D59 | **Cancel every old (legacy) cycle-count session and every held audit; there is no live data yet** (resolves Q-06-6; part of G-39 **APPROVED**). It is all test data, so nothing needs to be posted or preserved for the books. Cancel when G-33 adds Cancel (or as a one-time data cleanup with an audit row, at the owner's direction, during the build). | "Q-06-6- be canceled, we are not live yet. It's all test data." |
| D60 | **Each scan adds one package to the lot's count** (resolves Q-06-7; part of G-36). The counter scans every package; the count is the number of scans; typing a total stays available for a label that will not scan. | "A-06-7- yes." |
| D61 | **Counting is allowed any time during open hours** (resolves Q-06-8). This is safe **only** once G-35 is built (snapshot per lot at first count). Until then the v1.0 timing rule stays in force (count outside selling hours, never post if anything in scope sold), because today a mid-count sale is subtracted twice (F-06-7, S1). SOP-06 v1.1 §4.11 says both. | "Q-06-8- anytime during open hours." |
| D62 | **Write SOP-15 Returns to Vendor & Destruction next, following the standing rules, and teach the concierge every future build and fix ahead of time.** These features are rarely used but legally required, so the SOP and the concierge must be exact. | "Please proceed with the next sop, returns and destructions. Again, make sure the ai concierge is taught all the things we will build and fix in the future, so it's preemptively prepared. We will rarely use these features, but they are necessary for our industry so we must have them and do them properly and accurately. Follow the standing rules." |

### Applied in slice SOP-15

- **D54–D61 applied** in `docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md` **v1.1**: §2 rule 3, §3, §4.7, §4.8 step 5, §4.10 step 4, §4.11, §4.12, §4.20, §4.22, §4.23, new §4.24, forms 8.5–8.7 rewritten and new form 8.8, §9, Appendices B–D. Gaps G-33, G-34, G-35, G-36, G-38, G-39 **APPROVED**; new **G-40** (intelligent cycle counts) and **G-41** (annual full count). New findings F-06-15 (one counter not enforced), F-06-16 (no cockpit item), F-06-17 (no clearance-markdown screen). Concierge ledger: SOP-06 v1.1 teaching table.
- **D62 applied** in `docs/sop/SOP-15-returns-vendor-destruction.md` v1.0 (this slice), verified at `main@b8101abb`. It covers customer-return disposition, vendor returns, scheduled destruction, recall coordination and cancel/status restore. Findings F-15-1…F-15-17 and F-15-C are in `03-FINDINGS-LEDGER.md`; there are two S1: F-15-1 (a vendor return reduces on-hand before any manifest) and F-15-6 (a Destroy return goes into an Active, sellable lot). Gaps G-42…G-49 are PROPOSED and G-28 is extended in `05-GAP-REGISTER.md`. The concierge is taught today's behaviour and the behaviour once built (D41/D42/D62) in the SOP-15 section of `04-CONCIERGE-COVERAGE-LEDGER.md`. Paper interim: forms 8.1–8.6.

### Open questions raised by slice SOP-15 (awaiting the owner's words)

Asked in `docs/sop/SOP-15-returns-vendor-destruction.md` Appendix C. Each has an interim rule in that SOP until the owner answers; none is decided here.

| # | Question (short form) | Interim rule |
|---|---|---|
| Q-15-1 | Vendor returns: should logging only reserve the units, with stock coming off at pickup? (G-42) | Log the return only on pickup day, after the manifest exists (SOP-15 §4.12) |
| Q-15-2 | Who may witness a destruction? Is a budtender acceptable? | Manager, admin or owner only; never the person doing it |
| Q-15-3 | After G-28 is built, should recall destruction be allowed in the app only once the officer, the contact date and the direction are recorded? | Keep recalled lots out of the app (SOP-15 §4.21) |
| Q-15-4 | Remove the back-office Customer return wizard, or keep it as an owner-only exception tool? (G-45) | Owner only, with a written exception reason |
| Q-15-5 | Keep the destruction hold at 72 hours? | Keep 72 hours |
| Q-15-6 | Sample-pricing rules: enforce at the register and online, or remove the panel? (G-47) | Never sell samples |

**Answered** in the owner reply below (D63–D68).

## Owner reply after SOP-15 + request for SOP-08 (recorded verbatim, slice SOP-08, after SOP-15 merged via PR #1526)

> Thank you! Q1- I would like for you to deep research the proper CCRS method and procedures. It may not be up to us, I want to follow the states requirements. Q2- anyone may witness the destruction. It has to be done on camera as well. Double check the systems procedures match the states requirements with regard to destructions protocol. Q3- let’s not worry too much about recalls. If a product needs to be returned to the vendor, we will create a transfer back to the vendor. It’s rare we have a recall, in the past, it’s been the state requiring the vendor to reach out and request we transfer the product back. In which case we initiate a transfer. Let’s treat recalls like a transfer back to the vendor for now. Q4- remove it. Q5- reduce it to the minimum required by law. Look it up in CCRS please. Q6- I’m not sure what you are referring to, maybe it’s old legacy code? Samples go through receiving, are for employees only, have maximum amounts we can take in and give out. They have a .01 cost. They can not be sold at the register, they cannot be found on the menu. They go directly to the employee samples hub where they are distributed there. At that time they are reduced from inventory. Please make sure this is the correct logic in the code. We spent a ton of time following CCRS exactly as written. So I know our samples branch is damn near perfect already. Make sure you know what you are referring to before removing any panels. CCRS is clear about the process and we built it exactly to CCRS spec. If the panel truly does nothing because our system is properly set up to handle samples, then you may turn it off. But again, make certain you have read and understood it all. This is a big deal, we must treat samples accordingly. I want to skip CCRS reporting and uploads for now. We haven’t fully finished it, and soon, it will be completely automated. Same with the Leafly integration, I want to skip it for now. It’s connected to leaflys production system, it works automatically, I have tested each feature and all works perfect. We can skip everything related to the accounting branch, and anything related to the Lyman dropdown menu. The next major sop I want to work on is new hire onboarding, system management and off boarding employees. Please proceed with this sop next. Follow the standing rules. Thank you!

### What the state requires (research behind D63–D65 and D67)

The owner asked for *"the states requirements"* and to *"look it up in CCRS"*. Every point below was read from the state's own text on 2026-10-28. Nothing is from memory.

- **Returning product to a processor.** WAC 314-55-079(11) (eff. 7/1/26): *"A cannabis retailer may transport product to other locations operated by the licensee or to return product to a cannabis processor as outlined in WAC 314-55-085."* WAC 314-55-085(1): the shipper *"shall notify the WSLCB of the type and amount … name of transporter, information about the transporting vehicle, times of departure and expected delivery. This information must be reported in the traceability system"*. 085(3): *"A complete printed transport manifest on a form provided by the WSLCB … must be kept with the product at all times."* 085(5): only the licensee, an employee or a transport licensee may carry it; drivers 21 or older; sealed, unopened, locked compartment, direct route. 085(4): transport records kept three years. WAC 314-55-087: all records are kept five years.
- **The CCRS manifest.** The LCB's Manifest User Guide (10-27-2025) says: *"Transportation of product in the state of Washington requires submission of the official transportation manifest provided by the LCB."* The file is `manifest_LicenseNumber_YYYYMMDDHHMMSS`, and *"LicenseNumber in the file name must match OriginLicenseNumber"*. So **the retailer, as the origin, uploads the manifest**. *"Upon upload of a successful manifest file, an email will be generated with an attached PDF of the Manifest Report. The sending licensee, receiving licensee … will all receive confirmation emails."* It requires the driver, the vehicle, and estimated departure and arrival times. Items must be inventory already reported to CCRS. Contingency manifests are discontinued. **The LCB text states no lead time** (no "48–72 hours") and no Monday/Wednesday/Friday human confirmation: the confirmation is the automatic email and PDF. The 48–72 hour figure is a POS vendor's practice (POSaBIT), not law.
- **How the retailer's stock decrease is reported.** The CCRS Upload User Guide (2-26) lists the InventoryAdjustment reasons as Destruction, Reconciliation, Lost, Seizure, Theft and Other (Table 5). Table 5 has **no row for a return to a vendor**. The line *"Returned to seller → Other"* that our compliance doc cites is in **Table 4, DestructionReason**, which belongs to the producers' **plant destruction** file, not the InventoryAdjustment file. **Other** with a detail is still the best-supported encoding, but no LCB text says so for a retailer. This stays open in the CCRS register as **U-72** (examiner question), alongside **U-73** (the retailer files Manifest.csv as origin; the guide's file-name rule supports it).
- **Destruction.** WAC 314-55-097 (eff. 4/12/25): waste *"must be rendered unusable before leaving the licensed premises"*, by *"grinding the waste and mixing it with other ground materials so that the resulting mixture is at least 50 percent noncannabis waste by volume"*; other methods need prior LCB approval. *"Licensees must maintain records documenting the final destination and method of all cannabis waste rendered unusable."* **The current rule has no waiting period, no notice to the LCB and no witness requirement.** (The old 72-hour notice was removed by WSR 22-14-111.) WAC 314-55-083(3)(a): cameras must cover any area where cannabis or cannabis waste is *"moved within, processed, stored, or destroyed"*, recording 24 hours at 10 fps, kept 45 days. WAC 314-55-083(4)(c): the traceability system must be kept up to date *"When a lot … of cannabis waste is to be destroyed"*; CCRS receives a **Destruction** adjustment in the weekly file.
- **Recalls.** WAC 314-55-225: an affected licensee must *"Immediately notify the local LCB enforcement officer"*, secure and isolate the product, and is *"prohibited from destroying any affected product prior to notifying the LCB and coordinating with the local LCB officer on destruction activities."* The processor *"must immediately notify all licensees that received affected product"*.
- **Trade samples.** WAC 314-55-096(1)(i): *"Trade samples may only be given to and used by licensees or current paid employees … Trade samples may not be sold, nor provided as employee compensation, incentive, or reward."* 096(1)(j): retailers track incoming and outgoing samples in the traceability system, record each employee and product type, and give no more than 30 units per employee per quarter. 096(1)(f)(ii): a processor may give a retailer no more than 120 units per quarter. The LCB CCRS FAQ: a trade sample's TotalCost is **$0.01**.

### What the samples audit found (Q-15-6, the owner's *"make certain you have read and understood it all"*)

| Owner's rule | What the code does | Verdict |
|---|---|---|
| *"Samples go through receiving"* | A manifest line flagged as a sample, or priced $0, becomes a lot with `is_sample = true` (`intake-parser.ts` L448), in Quarantine like every lot (`intake-store.ts` L876) | Correct |
| *"have maximum amounts we can take in"* | Finalize is refused if accepting would pass the processor's 120-unit quarterly cap (`intake-store.ts` L1100, L1368–1388); each accepted sample is written to the sample ledger (L1843) | Correct |
| *"and give out"* | 30 units per employee per quarter on the samples hub (`trade-samples.ts`) | Correct |
| *"They have a .01 cost"* | CCRS TotalCost for a sample is `TRADE_SAMPLE_TOTAL_COST` (`ccrs-preflight-core.ts` L182); samples are not billable (`lot-cost-classification-core.ts`) | Correct |
| *"They go directly to the employee samples hub … At that time they are reduced from inventory"* | The hub lists only `is_sample` Active lots with stock (`trade-samples.ts` L391–395); giving a sample posts a negative `employee_sample` adjustment (L335–340), sent to CCRS as **Other** (`samples/actions.ts` L37–38) | Correct |
| *"They can not be sold at the register, they cannot be found on the menu"* | **Not enforced.** No register, menu or product-onboarding code reads `is_sample`. Product Onboarding seeds a draft for every lot on the manifest (`catalog-drafts.ts` L370–373); the register's lot draw picks any Active lot with stock that has the product's key, oldest first (`sale-lot-read.ts` L47–53); the register menu and barcode index check only status and quantity (`api/pos/menu/route.ts` L188–190, L420–424). A sample lot keeps the product's SKU as its key (`intake-parser.ts` L438), so a sale of the same product can draw the sample lot. Only a review warning says samples must not be sold (`intake-review-core.ts` L120–124) | **Gap, S1** (F-15-20, G-51) |
| The **Sample-pricing rules** panel on Returns & Destruction | Saves the legacy `sample_settings` table (migration 0042). Its functions (`sample-guardrails.ts`) are called only by a self-test. It plays no part in the samples branch above | **Dead (legacy).** Safe to remove; it protects nothing today, and the real protection is G-51 |

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D63 | **Vendor returns follow the state's method exactly** (resolves Q-15-1; G-42 **APPROVED**, rewritten). (1) Processor's written acceptance first. (2) **Greenway, as the origin, files the CCRS manifest** (Manifest.csv upload, driver, vehicle, departure and arrival times) and waits for the LCB's automatic success email with the manifest PDF; nothing moves before that. (3) The **printed CCRS PDF** travels with the product; only the owner, an employee 21+ or a transport licensee carries it, sealed, locked, direct (WAC 314-55-085). (4) **Logging reserves the units** (out of sale, not off on-hand); on-hand comes off and the CCRS **Other** adjustment posts only when the product **departs**. (5) The checklist's "48–72 hours" and "LCB confirms Mon/Wed/Fri" are removed: they are not LCB text (F-15-19). (6) The adjustment encoding stays **Other + detail** until the examiner answers U-72; the miscited "Returned to seller" line is corrected (F-15-18). | "Q1- I would like for you to deep research the proper CCRS method and procedures. It may not be up to us, I want to follow the states requirements." |
| D64 | **Anyone may witness a destruction, and every destruction is done on camera** (resolves Q-15-2). The witness is any second person (employee, manager, admin or owner), not the person rendering the waste. The law has no witness rule, so this is a store control. The destruction is done in a camera-covered area (WAC 314-55-083(3)(a)); the record notes the camera and the time so the footage can be found within the 45-day retention. The app's completion checks match WAC 314-55-097 (method, mix, the 50% attestation, final destination). It lacks a camera field and does not require the witness, so G-43 is **APPROVED** with "witness required (anyone)" and a camera reference added. | "Q2- anyone may witness the destruction. It has to be done on camera as well. Double check the systems procedures match the states requirements with regard to destructions protocol." |
| D65 | **A recall is handled as a transfer back to the vendor** (resolves Q-15-3). When the state has the vendor ask for the product back, Greenway initiates the vendor return (D63) with reason **Recall**. Recalled product is **never destroyed by us**. Because the law still applies, the admin (recall coordinator, D37) notes the vendor's request and tells the LCB officer (WAC 314-55-225), and the lot stays out of sale. G-28's recall-destruction design is withdrawn; G-42 keeps the recall reason. | "Q3- let's not worry too much about recalls. If a product needs to be returned to the vendor, we will create a transfer back to the vendor… Let's treat recalls like a transfer back to the vendor for now." |
| D66 | **Remove the back-office Customer return wizard** (resolves Q-15-4; G-45 **APPROVED** as removal). Customer returns go through the register's **Return an item** and the **Returns desk** only. Until it is removed, nobody uses it. | "Q4- remove it." |
| D67 | **The destruction hold is set to the legal minimum: 0 hours** (resolves Q-15-5). The current WAC has no waiting period. The setting already allows 0 (`disposition-core.ts` L33). The owner or admin sets **Hold (hours)** to **0** on Returns & Destruction. New gap **G-50**: the code default (72, L32) and the panel text change to 0 and "no legal hold". Scheduling still quarantines the lot and records the event; CCRS still receives the Destruction adjustment in that week's file. | "Q5- reduce it to the minimum required by law. Look it up in CCRS please." |
| D68 | **Samples: the owner's rules are the specification. The register and menu exclusion must be built; then the legacy panel is removed** (resolves Q-15-6). The audit (table above) found everything correct except the register and menu exclusion. New gap **G-51 (S1)**: a sample lot never gets a product draft, never enters the register's menu or barcode index, is never drawn by a sale, and never reaches the website. The **Sample-pricing rules** panel is dead legacy code; G-47 is **APPROVED** as removal, built with G-51 so the screen never suggests protection that does not exist. | "Samples go through receiving, are for employees only, have maximum amounts we can take in and give out. They have a .01 cost. They can not be sold at the register, they cannot be found on the menu… If the panel truly does nothing because our system is properly set up to handle samples, then you may turn it off." |
| D69 | **Skip SOP-16 (CCRS reporting and uploads), SOP-14 (Leafly), everything in the accounting branch, and the Lyman menu for now. The next SOP is SOP-08: new hire onboarding, system management and offboarding.** These are left out of SOPs and audits until the owner asks. | "I want to skip CCRS reporting and uploads for now… Same with the Leafly integration… We can skip everything related to the accounting branch, and anything related to the Lyman dropdown menu. The next major sop I want to work on is new hire onboarding, system management and off boarding employees." |

### Applied in slice SOP-08

- **D63–D68 applied** in `docs/sop/SOP-15-returns-vendor-destruction.md` **v1.1**. New findings F-15-18…F-15-21; gaps G-42, G-43, G-45 and G-47 **APPROVED**; new **G-50** (hold default 0) and **G-51** (samples kept off the menu and register, **S1**). No code changed.
- **D69 applied** in the roadmap (`02-SOP-CATALOG-AND-ROADMAP.md`) and `README.md`. SOP-08 is written in this slice.
- **SOP-08 written** as `docs/sop/SOP-08-onboarding-system-access-offboarding.md` **v1.0** (verified at `bad718b4`), per the request *"The next major sop I want to work on is new hire onboarding, system management and off boarding employees."* Findings F-08-1…F-08-10 and F-08-C (one **S1**: F-08-1, every new person is created Active so the Activate gate never runs); gaps G-52…G-58 PROPOSED; open questions below. The owner's books-87 rule (users separate from employees) is kept in every interim rule.

### Open questions raised by slice SOP-08

| # | Question (short form) | Interim rule |
|---|---|---|
| Q-08-1 | May we add an owner-set link between a user and an employee file (never creating an employee, books-87)? (G-53) | Keep them separate; paper handbook route; both halves of offboarding by hand |
| Q-08-2 | When an employee with a sign-in is terminated, should the app deactivate the sign-in in the same step (with a confirmation)? (G-54) | Same-day Half 2 by the owner or admin (form 8.3) |
| Q-08-3 | Visitor log: paper, or build it in the app? (G-57) | Paper form 8.5 at the back door |
| Q-08-4 | Does every budtender get a back-office sign-in, or are some PIN-only? | Every budtender gets a sign-in (SOP-08 §4.4) |
| Q-08-5 | May managers press Activate and Terminate, or only the owner and admins? | Managers may; they tell the owner the same day |

---

## Owner reply after SOP-08 + request for the SOP Library and a fix plan (recorded verbatim, after SOP-08 merged via PR #1527)

> Thank you! Q-08-1- yes, built right, professionally and of enterprise grade standards. Q-08-2- yes. Q-08-3- paper is fine for now. Q08-4- yes, everyone will get back office access. Q-08-5- I would like to modify this to be owner admin only. No manager access. I would like to take a break from the sop and audit work, we have covered the majority of what I want to have on hand as far as sops. I want you to now build for me a new page in the employee drop down menu, that has all of the current sop you have written, organized professionally. Everything about this new page should follow the apps styles fonts colors themes etc. it should be easy to find the sop I need to read. The page should be of enterprise grade quality. A professional ui and user experience. Build the page and load all the sop into it. Then stop, report back with a summary report of what was done. I want to start going through all of the audits gaps and issues it’s found. The main branches of the system have been audited now and I think it makes the most sense to stop and fix now, then use what money is left over to audit and fix things like digital content and such. Customers, loyalty, online orders are all solid right now. Worth doing the audit on them still, but probably won’t need an sop for them. Please proceed with the new page and loading all sop into it professionally. Then report back with your professional expert opinion on how we should proceed with the fixes. Should we go in the same order as we did for the sop creation? It was good ordering, priority wise in my opinion. I want your opinion too though. Maybe another area struggles more and needs more attention. Or maybe the fix we want to work on first requires fixing this other thing first. I don’t know, I’m relying on you to guide me on what’s right and professional. Follow the standing rules. Thank you. Minimal testing. I will test and inspect the new page. Thank you.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D70 | **Link a user to an employee file** (resolves Q-08-1; G-53 **APPROVED**). Built to enterprise standard: set only by the owner or an admin, audited, never creates an employee (books-87 stays). | "Q-08-1- yes, built right, professionally and of enterprise grade standards." |
| D71 | **Terminate deactivates the linked sign-in in the same step, with a confirmation** (resolves Q-08-2; G-54 **APPROVED**). | "Q-08-2- yes." |
| D72 | **The visitor log stays on paper for now** (resolves Q-08-3; SOP-08 form 8.5 is the procedure; G-57 **DEFERRED**). | "Q-08-3- paper is fine for now." |
| D73 | **Every employee gets a back-office sign-in** (resolves Q-08-4). | "Q08-4- yes, everyone will get back office access." |
| D74 | **Activate, Terminate and Rehire are owner and admin only; managers do not have them** (resolves Q-08-5; new **G-59 APPROVED**). Until built, managers never press them (SOP-08 v1.1 §2). | "Q-08-5- I would like to modify this to be owner admin only. No manager access." |
| D75 | **Pause SOP and audit writing. Build the SOP Library page in the Employee menu (all SOPs, app styles, easy to find). Then the fix phase starts; customers, loyalty and online orders are audited later but probably need no SOP; digital content is audited and fixed with the remaining budget.** | "I would like to take a break from the sop and audit work … build for me a new page in the employee drop down menu, that has all of the current sop you have written … I want to start going through all of the audits gaps and issues it's found." |

### Applied

- **D70-D74** in `docs/sop/SOP-08-onboarding-system-access-offboarding.md` **v1.1** and in `05-GAP-REGISTER.md` (G-53, G-54 APPROVED; G-57 DEFERRED; new G-59).
- **D75**: the SOP Library is built at **Employee → SOP Library** (`/admin/staffing/sop-library`); it reads `docs/sop/*.md` directly, so every SOP update appears there automatically. This delivers the reading and printing parts of **G-06**. The fix-phase recommendation is in `06-FIX-PHASE-PLAN.md`.


---

## Owner reply to the fix-phase plan (recorded verbatim, after PR #1528)

> Thank you! I agree with the order. I want to add context about the bookkeeping and accounting branch. It’s nearly built out entirely. It has not been connected to anything business related yet. I will finish it at some point, but getting the pos system built and working is far more important right now. So with that said, books accuracy does not worry me. I have other bookkeeping services I use still so we have time to finish building it. We need to protect the cannabis license first. Please complete phase 0 and phase 1 before reporting back to me with a summary report of what has been done. Follow the standing rules. Thank you!

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D76 | **The fix order in `06-FIX-PHASE-PLAN.md` is approved as written.** Phase 1 (lot lifecycle, license) stays ahead of Phase 2 (cash/books). **Phase 0 and Phase 1 are done before the next report.** | "I agree with the order." · "We need to protect the cannabis license first. Please complete phase 0 and phase 1 before reporting back to me" |
| D77 | **Books accuracy is not a current worry.** The bookkeeping branch is nearly built but not yet connected to business events, and outside bookkeeping services are still in use. Fixes that only post to the books (for example G-12, G-14, G-48) stay in their planned phase and do not jump the queue. A license-protecting fix never waits on a books posting. | "books accuracy does not worry me. I have other bookkeeping services I use still so we have time to finish building it." |

### Applied

- **D76** in `06-FIX-PHASE-PLAN.md` (status → approved; progress table).
- **D77** in `06-FIX-PHASE-PLAN.md` §2 note.

## Owner message 4 (recorded verbatim, fix phase, after Phase 1)

> Thank you. for completeness, please build the photo upload (G-43), as well as a video upload just in case. please also build the printable vendor-return packet (G-42). then i want you to move on to phase 2, Cash, in SOP order 01 → 02 → 03: per-drawer figure, then second-person count, then over/short warnings; post drops, then deposit-to-bank books, then deposit bag screen and end-of-day sheet. please complete the full phase before reporting back with a summary report of what was built. i have already applied all migrations. i am testing and inspecting the work now. please go above and beyond for me. follow the standing rules and never guess. thank you.

The list in this message ends at *"deposit bag screen and end-of-day sheet"*. The plan's Phase 2 table (`06-FIX-PHASE-PLAN.md` §3, rows 2.1–2.8) also has row 2.7 *"Master till items: denomination log, mix standard, printable sheet, supply run, any-employee count"* and row 2.8 *"Returns in the books and excise Box 1"*. Those words are the plan's, not the owner's.

## Owner message 5 (recorded verbatim, during Phase 2.7c)

> Please finish phase 2. My list must have gotten cut off so I was worried you were off doing something random. Please finish phase 2. Then report back with a full summary report of everything that has been done. Also, since I have your attention now, pr #1547 failed to build in vercel. It’s the only one to out of phase 2s work. Please make sure to go back and fix it too. The error was npm run build exited with 1. Please finish phase 2. Thank you!

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D78 | **Phase 2 is the whole plan table, rows 2.1–2.8**, including 2.7 (master till items) and 2.8 (returns in the books, excise Box 1). The owner's list in message 4 was cut short, not a narrower scope. | "Please finish phase 2. My list must have gotten cut off" |
| D79 | **A failed Vercel deployment on a Phase 2 merge is fixed as part of Phase 2**, and reported. | "pr #1547 failed to build in vercel … Please make sure to go back and fix it too." |
| D80 | **Report after Phase 2 with a full summary of everything done.** | "Then report back with a full summary report of everything that has been done." |

### Correction (rule: quote the owner verbatim)

Progress rows for Phase 2.7a and 2.7b quoted *"Master till items: …"* as **owner message 4**. Those are the plan's words (row 2.7), not the owner's. Fix Phase 2.7c corrected each one to cite *plan row 2.7* (`06-FIX-PHASE-PLAN.md` §7 rows 2.7a and 2.7b; `03-FINDINGS-LEDGER.md` F-00-7 and F-01-8; `05-GAP-REGISTER.md` G-02; SOP-01 revision 1.8; SOP-02 revisions 1.6 and 1.7).

## Owner message 8 (recorded verbatim, Fix Phase 6 / Fix E: answers to the shift-end and end-of-day strategy paper)

> Thank you. I didn't even have to tell you what I needed your help with fixing, incredible!! You nailed it exactly, this is the exact thing I was going to have you fix for me! Please read my answers, I posted them with the questions. Complete all tasks, then report back with a summary report. Follow the standing rules. Go above and beyond. Thank you!

Answers, written under the questions in the strategy paper (verbatim):

> **Q-E-1:** I have 2 cashiers on shift at all times. 2 in the morning, 2 at night. Sometimes I have a 3rd cashier on busier days. We will have 3 registers with 6 removable inserts. 8am to 4pm and 3pm to 11pm.
>
> **Q-E-2:** No solo closer or opener.
>
> **Q-E-3:** I have plenty of registers and inserts, so option b if not obvious at this point.
>
> **Q-E-4:** Please change it to assembled and verified at night, and blind counted in the morning.
>
> **Q-E-5:** Yes please do this.
>
> **Q-E-6:** Block. I don't want to clock out on the register change out step. A lot of times they count out early to let the new employee add their till ahead of their shift, so they can finish other tasks if needed before they clock out. Anyone can clock in and out on a locked register so we can use that for now.
>
> **Q-E-7:** Warn please
>
> **Q-E-8:** I think either is fine. I don't want to make it too difficult or time consuming to get out of there on time. So I think it can be done by either the night manager or morning manager. But don't build it this way just because I say to. I want your professional opinion on this one. I don't know what the enterprise grade solution to this one is. We are a small store, but this software could be used by someone much bigger that I, so I want to build it like dutchie, or AIQ, or any of the other massive players in the retail pos space. We are competing for the best pos ever built. So let's keep up with that strategy and build this one like the big boys would.
>
> **Q-E-9:** There is always a lead or manager at open and close.
>
> **Q-E-10:** The tip jar is pooled for the morning crew, and pooled for the night crew. At shift change the tips are counted and evenly distributed to the two employees. This is the amount to be reported on everyone's own close till summary report. I want everyone to be completely accountable for their register.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D81 | **Option B: cashier-accountable inserts.** Each cashier counts in their own insert at the start of their shift and closes it (blind, plus the D2 second count) at the end. One cashier, one insert, one session. Two shifts a day (8am–4pm, 3pm–11pm), 2 cashiers each and sometimes a 3rd; 3 registers, 6 inserts. | Q-E-1 *"We will have 3 registers with 6 removable inserts. 8am to 4pm and 3pm to 11pm."*; Q-E-3 *"option b if not obvious at this point."* |
| D82 | **The night deposit is assembled and verified, not counted by denomination.** The closer pulls each till's takings and drops, checks each stack against its line on the Deposit bags screen and ticks it; the bag total is the expected deposit. The morning blind recount by a different employee (D24) is the independent count. Counting by denomination stays available when a stack does not match. | Q-E-4 *"Please change it to assembled and verified at night, and blind counted in the morning."* |
| D83 | **Verify till is retired.** The morning blind recount of the bag is the verify. The old button is removed; a stale post is refused and audited (`till.verify_retired`). Past verified drawers keep their history. | Q-E-5 *"Yes please do this."* |
| D84 | **Clock-out is blocked while the employee still owns an open drawer, and closing a drawer never clocks anyone out.** A cashier may close early so the next cashier can count in, then finish other work and clock out later. Clock in and out happens on the locked register screen. Manager edits of a punch are not blocked. | Q-E-6 *"Block. I don't want to clock out on the register change out step. A lot of times they count out early … Anyone can clock in and out on a locked register"* |
| D85 | **Count-in float check warns, never blocks.** A count-in that differs from the register's standard float shows the difference, is saved, and is audited (`drawer.float_warning`). | Q-E-7 *"Warn please"* |
| D86 | **No solo close or open.** The D2 second count at close stays required; no "awaiting second count" path is built. | Q-E-2 *"No solo closer or opener."* |
| D87 | **Reconcile timing (professional call, as asked).** Either the night or the morning manager may reconcile. The window closes when the bag is sealed: sealing **warns** (never blocks) and audits `deposit_bag.sealed_unreconciled` when a drawer in the bag is still unreconciled. The EOD report reads *"Closed — N drawers awaiting manager reconcile"* until every drawer is reconciled, then *"Final"*. This is the pattern the large POS vendors use (blind close at the till, then an asynchronous manager review with a deadline), so the night crew is not held back and nothing is skipped. | Q-E-8 *"either the night manager or morning manager. But don't build it this way just because I say to. I want your professional opinion … build this one like the big boys would."* |
| D88 | **A lead or manager is always present at open and close**, so the manager-only EOD report and reconcile always have someone to do them. No new permission is needed. | Q-E-9 *"There is always a lead or manager at open and close."* |
| D89 | **Crew tip pool, split evenly.** Each crew (morning, night) pools tips. At close the cashier enters the crew pool and the number of people; the app splits it in whole cents (rounding down; any leftover cents stay in the jar for the next split) and stores **that cashier's share** as their own tips on their own close summary. "My own tips" stays available. | Q-E-10 *"evenly distributed to the two employees. This is the amount to be reported on everyone's own close till summary report. I want everyone to be completely accountable for their register."* |
| D90 | **Shift change on Option B.** The outgoing cashier closes early (blind + second count, D2), the incoming cashier counts in a fresh insert on the same register. One open drawer per register is already enforced, so the two never overlap on one register. | Q-E-1, Q-E-3, Q-E-6 *"they count out early to let the new employee add their till ahead of their shift"* |

### Applied

Fix Phase 6 / Fix E (gaps G-61 to G-66): SOP-01 v1.10 and SOP-03 v1.6, the concierge KB, and the ledgers 03/04/05/06. No migration.

G-71c (D102, D104): migration `0332_money_path_smoke_test.sql` (manual; rollback; PG check `scripts/recon/money-smoke-0332-pg-check.sql` proves the grants, that nothing is left, and reproduces R-RET failing at the return step with 42501) adds `platform_money_smoke_test()`: as the server, a test till open, register sale, stock decrement, draft ledger entry, customer return, cash drop and till close, always rolled back. Pure `money-smoke-core.ts` (33 self-tests) explains a failed step in staff words with the fix; folded into the same daily platform-health report and email (no new cron).

G-71d (D102, D104): migration `0333_platform_error_events.sql` (manual; rollback; PG check `scripts/recon/platform-errors-0333-pg-check.sql` proves append-only grants, RLS, constraints, the spike count and the alert claim) adds the append-only `platform_error_events`. `src/instrumentation.ts` `onRequestError` records unhandled server errors; a tap on the service-role client's fetch (`src/lib/supabase/db-error-tap.ts`, on top of the L-27 floor) records 42501 / missing-object refusals even when the code handled them (the R-RET blind spot). Pure `platform-errors-core.ts` (47 self-tests): staff are emailed and pushed on the first permission refusal, the third missing object or the fifth crash in 10 minutes, once per kind per hour; messages scrubbed; the 24-hour digest joins the daily platform-health email (no new cron).

### Numbering note

Owner messages 6 and 7 are cited throughout the SOPs and ledgers (Phase 2.1b/2.8b/2.9 and the receiving work) but were never copied into this file. This message is therefore recorded as **owner message 8**, so that no existing citation changes meaning.

## Owner message 9 (recorded verbatim, Fix Phase 6F: tip accountability and the return policy)

> Thank you. Before we move on. I want to make sure the tip logic is what I'm expecting. The tips are pooled between the two cashiers, each register has a tip jar at it. So when a cashier closes out their till, I want them to record their share of the tips in that form like it was before. Is that still the case here? All the other logic regarding tips is probably correct, I haven't looked yet. I just want to make sure the cashier is accountable for their tips too. We are a cash only business, so pooled tips won't show up in the system until they are reported. The last thing I need your help with is changing the policy for allowing customer returns. Right now we require they be a loyalty member. But after discussing the matter with my team, it would be better if this were changed to allow anyone to return products so long as they have the original packaging and the receipt to go with it and it falls within the 7 day return period. But because we are an enterprise grade platform, we shouldn't just change the behavior in code, we should allow it to be a setting in the register activity page, so we can toggle it on and off if we want to. I also want to have a setting for choosing a return window as well as the types of products we allow to be returned. That way everything can be adjusted if needed. Please complete these tasks then return with a summary report please. Follow the standing rules. Thank you!

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D91 | **Each cashier records their own tip share on their own close (unchanged).** The iPad close form still offers "Crew tip pool" (type the whole jar and the number of people; the server stores this cashier's share, D89) and "My own tips". | *"when a cashier closes out their till, I want them to record their share of the tips in that form like it was before"* |
| D92 | **The tips box is now required on the iPad close.** Blank blocks the close; a typed 0 is a real counted-zero jar. Before this, blank was allowed and saved as "not recorded". The back-office close keeps blank for the case where the cashier is not present to count their jar, and that close shows tips "not recorded". | *"I just want to make sure the cashier is accountable for their tips too. We are a cash only business, so pooled tips won't show up in the system until they are reported."* |
| D93 | **Anyone may return by default; "Loyalty members only" is a toggle.** The setting is at Register Activity → Return policy. Off (the default) means anyone with the original receipt may return. On restores the old loyalty-member gate. | *"allow anyone to return products so long as they have the original packaging and the receipt … we should allow it to be a setting in the register activity page, so we can toggle it on and off"* |
| D94 | **The return window is a setting:** whole days, 1 to 60, default 7. Purchase day = day 0, Pacific calendar days. It replaces the hard-coded 15 days. | *"it falls within the 7 day return period … a setting for choosing a return window"* |
| D95 | **Returnable product types are a setting.** Every category is listed; unticked types are refused at the register and at the returns desk, and the reason is shown. Sales recorded before categories were stamped on each line are not blocked. | *"as well as the types of products we allow to be returned"* |
| D96 | **The receipt and the original packaging stay mandatory and are not settings.** The receipt number is how the sale is found. WAC 314-55-079(12) requires the original packaging with the lot ID legible. A manager PIN still approves every return. | *"so long as they have the original packaging and the receipt to go with it"* |

### Applied

Fix Phase 6F (gaps G-67, G-68): a new settings page at `/admin/registers/return-policy` (a site_settings row; no migration). It feeds the returns desk, the iPad returns lookup, the printed receipt policy, the FAQ and the concierge KB. The iPad tips box is now required. Docs updated: SOP-01, SOP-15, and the ledgers 04/05/06.

## Owner message 10 (recorded verbatim, R-RET: customer returns stopped working after Fix Phase 6F)

> i need your help fixing the customer returns feature. it is not working for me anymore. we recently modified the logic so that anyone can make a return rather than just loyalty members. however, i can not return a sale on the register nor in the back office returns page. the back office keeps saying "⚠ No completed sales matched. Only completed orders can be returned.". the front register says, "the return was not saved and nothing was changed: permission denied for function record_customer_return." please look into why this is not working anymore and apply the fixes necessary to get it working again. for added context, the sale i am trying to return was made a few minutes prior to making the return. clone a copy of the repo, read agents.md, the standing rules, and then proceed with the enhancements and hardening. follow the standing rules. thank you. I have another agent finishing up a small slice, so please complete all work, but do not push or merge to the repo until i tell you it is safe to do so. complete all work, then stop and let me know what was wrong, what was done, and what i need to do to get it working again. i have rebuilt the register after updating the repo on my laptop, so the front register is up to date. thank you.

### Decisions derived (each traced to the words above)

| # | Decision | Source phrase |
|---|---|---|
| D97 | **The register failure is a database grant, not the 6F policy.** Supabase stopped giving new objects automatic grants on 2026-10-30 (discussion #45329). Migration 0308 revoked EXECUTE on `record_customer_return` from everyone and never granted the server role (`service_role`), so every return is refused. Migration **0330** grants the server role (only) on every function a migration revoked, catches up anything else in `public` the server cannot reach (the append-only ledgers only ever get select + insert), and sets default privileges for later objects. Nothing is opened to `anon` or `authenticated`. Grants only, so it can be run before the code is deployed. | *"the front register says, "the return was not saved and nothing was changed: permission denied for function record_customer_return.""* |
| D98 | **The back-office search finds a sale by what is on the receipt.** Register sales are saved as "Walk-in" with a GWY- number that is not printed, so searching by name or receipt found nothing. The search now takes the 8-character receipt number, the fun name, the GWY- order number, the loyalty member's name (from the member record) or phone. When nothing matches, the message says what was searched and what to type; a receipt that was found but is not completed says so. | *"the back office keeps saying "⚠ No completed sales matched. Only completed orders can be returned." … the sale i am trying to return was made a few minutes prior"* |
| D99 | **A permission error is explained in plain words.** Any "permission denied" from the database on the return, hold, vendor-return and non-cannabis paths now names the object and says to run 0330 in the Supabase SQL editor. A guard test fails the build if a later migration revokes a function without granting the server role, or creates a table without a server grant. | *"apply the fixes necessary to get it working again … proceed with the enhancements and hardening"* |

### Applied

R-RET (gaps G-69, G-70; findings F-15-22, F-15-23): migration `0330_service_role_grants.sql` (manual, rollback shipped, PG check `scripts/recon/service-role-grants-0330-pg-check.sql`), `rpc-fallback-core.ts` permission-denied explanation, `return-search-core.ts` (pure) + `searchReturnableOrderLines` in `disposition.ts`, the wizard's search box and message, test `tests/compliance/r-ret-service-role-grants.test.ts`. Docs: MIGRATIONS_TO_RUN, SOP-15 v1.14, concierge KB, ledgers 03/04/05/06. Not pushed until the owner says it is safe (*"do not push or merge to the repo until i tell you it is safe to do so"*).

## Owner message 11 (recorded verbatim, R-RET merge and platform-change monitoring)

> thank you. please push and merge the slice so I can inspect and test the new update. I am guessing this has raised a good gap that we should monitor. should we be monitoring supabase and vercel for issues like this that could cause real issues due to us not knowing about it until we run into the problem in production. how does an enterprise grade solution make certain that things like this cant or wont cause disruptions to business. please merge, then let me know your professional expert opinion on how we can stay ahead of these things in the future. follow the standing rules. thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D100 | **R-RET is cleared to push and rebase-merge.** | *"please push and merge the slice so I can inspect and test the new update"* |
| D101 | **Platform-change monitoring is an open gap (G-71, PROPOSED, not built).** The owner asked for an expert opinion first; the recommendation (vendor changelog watch, a daily database-grants health check, a production smoke test of the money paths, version pinning and a pre-deadline review) is given in the reply to this message. Nothing is built until the owner picks from it. | *"should we be monitoring supabase and vercel for issues like this … let me know your professional expert opinion on how we can stay ahead of these things in the future"* |

## Owner message 12 (recorded verbatim, build the platform early-warning items 1-4)

> Thank you. Let’s build 1-4 first. I see real value in all of them. Let’s do two rounds of building, two slices each round. Push and merge each slice individually. Update the standing rules so we don’t rely on the database to do things for us and we are more deliberate about how we communicate with the database. Follow the standing rules. Thank you!

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D102 | **G-71 is approved and split into four slices built in two rounds.** Round 1: G-71a daily database health check (item 1) and G-71b platform-changes register with a monthly review (item 2). Round 2: G-71c daily money-path smoke test (item 3) and G-71d error alerting (item 4). Item 5 (version pinning) is not in scope yet. | *"Let’s build 1-4 first. I see real value in all of them. Let’s do two rounds of building, two slices each round."* |
| D103 | **Each slice is its own PR, pushed and rebase-merged on its own** once CI is green, then production is verified. | *"Push and merge each slice individually."* |
| D104 | **New standing rule: the code never relies on database defaults.** Every migration writes out its grants (service_role yes, anon/authenticated only when meant), every table and function the code uses is listed in a generated contract that CI checks against the migrations, and every database call reads and explains its error. Written as AGENTS.md rule 15 in G-71b. | *"Update the standing rules so we don’t rely on the database to do things for us and we are more deliberate about how we communicate with the database."* |

### Applied

G-71a (D102, D104): generated DB contract (`src/lib/platform/db-contract.generated.json`, built by `scripts/platform/build-db-contract.ts`, checked by `tests/compliance/g71a-db-contract.test.ts`), pure `db-contract-core.ts` (34 self-tests), migration `0331_platform_health.sql` (manual; rollback; PG check `scripts/recon/platform-health-0331-pg-check.sql`), daily cron `/api/cron/platform-health`, page Admin → Platform health. Found while building: 0330's default privileges would have given the server UPDATE/DELETE on the new append-only log; 0331 takes them back explicitly (the D104 lesson).

G-71b (D102, D104): platform changes register `src/lib/platform/platform-changes.ts` (10 researched vendor changes with links, deadlines, impact and action; 36 self-tests) mirrored in `docs/PLATFORM-CHANGES.md`; the daily platform-health cron also sends the monthly review (once per Pacific month) and 30/7/1-day and overdue warnings, each claimed in `compliance_reminder_log`; the register on Admin → Platform health. AGENTS.md gains **standing rule 15** (be deliberate with the database: explicit grants and revokes, PG checks prove grants, the DB contract, read and classify every error) quoting the owner's words, and **standing rule 16** (monthly platform review). Open now: `supabase-js-node20` is action-needed (CI still runs Node 20; item 5). No migration.

## Owner message 13 (recorded verbatim, R-RET-2: the second item of a sale could not be returned; plain-English errors; item 5 and Node.js 20)

> thank you. is this everything from the original list? all of this is built except for item 5?
> 1: Daily database health check plus email alert, Small; no new services, Any repeat of this incident, caught the morning it happens
> 2: Platform-changes list plus monthly vendor review in the standing rules, Docs only, Known deadlines arriving unnoticed
> 3: Daily test run of sale, return and till, Medium, Any break in the money paths, from any cause
> 4: Error alerting (free tier or log forwarding), Small, Problems that only show up under real use
> 5: Locked versions plus upgrade pull requests through CI, Small, Surprise breakage from library updates.
> I want to build item 5 if you think, in your expert professional opinion, that we should include it too. what should we do about the node.js 20 and supabase ending support for it. is this important? before we build item 5 or the deal with the node.js 20 issue. we need to go back to the returns. my test sale was two products in one sale. my first test return was to return one of the two items. that worked. so then I tried to return the second item from that sale, and it rejected it. it gave me the error, "refund exceeds what the customer paid for the returned quantity (max 0.00) reduce the refund." please look into this issue and fix it for me so I can make any refund necessary. please make the errors be more plain english. I dont ever understand what the error actually is telling me. follow the standing rules. thank you.

(The owner attached a photo of the register's Return screen: **OG Kush (1g) $18.70, "1 of 2 returnable (1 already returned)"**, Wrong item, Restock, both attestations ticked, and the red message *"Refund exceeds what the customer paid for the returned quantity (max 0.00). Reduce the refund."*)

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D105 | **Returns come first; item 5 and the Node.js 20 move wait.** R-RET-2 is its own slice, pushed and merged before anything else. The owner gets an expert opinion on item 5 and on Node.js 20 in the reply, and neither is built until the owner says so. | *"before we build item 5 or the deal with the node.js 20 issue. we need to go back to the returns."* |
| D106 | **Every unit of a sale line can be refunded, one return at a time.** The refund limit is the SMALLER of what the customer paid for the units coming back now and what is still unrefunded on the whole line. The old limit (this return's price minus every earlier refund on the line) gave the second unit of a 2-unit line a limit of $0.00. The same fix applies to Other Inventory (non-cannabis) returns. The protection stays: a refund can never be more than the customer paid. | *"so then I tried to return the second item from that sale, and it rejected it … (max 0.00) … fix it for me so I can make any refund necessary."* |
| D107 | **Return and database errors are written in plain English.** Each message says what happened and what to do, with amounts in dollars and no system words (COMPLETED, line, integer cents, constraint, permission denied). Database errors are translated by code (duplicate, missing record, value not allowed, blank field, wrong format, busy, timeout, network, and our own functions' reasons without the function name). | *"please make the errors be more plain english. I dont ever understand what the error actually is telling me."* |

### Applied

R-RET-2 (D105–D107; gap G-72, finding F-15-24): `refundCeilingMinor`, `refundTooHighMessage` and `dollars` in `src/lib/inventory/disposition-core.ts` (pure; self-tests replay the owner's case), used by `createCustomerReturn` (`disposition.ts`, register + Returns desk + back office) and `createNonCannabisReturn` (`noncannabis/returns.ts`). Plain-English messages in `disposition-core.ts`, `pos/returns-core.ts`, `pos/returns-store.ts`, `disposition.ts`, `noncannabis/returns.ts`; `plainDbError` in `src/lib/db/rpc-fallback-core.ts` behind `dbErrorForStaff` (every caller benefits) and a plainer permission message. Test `tests/compliance/r-ret2-refund-ceiling.test.ts`. Docs: SOP-15 v1.15 §5.1, SOP-01 §4.23 and its message table, concierge KB, ledgers 03/05/06. No migration and no iPad rebuild (the register calls the server for returns).

## Owner message 14 (recorded verbatim, G-71e: item 5, locked versions plus upgrade pull requests through CI, and the Node.js fixes)

> Thank you. Please now complete item 5 to close all gaps. Fit inside this slice the node.js fixes too please.

(Item 5 of owner message 13's list: *"5: Locked versions plus upgrade pull requests through CI, Small, Surprise breakage from library updates."* "The node.js fixes" are the ones described in the R-RET-2 reply: move CI off Node 20, pin the Node version in package.json, and close the `supabase-js-node20` register entry.)

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D108 | **Item 5 and the Node.js move ship as one slice, G-71e**, with its own PR, CI green, rebase-merge and production check. | *"Please now complete item 5 to close all gaps. Fit inside this slice the node.js fixes too please."* |
| D109 | **Every dependency is locked to one exact version.** Both package.json files (site and merch-site) lose every `^`/`~` range and name the version the lockfile already installs, so nothing moved when they were locked. `.npmrc` `save-exact=true` keeps new installs exact. A guard test fails a PR on a range or on package.json/lockfile disagreement. | *"Locked versions"* |
| D110 | **Production and CI run Node 24, pinned in the repo.** `engines.node` is `24.x` in both package files (Vercel reads it and it overrides Project Settings); every CI job reads its Node from that field (`node-version-file: package.json`), so the two can no longer differ. 24 rather than 26: 24 has been LTS since 2025-10-28 (maintenance until 2028-04-30) and 26 became LTS only on 2026-10-28; the move to 26 is on the register as its own future slice. `@types/node` moves 20 → 24 to describe the runtime. CI actions move to actions/checkout v7.0.1 and actions/setup-node v7.1.0, pinned to commit SHAs. | *"Fit inside this slice the node.js fixes too"* |
| D111 | **Upgrades arrive as pull requests and pass the whole CI gate before they can merge.** Dependabot opens them (npm for `/` and `/merch-site` weekly, minor and patch grouped, majors separate, 7-day cooldown; GitHub Actions monthly). Dependabot's commits are authored by `dependabot[bot]`, which CI's authorship check refuses and Vercel will not deploy, so the agent reads the release notes, re-authors the PR as Greenway Dev, waits for green, rebase-merges and checks production (standing rule 17). Nothing is merged automatically. | *"upgrade pull requests through CI"* |

### Applied

G-71e (D108–D111; gap G-71, item 5): exact versions in `package.json` and `merch-site/package.json` (27 + 8 ranges removed: each now names the version the lockfile already installed, except `@types/node` ^20 → 24.19.2; the only lockfile changes are `@types/node` and its `undici-types`, plus merch-site optional wasm entries npm 11 records), `engines.node` `24.x`, `.npmrc` `save-exact=true` (both dirs); `.github/workflows/compliance-tests.yml` on actions/checkout v7.0.1 and actions/setup-node v7.1.0 by SHA with `node-version-file: package.json` (3 jobs); `.github/dependabot.yml`; pure `src/lib/platform/version-pins-core.ts` (self-tests registered at floor 50) and `tests/compliance/g71e-version-pins.test.ts` run against the real files; platform register: `supabase-js-node20`, `vercel-node20`, `github-actions-node20` → done, new `npm-12-install-scripts` and `nodejs-24-eol` (watch); AGENTS.md **standing rule 17**. Verified locally on Node 24.22.2 / npm 11.19.1: lockfile refresh moved only @types/node and undici-types; merch-site `npm ci`, tsc, self-test and `next build` pass. No migration, no iPad rebuild.

## Owner message 15 (recorded verbatim, G-73: Dependabot pull requests failing on author; drag-and-drop customer import from Cultivera)

> thank you. I have enabled dependabot in github. 8 of my pull requests fail because of the author. can you fix that now that the dependabot is enabled? I also need you to help me extract the data from this customers csv file taken from cultivera to upload to our new system. the upload process in place currently does not work, and I would much rather just drag and drop the file in then paste the spreadsheet into the box. follow the standing rules. thank you.

(Attached: `82BB4F__November-01-2026_Customers.xlsx`, the Cultivera customer export, 16,586 rows, 26 columns; and a screenshot of 8 open Dependabot PRs, #1595–#1602. By the time work began Dependabot had opened 22, #1595–#1617; one, #1605, it had already closed itself.)

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D112 | **Dependabot PRs are taken by standing rule 17, not by loosening the author check.** Each one is re-authored as Greenway Dev on top of main, passes the whole CI gate, is rebase-merged and checked in production. A PR whose changes are already on main is closed with that reason. A PR CI fails for a real reason (a major version that breaks the build or tests) is not merged; it stays open for its own slice. | *"8 of my pull requests fail because of the author. can you fix that"*, *"follow the standing rules"* |
| D113 | **The customer import is a drop zone, not a paste box.** Drop the Cultivera export exactly as exported (.xlsx, or .csv); it is read in the browser, previewed in plain English, and saved only when Import is pressed, in batches with a progress bar and a Continue button. Re-importing updates by Customer ID and never duplicates. | *"I would much rather just drag and drop the file in then paste the spreadsheet into the box"* |
| D114 | **Bad source data is blanked and counted, never stored as if true (rule 3).** Exact repeat rows merge; phones that are not 10 digits, emails with no valid address, birthdays shared by 10+ customers (11/11/1999 ×414) or impossible ones are left blank and counted in the preview; rows with no name, phone or email are left out and listed by Customer ID. Two Cultivera customers who share a phone stay two customers. | *"help me extract the data from this customers csv file … to upload to our new system"*, *"the upload process in place currently does not work"* |

### Applied

G-73 (D112–D114): see the G-73 section of `05-GAP-REGISTER.md` and the G-73 row of `06-FIX-PHASE-PLAN.md`.

## Owner message 16 (recorded verbatim, G-74: back to Greenway Dev pull requests for upgrades; Phase 7.1 Returns & Destruction)

> Let’s start fixing the issues. I don’t understand why our pull requests have to be merged by the dependabot. The previous 1600 pr’s didn’t need the bot. The only reason we needed it was to modify the one file you didn’t have access to modify. That’s done now though. Can we go back to the old way of merging pr’s? Please proceed with two slices of the most important areas. Follow the standing rules. Thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D115 | **Dependabot is removed; upgrades go back to the old way.** `.github/dependabot.yml` is deleted, so Dependabot opens no more version pull requests and nothing has to be re-authored. Every pull request, upgrades included, is opened by the agent as Greenway Dev, passes the full CI gate, is rebase-merged and checked in production (rules 6, 7, 13). The locked versions of G-71e stay. | *"Can we go back to the old way of merging pr’s?"*, *"The only reason we needed it was to modify the one file you didn’t have access to modify. That’s done now though."* |
| D116 | **Upgrades are found by a script, not a bot.** `scripts/deps/upgrade-plan.ts` reads both package files and the npm registry and prints which pinned packages have a newer patch, minor or major release; the monthly platform review (rule 16) runs it and takes patch and minor upgrades as one Greenway Dev PR, each major in its own slice. A test fails the PR if a Dependabot config file comes back. The 6 open Dependabot PRs (#1596, #1597, #1599–#1602) are closed with the reason; their majors are listed in the plan for their own slices. | *"I don’t understand why our pull requests have to be merged by the dependabot."* |
| D117 | **The second slice is Fix Phase 7.1, the next step in the agreed plan:** Returns & Destruction readable errors, housekeeping, the destruction hold at the legal minimum and the removal of the back-office customer-return wizard (G-46, G-49, G-50, G-45; D66, D67 already approved). It goes first because the wizard is the only remaining way to refund a customer that skips the store return policy and takes a typed refund amount (F-15-8, S2). | *"Please proceed with two slices of the most important areas."* |

### Applied

G-74 (D115, D116): merged as #1620; see the G-74 section of `05-GAP-REGISTER.md` and the G-74 row of `06-FIX-PHASE-PLAN.md`. Phase 7.1 (D117): the 7.1 row of `06-FIX-PHASE-PLAN.md`; G-45, G-46, G-49, G-50 BUILT in `05-GAP-REGISTER.md`; F-15-8, F-15-10, F-15-13, F-15-17, F-15-18 FIXED in `03-FINDINGS-LEDGER.md`; SOP-15 v1.16. Migration 0334 (destruction hold 72 → 0) is for the owner to run (`docs/MIGRATIONS_TO_RUN.md`). G-70 (back-office receipt search) is superseded by D66 and went with the wizard.

## Owner report R-CART-1 (recorded verbatim, 2026-11-01, first trading day: "variantId must be a UUID" register exceptions)

> "i need your help looking into something i am not sure is an issue and we need to fix it, or if its fine. today is the first day we are using this new software platform. in the employee drop down in the back office, the exceptions page, there is several of these messages. what should we do about it. i have another agent working on the repo, so please complete all task, ready them for merging, then stop and wait for me to tell you when it is safe to merge to git. clone the repo, read agents.md, the standing rules, then proceed with the fix. here is the back office message, 
> "Open exceptions
> 31 open
> cart adjustment
> 11/1/2026 8:01 AM PT · Sales Register 1 · Zachary Smith
> 9189126a-429c-445d-b94f-cdbc1495953c
> Invalid cart adjustment: variantId must be a UUID.
>
> Inspect payload
> Resolution note (what you did, at least 5 characters)
> e.g. Intook UPID WA-1234 in Medical, customer re-rang at Register 1
>
> Resolve
> cart adjustment
> 11/1/2026 8:03 AM PT · Sales Register 1 · Zachary Smith
> cac8db46-80eb-4dae-9833-5c78ec8e8060
> Invalid cart adjustment: variantId must be a UUID.
>
> Inspect payload
> Resolution note (what you did, at least 5 characters)
> e.g. Intook UPID WA-1234 in Medical, customer re-rang at Register 1"

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| R-CART-1a | **It is a bug, and only in the minus / remove tracker.** The register sends the item's MENU variant id (`menu_variants.source_variant_id`, text: `<lot>-onboarded`, `<item>-default`, `pos-custom-<uid>`, the Cultivera `<item>-<hash>`), never a UUID, so the S3 tracker refused every minus (−) and remove (✕) with an item. Sales, payments, inventory and CCRS were never affected (`order_items.variant_id` is text and the sale validator has no such check). The tracker now accepts any real menu id. | *"i am not sure is an issue and we need to fix it, or if its fine"* |
| R-CART-1b | **The stranded rows are recorded, not just closed.** The owner asked for the tracker (Register round S3) so minus / remove use cannot be abused unseen; resolving the 31 rows by hand would leave a hole in the first day. One button on Register exceptions records every row that failed for exactly this reason into Reports → Register Adjustments and resolves it with a fixed note; anything else stays open for a person. | *"what should we do about it"* |
| R-CART-1c | **Ready, not merged.** Another agent is working on the repo; the PR is left green and open until the owner says it is safe to merge. | *"complete all task, ready them for merging, then stop and wait for me to tell you when it is safe to merge to git"* |

### Applied

R-CART-1: see the R-CART-1 section of `05-GAP-REGISTER.md` and the R-CART-1 row of `06-FIX-PHASE-PLAN.md`.

## Owner message 17 (recorded verbatim, G-75: customer search at the register; Total Spent and Last Purchase Date from the customer spreadsheet)

> thank you. we need to go back to the customer list we just uploaded. i am having a hard time searching for customers on the front register. i can find them in the back office. i need a way to search for customers better as well. find all matches even if we spell the name partially, or use their last name or phone number, etc. we need the search lookup to be very powerful so it can find anyone. the spreadsheet i uploaded has spent and last purchase date, which our system did not pick up and save from the spreadsheet. please look at the .csv file i gave you earlier so you can see the data in their we need. please fix this so we get all data from the spreadsheet and we have powerful lookup features to go along with it. follow the standing rules. thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D118 | **One customer search, used everywhere.** The register, the back-office customer list and every customer picker use the same search (`searchCustomers`, pure rules in `customer-search-core.ts`). Every word typed must match somewhere, in any order and any part: first name, last name, email, phone digits (any format, any part) or the Cultivera Customer ID. Results are ranked best match first, then most recent buyer. When nothing matches, the closest spellings are offered (typo search, migration 0335). The register shows up to 25 results as you type, each with the full name, the last 4 phone digits, last purchase, total spent, medical and Customer ID, so two customers with the same name can be told apart; it still never receives a full phone, email or birthday. Root cause: the register matched the whole typed text against one column at a time ("bill mcclendon" matched nothing), showed only 8 results sorted by visits in this system (imported customers had none), and showed only "Bill M." | *"i am having a hard time searching for customers on the front register"*, *"find all matches even if we spell the name partially, or use their last name or phone number, etc."*, *"very powerful so it can find anyone"* |
| D119 | **Total Spent and Last Purchase Date are shown, not just stored.** The import already saved both (5,411 customers with spend and a last purchase, in `imported_spend_minor_units` and `last_purchase_at`), but the screens showed only spending and visits in this system. Now the customer list, the profile and the register show **Total spent** = spend at Greenway + old POS spend (with the split), and **Last purchase** = the later of the last visit here and the old POS date, marked "old POS" when it came from the spreadsheet. Both can be sorted. | *"the spreadsheet i uploaded has spent and last purchase date, which our system did not pick up"* |
| D120 | **Every column with real data is saved.** Of the 26 columns in the export, two with data were not saved: **Date Created** (every row) and **Tax Designations** (6 Veterans). Migration 0335 adds `imported_created_at` and `tax_designations`; the profile shows them as "Customer since" and a Tax designation badge. The other columns are empty for every customer (licence, address, city, zip, groups) or the same for every customer (Active = Y, the N flags), so there is nothing else to keep (rule 3: nothing is made up). After 0335 runs, the owner drops the same file again; it updates the same customers by Customer ID and fills in the two new fields. | *"please fix this so we get all data from the spreadsheet"* |

### Applied

G-75 (D118–D120): merged as #1624; see the G-75 section of `05-GAP-REGISTER.md` and the G-75 row of `06-FIX-PHASE-PLAN.md`. Migration 0335 is for the owner to run (`docs/MIGRATIONS_TO_RUN.md`), then re-drop the customer file.

## Owner request R-DRAWER-1 (recorded verbatim: open the cash drawer with or without a printed receipt)

> "i need your help modifying a behavior on the front register. i want to build a setting in the register activity page of the back office that gives me the option of popping the cash drawer with a receipt or with out the receipt printed. most of my customers do not want a receipt and this new method should make for a more efficient process. please clone the repo, read agents.md, the standing rules, then proceed with the enhancement. i have another agent working, so please complete all tasks and prepare the work to be merged when i say it is safe to do so. do not push to git yet, just get all tasks done. report back with a summary report of what was done and what i should expect to see. if i need to rebuild the front registers, let me know. thank you."

Follow-up (merge approval, verbatim):

> "is this pr still open? do we need to merge this slice? please check, if so, please merge now."

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| R-DRAWER-1a | **A setting with two choices, on Register Activity.** New page Register Activity → **Cash drawer & receipt** (`/admin/registers/cash-drawer`, settings.manage, audited `pos.drawer_on_sale_saved`). *Open the drawer with a printed receipt* (today's behaviour, the default) or *Open the drawer without a receipt*. Stored as the `site_settings` row `pos_drawer_on_sale`; no migration. | *"a setting in the register activity page of the back office that gives me the option of popping the cash drawer with a receipt or with out the receipt printed"* |
| R-DRAWER-1b | **Without a receipt, the drawer opens by itself on a cash sale.** When Sale complete appears for a sale with cash, the register sends a drawer-only job to the paired Star printer (the native `openDrawer` No sale already uses on the iPad); nothing prints. **Print receipt** stays for a customer who asks and then prints without opening the drawer again. If the drawer does not answer, an **Open drawer** button retries, and Print receipt opens it as before. | *"most of my customers do not want a receipt and this new method should make for a more efficient process"* |
| R-DRAWER-1c | **The drawer opens at most once per sale, in both modes.** Tapping Print receipt again only reprints (closes F-01-6: extra drawer openings went around No sale). A sale put all on the employee pay-later tab never opens the drawer. No sale (manager PIN) is unchanged. | Standing rule: harden the control while building |
| R-DRAWER-1d | **Not printing is lawful.** RCW 69.50.535(1)(a) governs what the receipt shows when one is given (the 37% excise itemised); WAC 314-55 has no duty to hand every buyer a printed receipt; tax stays separately stated on the record (RCW 82.08.050). The sale is recorded and reported exactly as before; MORE → Reprint last receipt and Email receipt still work. | Grounding (rule: verified fact) |
| R-DRAWER-1e | **Held, then merged on the owner's word.** Built while another agent worked; merged only after the owner said *"please merge now"*. | *"do not push to git yet"*; *"if so, please merge now"* |

### Applied

R-DRAWER-1: merged as #1628; see the R-DRAWER-1 section of `05-GAP-REGISTER.md`, the R-DRAWER-1 row of `06-FIX-PHASE-PLAN.md`, F-01-6 and F-01-7 in `03-FINDINGS-LEDGER.md`, and SOP-01 v1.13 (§4.16).

## Owner interrupt, 2026-11-01 (recorded verbatim, CVL: Cultivera loyalty earned / spent / current per customer)

> sorry to stop you. I dont normally do this, but I need you to add to the fetcher to specifically target the customer page and click through every single customer. cultivera, naturally, does not provide the total loyalty earned, spent, or current amount in the downloadable spreadsheet. which means I need you to add to this fetcher the ability to slowly crawl through each customer record and pull out this info and automatically apply the data to the customers in our back office. I have uploaded the spreadsheet from cultivera, now we just need the detail. please continue. follow the standing rules. thank you.

> here is a copy of the customers spreadsheet. the url for finding customer details in cultiveras back office is, https://wa.cultiverapos.com/cbo/#/crm/customers/2322/1/detail please continue.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| CVL-D1 | **Current balance comes from each customer's Cultivera record**, never from adding up history. Measured: the history does not reconcile (customer 2322: history 577.23, record 509.13), so a derived number would be a guess. Differences are shown on the preview, never "fixed". | "pull out this info" |
| CVL-D2 | **Slow on purpose:** one customer record per second (configurable), resumable, read-only, and never at the same time as the other Cultivera fetches. | "slowly crawl through each customer record" |
| CVL-D3 | **Applied automatically after a preview** (standing rule: crawler output is a draft). The balance enters our loyalty ledger once per customer as an opening adjustment (nearest whole point, no signup bonus); exact decimals, earned and spent are stored beside it. Matching is by Customer ID (= Cultivera's internal id). | "automatically apply the data to the customers in our back office" |

### Applied

CVL (CVL-D1–D3): merged as #1630. Migration 0336 is for the owner to run (`docs/MIGRATIONS_TO_RUN.md`).

## Owner request, 2026-11-01 (recorded verbatim, CVB: Cultivera benchmark)

The full request is quoted in `docs/roadmap/CVB-CULTIVERA-BENCHMARK.md` section 1 (the login line is redacted from the repository). The follow-up:

> please continue working on the remaining tasks. please complete 2 more slices before stopping and reporting back with a summary report. I have another agent working on the repo and will be merging soon. it is working on inventory issues that are causing us to not be able to ring them up. so please complete all work, commit it out of the sandbox, use the shared root workspace folder to keep work safe. follow the standing rules. thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| CVB-D1 | **The payback ledger starts at the two stated figures.** Build cost $40,000.00, and $5,500.00 saved on 2026-11-01, seeded once. Every later credit is its own append-only row with its basis; nothing is edited. | "Total build was 40k"; "We just now today from switching saved 5500" |
| CVB-D2 | **Outperformance is measured, never assumed.** A period is credited only for the positive amount by which our pre-tax figure beat Cultivera's own figure for the comparable period, once per period and metric. | "a total build cost amount that goes down as our system outperforms theirs" |
| CVB-D3 | **The history is kept byte for byte in a private bucket**, with sha256 provenance per file and append-only run records. These are KEPT by the factory reset. | "retain Cultivera historical data safely in our system" |
| CVB-D4 | **Owner-only**: permission `cultivera.benchmark: ["owner"]`, and every table is service_role only. | "This will be owner only access" |
| CVB-D5 | **Pushed, never merged by this agent.** Each slice is a branch with an open PR, with patches copied to `/workspace/cvb-safe/`. | "do not merge them until I tell you it is safe"; "use the shared root workspace folder to keep work safe" |

### Follow-up (verbatim, after #1633 / #1634)

> Please merge now. Then proceed with the next two slices. Complete all work, commit to the shared root workspace folder. Wait to merge until I say it's safe to do so. Follow the standing rules. Thank you.

#1633 and #1634 were merged on that instruction. The next two slices are CVB-5 (Admin → Cultivera Archive) and CVB-6 (Reports → Cultivera Benchmark tab). Both are pushed with open PRs and are NOT merged, with patches in `/workspace/cvb-safe/`.

| # | Decision | Source phrase |
|---|---|---|
| CVB-D6 | **The archive is a checked copy, never an overwrite.** Each file from the crawler is checked against the manifest (bytes + sha256) and stored with `upsert:false`. If a stored object's size differs from the manifest, the archive stops and says so. The manifest's own bytes are stored as `manifest.json`, and their sha256 is registered. If the page's time limit is reached, it reports how far it got; pressing Archive again carries on. | "retain Cultivera historical data safely in our system" |
| CVB-D7 | **Cultivera's daily figures are read back from our bucket, not from the crawler.** Each file is checked against the registered sha256 before it is used, so the benchmark keeps working after the Cultivera account is closed. | "my account is set to deactivate soon" |
| CVB-D8 | **The archive page sits in the owner's Lyman menu** with the other owner-only pages. Its page and all four server actions are gated on `cultivera.benchmark` and audited. | "Add a new page in the admin"; "This will be owner only access" |
| CVB-D9 | **Cultivera's own formulas are measured, not assumed.** On every compare, the page re-checks Cultivera's daily rows for the compared days (NetSales = Gross − Discounts, GrossProfit = Gross − Cost, NetProfit = Net − Cost; 1 cent of slack). One of our derived metrics is shown only when Cultivera's rows prove the same formula; otherwise it reads "not comparable" with the reason. | "compare how well we're doing with our system vs Cultivera"; standing rule: never guess |
| CVB-D10 | **Our side is pre-tax, on completed orders, by Pacific completed_at day, starting at the cut-over date** (gl_conversion_config, 0186). Our cost is the sale's own cost entry in the books (order:<id>#cogs). If any order in the period has no single cost entry, cost and profit are unknown, never a partial sum. Returns are not compared, because Cultivera's valuation of a return was never measured. | standing rules (cents, Pacific, never guess) |
| CVB-D11 | **The build cost goes down two ways, both owner-pressed, and both insert-only and audited.** (1) "Record a saving": the owner's amount, keyed by date + cents + note, so a double press is stored once. (2) "Credit this period": the server recomputes the credit for a closed, complete period: the positive gross-profit difference against Cultivera's same calendar days one year earlier. Nothing about the amount comes from the form. A day can never be credited twice, even under a different period. The tab is owner-only and sits before ACH Payments. | "Total build was 40k ... saved 5500 ... every time we outperform Cultivera it should go down"; "This will be owner only access" |

## Owner request, 2026-11-01 (recorded verbatim, SHIFT-END: one-person till close, second count in the office, clock-out fix)

> I need your help fixing an issue with the shift end, till end features. I thought we fixed it in pr #1567, but it is still not working the way it is suppose to. The register is requires a second count with a second pin before it lets me close out the register. The register should have the employee count out the drawer, entering the bill quantities, then tips, then end, that's it. The register is now ready to take on a new employee. The second count happens in the office on the computer via the back office app. This process needs to be smooth and simple so the transition from one cash drawer to the next is quick and seamless. The clock out feature is not working either. Please work on these issues and get them fixed for me please. Clone the repo, read agents.md, the standing rules, then proceed to fix all issues. Report back with a summary report and what's left, what I need to do, and anything else important. Follow the standing rules. Thank you.

Follow-ups (verbatim; the login line is redacted from the repository):

> Sorry to stop you. I set up a read only user for you to login to supabase and get what you need to build it right the first time without guessing. Username: [redacted] Password: [redacted] Please continue. Follow the standing rules. Thank you.

> please open the browser and I will log you in.

> please continue. follow the standing rules. thank you.

### What production showed (read-only, before the fix)

- `time_punches`: four open clock-ins (all `source = register`), and **no clock-out has ever been recorded**.
- `pos_sale_events`: four `punch` events, all intent `in`. The per-device sequence numbers have no gaps, so no clock-out punch ever left an iPad: it was stopped on the register before it was queued (the D84 open-drawer guard, shown only as a dismissable banner), or the cashier never found the clock option. A refusal by the server would also have been invisible (it became a sync `exception` that the register treats as delivered).
- `audit_logs`: no `timeclock.*` row from the register at all.
- The two closed drawers awaiting reconcile had their second count done on the iPad by the same manager.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D121 | **The iPad close is one person, one screen: count the bills, enter tips, enter your own PIN, Close drawer.** No second PIN at the till. The register is ready for the next cashier at once. Supersedes D2 / D86 / D90 **at the till** (the second count itself is kept, see D122). An old register build that still sends a second PIN is accepted and the extra fields are ignored, so no iPad is locked out during the update. Closing still never clocks anyone out (D84 stands). | *"The register should have the employee count out the drawer, entering the bill quantities, then tips, then end, that's it. The register is now ready to take on a new employee."* |
| D122 | **The second count is done in the back office, on the office computer**, on the drawer's card under Register Activity → Needs attention. Any employee except the closer (D2's "any second employee" still holds), by their own PIN (throttled pad), counting blind: the closer's count and the expected cash are hidden until it is saved. A difference is a warning only; over / short uses the closer's count. Uses the 0314 columns; no migration. | *"The second count happens in the office on the computer via the back office app."* |
| D123 | **Reconcile waits for the second count** (professional call, flagged to the owner). Moving the second count off the iPad must not mean it quietly stops happening; making it the step before reconcile keeps "two people count every drawer" without slowing the drawer change. A reconcile without it is refused and audited (`drawer.reconcile_refused`, `second_count_missing`). The owner can ask for this to be a warning instead. | *"This process needs to be smooth and simple so the transition from one cash drawer to the next is quick and seamless."* |
| D124 | **Clock in / out on the register is answered by the server directly** (`/api/pos/clock`) and the real answer is shown: "<name>: clocked OUT at 4:46 PM" or "NOT clocked in or out" with the reason. The lock screen has a large ⏱️ Clock in / Clock out button and does not go through unlock (owner Q-E-6: anyone can clock in and out on a locked register). Every punch and refusal is audited (`timeclock.in`, `timeclock.out`, `timeclock.refused`). Only a lost connection on the home screen falls back to the offline queue. | *"The clock out feature is not working either."* |

## Owner requests, 2026-11-02 (recorded verbatim, DRAWER GUARDS: confirm a $0 close, hold when the counts disagree, correct a reconciled drawer)

The investigation request that came first (read-only; nothing was changed):

> Thank you. That's working much better now! Please log back in to supabase and observe to till close out process. The second count gave me a strange message about the till being off by the amount I counted the second time. Please look at the data and let me know if you find any anomalies. Follow the standing rules. Thank you.

The build request:

> Thank you. Please build 1-3 now. Today was the first day we actually used this new system. And there were many bugs and wrinkles. I have now squashed and ironed nearly all of them now. So today's data is going to be wonky. Hopefully going forward, as we find less and less issues, we will start to record more accurate data. I am not ready to finish the books yet as much as I want them built. We have to make certain the business can operate first. I have other means to account for it. Complete all work before reporting back with a summary report. Let me know what was done, and what I need to do. Follow the standing rules. Thank you!

### What production showed (read-only, 2026-11-01 business day)

- SR2 evening drawer `631967ef`: closed on the iPad at **$0.00** (every denomination 0, tips pool $180 / 2). The office second count (a different employee) was **$2,678.10**. Expected was $2,778.00. It was reconciled against the $0.00, so it shows **short $2,778.00** (reason "not sure"). The ledger refused the post (`TILL_CLOSE_BELOW_FLOAT`). On the second count it is **short $99.90**. This is the "strange message": the second-count banner compared the second count with the $0.00 close.
- SR2 day drawer `3e4404bf`: close and second count both $2,220.00, expected $4,073.00 (short $1,853.00). No drops were recorded all day. This needs the owner's own check; the software counted correctly.
- SR1 drawers: short $49.90 and short $1.30.
- All four clock-outs were punched at 23:09 on one iPad, so two of the day-shift timesheets are long by about 7 and 6.5 hours (owner to edit).

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D125 | **A $0.00 close must be confirmed.** When no bills or coins are entered, the iPad shows "No bills or coins entered. The count is $0.00." and a tick box "The drawer is really empty". Close drawer stays off until it is ticked. The server refuses a $0.00 close without the flag (`confirmEmpty`) and says so in plain words, nothing saved. The same rule applies to the back-office close form. A real empty drawer (all cash dropped) can still close; the tick is audited (`confirmedEmpty`). | *"Please build 1-3 now."*, item 1: "Stop accidental $0 closes" |
| D126 | **Reconcile is held when the closer's count and the second count are more than $5.00 apart** (the same $5 line as D7). The manager chooses the count the drawer is reconciled on: the second count, the closer's count, or their own recount (typed). They must write why. Over / short is worked out from the chosen count, and the closer's original figure is kept in the drawer's notes and the audit log (`drawer.count_basis_chosen`). Compare-and-set on the original count. Equal counts, including two $0.00 counts, are not held. This refines D122 ("over / short uses the closer's count"): it still does when the counts agree within $5.00. | item 2: "Catch big differences before reconcile" |
| D127 | **Owner and admin can correct a reconciled drawer** on its till summary page (Register Activity → Cash drawer reports → the drawer). They use the second count or type the right figure, with a required reason. Over / short is worked out again against the expected figure the reconcile stored. The old and new figures are appended to the drawer's notes, the over/short reason becomes "Corrected: … (was: …)", and both are audited (`drawer.reconcile_corrected`, `drawer.reconcile_correction_refused`). **The books are not touched** (owner: "I am not ready to finish the books yet"). A drawer that already has a ledger entry, or whose cash is in a sealed deposit bag, is refused. If either cannot be read, it is also refused (never guessed). No migration. | item 3: "Correct a reconciled drawer" |
| D128 | **Item 4 (posting templates / finishing the books) is deferred** at the owner's word. Nothing in the books changed in this work. | *"I am not ready to finish the books yet as much as I want them built. We have to make certain the business can operate first. I have other means to account for it."* |

## Owner requests, 2026-11-02 (recorded verbatim, CLOSE-DRAWER OPEN FOR THE BLIND COUNT, CLOCK-OUT AFTER THE BLIND COUNT)

> Thank you! I have two more requests now. Please complete both for me. Follow the standing rules. Thank you.
> - [ ] For close drawer step, drawer should pop if given the employee assigned that tills pin. Should be logged in the audit log and give me warning if being used more than once per shift. Is there a smart way to keep this button, close drawer, safe from abuse? I need the drawer to pop for the first blind count.
> - [ ] Clock out allowed after first blind count, not after second count closing the till.

### What production showed (read-only)

- The clock-out guard (D84) already blocked only a drawer with status `open`; a drawer closed on the iPad and waiting for its office second count did not block. So the second count was never what held anyone.
- What did: on 2026-11-01 Michael Lyman closed his own SR2 drawer at 10:52:17 PM and his clock-out was refused at 10:52:48 PM with *"You still have an open drawer on Sales Register 1"*. He had counted in SR1 at 4:45 PM for Daylin Cole, who rang all 38 of its sales; SR1 was closed at 11:06 PM, and every clock-out then happened at 11:09 PM. The guard tied a drawer to whoever counted it in (`drawer_sessions.opened_by`), not to the person working it.
- The iPad already had a way to open the drawer without printing (`openCashDrawer`, the Star plugin in the packaged app, used by R-DRAWER-1); the close screen did not use it.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D129 | **The till is assigned to the cashier working it**: the employee who rang the most sales on it since it was counted in (a tie goes to the latest), or, before its first sale, the person who counted it in. A manager ringing one sale to help out does not take a drawer over. Used for opening the drawer at close (D130) and for the clock-out guard (D132). No migration: worked out from `pos_sale_events`. | *"the employee assigned that tills pin"* |
| D130 | **The close screen opens the drawer for the blind count**: Step 1 is the cashier's PIN and **Open drawer to count**. The server checks the PIN is the assigned cashier's (D129), writes `drawer.popped_for_count` to the Security Log, and only then does the iPad kick the drawer (without paper on the iPad app; a short slip elsewhere). Any other PIN is refused and audited (`drawer.pop_refused`); a manager who must get in uses No sale (reason and manager PIN) as before. The server never returns an expected figure, so the count stays blind. | *"For close drawer step, drawer should pop if given the employee assigned that tills pin. Should be logged in the audit log ... I need the drawer to pop for the first blind count."* |
| D131 | **Kept safe from abuse (professional call)**: the PIN must be the assigned cashier's and the request must come from this register's paired iPad (two factors); it only works on an open drawer on that register; the **first open per drawer is free**, every further open needs a typed reason, is still allowed (a drawer can shut mid-count) and is a warning (`drawer.pop_repeat_warning`). The owner is also warned when a drawer opened for the count is **not closed within 15 minutes**, or is **closed by someone else**: the two ways the button could be used as a free No sale. A failed history read refuses rather than handing out a free open. Warnings are on Register Activity → **Over / short warnings**, section **Drawer opened for the count** (owner and admin, `registers.warnings`). | *"give me warning if being used more than once per shift. Is there a smart way to keep this button, close drawer, safe from abuse?"* |
| D132 | **Clock-out is allowed as soon as your own blind count is done.** Only a drawer still `open` holds you; the office second count and reconcile are never waited for. The guard looks at the drawer you are working (D129), so counting a drawer in for someone else no longer holds you on the clock once they are selling on it. The refusal now says *"You do not wait for the office second count (owner rule D132)."*; the close success line says *"you can clock out now"*. D84 otherwise stands: closing does not clock you out. | *"Clock out allowed after first blind count, not after second count closing the till."* |

## Owner request, 2026-11-02 (recorded verbatim, CVB-7: the Cultivera harvest stopped at stage 4 of 8)

> Thank you. The crawler has gotten stuck on step 4 of 8. This is the message I get, " Harvest 20261102T013302Z-a0b9e827
> Stopped with a problem: shifts/list: Count 1662 but 0 unique rows. 4 of 8 stages, 16 datasets, 73,870 rows. Press Continue to retry the rest.
> Dates covered: 2015-01-01 to 2026-11-01 (Pacific)."
> I still have access to the back office, so something else has stopped it. My crawler fetching customer loyalty points finished a few minutes ago successfully. Please login to Cultivera and make sure the fetch logic is correct for the remaining pieces. Follow the standing rules. Thank you!

### What the live back office showed (read-only, 2026-11-02)

- `shifts/list` answered `{"Count":1662,"Data":[]}` for every page size (5 to 1,000), with or without a sort. The back office's own grid (cbo-app.bundle.js) spreads Kendo's `...options` into the body (`skip`, `take`, `page`, `pageSize`, `sort`) beside `Page`. With those keys present, 1,000 + 662 rows came back, 1,662 unique. The 2026-11-01 note "1,000 works" was wrong.
- Every other list was then re-read live. `products` (Count 17,605) also came back empty with the Page body; its grid sends Skip/Take flat, which returns all rows. `customers/customer-loyalty-point-adjustment` answered HTTP 500 without CustomerId/FromDate/ToDate, or with any sort; null filters and no sort return all 25. `activity` (Count 139,335) serves at most 1,000 rows per call and ignores Skip, so every page was the newest 1,000. Month windows add up to the all-time Count. A month holds up to about 5,200 rows and a day at most about 225.
- A one-day `activity` call is a 24-hour filter, so on the fall-back day (25 hours) it misses 11 PM to midnight. On 2024-11-03 it missed two rows: a $65.00 sale and Register 1's close. On 2025-11-02 it missed one. The month Count caught it (5,734 against 5,732), and the harvest stopped instead of saving a short month.
- These were checked unchanged: the other 29 lists (first and last page, distinct keys), orders (monthly windows, no overlap between pages), both cycle counts (items = header ItemCounts), and valuation snapshots (126, rows = Count).

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| CVB-D12 | **Each list is requested exactly as the back office's own screen requests it** (read from cbo-app.bundle.js and confirmed live): shifts with the Kendo keys, products flat, and loyalty adjustments with the three filters and no sort. Nothing is inferred from a neighbour endpoint. | "make sure the fetch logic is correct for the remaining pieces"; never guess |
| CVB-D13 | **A list that ignores Skip is read in date windows, never paged.** Activity is read by Pacific month; a month the server holds more than one call's rows for is read day by day. Each day call covers that day and the next, and only rows whose own Pacific wall-clock day is in the month are kept (de-duplicated by Id), so the fall-back hour is never lost. Every window is Count-verified, a day the server still truncates stops the harvest loudly, and the windows must equal the all-time Count. Nothing is silently short. | "Leave nothing out"; Pacific time |
| CVB-D14 | **The stopped harvest is continued, not restarted.** The 16 finished datasets and 4 finished stages are kept. Pressing Continue on the Cultivera Archive page resumes at shifts with the fixed requests (after the crawler is redeployed with this fix). | "Press Continue to retry the rest" |

## Owner request, 2026-11-02 (recorded verbatim, D133–D136: harden the registers and the promotions, easier promotion building, daily-deal button, wording warnings)

> thank you. I want to enhance and harden the ipad registers and the promotions logic to protect against this in the future. for the promotions page, its great, but it feels complicated and not as straight forward as I would like. there are many different sections, and it is not clear if I need the top one set in addition to the ones below or if I need to do something is some specific way. please make building promotions a bit easier. add more helpers and hover helpers maybe, or give clear explanations for what each section does. for our routine daily deals, I want a button that I can push that will set it up automatically for me. except for thursday, that one is a manual processes. we will test it out this coming thursday. we have not properly set it up yet. I also want to be warned if the text we use is misleading or unlawful or inappropriate, etc. not block, just warn and suggest. complete all tasks before returning back with a summary report of what was done, what i need to do and anything important i need to know about. push and merge the work when you are finished. after you have finished the tasks requested, log back into supabase for me and look for the loyalty points program data. it is suppose to be 150 points buys you 10% off, or 300 points buys 25% off. you earn 1 point for every dollar spent before tax. right now, i am told that the loyalty discount is using the maximum number of points. the example i was given, someone had used their loyalty points on a 120 dollar purchase, they had a ton of points, when we ent to apply them, the system wanted to give them 65 dollars off, over 54% off, which is probably the max the system allows, so it capped it there. i need you to help me set up or fix the loyalty points program logic so it behaves properly. thats a read only strategy round, after the code edits are in and merged. follow the standing rules. thank you!

### What production showed (read-only, 2026-11-02)

- On Monday 2026-11-02 a register applied **Sunday's** buy-3-pay-for-2. The register works from the menu bundle it downloaded, and that bundle carried the deal that was live when it was downloaded; nothing checked the day again, and the server took the sale as rung.
- The live daily-deal rows did not match the standard week: Monday 20% (standard 25%, without RSO in the order); Tuesday an either/or 20% or 4-for-3 (standard 1+ items 20%, 4+ items 25%); Wednesday an empty spend-tier config (so only the 20% fallback) with a start date of 2026-10-21 and RSO excluded; Friday weight tiers with an extra *everything (storewide)* target; Saturday **0%** with an empty config; every row priority 0.
- Thursday has not been set up properly: it is a 25% percent deal on 1937, Constellation, Blue Roots, Blaze and American Hash Makers. PERMA's brand on the menu is **Sunny Smokes**.
- The never-discount list is empty.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D133 | **The register never applies another day's deals.** Each promotion in the bundle carries the Pacific weekday it is for; the register re-checks the day every 30 seconds and drops any deal for a different day (the register then says *Today's deals are not loaded on this register yet, so no daily deal is being applied* until it has today's), refreshes its bundle as soon as the day turns, and stamps each sale with the deal day used. The server compares every synced sale with the schedule at the time of the sale and writes a `register.promo_day_mismatch` audit row when they differ; it never refuses the sale (the money was taken). | *"harden the ipad registers and the promotions logic to protect against this in the future"* |
| D134 | **Set up our daily deals button** on Promotions: it compares Monday, Tuesday, Wednesday, Friday, Saturday and Sunday with the standard week and shows every change before you press it; pressing it saves and publishes each day (each one through the same pre-publish check as Publish; a day that fails the check is skipped and named). The owner's own titles, descriptions, bonus notes and product/brand exclusions are kept. Thursday is never touched (manual each week). Pressing it again when everything matches changes nothing. | *"for our routine daily deals, I want a button that I can push that will set it up automatically for me. except for thursday, that one is a manual processes."* |
| D135 | **Wording check: warn and suggest, never block.** As you type, the promotion form checks the title, description and bonus note for wording Washington does not allow in cannabis advertising (free / giveaway, minors, health or safety claims, over-consumption, alcohol or tobacco references, superlatives and guarantees, vendor-paid wording, "unlimited") and for text that does not match the deal (a percent, dollar amount, bundle, weekday, product type, brand or "storewide" the deal does not give). Each heads-up says why and suggests wording. The list of promotions shows a heads-up count. Saving and publishing are never stopped by it. Professional call, not legal advice. | *"I also want to be warned if the text we use is misleading or unlawful or inappropriate, etc. not block, just warn and suggest."* |
| D136 | **Building a promotion is explained step by step**: a *Which sections do I need?* table (for each kind of deal, which boxes to fill and which are ignored), numbered steps marked *(always)* or *(optional)*, and a hover hint (ⓘ) on every field. Old help text that was wrong (either/or "saves less") was corrected: the either/or gives the customer the better option. | *"it is not clear if I need the top one set in addition to the ones below … add more helpers and hover helpers maybe, or give clear explanations for what each section does."* |

## Owner request, 2026-11-02 (recorded verbatim, D137–D141: loyalty rewards 150 pts = 10% off and 300 pts = 25% off, $0.10-per-point retired everywhere, badges are names only and renameable)

> thank you. yes, one redemption per sale, and works exactly as you described in the proposed fix. no dollar cap on the 25% off. bronze and gold stay as names only, everything else about them can be retired. i would like the ability to change their names though now that i think of it, please build that in somewhere practical for me. the $0.10-per-point should be retired and the website, register, receipts, back office, all places should be updated to reflect this retirement. please make sure to go above and beyond, by this i mean, if i failed to mention something, or if there is something important that you the expert professional would also do, please use your executive decision making powers i am granting you to make improvements and enhancements that add value beyond what i am asking for. follow the standing rules. thank you.

The *proposed fix* the owner approved (from the read-only loyalty report of the same day): the register shows **Use 150 pts – 10% off** and **Use 300 pts – 25% off**, only the ones the balance covers; the percent comes off pre-tax; exactly 150 or 300 points are deducted; per item the customer gets the better of the day's deal or the reward, never both; the legal floors still apply; back-office codes follow the same rules.

### What production showed (read-only, 2026-11-02)

- `loyalty_config`: `points_per_dollar` 1, `point_value_minor` **10** ($0.10 per point), `min_redeem_points` 150.
- `loyalty_tiers`: **Bronze** (min 150 lifetime points, `discount_bps` 1000) and **Gold** (min 300, `discount_bps` 2500). The tiers were standing member discounts, which is not what the owner meant by "150 points buys you 10% off".
- The register's **Redeem** button spent the **whole balance** at $0.10 per point, capped only by what the cart could absorb above the legal floors. The owner's example: a member with a large balance on a ~$120 sale ($87.83 pre-tax) was offered **$65 off (about 54%)**. Under the approved rule the most is 25% (about $21.96 pre-tax), for exactly 300 points. The test member had 2,472 points.
- 0 reward codes outstanding; 0 orders priced at a tier; one earlier sale used a points code of **465 points ($46.50)** under the old rule.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D137 | **Two fixed rewards: 150 points = 10% off, 300 points = 25% off.** The register shows *Use 150 pts – 10% off* / *Use 300 pts – 25% off*, only the ones the balance covers. Exactly 150 or 300 points are deducted, never the whole balance. The percent comes off each item's regular price (so the same percent off pre-tax); per item the customer gets the better of the day's deal or the reward, never both; no item goes below its legal floor (1¢, acquisition cost). **One reward per sale, no dollar cap.** If the day's deals already match or beat the reward on every item, the reward is refused and no points are used. Back-office reward codes (customer profile, order page) follow the same rules. An old register app that does not send a reward choice is given the best reward the balance covers, never the whole balance. | *"yes, one redemption per sale, and works exactly as you described in the proposed fix. no dollar cap on the 25% off."* |
| D138 | **The $0.10-per-point cash value is retired everywhere.** Points have no cash value: the website loyalty page and program terms, the cart estimator, the register (balance line, buttons, rail, payment screen), receipts (*Reward used: 25% off (300 pts)*), the back office (Loyalty Program, customer profile, order page, customer insights, reports and CSV, the loyalty advisor, the concierge and the website AI) show rewards, not dollars. The menu bundle no longer carries a point value. The old database columns stay and are ignored (no migration). | *"the $0.10-per-point should be retired and the website, register, receipts, back office, all places should be updated to reflect this retirement."* |
| D139 | **Bronze and Gold are names only, and the owner can rename them.** They give no discount and set no reward; they are badges by lifetime points (Bronze 150+, Gold 300+). CRM → Loyalty Program → **Member badge names**: type a new name and save. Names are 1–40 characters, no `<` `>` or control characters, and no two badges share a name (case-insensitive). Each rename is audited (`loyalty.tier.rename`, before and after) and the website, customer profiles and register pick it up. Adding, deleting and the percent fields are gone. | *"bronze and gold stay as names only, everything else about them can be retired. i would like the ability to change their names though … please build that in somewhere practical for me."* |
| D140 | **Rewards never touch never-discount items**, at the register and in the back office, the same as promotions. **Old-style points codes** (from the retired $0.10 program) are refused with instructions: cancel it on the customer's profile (the points go back), then use a 10% or 25% reward. | professional call, *"if i failed to mention something … use your executive decision making powers"* |
| D141 | **Value-adds (owner's grant of executive judgement):** a **full void returns the reward's points** (once, conditional update; partial returns do not); **Cancel & return points** on any open reward code on the customer profile (audited `loyalty.reward_code.cancel`); a register reward removed before the sale is released, and only codes the register or order page issued are cancelled automatically (a code the customer brought stays theirs); **every reward used is audited** (`loyalty.reward_used`); the Loyalty Program page, the loyalty report and the customer insights show who can use a reward now, rewards used (10% / 25%) and the amount taken off, instead of a dollar liability; the advisor's ground truth states the new rules. | *"please make sure to go above and beyond"* |

## Owner request, 2026-11-03 (recorded verbatim, D142–D150: offline mode verified, iPad lockdown, setup checklist, status-bar collision, "am I on the newest version?" on the lock screen)

> Thank you. The next thing I need you to do now is log back in to supabase, and make certain that offline mode is working properly as intended and if there is any weaknesses we need to harden or any gaps we should fill. Is this something you can check more reliably via database query? If so please query the database and make certain offline mode is perfect. Let me know what I need to do on the iPad to make the settings perfect for this to work. Add it to the back office, a checklist or todo list or some enterprise grade method for making this simple, that we can use to make sure the settings are correct. Add to this how I can pin the app so nothing else can open, so it can't be closed. The iPad top menu bar with the time and such, collides with our apps top menu bar. This round is meant to make the iPad connection as perfect as possible and add settings and task lists to the back office register activity screen the ability to set the correct settings and such to make the iPad behavior set in stone and something only I can undo. Please go above and beyond. Follow the standing rules. Thank you!

> Sorry to stop you. I saw you mention that I hadn't applied the new register rebuild. I thought I had done that by downloading the current repo to my desktop and then using Xcode to rebuild them. Can you add into this slices work a way for me to see or validate in some way I am on the latest version for my iPad registers? So I don't rebuild them thinking it worked when I really missed a step somewhere and didn't actually update the registers. I use the iPad app specifically. I will never use the browser register. Please add to the lock screen of the app something bold that says I am running the newest version and all is good. Please continue. Follow the standing rules. Thank you.

### What production showed (read-only, 2026-11-03 ~04:21 UTC)

- `pos_devices`: **Register 1** and **Register 2** active and heart-beating, 0 rejected rows each. A third device, **"Test iPad"**, is still **active** and was last seen 2026-11-01: a paired key nobody is using (stale-device gap).
- `pos_sale_events`: 861 processed, 37 exceptions (all resolved), `recovery_attempts` max 0. No sequence gaps and no duplicate client ids, so the queue/ack/idempotency path is sound.
- Sync timing: p95 about 15 seconds from sale to server, none more than 2 minutes late. **Real offline operation has never been exercised in production**: every sale reached the server within seconds.
- `promoDayKey` (added D133) is present on **0 of the 80 sales since D133**, so **both iPads still run a pre-D133 bundle** even though the owner rebuilt in Xcode. Mac/Xcode builds were stamped `dev`, and the stale-build check ignored `dev`, so nothing told the owner. The usual miss is pressing Run in Xcode without first running `npm run register:build:ios` (which builds the web bundle and copies it into the Xcode project).
- `audit_logs.user_agent` for register actions shows a desktop-Mac string (WKWebView), so it cannot identify the app build.
- Offline PIN unlock is online-only (GW-007, unchanged); pairing credentials live in the app's local storage.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D142 | **Offline mode verified by query; the gaps found are fixed or listed.** Queue, acks, idempotency and exception handling are sound (above). The weak points were all visibility: the back office could not see an iPad's version, unsent sales, Guided Access, power or settings. Fixed by D143–D149. Documented, not changed: PIN unlock still needs the internet (GW-007) and pairing stays in app storage. | *"make certain that offline mode is working properly as intended and if there is any weaknesses we need to harden or any gaps we should fill ... please query the database"* |
| D143 | **Bold "newest version" banner on the lock screen.** Every build carries a fingerprint (sha-256) of the register source (`RegisterShell.tsx` and every local file it imports, plus the native/config files). Vite stamps it into the iPad bundle, Next stamps the same value into the server, `/api/pos/version` returns it. The lock screen shows **green "NEWEST VERSION — ALL GOOD"**, **red "NOT THE NEWEST VERSION — REBUILD THIS IPAD"**, or **grey "THIS APP CANNOT VERIFY ITS VERSION"**; offline it shows the last confirmation time. The preflight prints *"this build will be <code>"*, and the back office shows the server's code. | *"Please add to the lock screen of the app something bold that says I am running the newest version and all is good."* |
| D144 | **Status bar no longer collides with the register header.** The native app hides the iPad status bar (Info.plist `UIStatusBarHidden`, `prefersStatusBarHidden` on the bridge view controller, Capacitor `SystemBars.hidden`). Second line of defence: every full-screen register surface pads by the safe-area inset. | *"The iPad top menu bar with the time and such, collides with our apps top menu bar."* |
| D145 | **Each iPad reports its health.** Every heartbeat and flush sends app fingerprint, build, unsent-sale count and oldest age, rejected rows, menu age, storage readiness and native status (Guided Access, Low Power Mode, charging, battery, keep-awake, iPadOS, free disk) from a new native `GreenwayDevice` plugin. Stored per device as a `site_settings` row (`pos_device_health:<id>`, throttled to one write per 5 minutes unless something changes). | *"make the iPad connection as perfect as possible"* |
| D146 | **Owner-only lockdown policy.** New permission `registers.lockdown` (owner only). Register Activity → **iPad setup & lockdown**: keep the screen awake (default on); what happens when Guided Access is off: nothing / warn (default: bold red lock-screen notice) / block (refuse PIN unlock); days before an active device is flagged stale (default 3). Registers pick it up on the next heartbeat. Audited `pos.ipad_lockdown_saved`. | *"make the iPad behavior set in stone and something only I can undo"* |
| D147 | **Per-iPad setup checklist with live verification.** 18 items in five groups (pin the app, iPad settings, app build, power/network/accessories, offline drill) with exact taps. Items the iPad can measure (Guided Access, keep-awake, Low Power off, newest version, charging, no unsent sales) show the device's live answer; a tick the device disproves turns red and does not count. Only the owner ticks; each tick audited `pos.ipad_checklist_checked/unchecked`. | *"a checklist or todo list or some enterprise grade method for making this simple, that we can use to make sure the settings are correct"* |
| D148 | **Pinning the app = Guided Access with an owner-only passcode.** Steps on the page and in the checklist; Face ID/Touch ID for ending it off; Screen Time restrictions block deleting or installing apps. The lock screen warns (or blocks, per D146) when Guided Access is off. | *"Add to this how I can pin the app so nothing else can open, so it can't be closed."* |
| D149 | **Stale devices are flagged.** An active device with no contact for the policy's days is shown in red with "revoke it on POS devices". Today that is the **Test iPad**. | professional call, *"Please go above and beyond"* |
| D150 | **Value-adds:** the preflight refuses to build without a fingerprint and prints it; the confirmation is remembered on the iPad only for the same build; the back office summary says how many iPads need a rebuild; the offline drill is in the checklist; the app itself keeps the screen awake when the policy says so. | *"Please go above and beyond"* |

## Owner requests, 2026-11-02 / 2026-11-03 (recorded verbatim, CVB-8: Cultivera history in our reports and forecasts, cockpit taxes, sales by hour, Leafly tile)

> Thank you, that worked. Now that we have everything, would it be smart to backfill our reports so we can see our historical data in our reports and forecasts and such. Is this something an enterprise grade platform would offer or do for a migrating customer? Please deep research this. Then recon our reports. If we are to add the data to our reports, I want the Cultivera data to be clearly marked somehow so I know which systems data we are using as a forecast or comparison. Please clone a fresh copy of the repo, the. Complete all tasks before returning back with a summary report. Follow the standing rules. Thank you.

> Thank you. I agree with your plan, I want to build all of what you have laid out as recommendations. I want to add to this as well a slight enhancement to the main dashboard cockpit. I want to see excise tax, sales tax, and after tax sales figures. Also, the sales by hour section is broke. Please also repurpose the menu upload tile to be a Leafly dedicated tile for a quick look at connection status, last sync, etc. the menu upload is a one time thing and is done now so we need to retire the page at some point. Please prob the sandbox one time, if it is working, proceed, if not, stop. Because the sandbox is unstable, commit work out of it often to keep the work safe. Push and merge to the repo often to keep the work safe. Follow the standing rules. Thank you.

### What the research and the live back office showed (read-only, 2026-11-02 PST)

- **Enterprise practice.** Lightspeed X-Series does not bulk-import sales from a previous POS; its demand forecasting wants 6 weeks of recent sales and 2 years for seasonality. Paid importers (Hyperspace) tag imported sales with a "Historical" employee/payment because imports change inventory and are hard to remove. Cova recommends a clean cut-off with side-by-side reporting rather than moving transactions. Dutchie tells stores to archive the old system's reports before leaving. KORONA lists three options and recommends summary-level history (1 to 2 years) when transactions cannot be imported. Shopify-style imports keep the original dates and are reconciled to the cent. Sources are listed in docs/roadmap/CVB-CULTIVERA-BENCHMARK.md section 9.
- **Cultivera.** `reports/daily-sales` has 790 days (2024-08-30 to 2026-10-31) of dollar figures but no order or unit counts. The `orders` grid (archived as `orders.YYYY-MM.jsonl.gz`) has per-order `Total` (tax-inclusive, after discount), `Units`, `IsCompleted` and `CreatedAtStr` (Pacific wall clock).
- **Reconciliation, to the cent.** On days without returns, the sum of `Total` over completed orders equals Cultivera's `NetSales + Taxes`: 2026-10-31 = $8,886.34 (192 orders, 404 units); 2025-03-15 = $9,106.35. Days with returns differ (2025-12-24: $8,300.28 against $8,319.28; 2024-11-03: $15,341.12 against $15,448.36), so those days are flagged, never silently used as matching.
- **Our reports.** The Forecast, Overview and Sales tabs read only our `orders`. Forecast and Overview revenue is the order total (tax-inclusive), the same basis as Cultivera's completed-order totals. Only the Cultivera Benchmark tab reads Cultivera data.
- **Dashboard.** "Sales by hour (today)" drew every bar at its 3 px minimum: each bar's height is a percentage of a flex column that has no height of its own, so the browser treats the percentage as auto. Reproduced in a headless browser with the same CSS, and fixed the same way. The "Last POS import" tile still points at the one-time menu upload page.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| CVB-D15 | **Cultivera history is kept separately, never mixed into our books.** A new table `cultivera_history_days` (0338) holds one row per Pacific day: Cultivera's completed-order revenue (tax-inclusive, after discount, in cents), completed orders and units, built from the archived `orders` parts (sha256-checked bucket copy) and cross-checked against Cultivera's own daily report (`NetSales + Taxes`). A day that does not match (usually a return day) is stored with the difference and flagged. Nothing is written to orders, inventory or the general ledger. Owner-only, kept by the factory reset. Built by **Build report history** on the Cultivera Archive page (audited). | "backfill our reports so we can see our historical data"; never guess |
| CVB-D16 | **Forecast data source switch.** Reports → Forecast gets "Data source": **Greenway only** (default), **Greenway + Cultivera history**, **Cultivera only**. Cultivera days are used only before the cut-over date, never on a day we have our own figures. The two Cultivera options are owner-only (`cultivera.benchmark`). Cultivera actuals draw as their own line, labelled with a gold **"Cultivera (imported)"** badge, with a dashed line at the cut-over, and a note says which system fed the forecast. The AI insights are told the source. | "I want the Cultivera data to be clearly marked somehow so I know which systems data we are using as a forecast or comparison" |
| CVB-D17 | **"Same period last year" on Overview and Sales.** An optional comparison of revenue, orders and units with the same calendar days one year earlier. Each figure says which system it came from (**Greenway** or **Cultivera (imported)**), and a period that spans both is shown split, never blended silently. The Cultivera part is owner-only. | same |
| CVB-D18 | **Cockpit taxes.** The dashboard's today block adds **Excise tax**, **Sales tax** and **After-tax sales** (what the store keeps: the pre-tax base). They are computed by the same engine as Reports → Tax (`getWaTaxReport`: 37% excise on cannabis lines, 9.3% combined sales tax, medical exemptions honoured), on completed orders today. | "I want to see excise tax, sales tax, and after tax sales figures" |
| CVB-D19 | **Sales by hour fixed.** The bars now sit in a fixed-height track so their percentage heights work. Only the hours from opening to closing (or to the last sale) are drawn, and each bar shows its amount and order count on hover. | "the sales by hour section is broke" |
| CVB-D20 | **Leafly tile replaces the menu-upload tile.** The dashboard's "Last POS import" tile becomes **Leafly**: the same connection verdict as the Leafly page (connected / waiting / failed / not connected), when Leafly last received the menu, and the last automatic check. It links to the Leafly page for those allowed to open it. It never fails the dashboard: an unreadable history shows "Cannot check". | "repurpose the menu upload tile to be a Leafly dedicated tile for a quick look at connection status, last sync, etc." |
| CVB-D21 | **The menu upload page is retired later, not now.** It is listed on the roadmap (CVB-12): remove every link to `/admin/menu-imports`, keep the import history readable, and then remove the page. | "we need to retire the page at some point" |
| CVB-D22 | **Ship in small merged slices.** Each slice is committed, pushed, rebase-merged and checked on Vercel before the next starts, because the sandbox is unstable. | "commit work out of it often ... Push and merge to the repo often" |

## Owner request, 2026-11-03 (recorded verbatim, D151–D155: drawer close slip to leave with the till, read-only view of the second count)

> Thank you. That is working great now. I need your help enhancing the end drawer feature on the iPad register. I want it to print a short receipt with the employee name and register number and other such important details so they can leave it with the till for the second counter to know who's till they are counting. The Second counter should have an option to see the numbers they input after submitting their count. I want to be able to see the table with the numbers in it again. Read only. I have another agent working, so complete all tasks, commit them out of the sandbox to keep the work safe, then wait to merge until I say it is safe to do so. Follow the standing rules. Thank you!

### What production showed (read-only, 2026-11-03 ~07:10 UTC)

- `drawer_counts`: 8 `open`, 8 `close` and 6 `second` rows. Every drawer with a second count has exactly one `second` row holding the full bill-by-bill breakdown. **The numbers the second counter typed are already saved, so no migration is needed**: only a read path and a screen.
- Two drawers were closed and waiting for a second count at the time (Sales Register 2 closed 07:09 UTC, Sales Register 1 closed 07:04 UTC). The register names in use are **"Sales Register 1"** and **"Sales Register 2"**.
- Today a non-manager loses sight of a drawer as soon as their second count saves (the card disappears), so there was no way to look at what they typed.
- The close is blind (D121) and the second count is blind (D122/D123). Nothing printed at the till may carry the counted or expected amount.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D151 | **The till API returns the slip details on close.** `/api/pos/till` `close` now also returns `closeSlip`: drawer id, register name, who closed it, who counted it in, business day, opened and closed times, the iPad's name. **No money**: no counted total, no expected, no tips, no over/short. A failed lookup never fails a close that already saved. | *"print a short receipt with the employee name and register number and other such important details"* |
| D152 | **The iPad prints a DRAWER CLOSED slip right after a close.** Banner **"DRAWER CLOSED — LEAVE WITH THE TILL"**, the register name and the employee's name in large print, then register, closed by, opened by (when a different person), business day, drawer opened and closed times, iPad and a short **drawer ref** (the first 8 characters of the drawer id), and a line telling the second counter to count by themselves and enter their own PIN on Register Activity, with blanks for their name and time. New print kind `drawer_close`; the printer refuses one that would open the drawer (it was already opened and audited for the count, D130). If the printer fails, the close still stands and the banner says to use **MORE ▸ Reprint drawer close slip** (marked "REPRINT"). If the server sends no details (old server), the iPad prints from what it knows. | *"so they can leave it with the till for the second counter to know who's till they are counting"* |
| D153 | **The slip shows no amounts, by design.** A slip saying how much was counted would give the second counter the number to hit, and the second count would no longer be independent. A test fails the build if a `$` amount ever appears on the slip. | professional call, protecting D121–D123 (blind close and blind second count) |
| D154 | **The second counter can see the numbers they entered again, read only.** After **Save second count**, Register Activity shows **"See the numbers you entered"**, open: every bill and coin ($100 down to 1¢) with quantity, amount and total, as plain text (no boxes, no buttons). The drawer stays visible to non-managers as a **"Second count saved"** card with the same read-only table until a manager reconciles. Managers see a **"Second count table"** on the reconcile card, and the till summary (history) shows it too. Only the second count's own table is shown: never the closer's count or expected cash. A wrong count is still corrected the existing way (D126/D127), never by editing this table. | *"The Second counter should have an option to see the numbers they input after submitting their count. I want to be able to see the table with the numbers in it again. Read only."* |
| D155 | **Value-adds:** the drawer ref is printed on the slip and shown on every second-count card, so paper can be matched to screen; the slip reprints from MORE; the post-save URL only accepts a real drawer id. **Not merged until the owner says it is safe** (another agent is working). The register fingerprint changes, so **both iPads need a rebuild after merge** (the lock screen will say so). | *"complete all tasks, commit them out of the sandbox to keep the work safe, then wait to merge until I say it is safe to do so"* |

## Owner request, 2026-11-03 (recorded verbatim, D156–D160: manifest intake unblock round — duplicate Cultivera uploads, lab-agnostic COAs, books product line)

> Sorry to stop you. It is likely we will continue getting coas from labs we have never heard of. We need our system to not care which lab it came from. Or it needs to flag it so I can confirm myself. But anything that came from CCRS, used a real legit lab. So we can't block products just because we haven't seen that lab yet. Please continue. Thank you.

> Thank you. Yes please build everything you recommended in one round, broken up into manageable slices. Push and merge work often to protect the work. For the Cultivera menus, that was my fault, I thought the button didn't work and so I must have pushed it two more times. Please clear those out and unlock the system so I can start intaking the rest of the waiting manifests. You don't need to build anything for the Cultivera menu upload page, we will retire it soon, we only needed it the one time and we now have all data from Cultivera, so it'll never get used again. Everything else recommended, please build. Follow the standing rules. Thank you!

> Sorry to stop you. Please confirm for me to give me peace of mind, you are clearing the two unpublished Cultivera menus and not publishing the latest version? We have had sales for the past two days now, so I just want to make sure nothing done here is going to mess anything up inventory numbers wise. Please continue. Thank you.

> I'm done. Let me know when it's safe to resume sales on the register please. Thank you.

> thank you. please proceed with all fixes. for number 4, the unposted bills, it is fine that they dont post to the books yet. we have not finished the books yet, and I dont have the resources to finish it. the remaining credits I have left need to be used to solve real problems like blocking sales and other such important things. please complete all task, including the bookkeeping work, if you can keep the spending on it to a minimum. we havent abandoned it, so I want to make sure it is in good shape when we come back to it later. follow the standing rules. thank you.

### What production showed (read-only, 2026-11-03)

- Manifest #12075358321394116 (Edgemont Group dba Sungrown, 32 lots, all new products) showed no price on the product page and *"Partly read … 1 check(s) disagree"* on its COAs.
- **No price:** on 2026-11-01 07:25–07:27 UTC the Cultivera upload was pressed six times with the identical file pair (same `products_file_hash` / `inventories_file_hash`). The 4th copy (import `a474040b`) was published; copies 5 and 6 (menu versions `e1fc37c3`, `2d63d20e`) were created after it, so migration 0236's archive (older staged rows only) never touched them. They stayed `staged`, the cutover guard read them as "Cultivera not published yet", and 34 receiving updates for 3 deliveries (Edgemont, plus the migrated Botanical Arts and Dope Synergy manifests) were held for two days. Nothing alerted.
- **COA:** all 31 certificates are from Medicine Creek Analytics, a lab the readers did not know (test type `Cannabinoid`, analytes `Δ9 THC`, `Δ9 THC-A`, `Activated Total THC`). The state sample id in the lab JSON (`sample.id` 12074675516159269) equals the id in the COA file name and the *External Inv ID* on the PDF, but the identity check only knew two labs' URL patterns.
- **Books:** WCIA-format deliveries store `inventory_category` = `EndProduct` as the lot category, which the receipt/bill category table does not know, so the whole delivery's receipt and vendor bill were refused (Edgemont; Bellevue Cannabis Company is the same).

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D156 | **The two duplicate Cultivera uploads were retired by an owner-approved data operation, not published.** `menu_versions` `e1fc37c3…` and `2d63d20e…` set `archived` with `archived_reason` `duplicate_of_published:c1523a47…`, one `audit_logs` row each (`menu_version.duplicate_upload_retired`). The owner then pressed **Rebuild on the live menu**; the three deliveries published on top of the live menu. Verified after: the old live version archived, nothing staged, every product's stock equal to or 1 lower than the old live menu's last number (the 3 lower = the one sale at 19:20 UTC, after the publish), none higher, none missing; 32 Edgemont products live, all priced. | *"Please clear those out and unlock the system"*; *"you are clearing the two unpublished Cultivera menus and not publishing the latest version?"* |
| D157 | **A copy of an upload that is already live never blocks receiving again.** The guard ignores a staged real upload whose products AND inventories file hashes both equal a published real upload's (re-pressing the same export). A missing import row or hash keeps the old rule (blocks). No change to the upload page (it is being retired). | *"I thought the button didn't work and so I must have pushed it two more times"*; *"You don't need to build anything for the Cultivera menu upload page"* |
| D158 | **A receiving update held for more than an hour sends one alert** (email + phone, through the cutover watch every 5 minutes), linking the cutover page, so a silent two-day hold cannot happen again. | professional call: the hold was invisible for two days |
| D159 | **A lab the system has never seen is read, proven by ids, and flagged for the owner to confirm. It never blocks a product.** The lab JSON reader accepts other spellings (Greek Δ, *Activated Total THC*, *Total Cannabinoid*, test type *Cannabinoid*, `sample.source_id`). A general PDF reader reads any lab's potency table, accepting a row only when its mg/g is 10 × its % (no guessing), and re-adds the totals. Identity is proven by ids, never by the lab's name or host: the PDF's 16+ digit WSLCB inventory id equals the lab JSON's sample id AND the PDF's lab sample id is named by the lab JSON; or, with no readable PDF, the transfer's certificate link names that inventory id. Every certificate the general reader reads shows *"New lab layout … Please confirm these numbers against the PDF; the product is not held."* A certificate for a different sample is still caught. | *"We need our system to not care which lab it came from. Or it needs to flag it so I can confirm myself."*; *"we can't block products just because we haven't seen that lab yet"* |
| D160 | **A WCIA delivery's lots are filed in the books by their state inventory type when the category is the placeholder "EndProduct".** Only when the category itself is not recognised; never into the three non-cannabis accounts; an inventory type the table does not know still refuses; blank stays an honest unknown. Both refused deliveries (Edgemont/Sungrown 12075358321394116, 32 lots; Bellevue 01M624SC4JCCB917, 27 lots) now map lot by lot (measured: 15 cartridge, 9 disposable, 10 concentrate, 9 preroll, 8 preroll pack, 3 blunt, 4 flower, 1 solid edible). They are already finalized, so they are **not re-posted now** (owner: the books are paused); re-posting them is the first item when the books work resumes. No D161–D163: the unposted-migrated-bills slice was dropped by the owner. | *"please complete all task, including the bookkeeping work, if you can keep the spending on it to a minimum"*; *"it is fine that they dont post to the books yet"* |


## Owner request, 2026-11-04 (recorded verbatim, D161–D168: offline PIN unlock and an outage-proof register)

> thank you. please now build for me something that allows my employees to unlock the ipad registers in offline mode. we cant ring a sale if we cant get past the pin unlock page. if there are other features that we need or should have so that we have an exceptional system that works no matter the situation. use every enterprise grade solution to make this the most robust, hardened feature possible. I have another agent working right now, so complete all work, commit it out of the sandbox to keep it safe, then wait to merge it until I tell you it is safe to do so. go above and beyond for me. follow the standing rules. thank you.

> Sorry to stop you. It’s safe to merge work now. Please finish and merge all work when you are done. Thank you.

### What production showed (read-only, 2026-11-04)

- Unlock was server-only: the lock screen answered *"Offline — unlock requires a connection in this build."* (GW-007, open since the first audit). A register that idled to the lock screen during an outage could not ring a sale although the offline sale queue works.
- 11 active employees have a clock PIN (10 managers, 1 sales); 3 POS device rows. PINs are stored as scrypt hashes, which cannot be turned into an offline check without the PIN, so an iPad can only learn a check at the moment the person proves the PIN online.
- No `pos_offline_unlock_policy` row exists, so the defaults below apply until the owner saves the card.
- The `pos_sale_events` event_type CHECK is exactly the 0301 list, so a new audit event type needs migration 0339.
- The price-override window refused as soon as the iPad was offline, before any fallback could run (found and fixed in this round).

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D161 | **A locked register unlocks with a staff PIN when the internet or the server is down.** The iPad keeps, per employee, a one-way verifier: HMAC-SHA256 of a device key over PBKDF2-SHA256(PIN, device salt, 600,000 rounds) and the employee id. The PIN is never stored. The device key is derived on the server from a secret, the device id and the owner's reset epoch, so a verifier is useless on any other iPad. The vault is a this-device-only, never-synced keychain item, erased on unpair. | *"allows my employees to unlock the ipad registers in offline mode"* |
| D162 | **Arming happens only at an online PIN proof** (unlock, lock-screen clock, approval). Every 10 minutes online the iPad fetches the staff roster (names, roles, a PIN stamp; never a PIN, hash or verifier) and drops anyone missing, deactivated or whose PIN changed. Only a fully parsed 200 may purge; an error never erases the vault. | *"the most robust, hardened feature possible"* |
| D163 | **Offline is a fallback, never a bypass.** It is tried only when the request throws, times out (8 s) or the server answers 5xx. A 4xx answer (wrong PIN, inactive, handbook, register not assigned) is final. | *"enterprise grade"* |
| D164 | **Anti-guessing and time limits.** 5 wrong offline PINs pause the pad (30 s doubling to 15 min); 25 in a row erase the vault. A clock moved earlier than the last server contact stops offline unlock. Owner limits: longest offline stretch (default 168 h, 4–720) and how recent an online unlock must be (default 30 days, 1–90). | *"works no matter the situation"* |
| D165 | **Offline also covers the other PIN gates needed to keep selling:** lock-screen clock in/out (the iPad asks in or out), and manager/lead approval of price override and no sale (owner can turn approvals off). Drawer count-in, drops, swaps, closes, voids, returns, employee purchases, loyalty redemption and the day report stay online-only (they move money or read server records). | *"other features that we need or should have"* |
| D166 | **Every offline PIN use is audited and re-judged.** It is queued as an `offline_auth` event (migration 0339) and re-checked at sync: unknown or inactive employee, approver no longer a manager/lead, or a key from before an owner reset goes to Exceptions. | *"enterprise grade"* |
| D167 | **Owner-only control and an emergency reset.** Register Activity → iPad setup & lockdown → Offline unlock (`registers.lockdown`, audited): on/off, the two limits, offline approvals, and **Reset offline PINs** (typed RESET) which bumps the epoch so every iPad erases every verifier at its next check-in. A failed settings read never moves the epoch backward. | *"something only I can undo"* (D142 standard) |
| D168 | **Visible readiness.** The lock screen shows *Offline unlock ready: N people*; each iPad's health report carries offline readiness (armed count, approvers, failures, wipes, key) and the iPad setup page judges it; the checklist gains a device-verified **Offline PIN unlock drill passed (D161)**. | *"works no matter the situation"* |


## Owner request, 2026-11-04 (recorded verbatim, D169: vendor-menu descriptions save; D170: the offline backlog)

> Please add all of these things to the todo list so we can be fully operational while internet is down. It’s fine if online orders don’t make it to the registers. Everything else should work though. But before we work on that, I need your help with an issue I’m having with saving the descriptions from fetched menus for purchase orders via the web crawler. Please log in to supabase again, and look at the recent activity from those tests I did earlier today. I can fetch the menu items, and I can save the images. It fails to save the descriptions, it says so under the save all assets button. Please help me fix this so I can start attaching descriptions to my products. Follow the standing rules. Thank you!

### What production showed (read-only, 2026-11-04)

- `audit_logs` `cultivera.kb.strains_saved` (01:09 and 01:11 UTC, snapshot `f3f5e79b…`): 19 images saved, **descriptionsSaved 0, kbWriteFailed 19**, reason *"The Knowledge Base write did not complete."* `cultivera.media.bulk_saved`: 20 images. So images landed and every description write was refused.
- Vendor-menu KB identities are built as brand, product and variant joined with the character U+0000 (`kbIdentityForItem` in the Cultivera, GrowFlow and LeafLink link cores) and that value was sent as `kb_products.pos_product_key`.
- A live probe showed PostgreSQL refuses it: *"22P05 unsupported Unicode escape sequence: \u0000 cannot be converted to text"*. The upsert failed, its error was discarded, and the button could only say the write did not complete.
- The same key made every `media_usages` row for `kb_product` / `cultivera_strain` fail silently (0 such rows in production).
- Ruled out: table grants, the actor's staff row, the unique index (brand_slug, product_slug, variant_label). Crawler rows (218) already have a NULL key; real POS keys are digits.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D169 | **A vendor-menu description is saved into the Knowledge Base.** A menu identity is not a POS key: `pos_product_key` keeps an existing key, else stores a real key, else NULL. The row is still found by brand + product + variant. Every free-text field is cleaned of U+0000 before writing. The media usage ledger stores menu identities as `brand/product/variant`. A refused Knowledge Base write now shows the database's own reason under the button (code and message), never only *"did not complete"*. Re-running **Save all assets** is safe: images de-duplicate, and descriptions fill empty slots only (curated text is kept). | *"It fails to save the descriptions, it says so under the save all assets button. Please help me fix this so I can start attaching descriptions to my products."* |
| D170 | **The register must work fully offline except online/pickup orders.** Every action still marked online-only is logged as a build item in `todo.md` (section *OFFLINE BACKLOG*), each with the reason it needs the server today. | *"Please add all of these things to the todo list so we can be fully operational while internet is down. It’s fine if online orders don’t make it to the registers. Everything else should work though."* |


## Owner requests, 2026-11-04 (recorded verbatim, D171–D176: the offline backlog built)

> Thank you. I will test that now while you finish all remaining offline mode tasks. Is it possible to include online orders and pickup orders to the offline mode? Would that require buying a data plan for the iPads or something? If it's possible to have those included, please do so, or explain to me how enterprise grade solutions deal with this. I want to make sure we are fully hardened and prepared for any situation. In the summary report, please give me a terminal command for generating the hash key for the vercel env variable value. Break it up into manageable slices, push and merge work often to keep it safe from the unstable sandbox. Follow the standing rules. Thank you!

> Sorry to stop you. I forgot to answer your question. Please add customer loyalty to the iPad. Our data is safe. I want all features unlocked. Please continue. Thank you!

> Please continue. Follow the standing rules. Thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D171 | **Every register action works offline except new online orders**, built in slices O1–O15 (PRs #1663–#1674): drawers, approvals, scan unlock, voids, returns, employee purchases, loyalty, out-of-stock flags, emailed receipts, Fix & sell, lot details, a provisional X and already-downloaded pickup orders. Each is queued and re-judged by the server at sync; anything refused lands on Exceptions. | *"finish all remaining offline mode tasks"* |
| D172 | **New online orders need store backup internet, not iPad data plans.** A website order lives on the server and cannot reach an iPad with no internet. The enterprise answer is a dual-WAN router with cellular failover (Peplink / Cradlepoint on a Verizon or T-Mobile business line, or Starlink); a phone hotspot is the stopgap. What software can do is done: the pickup book is cached encrypted and orders already waiting can be handed over offline (O14); a pickup closed offline after an online cancellation is audited `order.pickup_closed_before_sync`. | *"Would that require buying a data plan for the iPads or something? … explain to me how enterprise grade solutions deal with this."* |
| D173 | **Loyalty on the iPad.** The member book (names, points, tier, medical flag) is cached on the iPad, encrypted as patient-class data, for offline lookup, scan-attach, history and 150/300-point rewards limited to the saved balance and re-judged at sync. | *"Please add customer loyalty to the iPad. Our data is safe. I want all features unlocked."* |
| D174 | **Offline voids and returns only for this iPad's own sales**, from an encrypted sale book, with a manager/lead PIN. One queued `reversal` event (migration 0341) is replayed through the online void/return machinery as of when the cash moved, tied to the exact sale uuid, with the approver re-checked and the refund required to match. | *"I want to make sure we are fully hardened and prepared for any situation."* |
| D175 | **Long-outage warnings.** Offline, the banner shows the saved menu's age (after 2 h or an earlier day) and warns 24 h before offline PIN unlock stops; the sale book is size-capped; an outage drill is in SOP-01 §4.32. | *"fully hardened and prepared for any situation"* |
| D176 | **POS_OFFLINE_SECRET** (Vercel env) is generated with `openssl rand -base64 48`. Changing it later resets every iPad's offline PINs. | *"please give me a terminal command for generating the hash key for the vercel env variable value"* |


## Owner requests, 2026-11-05 (recorded verbatim, D177: Label Studio)

> I need your help enhancing the label printer features we have currently to better suit our needs. We use the rollo x1040 wireless label printer. Right now the system only uses it in receiving, for printing a label from the manifest. It is a very simple and basic feature, and I want to now create a much better version of it now that I know what I need. The printer is meant to add barcodes to products that have damaged barcodes, or don't scan, or were sent with the wrong barcode on it, or it's for glass and non cannabis goods that don't have barcodes. I want a much fancier, far more professional label builder experience. I need to be able to select from the various size labels, not just rollo but any vendors sizes. I need to be able to switch between 1D and 2D barcodes (qr codes) and the info I want on the label. This should be connected to receiving as it already is, and should be available in the product detail pages for both cannabis and non cannabis inventory. Please go above and beyond when building this. It needs to be exceptional, professional, enterprise grade, easy to use. Clone the repo, read agents.md, the standing rules, then proceed with building everything needed to make this a fantastic experience. Follow the standing rules. Thank you!

> Please continue. Follow the standing rules. Thank you!

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D177 | **One Label Studio replaces the fixed 4×6 lot label**, built in slices S1–S6 (PRs #1676–#1680 and the S6 PR). S1 is a cited stock catalogue (Rollo, OnlineLabels, Zebra, DYMO, custom) with a fit check against the Rollo X1040's 1.57″–4.1″ / 203 dpi limits. S2 is Code 128, QR and UPC/EAN drawn natively, proven to decode with zxing-cpp at printer dpi. S3 is a field picker and layout engine with scan-readiness warnings. S4 is the studio UI (to-scale preview, batch copies, one label per page). S5 adds entry points from receiving manifests, lot and product pages, Other Inventory items, drafts and keyed-in invoices. S6 adds saved store designs with a default per kind, and an append-only print history (migration 0342). Cannabis labels go beside the producer's label, never over it (WAC 314-55-105). | *"I need to be able to select from the various size labels, not just rollo but any vendors sizes. I need to be able to switch between 1D and 2D barcodes (qr codes) and the info I want on the label. This should be connected to receiving as it already is, and should be available in the product detail pages for both cannabis and non cannabis inventory."* / *"enterprise grade, easy to use"* |


## Owner requests, 2026-11-05 (recorded verbatim, D178–D185: the self-healing partner round)

> Thank you. I had to rush to deploy this system so I didn’t have to pay Cultivera another year. My employees, and myself for that matter, is still learning how to use the system properly as intended. So mistakes are going to happen while we work through this part. I need a system that is much smarter, or much more determined to help me out and do things for me. I am not a pro or an expert, and I am now alone in the realm of self servicing systems. We have a crazy powerful system, and someone half blind flying it. All I know is, if product left the shop and money was given to me in exchange, there can be no manual exceptions. I want you to deal with it. You know more than I do, you can prob and query unlike I can. Is there a way to give the system access to supabase so I can ask the system to help me fix things, or tell the system how I want it to fix it for me? If you can manage the exception for me, can’t the system too?  When it comes to paying the correct amount of taxes, or reporting the right numbers to CCRS, my input doesn’t matter. The numbers and data need to make it to CCRS and I need to pay the correct amount in taxes. I need to report the correct numbers. Everything else regarding enhancing the system to gently require correct behavior is absolutely warranted and wanted. Don’t let us push a button twice by accident, make it blatantly obvious a button is working or thinking. Disable it while it thinks. Give more precise direction when it comes to cash procedures. It needs to be spelled out on screen. This is the step you are on, this is what’s required of you, do this, do this, do that, done. Validate us when we are done so we aren’t left guessing. If there is a step to be done, make it loud. The morning people need to count last nights tills and prepare the deposit bag, make that loud on the min cockpit admin page. I hate to say this, but we are lazy potheads, we need nudging. We need special hand holding. We have not had a proper system ever, so we have not understanding of how it should be done yet, per an enterprise grade level of management. Cash handling, sop, opening and closing tills, daily employee tasks and obligations. I am not a hard ass or someone that likes to put my foot down. This system is meant to do this for me. We build the perfect system, and the employee sits in their tube and floats down the lazy river. Build me a smarter system that is more my partner and manage the data side of things. You know the database, I need you to own it now, if the system needs help, it needs you to query it and fix it. Can you built this for me? Can you make a more aggressive system that is willing to step up and help me fix the issues with out me needing to lean on you? I love ai at this point, it’s making this process incredible, so if I can keep that level of superiority inside my system, to help me with real issues rather than me just scratching my head in complete confusion. Please work on building and fixing and hardening all things you found wrong. Don’t worry about connecting the books. We aren’t there yet. Sage handles the books for now. Before you begin, please tell me what you can do for me to build a system that can take more responsibility for itself and help me do what’s needed so I don’t have to make every single difficult fix I do t actually know how to fix. Everything needs to be plain English. I don’t have an it guy any more, I don’t have someone I can call and say it’s not working fix it. I am those roles now, which means I need you to fill those shoes now too. Before you build just yet, please tell me what you can build for me. What you can let this system do for me, so we can have a more productive experience knowing the weird and abnormal stuff is being dealt with too. Give me your incredibly well thought out strategy and plan for me. Tell me you can build me a system that self heals. That can report accurately to CCRS. If the system can work out we can sell something we couldn’t before by doing so me cool trick, then let’s do more cool tricks to get it reported. We are better than everyone else, our system is better. Let’s make that statement a matter of fact and not a wishful pipe dream. No code edits. Just strategy. Follow the standing rules. Thank you.

> Thank you! Yes please go ahead and begin all tasks, one slice at a time, until the whole round is completely finished. Set ai to be level 2 to start. Cash rules, 167.5 for employees, 300 for manager (I think, double check the code on that, I can’t remember the manager float). Cash should be dropped if over 2k in sales for their register. Either of the morning employees may build the deposit bag. I am making all of my employees manager types. I am not big enough to have a dedicated manager per shift, so I need to trust my employees, which means we need a system that is very good at beating the fraud triangle. I am the only one to seal the bag and take it to the bank. There should be a deposit bag for every single day. For the two sales that already happened, they can be recorded as rung. Nudges by admin screens only for now,  it build the email and text options so I can use it if needed. They will listen if they are nagged on their phones. Go above and beyond for me. Give me the best possible system that helps me, works for me, and encourages properly behavior from my employees. Push and merge work often to protect it from the unstable sandbox environment. Follow the standing rules. Thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D178 | **Sales always land.** If product left the shop and money changed hands, the sale is recorded. Lines are always sent with the same columns, so one loyalty line can never null out another (the root cause of the stuck loyalty sale). A discount rate that changed between the ring and the sync is recorded **as rung** with an audit flag (the receipt is the truth). Exceptions caused by a system fault are retried automatically by a frequent cron; an owner/manager can press **Retry this sale** or **Record as rung** on Exceptions. Hard legal blocks (hours, recall, expired edible, limits) are never auto-forced. A replayed sale keeps its real sale time for CCRS and taxes. The two stuck sales are recorded as rung. | *"if product left the shop and money was given to me in exchange, there can be no manual exceptions"* / *"For the two sales that already happened, they can be recorded as rung."* |
| D179 | **Busy buttons everywhere**: every admin and register action button disables itself, shows a spinner and says what it is doing while it works. | *"Don't let us push a button twice by accident, make it blatantly obvious a button is working or thinking. Disable it while it thinks."* |
| D180 | **Blind-count integrity**: because everyone is a manager type, the system itself beats the fraud triangle: the closer's count is preserved, hidden until the second count, and fast or identical second counts are flagged. | *"I am making all of my employees manager types … we need a system that is very good at beating the fraud triangle."* |
| D181 | **Guided cash.** Floats are $167.50 per sales register and $300.00 for the manager till (verified in the database). A safe drop is required once a register's cash sales pass $2,000. A deposit bag exists for every business day; either morning employee may build it; **only Michael seals it and takes it to the bank**. Morning duties (count last night's tills, build the bag) are loud on the admin cockpit, step by step. | *"Cash rules, 167.5 for employees, 300 for manager … Cash should be dropped if over 2k in sales for their register. Either of the morning employees may build the deposit bag … I am the only one to seal the bag … There should be a deposit bag for every single day."* |
| D182 | **Night watch and nudges.** A nightly health check and morning report; nudges appear on admin screens now; email and text channels are built but switched off until the owner turns them on. | *"Nudges by admin screens only for now, it build the email and text options so I can use it if needed."* |
| D183 | **CCRS and taxes are correct by construction**: completeness checks, lot-shortfall repair and a plain-English taxes-owed screen. | *"The numbers and data need to make it to CCRS and I need to pay the correct amount in taxes."* |
| D184 | **Greenway Partner AI at Level 2**: it can read the database and propose fixes; it acts only through approved, audited repair tools. | *"Set ai to be level 2 to start."* |
| D185 | **Daily role checklists** so each shift knows exactly what it owes. | *"Cash handling, sop, opening and closing tills, daily employee tasks and obligations."* |

**D179 as built (S2).** PendingKeeper already greyed out, spun and locked every admin server-action button, so nothing was rebuilt. S2 adds the third step the owner asked for, *"ends with a big green check: 'Saved. You're done.'"*:
- **Green card only when the redirect URL proves the save.** That means a fresh `?saved=`/`?ok=`/… key, or landing on a new page with no error key.
- **Red "That did not save." card** for `?error=`/`?blocked=`/`…Error=`, showing the server's own words.
- **Silence otherwise**, because a green check on a failed save teaches staff to trust a lie.
- **Confirm questions moved to the button click** on three forms that asked inside `onSubmit`. There, a Cancel left the form held busy and swallowed the next press.
- **Public vendor ACH page:** its two buttons now show a busy state too, since it sits outside the admin keeper.
- **CI guard:** every async iPad and admin button must carry `disabled=`.

**D180 as built (S3).** Migration 0343 plus pure `count-integrity-core.ts` (36 self-tests) and 14 CI tests:
- **The closer's count is never overwritten.** Reconcile and correction now write a new `reconciled_count_minor` column; a database trigger refuses any change to the closer's count or the second count once the drawer is closed. 0343 backfills old drawers by restoring the closer's original figure from the `drawer_counts` 'close' row.
- **Money reads the reconciled count.** Posting, drawer figure, EOD sheet and deposit bag all read `countedCashMinor()` (reconciled, then second count, then closer). A closed drawer with no second count is withheld from the deposit bag with a plain message, so a bag is never built on an unchecked count.
- **Hidden until the second count.** Registers, history, EOD, oversight attention and the activity feed show "Hidden until the second count is done" instead of the closer's figure.
- **Timed, flagged, never blocked.** The second-count form carries a signed "opened at" token. A save under 2 minutes, an identical figure saved fast, the closer counting their own drawer, or a missing timer raises a loud red "Check this second count — have a third person count the drawer" on the reconcile card and history, plus a `drawer.second_count_flagged` audit. Staff are never blocked; the owner sees it.
- **Owner action:** apply 0343 after 0341/0342 (MIGRATIONS_TO_RUN.md has the check query and rollback).

**D181 as built (S4).** Pure `guided-cash-core.ts` (38 self-tests), `guided-cash-store.ts`, `GuidedCashPanel`, `/api/pos/drop-status`, and 13 CI tests. No migration.
- **Floats.** The owner asked us to double-check the manager float: it is $300.00 in code and on the live registers. The rule is now one constant, `STANDARD_FLOAT_MINOR = { sales: 16750, manager_till: 30000 }`. Any register set to something else gets a gold "Float setting" notice.
- **Drops.** "Over 2k in sales for their register" is read as **cash taken since the last drop**: cash sales minus cash refunds paid from the drawer minus drops. It uses the same drawer figure the reconcile uses. From $1,500 a drop is *coming*. **Over $2,000 it says "DROP NOW"**, with a suggested amount in whole twenties:
  - in red on the cockpit and Register Activity;
  - on the iPad home screen, polled every 60 s. Tapping it opens the Cash drop flow, which already needs a witness PIN.
  - A partial read says "unknown", never "ok". Nothing ever blocks a sale.
- **Morning duties.** A checklist runs in the order the cash moves: close any open drawer → second counts → reconcile → build yesterday's bag → blind recount by a different person → Michael seals → Michael banks.
  - The next step is marked 👉 and links to its screen.
  - Owner steps are labelled "(Michael only)" and do not nag the crew. The crew count shows "the crew is done" once the bag is recounted.
- **A bag every day.** Any past day (last 14) that had drawers but no bag shows a red alert on Deposit bags and the cockpit, with a "Build the <day> bag" button per day. The night form already takes any past day, so either morning employee can build yesterday's bag.
- **Only Michael seals.** `sealBagAction` is gated by `requireBooksAccess` (owner only), like the bank run. If Michael's sign-in is linked to his employee record, the PIN must be his own. A borrowed login with another PIN is refused and audited (`deposit_bag.seal_refused`).
  - Staff see "waiting for Michael to seal … your part is done", not a form.
  - This **replaces D25's "anyone can seal"**.

**D182 as built (S5).** Pure `night-watch-core.ts` (36 self-tests), `night-watch-store.ts`, `src/lib/notifications/sms.ts`, `MorningReportPanel`, the page `/admin/registers/night-watch`, and 9 CI tests. No migration and no new cron.
- **The night watch** runs inside the existing `platform-health` cron (about 6:25 am PST / 7:25 am PDT), after the database check, so it reads this morning's result. It checks the last 14 days for:
  - drawers left open overnight;
  - drawers with no second count, or not reconciled;
  - days with no deposit bag, and a bag whose night and morning counts differ;
  - bags waiting for Michael's seal or the bank;
  - register sales waiting for a decision (urgent after a day);
  - yesterday's second counts flagged as fast, copied or entered under the closer's login (D180);
  - over/shorts of $5 or more with no reason (last 7 days);
  - anyone on the clock for 14+ hours;
  - a failed or warning health check.
- **Each item** says who owes it (crew or Michael) and links to the screen that fixes it. Urgent items come first, and crew items before Michael's. A failed read says "Could not check …", never all clear (rule 135). Nothing locks anyone out (D27).
- **Nudges on admin screens (as asked).** The report is on the admin home page (only when something is open), on Register Activity, and in full on Night Watch (new nav item, Employee group). Staff see the crew's list; Michael sees everything.
- **Email and text are built and OFF.**
  - Michael turns them on at Night Watch → "Send the morning report to phones". He can set the addresses (empty means the staff alert list) and phone numbers, and choose whether to send on all-clear mornings. A "Send this morning's report now (test)" button sends right away.
  - Owner only (`requireBooksAccess`), audited.
  - Email goes through Resend, as the other alerts do. Text goes through Twilio's REST API and needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` on Vercel. The page says which service is not set up.
  - One message per Pacific day, claimed in `compliance_reminder_log` (`night-watch:daily:<day>`) before sending. The text is at most 320 characters: the count, the first two jobs, and the link.

**D183 as built (S6).** Owner: "The numbers and data need to make it to CCRS and I need to pay the correct amount in taxes." Pure `ccrs-completeness-core.ts` (52 self-tests) and `taxes-owed-core.ts` (20 self-tests), `ccrs-completeness-store.ts`, two pages (`/admin/compliance/sales-check` and `/admin/compliance/taxes-owed`, both in the CCRS nav group on reports.view), and 11 CI tests. No migration and no new cron.
- **CCRS sales check (per week, Production by default, Preprod one click away).** Every cannabis sale line of the week (detail id `order-lineid8`, the id `ccrs-sales.ts` writes) is matched against the rows of live Sale files (not abandoned) and the held list. It reports filed, held (with the reason), and missing. While the week is still running, unfiled lines show as "not filed yet" (pending), never as missing. It also checks the money: the filed rows (quantity × price − discount + sales tax + excise) must equal what the register took for those lines, within 1¢ per line. On live data, Nov 1 preprod: 516 filed rows differ by 33¢ in total. A line filed twice is named. A failed read says "Could not check", never complete (rule 135).
- **Lot shortfalls (a lot that sold more than it ever had; CCRS rejects these).** Record = received + every non-receive adjustment − sold. Each shortfall gets a plain-English cause and the one safe fix:
  - **wrong lot**: the register drew from a sibling lot of the same product. Fix: move that one sale line to the sibling.
  - **count**: a count took away units that were in fact sold. Fix: add a count correction of exactly the shortfall.
  - **split** or **unknown**: explained only, with no button.
- **Repairs (owner only, audited, re-checked against fresh data right before writing).**
  - The move changes only `order_lines.ccrs_inventory_external_id`, guarded by the old value, so a second press changes nothing. It never moves a line that CCRS Production already holds.
  - The count correction inserts one `count` adjustment and leaves `on_hand` untouched (the shelf is unchanged). It is reported to CCRS as Reconciliation. If two presses race, the second is taken back.
  - Neither repair changes stock or money. Partner AI Level 2 (S7) may propose these repairs; only these actions apply them.
  - Live on 2026-11-05: 4 short lots. One is a wrong-lot case, one is a count case, and two are explained only.
- **Taxes owed (one card per month, newest first).**
  - Excise to the LCB on the LIQ-1295 is due the 20th of the next month. Sales tax to the DOR is due the 25th, rolled past weekends and holidays (for example, the Nov 2026 return is due Dec 28).
  - Each card shows filed, due soon, or overdue from the Compliance Calendar's done marks, and a money check: the register's taken total must equal price + sales tax + excise.
  - A "Next to file" line is at the top. There are links to the calendar (to mark a return filed), the tax report and the excise report.

**D184 as built (S7).** Owner: "Set ai to be level 2 to start." Pure `partner-core.ts` (38 self-tests), `partner-store.ts`, `/admin/partner` ("Greenway Partner", Employee group, any manager type), `PartnerChat`, and 10 CI tests. No migration and no new cron. The level lives in `site_settings` key `partner_ai_level`. A missing setting means Level 2.
- **The AI never writes.** It reads a capped, cleaned picture of the live data:
  - the morning report;
  - this week's and last week's CCRS Sale check (Production);
  - open register exceptions;
  - lots that sold more than they had;
  - anything it could not read, which it must say rather than guess.

  It answers in plain English. It is told to never invent a number or a fix, and never to suggest changing a price, a tax rate, an amount, a date or a count.
- **Fixes are proposals made by fixed rules, not by the AI.** Each proposal is bound to one of four approved, audited tools:
  - retry a sale the system tripped on (the same sync chain, legal gates on);
  - record a sale as rung (the receipt is the truth);
  - move one sale line to the lot it really drew from (D183);
  - correct a count (D183).

  Legal blocks and sales that already have an order are never proposed.
- **Level 2 as offered.**
  - A fix that changes nothing about the sale (a retry) may be run by any manager.
  - Anything that changes money, counts or CCRS shows "Michael approves", and only the owner's button runs it.
  - Level 1 is explain-only.
  - Level 3 is shown but not open; a saved 3 reads as 2, never wider.
  - The owner switches levels at the bottom of the page (owner only, audited `partner.level_set`).
- **A press sends only the fix id.** The server re-reads everything, rebuilds the proposals and runs the tool only if the same id is still proposed and the person may press it.
  - The id is a hash of the exact repair, so a changed quantity or lot makes a new id and an old page cannot replay it.
  - Any read error pauses all fixes.
  - Each press is audited (`partner.fix_applied` / `partner.fix_refused`), on top of the tool's own audit.
- **Fix links in answers.** Fix ids cited in an AI answer become links to the matching fix card, but only ids that really exist.

**D185 as built (S8).** Daily role checklists, so each shift knows exactly what it owes ("This is the step you are on… do this, do this, do that, done. Validate us when we are done… make it loud").

- **Where it lives.**
  - New screen **My day** at `/admin/registers/my-day`, in the Employee menu. Any staff login can open it (orders.manage, the same as Night Watch).
  - A compact version sits at the top of the admin home. It only appears while something is open or urgent, and it disappears once the shift is done.
- **One list per shift, built from the live data** (`role-checklist-core.ts`, pure, 60 self-tests):
  - **Opening (morning crew):** close, second-count and reconcile yesterday's drawers; build the deposit bag (either morning employee); a different person recounts it blind; count the float ($167.50 for a sales drawer, $300.00 for the manager till); initial and sign off the opening sheet.
  - **During the shift:** each open drawer's drop status (over $2,000 in cash since the last drop means drop now); the during-shift sheet.
  - **Closing:** the closing sheet; every drawer from today closed and left in the safe for the morning second count.
  - **Michael only:** seal the bag and take it to the bank. Everyone can see these lines, but they never hold up a staff list.
- **Nudging.**
  - 👉 marks the step you are on.
  - 🚨 is loud and always comes first. It covers a drop that is due, an earlier day with no deposit bag (a bag for every single day), and yesterday's crew cash still unfinished after the opening shift.
  - When every staff line up to the current shift is green, the screen says "You're done… Thank you."
- **Read-only and honest (rule 135).**
  - The screen never writes and never blocks anyone; each line links to the screen where the work is done.
  - Anything that could not be read shows ❓ with a hand check, and the shift is not validated while any line is unknown.
  - `?shift=opening|during|closing` previews another shift's list.
- **Builds on existing pieces.** It uses the existing 0327 checklist sheets and the S4 guided-cash duties. No migration, no new cron, no notifications (nudges stay on admin screens, as asked).


## Owner requests, 2026-11-05 (recorded verbatim, D186–D190: the PERF round)

> Thank you. I will test now. I need you to log back in to supabase and help me optimize everything. A lot of the pages, main admin cockpit included, are very very slow to load. I am hoping you can see why in supabase and let me know your thoughts and opinions on it. If you need a read only access to the back office site, let me know and I’ll set you up. I need my back office to be lightning fast. Our database is large at all yet, and already it is incredibly slow. We have done several optimizations to it, but now that you have access to the database, maybe you can more accurately pinpoint why it’s so slow. The main cockpit especially needs to load instantly. Right now, I have to avoid it to get anywhere else in the back office. Please go above and beyond and really impress me with how efficient and optimized the system can become! No code edits yet, just let me know why we are so slow right now and how you plan to fix it. If you need back office access, let me know. Follow the standing rules. Thank you.

> Thank you! Please proceed to fix all issues, big and small. If there is ways to pin optimization and efficiency in the test suite or code or something like that, please make it a permanent issue to address every time we add to the repo. I want optimization and efficiency to be paramount now that we are in live production. Please push and merge often to protect the work from this unstable sandbox environment. Keep the work safe. Go above and beyond. Follow the standing rules. Thank you!

> you are back in now. please continue. follow the standing rules. thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D186 | **Old menu copies stop piling up.** Each publish clears a few old archived intake copies (newest 5 kept; published, staged, import, test and just-archived copies never touched). The newest facts per product live in `product_latest_facts`, so pruning never changes a past sale's category. | *"I need my back office to be lightning fast."* |
| D187 | **The menu-facts lookup reads one row per product** and never falls back to a walk of every row on a timeout; it reports the error instead. | *"A lot of the pages, main admin cockpit included, are very very slow to load."* |
| D188 | **The cockpit loads instantly**: panels stream in, finished days are cached, shared reads are done once. | *"The main cockpit especially needs to load instantly."* |
| D189 | **Small costs fixed too**: N+1 reads, unscoped menu reads, a 459 kB vendor row, the Vercel region next to the database, missing indexes. | *"Please proceed to fix all issues, big and small."* |
| D190 | **Performance is a standing rule with a guard test**, checked every time the repo changes. | *"please make it a permanent issue to address every time we add to the repo. I want optimization and efficiency to be paramount"* |

**D186 / D187 as built (PERF P1/P2).** Measured read-only on 2026-11-05: `menu_items` held 720,163 rows (755 MB) for 2,288 products, because every intake stage wrote a full menu copy and nothing removed the old ones. The facts lookup sorted all of them (6 s for all keys), and on any error the app walked the whole table 1,000 rows at a time (5,622 walks at 2.15 s a page, the biggest cost on the server).

- **Migration 0344** (owner applies by hand):
  - `product_latest_facts`: one row per product key, kept current by statement-level triggers on insert, update, delete (a clean-slate delete falls back to the newest remaining row) and truncate (the factory reset empties it).
  - `latest_menu_facts`: same signature and answer, now reads that table; SECURITY INVOKER.
  - `prune_menu_version_items(keep, max)`: bounded, service_role only, never changes a fact.
  - Pg-check `scripts/recon/menu-copy-retention-0344-pg-check.sql`; rollback refuses while a key would lose its facts.
- **After 0344:** the owner runs `scripts/ops/menu-copy-reclaim.sql` once (clear the backlog, then VACUUM FULL).
- **App:** both publish paths call the prune after the response (`menu-retention-store.ts`; "not applied yet" is logged, never treated as done). `latest-menu-facts.ts` only walks when the function is missing, and the walk reads its own errors.

**D188 as built (PERF P3, PR #1691).** The cockpit used to wait on one `Promise.all` of about 20 reads, so the slowest read held the whole page. Now:

- The page itself awaits only the session and the URL. Each section (banners, flags, sales, taxes, refunds, hourly, orders, operations, and the My day, Morning report and Guided cash panels) has its own `<Suspense>` with a skeleton, so each one appears as soon as its own reads finish.
- Shared reads use React `cache()`, so each runs once per request.
- Display figures are kept briefly in a cache:
  - today's figures for 30 s;
  - finished days for 10 min;
  - the low-stock count for 2 min.
- A failed read is never stored ("cache the display, never cache the money"). Filings and exports always read live.
- Fixes found along the way:
  - The tax, LIQ-1295, CCRS, Sage and benchmark category lookups now read only the products actually sold.
  - The low-stock count was silently capped at 1,000 of about 2,300 lots. It is now paged and checked.
  - The sales, tax and filing reads now report their errors (rule 135).

**D189 as built (PERF P4a/P4c, PRs #1692 and #1694).**

- **Old menu copies:** every per-product read now reads one row per product (`loadLatestMenuFacts`) instead of every old menu copy. This covers:
  - the return's tax snapshot (which also now reports a failed read instead of quietly treating the item as non-cannabis);
  - the pickup ticket;
  - the Sage "unmapped categories" list;
  - the Leafly labels, which now use the live menu.
- **Product tags:** the public menu's tags and "New" badges are read once a minute and shared by every page. Before, each page view ran 16 queries; `product_first_seen` alone took 287,000 calls. Tag edits and publishes clear the cache at once.
- **Vendor row:** the 459 kB vendor row could not be traced to code from the sandbox. It is listed as a SQL check in the hand-off.

**D190 as built (PERF P4b/P5, PRs #1693 and #1695).**

- AGENTS.md rule 18: "Speed is a requirement, not a polish step."
- `tests/compliance/perf-guard-menu-items-scope.test.ts` scans the whole repo, so every future `menu_items` read must be scoped to a menu version or a row id.
- Vercel functions are pinned to `sfo1`, next to the database in us-west-1 (they ran in pdx1 before).
- A cockpit read that misses its cache and runs past 800 ms logs one `[slow-read]` line in the Vercel logs, so a slow section names itself.

## Owner request, 2026-11-05 (recorded verbatim, D191: label printing fixed and calibrated)

> Thank you. The print settings need significant adjustment. I need to have better use of the available space. I have the correct settings saved in the browser settings. I use the correct label in the back office, have the correct roll fed into the rollo. I tested the 2x1" labels, it prints two labels, the first blank, the second nearly prints off the bottom of the label. Can you make significant improvements so we can start making labels. Deep research the internet. Make our system better. Go above and beyond. Give me settings and abilities I've not even asked for if they exist. Make it perfect. Follow the standing rules. Thank you.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D191 | **Root cause: Chrome rotates a page that is wider than tall when printing to a thermal printer** (Chromium issue 372435414, reported on a 60×50 mm label; Firefox and Acrobat print it correctly). Our 2×1 page went to the Rollo turned 90°, so it spread over two labels: the first blank, the second cut off. **The fix (new pure core `label-print-core`):** Orientation **Auto** sends wide labels as a tall page (1×2 for a 2×1) with the artwork turned in CSS, so the browser has nothing to rotate. `@page` margin is `0 !important`, which beats the admin's 8 mm pick-ticket print rule. Each page box is 0.01″ shorter than the page, and the last label has no page break, so no stray blank label. **Added (per device, per label size):** Orientation (Auto / Straight / Rotate ↻ / Rotate ↺), Nudge X/Y in 0.01″ steps (±0.25″), Scale 85–105 %, **🎯 Print test label** (border, corner brackets, 0.1″ ruler, centre cross, TOP arrow, the active settings), print-dialog steps for the detected OS (Mac custom size with zero margins; Windows mm and the Rollo TCP/IP driver note), the Rollo Printer Portal media size, and a symptom → fix table (blank+cut, sideways, shifted, too big, every-other-label/drift → recalibrate, faint → Darkness/Speed). **Better use of space:** new **Fill** text size (the default; designs saved on Regular before D178 upgrade once) grows text and code to fill the label with no truncation and the barcode never dropped. New **Edge margin** setting: Standard 1/16″ or Tight 1/32″. | *"it prints two labels, the first blank, the second nearly prints off the bottom of the label"* / *"I need to have better use of the available space"* / *"Give me settings and abilities I've not even asked for if they exist"* |

## Owner request, 2026-11-06 (recorded verbatim, D192-D194: the database stays healthy)

> Thank you. I completed the sql steps and cleared everything out. I'll update you in a few days about what I see in there. I need you to log back in to supabase now. Every few hours the database will become "unhealthy" and I can't use the back office. I get an email alert about the platform health. It's unexplainable and frequent. I am hoping you can go in and locate the instability and fix it so we have a consistently health database that we can communicate with always. Surely supabase isn't a spotty service that goes down every few hours. This has to be something we are doing. If you need help logging in, stop and queue up the browser for me to log you in. Otherwise, please start querying the db. Please look for ways you can add to the ai partnership so that it can help me self heal these issues now. I want a healthy db always. Thank you.

### What was measured (Supabase dashboard, logs and metrics, read-only)

- **Compute:** Supabase **Micro**: 1 GB RAM, 2 shared CPU cores, 60 direct connections. Steady state: RAM 55-80%, swap 50-65%, average CPU under 10%.
- **Two hard stops in six hours.** Postgres logged "database system was interrupted ... not properly shut down; automatic recovery in progress":
  - last good at 21:07:22 UTC on 2026-11-05, back at 21:09:55;
  - last good at 02:24:30 UTC on 2026-11-06, back at 02:28:36.
  - Nothing was logged in between, so the whole instance froze or was killed. CPU recovery spikes at 99% matched both events.
  - The API returned 4,045 "503" responses in the 21:00 hour, then 521/520/525 at 02:00.
- **What came right before each stop:** bursts of 2,000-7,000 API requests a minute from our own website server (user agent `node`). Before the 02:24 stop:
  - about 1,600 a minute were the **same eight `content_blocks` lookups** (footer warning, footer hours image, business hours, social links, brand kit, fonts...), about 255 of each per minute;
  - about 800 a minute were **whole-menu `product_enrichments` chunks** for product photos;
  - plus product-first-seen, overrides and DOH registry chunks.
  - PostgREST logged "Thread killed by timeout manager" in the hour before. `platform_error_events` shows `AbortError` page renders on `/menu/products/[id]` and `/menu/[category]` in the same hours.
- **Not the cause:**
  - The queries themselves are fast; the top statement averages 25 ms.
  - Connections stayed at about 31 of 60.
  - Disk IO budget stayed at 99%.
  - No pg_cron or pg_net backlog.
  - The 516 MB database after the reclaim.

### Decisions derived

| # | Decision | Source phrase |
|---|---|---|
| D192 | **Stop the render stampede (slice A).** The small display tables that every public page reads are now read once a minute into shared snapshots, and each render looks values up in memory: content_blocks (public visitors only; staff preview keeps the live read), published enrichment photos plus media URLs (exact rung and S20 identity borrow), classification overrides, and the DOH registry. A failed read is never cached; a failed, missing or oversized snapshot falls back to the original keyed read. Display only, never money. The DOH registry save now also clears the public menu. Pinned by `tests/compliance/db-health-a-public-snapshots.test.ts` and `public-snapshot-core` self-tests. | "This has to be something we are doing" |
| D193 | **Watch the database's vital signs and let the Partner help heal (slice B).** Recurring check of restarts, connections, idle-in-transaction sessions, long queries, cache hit and database size, with plain-English remedies; safe repairs are owner-approved and audited. | "add to the ai partnership so that it can help me self heal" |
| D194 | **Recommend the compute step up.** Micro (1 GB) has no headroom for a burst. Small (2 GB) is about $5 more a month. Slices A and B remove the load we caused; the upgrade adds a margin. The owner decides. | "I want a healthy db always" |
