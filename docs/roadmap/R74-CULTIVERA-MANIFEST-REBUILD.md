# R74 - Cultivera manifest rebuild (non-cannabis gate, loud JSON coverage, email harvest, Cultivera onboarding tab)

Internal working name during research was "R51 round 2". The repo already has an R51 roadmap
(`R51-GEMINI-IMAGES-ONBOARDING-PO-STRIP.md`) and the latest round is R73, so this work is filed as **R74**.

## Owner request, round 1 (verbatim)

> # Owner request — verbatim (AGENTS.md rule 1)
> 
> I need you to help me fine tune and make adjustments to my cultivera menu import pipeline. the process uses the crawl4ai to log in to my cultivera back office portal. it is able to get the products and their data into our system, except for the json, manifest, coa data, and other important data. cultivera has made it clear they will not give us our data, I guess as a means to hold us hostage to their platform. I had hoped the crawler would be able to scrape that extra data we need, but upon closer look at cultivera again, the json, manifest, and coa data is not even there for us to scrape. so I have a new plan, first I want to enhance the fetch and transform more, we have touched on it many times now. but from my last import test, there are several products that get transformed into the wrong category or type. the ones I have noticed right away are non cannabis items getting a cannabis type/ category. there are unknown types/categories being imported from cultivera as well, so we need to figure out a way to deal with these few products. the ones I saw had the word "battery" in it usually, which the transformer turned into a concentrate. if there is this small mistake there, its entirely possible there are other, small and subtle, incorrect transformations like that. the main reason I want to touch on this again is because, every json, manifest, coa comes to us specifically digitally via email. what I should have had you do from the very beginning was to give the system access to my google email address that gets these emails sent to us by the vendors. after the system scrapes cultivera for all of the products and their data, I want the system to then go to my email address and filter it using keywords like "json", "manifest", "invoice", etc. collect every single email and then send each one through "OUR" receiving pipeline. we need to move the products from cultivera into our system as if we are accepting new inventory and cultivera didnt ever exist. we should with out doubt be able to match every product from cultivera to a manifest from my email address. the email scrape needs to be very intelligent. it needs to collect every single document that can be downloaded from the email, the json included. the reason it is so incredibly important that each one of these manifests we match to products goes through our intake pipeline. unless you can figure out a better way to match all the data and get the cultivera items into our system while at the same time completely abandoning the data from cultiveras products and inventories spreadsheets. I may not be explaining this properly either, so I really want you to ask me before jumping into this project if you need clarification or more information. our intake process is perfect. an email gets sent to the email address, our system picks it up immediately, pulls in the json, manifest, invoice, coa. then it actually attaches all that data to the products. I need to match this process for the cultivera products. the goal is to recreate every single manifest that these products came from. not the full manifest, just the products left in stock. the new manifests we recreate from the originals need to move automatically into onboarding, every manifest should be seen and workable on the onboarding page. that was the original design idea, but its not what I have tested so I want to fix it. we dont owe these vendors any money, so we dont have to worry about bookkeeping or accounting or any of that. I simply want a way to put every manifest we rebuild into onboarding. it would then use our naming conventions, promote the products accurately to our knowledge base, which is huge as we can then reliably reuse the data from those products when new shipments come in. I really believe that if instead of transforming the products from cultivera, we simple identify them, match them to the manifest that they came on from, pulled from my email address where I know every one of them lives. take all the data and promote it to the system as if we received them instead of importing them. I hope that makes sense. the key difference however is that I need to be able to sell these products even though they are on the onboarding page. becuase my business and livelihood depends on me being able to sell these products. we should try to fill in the gaps as much as we can, like price from the products and inventories spreadsheets from cultivera has accurate out the door prices and cost info. I also want to prevent our system from importing anything that is non cannabis, there are too many mistakes in cultivera regarding those products. I would rather just recreate them in our system individually. there are not many to do. but back to the main point, I want to be able to use gemini to enrich all the products exactly like I do now when I intake my manifests. our system uses the data from the json and manifest and coa to make a new system name, stores all its data, then on boards it with all the ways we enrich products. I want to run gemini on every single item. even if it costs a few hundred dollars to run gemini 3000 times, its worth it to get these products enriched. before I drone on more like a broken record, please download the repo, read the cultivera menu import code and logic to familiarize yourself with it. then look into the google workspace federation key webhook thing we built to fetch mail from my email account for the ccrs uploads. if thats not the right solution, tell me what is for collecting all the manifests so we can actually rebuild them, actually move them through our intake receiving pipeline, starting from the front door, "receiving", all the way through onboarding, to publishing, to mastering, to inventory. this system is not in use yet, this system will not be used until after cultivera has been uploaded into our system. so its important that we intake them our way, through receiving via manifest recreation, while still allowing me to sell them while I onboard them. please read what you need to read, research what you need to research, then repeat back to me what you think it is I want and need so we can work on getting on the same page. the repo is huge, so go slow, take your time, read the receiveing intake pipeline so you understand where and why I want cultiveras recreated manifests to flow through the system this way. naming them directly from the manifest, logging the type from the manifest and category from cultivera. the category in cultivera is accurate and source of truth. price and cost are source of truth in cultivera. we need to be able to sell these products while in onboarding having gemini enriching them and the coa enriching them with strain types and terpenes and mg and ml facts from the coa. mastering that happens on on boarding too, is a major deal to our website. the cultivera products upon upload get a cultivera badge attached to the,, so we should be able to easily tell the system to allow them to be publish while being onboarded so that we can continue to sell them while we enrich them through onboarding. we should then have some sort of way of refreshing the menu after we finish enriching a manifest in onboarding so those products get the correct and accurate data from onboarding enrichment. please do all that you can to understand what I need and how I want it done and why. why is important because its my livelihood and I cant get cultivera to give me my data. so we have to be clever, and do what they dont want me to do, leave their system. help me do this. no code edits, just read and strategize with me. go above and beyond please. follow the standing rules "agents.md". it is the first thing you should read after cloning the repo. they are your standing rules and they must be enforced religiously. let me know what you find and what you think I need and how you can make my vision a reality. thank you

## Owner reply, round 2 (verbatim)

> # Owner reply, Round 2 (verbatim, 2026-10-22)
> 
> Thank you. 1. Yes, tell me how to get you that info please, unless you have a way of getting it yourself. 2. Stephen@greenwaymarijuana.com. After migrating we will switch to vendor_intake. But every Cultivera manifest was sent to stephen@. Please go as far back as you are allowed to go. 3. Manifest wins on name, type, cost. Cultivera wins on category and quantity. There might be so products with a non cannabis category that are actually cannabis as the “is cannabis” flag is set to “true”. For those, make me have to pick the right category before it lets me finish onboarding that manifest. 4. Yes, anything that is flagged non cannabis from the is cannabis column should be left out. 5. I am not sure I understand. Whatever Cultivera doesn’t find, the email will. I’m hoping the 148 will be found by the email and sent properly through onboarding. But for ones the email can’t find either, yes flag them in one unmatched Cultivera stock manifest. They likely don’t exist and will be cropped outed of CCRS when we initiate the cleanup process. Anything without a receive date should be flagged as, does not exist and to be included in the clean up. 6. If by start you mean show all 680 manifests in the onboarding page, then yes, in its own Cultivera tab on the table so it doesn’t drown out our intake process once we start recording our own products. I then want to be able to filter all Cultivera manifests by vendor. That way I can batch look up with Gemini by vendor for every manifest in the table by that vendor. I will work through all 680, first running Gemini on them. Then working through each manifest to properly enrich them by attaching all the details Gemini finds. 7. Refresh when each product is approved. 8. I use flash 3.8 right now. Is argon better for this type of task? I was told and under the impression that flash is a superior ai to use for product lookup. But I will let you the professional expert tell me what ai to use for this problem to solve. And yes, upgrade me to sprint mode for this initial enhancement feature that fast tracks the process. 9. No thank you. 10. Yes for wave 1 and 2. I have a factory reset feature. So I want to do real dry runs. Import the full menu with the new enhancements to the transformer. Run Gemini on all of them, attach all the facts I can before 11/1, then factory reset before opening November 1. Importing again, all the product facts should reappear in the onboarding step because they were saved to the product and promoted to the kb. And the kb sees the same product and assigns the facts again. I’ve seen this behavior when I try it with manifests I intake before and after a reset. So I want to do as much now as I can, then finish what I can’t get to after 11/1. So build all three waves now. Let’s test everything now. Let’s guarantee this thing will work as it should. Because if it doesn’t, I don’t have a pos integrator to track and report my data, which means I go bust. This has to work. That’s why I have the factory reset feature. There is no real data other than real enriched product data. So we can test all we want and reset all we want without worry. I think you understand the importance. I want the system to fail loud when it doesn’t succeed to get all the jsons or whatever. I want the jsons it can get to still stage receiving/ onboarding for enrichment. The failing silently is exactly what I saw. Everything made it to the menu, none of it made it to onboarding. Please work two slices, commit and push both individually. Commit work out of the sandbox often, it’s unstable. When you are finished, report back with a summary report of what was done, what is left to do and how I can or should test it or if I should wait until all three waves are done, full test, then report back to you with the results? You are the expert and professional. Please guide me. Follow the standing rules. Thank you!

## Owner request, round 3 (verbatim)

> Thank you. I will try a dry test run and set the mode to sprint. 3.8 flash is already set in vercel. Please walk me through the steps to getting you the crawler data you need. Baby steps, plain English, every step needs full explanations, every button, every screen every setting, whatever. I use railway to deploy the crawler if that matters. Please complete another two slices, commit and push each individually. Commit work out of the same box often. In the summary report, let me know what was built, what's left to build, and what and how to test it. Follow the standing rules. Thank you!

## Owner request, round 4 (verbatim)

> Thank you. Please complete another two slices. Commit and push both individually. Let me know in the summary report what was done, what’s left to build. How to setup Google workspace for email reading, and anything else important. Follow the standing rules. Thank you!

## Owner request, round 5 (verbatim)

> Thank you. I will work on all those things now. Please complete another 2 slices following the same principles as the ones before it. I appreciate your going above and beyond. Keep it up. Follow the standing rules please. Thank you. Make sure to give a summary report at the end with what was done, what to setup, what to test, and what’s left to build. Please commit and push each slice individually. Commit work out of the sandbox often please. Thank you.

## Owner request, round 6 (verbatim)

> Thank you. I am testing now. The harvester works. I am harvesting now. While I do that, please begin another two slices following round. Make sure when you build the pdf and spreadsheet reader to utilize llama parse ai if it helps us in any way. Please keep going above and beyond, it's working. Follow the standing rules. Test it, test the tests. Thank you!

## Owner request, round 7 (verbatim)

> thank you. please begin another two slice round. commit and push to git each slice individually. commit work out of the sandbox often, it is unstable. please provide a summary report at the end with what was done, what is left to do, what i should look for, test and report back on. please also remind me what the vercel environment variable i am suppose to change to "sprint". was in ai_thinking_level? i have that set to "low", should i change that to sprint? i have flash 3.8 already set. also let me know if i can, or when i can, test a full dry run of the pipeline. i have been fetching emails, i have no idea how many times i will need to do it, maybe there is a way to add a date of the last email read? so i dont repeatedly push the button for no reason. once i am done fetching all emails i click the read the kept pdfs and spreadsheets button, before fetching all? Or fetch all first and then read the kept pdfs and spreadsheets? please explain the full dry run not in test mode process. the full sequence of events i will go through on migration day. i want to also test the scan process. i have set up all my scanners per the count page, i have tested the spreadsheet and it works. it gives me an error. i will upload the error message to add to the roadmap. lets complete all the remaining work first before we fix and enhance the workbook. i want to see the manifests in full in the receiving table under the cultivera tab. i want to see the manifests in onboarding, grouped or groupable by vendor. i want to see gemini telling me it can lookup all products from a vendor. if you can increase the limits for the cultivera look ups, please increase them so we dont run into any limitations. i am fine with spending extra money on google searches if i get quality data to attach to my products. it will then live forever in my kb, so i can reuse it. i want to test using gemini on a vendor. i want to see the onboard page showing me all the mastering it is doing to the products. i want to see the coas being attached and the facts from them getting attached to the products. i want to see all of it in action. i can factory reset, then on migration day all the gemini searches done will just get reassigned to the products i already looked up. finally, i will need your help adding a new scanner to the count page. it is a, Alacrity MJ-2020R barcode scanner. please make sure the setup steps include it as well. follow the standing rules. thank you.

## Decisions taken from round 2

| # | Owner answer | Where it lands |
|---|---|---|
| 3 | Manifest wins on name, type, cost; Cultivera wins on category, quantity. If Is Cannabis = true but the category is non-cannabis, owner must pick a category before the manifest can finish onboarding | S1: needs_category hold. Wave 3: survivorship + finish gate |
| 4 | Anything flagged non-cannabis in Is Cannabis is left out | S1 (shipped) |
| 5 | Email finds what Cultivera lacks; anything neither finds goes on one "Unmatched Cultivera stock" manifest; no receive date = "does not exist, include in CCRS cleanup" | Wave 2 |
| 6 | All Cultivera manifests in their own Cultivera tab in Onboarding, filterable by vendor, with batch Gemini by vendor | Wave 3 |
| 7 | Refresh the live card when each product is approved | Already the S3c behaviour, kept |
| 10 | Build all three waves; fail loud when JSONs are missing, but stage the JSONs that were obtained | S2 + Waves 2/3 |

## Slices

| # | Slice | Status |
|---|---|---|
| S1 | (#1453) Non-cannabis gate in the transform. Rows with Is Cannabis = false (or Cannabis Y/N = N when the stock flag is blank, or the CCRS "Non-cannabis (no limit)" type with no flag) never become cards, lots or manifest lines. The `"concentrate"` default for unknown categories is removed; a cannabis row with a non-cannabis, unknown or blank category is held hidden (`needs_category`) instead of guessed | shipped |
| S2 | Loud WCIA JSON coverage. The crawler counts transfers that publish a JSON vs JSONs obtained; Fetch It All shows the gap as a failing check (no silent "partial"); every JSON obtained still stages | shipped |
| S3 | (#1455) One-click crawler report (round 3). The Fetch It All run page gets a "Crawler report (for support)" box: **Download crawler report** (one `.txt`: run status + Pacific times, loud warnings, every stage, vendor-file coverage, fetch errors grouped by stage, file list, raw `state.json` + raw `errors.jsonl`, credentials redacted) and raw `state.json` / `errors.jsonl` / `manifest.json` links. Route `GET /admin/menu-imports/fetch/<runId>/report[?file=…]` (menu.import, audited `pos_fetch.report_download`) | shipped |
| S4 | No received date = "does not exist, include in the clean up" (owner #5). `ccrs-migration-garbage-core` gains dead reason `no_received_date` (evidence: the lot's `received_on` was read and is blank); the CCRS hub's Migration clean-up panel lists and routes those lots like every other dead lot (Reconciliation zero-out if CCRS holds them, local-only if not; never a Delete), with a note + link to the import's Received dates page for any that really exist. A missing received date is no longer listed as "fixable" | (#1456) shipped |
| S5 | Mail harvest foundation (round 4). Pure `cultivera-mail-harvest-core` (52 self-tests): the CCRS monitor's keyless Google sign-in pointed at `CULTIVERA_HARVEST_MAILBOX` (default stephen@), a no-date-limit vendor-document search, a resumable Gmail-pageToken cursor, an attachment plan (json/pdf/csv/xlsx as BYTES, every skip named), magic-byte checks, Gmail quota budget. I/O: `listMessageIdsPage`, `getAttachmentBytes`. Menu imports gets a read-only **Test the vendor mailbox** button (audited `cultivera_mail.probe`). Setup guide `docs/CULTIVERA_GMAIL_HARVEST_SETUP.md` | (#1457) shipped |
| S6 | Email match by barcode + the ONE "Unmatched Cultivera stock" manifest (round 4, owner #5). Pure `cultivera-mail-match-core` (29 self-tests): `openLotsFromTransferPlan` takes the lots the crawler's transfer match left unplaced; `planMailMatch` matches each against harvested, parsed vendor documents on barcode (WCIA `inventory_id` = Cultivera Barcode). One emailed manifest places the lot (with the manifest's name, type and cost in cents for survivorship); two or more = never guess; none = `CV-UNMATCHED` "Unmatched Cultivera stock". Same transfer emailed twice = one manifest; sold-out lines counted, never made into lots; loud summary line | (#1458) shipped |
| S7 | The harvest RUN (round 5). Menu imports -> Vendor mailbox -> **Harvest the next batch** (menu.import, audited `cultivera_mail.harvest`, no new cron). Each press lists one Gmail page at the S5 cursor, opens up to 47 new emails inside a 200-second budget, downloads each vendor attachment as bytes (magic-byte checked), fetches each WCIA Transfer Data Link in the email body, stores every file privately in `pos-raw/mail-harvest/<mailbox>/<gmail id>/<n>-<name>`, parses JSON (WCIA / generic) and CCRS manifest CSVs with the existing parsers (PDF / spreadsheet kept as `stored`, read later), and inserts one row per document into the new `cultivera_mail_docs` (migration 0293; the insert is the claim). Pure `cultivera-mail-harvest-run-core` (49 self-tests); `mailDocsFromRows` feeds S6 | (#1459) shipped |
| S8 | The per-lot coverage report (round 5), read-only. Rebuild manifests -> **Coverage report** (`/admin/menu-imports/<id>/coverage`, menu.import). Builds the SAME transfer plan as the rebuild page and Apply (`loadRehomeSources` + `planFromSources`), reads only the parsed `cultivera_mail_docs` rows that list a lot the transfers left open (`barcodes &&`, GIN index, paged, fail closed), runs S6's `planMailMatch`, and shows, per lot: Cultivera transfer / one emailed manifest / several emails (not guessed) / nothing (goes on `CV-UNMATCHED`), plus the lots with no received date (CCRS clean-up). By-vendor table (most unplaced first), filters (source, vendor, no received date) and a CSV download (formula-safe). Pure `cultivera-coverage-core` (41 self-tests) | (#1460) shipped |
| S9 | Read the kept PDFs and spreadsheets (round 6). Menu imports -> Vendor mailbox -> **Read the kept PDFs and spreadsheets** (menu.import, audited `cultivera_mail.read`, no cron, no migration). Up to 12 `stored` documents per press (oldest email first, 200-second budget). PDFs: **LlamaParse** first (`parsePdfWithFallback`, the live intake's primary reader, usage logged as `cultivera-mail-read`; unpdf text layer on an outage / no key), then the intake's own layout parsers (shared via the new pure `pdf-manifest-dispatch-core`), then LlamaParse's markdown tables as a last resort; every barcode is grounded against the PDF's own text layer (an OCR-only barcode is dropped and counted). Spreadsheets: exceljs cells (exact values; not the CVE-flagged `xlsx` package), barcode only from a header-named column. Rows move `stored` -> `parsed` / `unreadable` (with the reason) via a guarded update (the claim); S6/S8 then see them. Pure `cultivera-mail-read-core` (51 self-tests) | (#1461) shipped |
| S10 | The email-step executor (round 6, W2). Rebuild manifests -> Coverage report -> **Apply the email step** (inventory.manage + attestation tick, audited `cultivera_mail_apply.*`, no cron, no migration; uses 0255's dedupe-key unique index). Writes S6's plan: one accepted, accounting-inert manifest per emailed manifest number (`<number>|EMAIL|IMPORT-<id>`; vendor, transfer date, per-barcode line facts and message ids in `raw_payload`) and the ONE `CV-UNMATCHED` "Unmatched Cultivera stock" manifest. Moves ONLY `inventory_lots.manifest_id`, each batch guarded by the manifest the preview saw; digest-pinned (Apply runs exactly the previewed plan); lineage grows before any move; verified from a DB re-read; empty received-date manifests the lots left are removed unless they carry onboarding work. Works before or after the re-home (the re-home now leaves email-step lots alone). Rollback moves lineage lots back and removes only empty email/unmatched manifests. Pure `cultivera-mail-apply-core` (52 self-tests), re-home core 76 | (#1462) shipped |
| S11 | Manifests by vendor, Gemini for a whole vendor, the mastering panel, higher lookup limits (round 7). **Receiving -> Cultivera manifests**: a **Source** column + chips + filter (Cultivera transfer / Emailed manifest / Unmatched stock / Received-date group, from `raw_payload.group_kind`; unrecorded = "Not recorded", never guessed) and **Group by vendor** (one line per vendor over every filtered manifest, link to its manifests and to "Onboard vendor"). **Product Onboarding -> Cultivera manifests by vendor** (loaded only when opened): vendor roll-up; **Start every manifest from <vendor>** (the SAME per-manifest Start, not-done only, unknown worked, id order, 200 s budget, Continue cursor; audited `cultivera_onboarding.vendor_started`); **Look up all N products from <vendor> with Gemini** (the SAME per-manifest batch lookup, once per manifest in review, idempotent; audited `catalog_draft.vendor_lookup_enqueued`); the **mastering panel** (products in onboarding, KB links, facts by source - lab certificate / Cultivera / Gemini / remembered / KB / a person - facts by field, lots linked to a lab result and certificate kept, Gemini progress, latest timeline notes; an unreadable part says so, never zero). **Lookup limits raised**: 1000 products per manifest (was 200), 30 per run (was 12), and `LOOKUP_PARALLEL_JOBS` (default 4, max 8) manifests worked at once by the every-minute worker (same lease safety; no new cron). Pure `cultivera-vendor-core` (63 self-tests), receiving-table-core 98, lookup-job-core 161. No migration | (#1463) shipped |
| W2 | Rest of Wave 2: the executor that writes S6's plan | done by S10 |
| W3 | Auto-Start rebuilt manifests, Cultivera tab + vendor filter + batch Gemini by vendor, field survivorship, category-pick finish gate | planned |

## S1 evidence (measured, not assumed)

- `normalized_cultivera/INVENTORIES_NORMALIZED.xlsx`: 4,346 rows, 93 with Is Cannabis = False (90 barcodes,
  3,734 units; Accessories, Blunt Wrap, Devices, Pipe, Paper, Bong, Dab Rig, Other Non Cannabis).
- `normalized_cultivera/PRODUCTS_NORMALIZED.xlsx`: 37 rows with Cannabis Y/N = N; 10 cannabis rows with a
  non-cannabis or formless category (Accessories, Without Category, Trade Sample) are now held for a pick.
- Through the real transfer index, every kept lot keeps the exact transfer it had before S1 (lot-by-lot diff).
  10 accessory-only transfers and 4 accessory-only vendors drop out; tests re-pinned with the old numbers in comments.
- Receiving (`website-category-resolver.ts`) already returns null / "unmapped" for these and never defaults
  to concentrate, so rule 11 parity holds; S1 reuses its `heuristicWebsiteCategory` for the held card's hint.

## S2 evidence and behavior

- Crawler (`crawler/app/cultivera_pos.py`): `stage_wcia_json` now returns a `coverage` block
  (`expected` = transfers with a vendor file incl. refused paths, `saved`, `missing`, `refused`, `errors`,
  `stoppedForTime`, `complete`). A refused path now makes the stage `partial` (it was a silent `done`).
  Any miss or a stage error writes one plain line into `state.json` `warnings`; a resume that completes clears it.
  The run itself still finishes `done` so the obtained files stage. 7 new pytest cases (101 pass).
- App: `src/lib/pos/cultivera-wcia-coverage-core.ts` (pure, 17 self-tests) counts coverage from the run's
  own `transfer_details.jsonl` (transfers with a `JsonFile`) vs readable documents in `wcia_json.jsonl`, plus
  any checksum / unreadable-line problem. No details and no crawler block = "coverage UNKNOWN" (never complete).
- Fetch run page: a red warning box above the stages, the vendor-files row turns red `PARTIAL · MISSING`,
  a red `vendor_files_complete` line lists missing transfer ids, and "What to do now" never says a plain GO.
- A real import with any missing vendor file needs the owner's tick **"Stage without the missing vendor
  files (N)"**; otherwise it is refused with the count. Test imports never need it. The files it did get are
  saved (`saveWciaFiles`) and the coverage + acknowledgment are written to the `pos_import.staged` audit row.
- GO itself stays about the core cutover (lots, columns, control totals, manifest plan); vendor files are
  reported beside it, per owner decision #10 (obtained JSONs must still stage).

### Where the stage report lives

The Fetch It All run page (`/admin/menu-imports/fetch/<runId>`) shows it: the "Vendor transfer files" row
(saved / wanted, not fetched, errors, refused, stopped for time) and the red `vendor_files_complete` line. The raw
numbers are in the run's `state.json` → `stages.wcia_json` (and `manifest.json` → `stages.wcia_json`); per-transfer
errors are in the run's `errors.jsonl` (lines with `"stage": "wcia_json"`).

## S3 behavior

- Pure core `src/lib/pos/cultivera-run-report-core.ts` (33 self-tests): `buildRunReport`, `summarizeErrors`,
  `redactSecrets`, `pacificStamp`, `RAW_REPORT_FILES` allowlist (`state.json`, `errors.jsonl`, `manifest.json`).
- `getPosRunFile(runId, name)` in `cultivera-fetch-client.ts` reads only the allowlist; a 404 is `null` (the crawler
  only writes `errors.jsonl` when a fetch fails; a running harvest has no `manifest.json` yet).
- The box shows for every run state (running, failed, cancelled, done), so a failed harvest can still be handed over.
- A crawler deployed before R74 S2 has no coverage block; the report says "Redeploy the crawler on Railway".
- Nothing new is read from Railway: the files come over the same `CRAWLER_BASE_URL` + `X-Crawler-Secret` link the
  button already uses. No crawler change, so no Railway redeploy is needed for S3 itself.

## S4 behavior

- Owner (round 2, #5): "Anything without a receive date should be flagged as, does not exist and to be included in the clean up."
- `deadReasonsFor` adds `no_received_date` when `receivedOn` was read and is null/blank. If the date was never read
  (`undefined`), nothing is flagged (no guessing). The store now selects `received_on` (`GARBAGE_LOT_SELECT`).
- Routing is unchanged and evidence-based (CCRS ledger): on file + stock + active → "Zero it out in CCRS"
  (Reconciliation, through the lot page's audited adjustment, reason "Cycle-count correction" → CCRS `Reconciliation`);
  not on file → "Not in CCRS, remove or fix it here only"; no ledger → Unknown, no action offered.
- `import_lot_received_date_missing` leaves `FIXABLE_CODES` (a lot is either dead or dated, never both lists).
- The panel note says how many lots are dead only for the date. If one is really on the shelf, giving it a date on
  `/admin/menu-imports/<importId>/received-dates` (R16b, attested, never derived) takes it off the list.
- Guide step `ccrs_cleanup` and the Menu Imports page text now name the third reason.
- Pins: core self-tests 53 → 67 (+14), `tests/compliance/r50-s10c-migration-garbage.test.tsx` +2 tests.
- Read-only, as before: S4 writes nothing and adds no migration.

## S5 behavior

- Sign-in is the CCRS monitor's, unchanged (`mailConfigFromEnv`), with the mailbox swapped to
  `CULTIVERA_HARVEST_MAILBOX` (default `stephen@greenwaymarijuana.com`). The CCRS lookback setting is
  ignored for the harvest. One domain-wide-delegation approval covers every mailbox in the domain.
- Search: `{filename:json filename:pdf filename:csv filename:xlsx filename:xls manifest invoice COA
  "certificate of analysis" "transfer data" wcia} -in:chats`. No date limit unless one is given (bad
  dates are dropped, never guessed).
- Cursor `{version, mailbox, query, pageToken, pagesDone, listed, done}`: a changed mailbox or query, or
  an unreadable cursor, restarts the walk and says why. A page with no `nextPageToken` finishes it.
- Attachments: kind by extension, then MIME; at most 25 MB (Gmail's limit) and 10 per email; duplicates,
  non-documents and missing data are named as skips. Bytes are decoded from base64url directly, and
  `bytesMatchKind` refuses a "PDF" that is not `%PDF`, a "JSON" that does not open with `{`/`[`, and a
  binary "CSV".
- Quota (Gmail usage-limits page, read 2026-10-21): list 5, get(full) 60, attachments.get 20; 6,000 per
  user per minute. `messagesPerRun(2)` = 47 emails under an 80 % budget.
- The test button reads ONE id; nothing is opened or stored.

## S6 behavior

- Input lots: TransferMatchPlan decisions with `matched=false`, joined to the export rows (first row
  labels the lot; units summed; rows with units <= 0 are not stock).
- A receipt in email: a parsed document line with `lot_code` = the barcode and received qty > 0.
- Documents with the same manifest number and the same vendor license (else normalized vendor name)
  are one manifest, so a forwarded or re-sent email never makes a duplicate. A document with no number
  is its own manifest.
- Exactly one manifest: the lot is placed, carrying `{productName, inventoryType, unitCostCents, qty}`
  from the line (manifest wins on name/type/cost; Cultivera keeps category and quantity).
- Two or more manifests: `several_manifests` with the candidates, and the lot goes on the unmatched
  manifest (these lots have no received time to choose with).
- No receipt: `CV-UNMATCHED`, label "Unmatched Cultivera stock", with per-vendor counts and units.
- Vendor names may differ (a license's legal name vs Cultivera's display name); barcodes are
  state-issued, so the barcode decides. Agreement is reported (`vendorAgrees`, `vendorDiffers`).
- Lines for barcodes that are not open lots (sold out, or already placed) are counted as
  `otherLines`, never turned into lots.

## S7 behavior

- One batch = one Gmail page (100 ids, newest first within the page; the walk goes page by page as
  far back as Gmail allows). Ids already in `cultivera_mail_docs` are never opened again. The cursor
  moves to the next page only when every email on the page has rows; otherwise the next press
  finishes the same page.
- Per email: attachments to download come from S5's plan (json / pdf / csv / xlsx, at most 10, 25 MB
  each); when no JSON is attached, up to 4 WCIA transfer links in the body are fetched (the same
  extractor the inbound email uses). Every document gets a numbered row: `parsed` (barcodes read),
  `stored` (PDF / spreadsheet kept, read later), `unreadable` (kept, no barcodes, with the reason),
  `failed` (could not download, or the bytes are not what the name says), `skipped` (too large, over
  the per-email cap). An email with no vendor document gets ONE `no_documents` row (pictures and
  signatures are counted on it).
- Each line kept is `[barcode, qty, product name, inventory type, unit cost in cents]`.
- A Gmail 429 / 5xx / timeout stops the batch and writes nothing for that email; it is read again on
  the next press (never recorded as a permanent failure). Any other error opening an email also stops
  the batch (never skipped silently).
- A changed mailbox or search starts over from the oldest page and says why.
- Database (0293): unique (mailbox, gmail_id, doc_index) is the claim; received fields immutable;
  status only moves among stored / unreadable / parsed (a later re-read); never deleted; factory
  reset KEEPS it; staff read, admin write. Proven on Postgres 15 by
  `scripts/recon/cultivera-mail-docs-0293-pg-check.sql` (CI post-apply check).
- Before 0293 is applied the section says "Apply database update 0293 first." and the button is off.


## S8 behavior

- Read-only: no table, no migration, no audit row. Nothing is moved; it says where every lot WOULD
  go, using exactly the plan Apply runs and the S6 match rule.
- One row per Cultivera barcode with stock (units summed across rows; zero-unit and blank barcodes
  left out). Each row carries the manifest number it lands on and why (how the transfer matched, why
  Cultivera missed, or which emailed manifests compete).
- "Several emails" = the barcode is on two or more DIFFERENT emailed manifests (a re-sent email of
  the same manifest counts once). It is never guessed: it goes on `CV-UNMATCHED` with the candidates
  named.
- Before 0293 is applied (or before any harvest), the summary says the email was NOT checked /
  that there are no harvested documents yet, so "not checked" and "nothing found" are never confused.
- A barcode query failure is an error on the page, never a silent partial report.
- CSV: `cultivera-coverage-<id>.csv`, same filters as the page, cells starting with = + - @ are
  neutralised.

## S9 behavior

- LlamaParse helps here, so it is used: it is the PRIMARY PDF reader (same call as the inbox intake,
  `parsePdfWithFallback`, feature tag `cultivera-mail-read` in `ai_usage`). It reads scanned PDFs
  (no text layer), which the text layer alone cannot. Without `LLAMA_CLOUD_API_KEY` (or on an outage
  / 402) the PDF's own text layer is used and the row's note says why.
- Never guessed: when the PDF has a usable text layer (>= 40 chars), every barcode LlamaParse read
  must also appear in that layer, or it is dropped (counted in the note). A scanned PDF keeps
  LlamaParse's barcodes and the note says they are vision-only.
- Order of readers for a PDF: LlamaParse text -> the same text with markdown tables flattened -> the
  raw text layer, each through the intake's layout parsers (LCB shipping doc, GrowFlow, Transfer
  Log, OpenTHC invoice). If none matches, LlamaParse's own markdown table is read like a spreadsheet
  (barcode only from a column headed Barcode / Inventory ID / Lot ID / ...), still grounded.
- Spreadsheets are NOT sent to LlamaParse: a cell is already exact text, and AI could only add error.
  exceljs reads every sheet; the sheet with the most barcodes wins. Formulas count by their saved
  result; rich text is joined; dates become YYYY-MM-DD. Quantity, product, type and unit price come
  only from named columns (price in cents). No quantity column = each listed lot counted as present,
  with a warning. Number / license / vendor / date come from a "Label: value" block or a column with
  one distinct value; two values = not guessed. Old `.xls` (97-2003) and files over 15 MB are
  unreadable with the reason.
- Fail loud: a storage outage stops the press and leaves the document `stored` (read next press). A
  file gone from storage, a corrupt workbook or a PDF with no readable text is marked `unreadable`
  with the reason, so it never blocks the queue and is never silently skipped.
- The guarded update (`status = 'stored'`) is the claim: two presses read each document once.
- Tests: `tests/compliance/r74-s9-mail-read.test.ts` (22) with the real LCB shipping-document text,
  the real QGT PDFs (manifest + COA) through the real text layer, and a real exceljs-built `.xlsx`.
  Mutation-checked: disabling grounding, the claim guard, the outage stop, the `.xls` check, formula
  results, the header rule, table-fallback grounding, the time budget or cents makes the suite fail.

## S10 behavior

- Where: Menu imports -> Rebuild manifests -> Coverage report, new section "Apply the email step"
  (only inventory managers see the button; everyone with menu.import sees the preview).
- What it writes: for each emailed manifest number that lists a lot the transfer plan leaves open,
  one `inbound_manifests` row (status accepted, `accepted_at`/`received_at` null, so nothing posts
  to accounting), keyed `<NUMBER>|EMAIL|IMPORT-<import id>` (numberless documents get
  `CV-EMAIL-<hash>`). Vendor = the email's vendor, else the single Cultivera vendor label, else
  "Vendor not named on the emailed manifest" (never guessed). Every open lot no email lists goes on
  ONE `CV-UNMATCHED` "Unmatched Cultivera stock" manifest (`by_vendor` and the several-manifest
  candidates recorded in `raw_payload`). `line_facts` (name / type / cost in cents per barcode) are
  stored for Wave 3 survivorship; nothing on the lot except `manifest_id` changes.
- Where a lot may come from: the import's POS-IMPORT manifest, a received-date manifest built by
  the re-home (session / day / undated), or CV-UNMATCHED (an upgrade after a later harvest). A lot
  already on an emailed manifest stays (never downgraded; reported). A lot on one of this import's
  transfer manifests, or on a manifest from elsewhere, REFUSES the plan (nothing is pulled off a
  native delivery).
- Refuses (in the preview, before anything is written): transfer-plan gate failing, 0293 not
  applied, no harvested document at all while lots are open (never dumps everything on unmatched),
  missing POS-IMPORT manifest, duplicate barcodes, a planned key held by something else, an
  existing email manifest without barcode lineage. Unread kept files only warn ("read them and
  apply again").
- Order and safety: (1) lineage (`raw_payload.barcodes`) grows on existing manifests first, guarded
  by kind + import id; one that changed hands stops the run before any move; (2) missing manifests
  are inserted (the unique dedupe key makes a resume never duplicate); (3) moves in batches of 150,
  each `.eq("manifest_id", <manifest the preview saw>)`; a lot moved meanwhile is left alone and
  reported; (4) emptied received-date manifests are deleted only when empty, ours, and carrying no
  onboarding work (else kept with a warning); (5) control totals are re-read from the database.
  The button carries the preview's sha256 digest; a new harvested file since the preview means
  Apply writes nothing and asks for a fresh preview.
- Rollback: moves back only the lots whose barcodes are in each manifest's lineage, checks they
  left, then deletes the email/unmatched manifests that are empty and carry no work. A manifest
  without lineage refuses (no guessing). After a rollback the re-home puts the lots back on
  received-date manifests.
- Re-home interplay: `planRehome` now skips lots on this import's email/unmatched manifests
  (`lotsPlacedByEmail`), so the re-home and the email step never fight in either order.
- Tests: `tests/compliance/r74-s10-mail-apply.test.ts` (22) against a fake database covering both
  orders, resume after insert/move failures, a lying update, the move guard, the upgrade, lineage
  union, changed-hands stop, rollback (exact + work kept), refusals and wiring. Mutation-checked
  (19 mutants, all caught): removing the move guard, the digest check, lineage-first, the lineage
  count check, the work check, the fallback clean-up, rollback lineage, rollback's empty check, the
  missing-lineage refusal, DB verification, the downgrade/transfer/foreign/no-docs/0293 refusals,
  the re-home's skip (both places), the lineage union or the inventory.manage permission makes
  the suite fail.

## S11 behavior

Owner (round 7): "i want to see the manifests in full in the receiving table under the cultivera tab. i want to see the manifests in onboarding, grouped or groupable by vendor. i want to see gemini telling me it can lookup all products from a vendor. if you can increase the limits for the cultivera look ups, please increase them ... i want to see the onboard page showing me all the mastering it is doing to the products."

Receiving (`/admin/inventory/intake?view=cultivera`). Every rebuilt manifest is listed (the loader pages past the 1,000-row cap; 50 per page). New: the **Source** of each manifest, read from `raw_payload.group_kind` - `transfer` (matched to the vendor's own Cultivera transfer), `email` (rebuilt from the vendor's emailed manifest), `unmatched` (the ONE `CV-UNMATCHED` catch-all), `session`/`day`/`undated` (grouped by received date). Anything else shows "Not recorded". Chips above the table count each source and filter on click; the filter bar has the same Source select. **Group by vendor** rolls the filtered manifests (all of them, not one page) into one line per vendor: manifests, lots, not started / in review / complete (+ unknown when the onboarding counts could not be read), with links to that vendor's manifests and to **Onboard vendor**.

Product Onboarding (`/admin/inventory/drafts`, link "Cultivera manifests by vendor"; `?cv_vendor=<name>` opens one vendor). Loaded only when asked for, so the ordinary review page is not slowed down.
- **Start every manifest from <vendor>** runs the existing per-manifest Start (vendor lab results, onboarding rows, certificate archive + read, KB write-back + link, lab facts, Cultivera potency fact) on each manifest not complete yet, in id order. One press works until less than 75 s of its 200 s budget is left (a Start can take ~60 s for the certificate read), then shows **Continue**, which resumes after the last manifest finished; "started N of M" counts across presses. A manifest whose state is unknown is worked (Start is re-runnable; that is the safe side). Failures are listed, never hidden. Nothing changes stock, prices or the live menu.
- **Look up all N products from <vendor> with Gemini** queues the existing batch lookup once per manifest of the vendor that has products in review (a not-started manifest has nothing to look up yet: Start it first). An already-running job is reused, never doubled. The banner says how many products Gemini is looking up across how many manifests; results land on each product as the every-minute worker finishes them, and every answer is saved to the knowledge base (and so reused after a factory reset, which keeps `kb_*`, provenance and image memory).
- **Mastering panel** for the chosen vendor: products in onboarding (in review / approved / dismissed), how many are linked to a knowledge-base product, total facts and how many products have a fact from each source (lab certificate, Cultivera, Gemini, remembered, knowledge base, a person), facts by field, "X of Y lots linked to a lab result, Z with the certificate file kept", Gemini progress ("N of M products looked up across K manifests"), and the latest timeline notes (onboarding runs, vendor lab results attached, lab certificates read, facts from lab certificates). Each part is read separately; one that fails says "could not be read", never 0.

Lookup limits (owner: "if you can increase the limits ... please increase them"). One manifest's batch now holds up to **1000** products (was 200); one run of the worker looks up to **30** (was 12; `LOOKUP_ITEMS_PER_TICK` still lowers it); and the worker now takes the oldest job whose lease is free, so up to **`LOOKUP_PARALLEL_JOBS`** manifests (default 4, max 8) are worked at the same time by overlapping minute runs - a whole vendor's lookups proceed in parallel. Lease safety is unchanged (one run per job at a time). The real cap on speed is the AI and web-search time per product, not these numbers. No new cron (still 15).

## Round 3 walkthrough

The owner's baby-steps guide (Railway redeploy check → fetch → **Download crawler report** → send) is
`docs/CULTIVERA_CRAWLER_REPORT_WALKTHROUGH.md`. Railway keeps run files in the container
(`crawler/.cache/cultivera_pos/`, newest 12) unless a Volume is attached, so the order is always: redeploy,
then fetch, then download.
