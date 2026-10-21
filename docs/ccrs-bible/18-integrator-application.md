# Part 18 — The CCRS integrator application (LIQ1455), as submitted 2026-10-19

**Audience: the AI agent.** This part records what Greenway told the LCB when it applied to be its own CCRS integrator. Every promise in that package is a commitment the code has to keep. A future agent must be able to answer "did we say we would do X, and do we?" from this page alone.

**Owner, verbatim (2026-10-20):** *"I have already filled out, signed, and emailed brian a copy of the application to become an approved integrator. I will upload to you what I sent him already for you to have to reference if needed. perhaps we should add them to the repo if they arent already in there? ill let you decide based on professional enterprise grade methods would be for including this in the project."*

---

## A. Where the documents live, and why they are NOT in git

The four PDFs are **not committed**, on purpose:

1. **This repository is public** (`mblyman89/GREENWAY-WEBSITE`). Anything committed stays in git history forever, even after it is deleted.
2. The LIQ1455 scan carries a **handwritten signature**, a personal email address and two phone numbers. A public signature image is a forgery risk. The contact details are personal information.
3. A signed legal record is kept as a **records-management** matter: the original file, its checksum, and controlled storage. A code repository is the wrong place for it.

What is kept here instead is the **fingerprint** (SHA-256) of each file, a summary, and the traceability table in §D. Anyone holding the originals can prove they are byte-for-byte the files described here:

- Mac/Linux: `shasum -a 256 <file>`
- Windows PowerShell: `Get-FileHash <file>`

**Where the originals must be kept (owner action, checklist C-138):**
- the sent email in the owner's mailbox, which is the legal record of what was sent and when;
- one copy in private, access-controlled storage (for example a private Google Drive folder named `CCRS Integrator Application 2026-10-19`);
- retained at least five years, the same period WAC 314-55-083 sets for CCRS records and the period the agreement's clause 5 promises.

`.gitignore` blocks these exact file names, so a copy dropped into the repo folder by mistake cannot be committed by accident.

| File (as uploaded 2026-10-20) | Pages | Made by | SHA-256 | MD5 |
|---|---|---|---|---|
| `CCRS_System_Access_Application-Signed.pdf` (LCB form LIQ1455 10/22, scanned) | 3 | Epson ScanSmart, 2026-10-20 00:03 UTC | `c943d2f1102c2619b18a5f357228f525fe638f697a8d84c3b85194e2ee3dbadf` | `631b9623c06c6ba8e7d85e44085400f0` |
| `Greenway_CCRS_Integrator_Agreement_Executed_Self.pdf` | 1 | Qt 5.15.8, 2026-10-20 00:14 UTC | `19f5674230d12546fb1fb940878dfbdab7338096af8d2ea49a6c1ef4c5720bb0` | `f74b966f69b6c19d729550fd7f5bfd13` |
| `Greenway_Statement_of_Services_Offered.pdf` | 4 | Qt 5.15.8, 2026-10-20 00:14 UTC | `3308001f9c871d19a3550a4924e00ae6c69600b3a0d4da80a1dbc92afb6d0a0f` | `92b742e6bd115f7039beced39e13425c` |
| `Greenway_Statement_of_Developmental_Purpose.pdf` | 5 | Qt 5.15.8, 2026-10-20 00:14 UTC | `eebf48d460666079433178a988f4497f47b85a801bd30d45e832ebb9da1ad4fa` | `c9e3761abf8e4bf4d0b5b4031dc411a6` |

(UTC times. 00:03–00:14 UTC on 10/20 is the evening of Monday 10/19 in Pacific time.)

---

## B. What each document says (read from the files, 2026-10-20)

### B.1 LIQ1455 "CCRS System Access Application" (scanned, signed)

- **Boxes checked:** both "test environment for development purposes" materials (integrator contact information; statement of developmental purpose) **and** all four "access to CCRS" materials (contact information; statement of services offered; complete list of LCB licensee clientele under contract; blank template of contract terms and agreements).
- **Trade name:** "Greenway Marijuana Point of Transaction System". **UBI** 603353555. **Business URL** greenwaymarijuana.com. **Business phone** 3604436988.
- **Primary point of contact:** Michael Lyman, michael@greenwaymarijuana.com, phone **360-204-1119**.
- **Secondary point of contact:** Michael Lyman, contact@greenwaymarijuana.com, phone **360-443-6988**.
- **CCRS Admin 1 email:** michael@greenwaymarijuana.com. **CCRS Admin 2 email:** **M_lyman@live.com**.
- **Statement of services offered** box: "Please see attached document" for the statement of services, the statement of developmental purpose and the integrator agreement template.
- **LCB licensee clientele:** one row, "Greenway Marijuana", license 413541.
- **Acknowledgements (all checked):** files must follow the CCRS Data Model File Specification Manual; data must accurately reflect what clients submit; access is a privilege by business need; it may be removed for failure to upload, failure to report accurate information, or failure to maintain accurate information; an integrator may only upload for licensees who granted access through CCRS.
- **Signed:** Michael Lyman, Owner, **October 19, 2026** (page 3).

### B.2 "CCRS Integrator Services Agreement" (executed copy; integrator and licensee are the same entity)

Parties: Lyman's Marijuana LLC dba Greenway Marijuana, UBI 603 353 555, 4851 Geiger Rd SE, Port Orchard WA 98366, as both Integrator and Licensee (WSLCB Cannabis Retailer License No. 413541). Twelve clauses:

1. **Services:** prepare and upload Strain, Area, Product, Inventory, InventoryAdjustment, InventoryTransfer and Sale, as applicable.
2. **Authorization:** for this license only, only while authorized.
3. **Licensee responsibilities:** complete and accurate records; review and correct errors; the licensee stays responsible to the LCB.
4. **Integrator responsibilities:** (a) files that follow the Data Model File Specification and accurately reflect the records; (b) weekly files by the CCRS due date; (c) prompt notice of any CCRS error, and help correct it; (d) keep its CCRS integrator contact information current.
5. **Records and data:** the licensee owns its data. Copies of all submitted files and CCRS responses are kept at least five years (WAC 314-55-083) and provided on request.
6. **Confidentiality and security:** credentials stored securely and never shared.
7. **Fees:** $0.00; any change needs 30 days' written notice.
8. **Term and termination:** 30 days' written notice; on termination, stop uploading, return records, and cooperate in un-assigning the integrator in CCRS.
9. **Compliance:** chapter 69.50 RCW, chapter 314-55 WAC, LCB CCRS requirements.
10. **Liability:** no indirect or consequential damages; each party responsible for its own regulatory obligations.
11. **Governing law:** Washington.
12. **Entire agreement:** changes in writing, signed by both parties.

**As uploaded, the "made on ____, 2026" date, both signature lines and both date lines are BLANK** (§E item 1).

### B.3 "Statement of Services Offered" (4 pages, header date October 19, 2026)

What the engine does today, and what is "still being developed". Its claims are traced line by line in §D. It names the contacts (360) 443-6988, michael@greenwaymarijuana.com and contact@greenwaymarijuana.com, plus Brian McQuay and Marcos Ocampo at the LCB. The closing "Date: ____" is blank (§E item 2).

### B.4 "Statement of Developmental Purpose" (5 pages, dated October 19, 2026)

Asks for **Pre-Production** integrator access (`precannabisreporting.lcb.wa.gov`, Integrator API audience `lcb.ccrs.api.pre`) to finish and certify the engine before the November 1 migration. Sections:
1. purpose;
2. business need (44,746 open lots / ~532,000 units in the 9/18 delivery vs ~4,284 lots / ~30,000 units on hand);
3. what is built (engineering discipline, the bible, byte-exact files, pre-flight, ledger, outbox, PREprod evidence);
4. developmental work: 4.1 API client, 4.2 integrator file names, 4.3 InventoryTransfer rows and validation refinements, 4.4 large-scale reconciliation waves, 4.5 open questions;
5. testing method;
6. data security;
7. schedule;
8. contacts.

The closing "Date: ____" is blank (§E item 2).

---

## C. What the LCB sources say the integrator path requires (pinned)

- File names: "Integrators: UploadType_IntegratorID_YYYYMMDDHHMMSS" `[G L0047]` (licensees: `[G L0046]`).
- Examiner: API access "At this time it is just for integrators, future enhancements are being researched." `[EXAM L0563]` (X-37).
- Integrator API guide `[API]`: an OAuth 2.0 client-credentials token for the environment's API identifier (`lcb.ccrs.api.pre` / `lcb.ccrs.api.prod`, `[API L0056]` / `[API L0061]`); "Tokens expire 24 hours after they are issued" `[API L0137]`; a multipart upload with the bearer token and an `X-Uploader-Email` header naming an authorized uploader `[API L0154]`.

---

## D. Commitments vs code (traceability, as of main `e9b31574` + S-14/S-16 this round)

Status: **BUILT** (in code, tested) · **THIS ROUND** (built in S-14 / S-16, 2026-10-20) · **NOT BUILT** (promised as developmental) · **OWNER** (a business action, not code).

| # | Commitment (where) | Status | Evidence / next step |
|---|---|---|---|
| 1 | Seven retailer files, exact template columns (SoS; DP §3.2–3.3) | BUILT | `CCRS_COLUMNS` (`ccrs-batch-core.ts`); P20261007A golden set (Part 17 §B) |
| 2 | Three header rows, CRLF, no BOM, MM/DD/YYYY, True/False (DP §3.3) | BUILT, one caveat | `assembleCcrsFile`. **Caveat:** the weekly Inventory builder writes `FALSE` in upper case (`ccrs-batch.ts` ~L678). CCRS accepts it (S-13 production files) and the guide lists `TRUE`/`FALSE` `[G L0620-L0621]`, but it is not the `True/False` the statement describes. S-14 writes `False`, matching the P20261007A known-good file |
| 3 | Pacific-time file stamps (DP §3.3) | BUILT | `ccrsFileStamp` (S-01) |
| 4 | Upload groups in order, released on the success notice (DP §3.3) | BUILT | `CCRS_UPLOAD_GROUPS`; 0249 `ccrs_mark_uploaded` pacing (X-31) |
| 5 | Pre-flight rules: TotalCost ≠ 0, $0.01 samples, QoH ≤ Initial, unit weight, reserved strains, 37% excise, adjustment detail, unassigned ids, comma/line-break (DP §3.4) | BUILT | `ccrs-preflight-core.ts`, `ccrs-submit-gate-core.ts`, `withholdUnencodableRows` |
| 6 | Ledger self-check: no Insert of a held id, no Update/Delete of an absent one, references resolve, totals reconcile (DP §3.4) | BUILT | `verifyOutboxAgainstLedger` (S-12b, S-17b) |
| 7 | Ledger seeded from 9/18: 62,744 lots (17,998 closed / 44,746 open), 64,563 products, 9,692 strains, 9 areas = 137,008 (DP §3.5) | BUILT | `EXPECTED_2026_09_18` in `seed-ccrs-ledger.ts` (62,744 + 64,563 + 9,692 + 9 = 137,008) |
| 8 | Filed ids kept byte-for-byte incl. 4,295 with periods; new ids minted `GWP-` (DP §3.5) | BUILT | S-10, S-12 |
| 9 | Outbox: SHA-256, immutable copy, duplicate refusal, 10,000-row chunks one second apart (DP §3.6) | BUILT | 0248 `ccrs_emit_files`; `ccrs-chunk-core.ts` |
| 10 | "ten-transition state machine" (DP §3.6) | BUILT | 0247 `ccrs_files_guard` `legal` array has exactly 10 entries |
| 11 | Success notice parsed and correlated on our file name; error file matched row by row (DP §3.6) | BUILT | S-12c, S-18a/b mailbox monitor |
| 12 | Five-year retention of submitted files and responses (Agreement 5; DP §6) | BUILT (storage); OWNER (policy) | `ccrs_files` rows can never be deleted after draft (0247 guard); `ccrs_file_contents` keeps the bytes. No purge job exists. Backups are the hosting provider's |
| 13 | Credentials only as server-side secrets, never in git (Agreement 6; DP §6) | NOT BUILT (nothing to store yet) | Applies when the API client lands (R-1) |
| 14 | Integrator API client: token cache to ~24 h, every documented outcome, pacing (DP §4.1; SoS) | **NOT BUILT** | R-1. Needs the client id/secret LCB issues on approval. Design in the round report |
| 15 | Integrator file names `UploadType_IntegratorID_…` (DP §4.2) | **NOT BUILT** | Needs the Integrator ID. `ccrsFileName` is pure, so the change is small; prove it in PREprod first |
| 16 | InventoryTransfer rows from receiving records (DP §4.3) | **NOT BUILT** | Today the file is empty with an advisory (`ccrs-batch.ts` ~L1027) |
| 17 | Empty Description demoted to warning (DP §4.3) | **BUILT (R5-3, 2026-10-20)** | `E10_DESCRIPTION_REQUIRED` is now `severity: "warning"` in `ccrs-batch.ts`; the product row was never withheld (test `r5-preprod-evidence-gates.test.ts`, mutation M394). Based on T-19 accepted `[OBS 2026-09-17 T-19]`; U-21 stays open (LCB may enforce the Note `[G L0482-L0483]`) |
| 18 | Stale-lot waves: Update to 0, then Reconciliation, 10k chunks, cost/QoH/strain repairs (DP §4.4; SoS) | **THIS ROUND (S-14)** | `ccrs-equalize-core.ts`, `scripts/compliance/equalize-ccrs-wave.ts`. Every open examiner question (Q-B1/2/3/6) is a policy switch with the safe default |
| 19 | Fresh-copy compare after uploads (SoS; Part 17 §G) | BUILT (S-15 merge) + **THIS ROUND (S-16 verify)** | `ccrs-reseed-core.ts`; `ccrs-copy-verify-core.ts`, `scripts/compliance/verify-ccrs-copy.ts` |
| 20 | Test counts "23,676 tests / 908 files; CCRS subset 20 files / 740 tests" on 10/19 (DP §3.1) | Was true on 10/19; grows | Each round's report gives the current count |
| 21 | "about 185 SQL mutants" and "111 mutations" (DP §3.1) | Understated | The TypeScript harness had 261 mutations at `e9b31574` (M1–M269 with gaps), all killed. The SQL mutant count was not re-counted here |
| 22 | Integrator keeps contact information current (Agreement 4(d)) | OWNER | See §E items 3–4 |
| 23 | On termination, cooperate in un-assigning the integrator (Agreement 8) | OWNER | Part 07 un-assignment click path |

---

## E. Discrepancies found (owner to decide; none is a code change)

1. **The agreement is unsigned and undated as uploaded.** The "made on ____, 2026" line, both signature lines and both date lines are blank, but the header says "EXECUTED COPY". Clause 12 says changes must be "in writing and signed by both parties". If the emailed copy is the same file, the LCB holds an unsigned "executed" agreement. **Recommended:** sign and date both blocks (same person, both roles), fill in "made on October 19, 2026", and send the signed copy to Brian as a follow-up: *"Attached is the signed copy of the integrator agreement; the copy sent on 10/19 was missing signatures."*
2. **Both statements end with "Date: ____" blank**, though each header says October 19, 2026. Low risk; fill them in on any re-send.
3. **Phone numbers differ.** LIQ1455 gives the primary contact **360-204-1119** and the secondary **360-443-6988**. Both statements list only **(360) 443-6988** for the primary contact. Not wrong if both are valid, but the LCB may call 360-204-1119 first. Confirm which number answers.
4. **CCRS Admin 2 is a personal address (`M_lyman@live.com`).** That is allowed, but CCRS mail (success/error notices) goes to the admin addresses. The S-18 mailbox monitor watches michael@greenwaymarijuana.com only. Mail sent only to the live.com address would not be seen by the system. Either keep it as a deliberate personal backup (preferred: a second human copy) or change it to a business address.
5. **"InventoryTransfer … emitted with no rows"** (DP §4.3) is true and honest. It stays on the list (D row 16).
6. **The trade name** is "Greenway Marijuana Point of Transaction System". If the LCB lists it on its approved-integrators page, that is the public name. Owner's choice; no action.

---

## F. What happens next, and what the code must do then

| When | Event | Code / doc action |
|---|---|---|
| LCB answers the application | PREprod integrator credentials (client id, secret, Integrator ID, uploader email) | Store the secret only in Vercel environment variables (never git, never the browser). Record the Integrator ID in Part 05 as an owner fact. Start R-1 slice R-1a (pure API core, tests first) |
| PREprod proof | Integrator file names + API upload accepted | Evidence folder under `docs/ccrs-bible/evidence/`, the same discipline as P20261007A |
| Production approval | Production credentials, audience `lcb.ccrs.api.prod` | R-1 switch, dry-run first (Part 09 Roadmap R-1 gate) |
| Brian answers Q-B1…Q-B11 | Policies for the waves | Change only the S-14 policy defaults the answer settles, cite `[EXAM L####]`, close U-55…U-58 |

---

## G. Change log

- 2026-10-20 (R5-3): row 17 is now BUILT (E10 demoted to a warning).
- 2026-10-20: created (owner upload of the four PDFs). Hashes computed in the sandbox with `sha256sum`/`md5sum`. Text read with `pdftotext`. The LIQ1455 scan was read from its page images.
