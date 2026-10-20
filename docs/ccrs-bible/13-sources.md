# 13 — Sources (URL, fetch date, on-disk path, checksum)

All fetched 2026-09-15 (Pacific) from `lcb.wa.gov`. On-disk paths are under `/workspace/lcb/` (outside the repo; regenerate Part 02 from them per Part 00). If a future sandbox lacks `/workspace/lcb`, re-fetch from the URLs below, re-run `md5sum`, and **compare against this table before regenerating Part 02** — a changed checksum means the LCB revised the document and every pin in Parts 04–12 must be re-verified.

## A. Primary LCB documents

| Pin prefix | Document | URL | On-disk (PDF/HTML) | md5 | Text extraction | md5 | Lines |
|---|---|---|---|---|---|---|---|
| `[G]` | CCRS Upload User Guide, Feb 2026 ("CIB 133", 41 pp) | `https://lcb.wa.gov/sites/default/files/2026-02/CCRS%20Upload%20User%20Guide%202-26%20word.pdf` | `lcb/guide-2026-02.pdf` | `cbfc4dd29b49c42639f1207f8078a6b4` | `lcb/guide.txt` (pdftotext -layout; footer "Page N" is the **last** line of page N) | `02ca3b523c2b41e4b833d1b1b4552aab` | 1479 |
| `[FAQ]` | CCRS FAQ page | `https://lcb.wa.gov/ccrs/faq` | `lcb/faq.html` | `c31bf85dd659fa34195b84c9d8440f9d` | `lcb/faq.txt` (verbatim Q/A text; hrefs not preserved) | `49fdad3c530e1f19dcbcb294e4908a2d` | 183 |
| `[API]` | CCRS Integrator API Guide, Aug 2026 (8 pp) | `https://lcb.wa.gov/sites/default/files/2026-08/CCRS%20Integrator%20API%20Guide.pdf` | `lcb/api-2026-08.pdf` | `f9cf4ea490a1b38d62c8f27de497d9ed` | `lcb/api.txt` | `51b8c3b16d313d4fe89a7535a15cc2f2` | 285 |
| `[LOGIN]` | CCRS Getting Started and Login Guide (updated Aug 9 2024) | `https://lcb.wa.gov/sites/default/files/publications/Marijuana/CCRS/CCRS%20Getting%20Started%20and%20Login%20Guide.pdf` | `lcb/login.pdf` | `018b48f75d48256abc43652cb1394e90` | `lcb/login.txt` | `40c47dad8e7c3bbf92c9f3eab68b1273` | 78 |
| `[ADMIN]` | CCRS License Administrator Guide | `https://lcb.wa.gov/sites/default/files/publications/Marijuana/CCRS/CCRS%20License%20Administrator%20Guide.pdf` | `lcb/admin-guide.pdf` | `124afd694274304ec4a5f5f35ae6ceca` | `lcb/admin-guide.txt` | `108243eefb48113770e6e1e44b5815ee` | 161 |
| `[SAW]` | CCRS SAW User Guide (updated Aug 9 2024) | `https://lcb.wa.gov/sites/default/files/publications/Marijuana/CCRS/CCRS%20SAW%20User%20Guide.pdf` | `lcb/saw-guide.pdf` | `72834e6aca40474762e4b673060f2133` | `lcb/saw-guide.txt` | `e311f24ae673959c2249848c0adbead7` | 55 |
| `[MANI]` | CCRS Manifests page | `https://lcb.wa.gov/ccrs/manifests` | `lcb/manifests.html` | `87ccb8ee7155938dc5fdf570109a1da2` | `lcb/manifests.txt` | `872e34b7fc207701ab20bba611e3982f` | 206 |

## B. Official CSV templates (`[TPL <File> R#]`)

Downloaded from the CCRS Resources page (`https://lcb.wa.gov/ccrs/resources`, saved as `lcb/resources.html`, md5 `e45340bbae798c3d0ac2bc473229e3c4`). Each is 4 lines: 3 header rows + the column row. **Byte-identical** to `repo/docs/ccrs-templates/*.csv` (md5 compared 2026-09-15).

| File | URL | md5 (both copies) |
|---|---|---|
| Strain.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/Updated%20CSVs/Strain.csv` | `f8545b96d0f3caf8dc54c6d31b8fd6a3` |
| Area.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/Area.csv` | `304a0171bc6454c01eb9bd924ad7f8a3` |
| Product.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/Product.csv` | `5bf8330bf90fe04ae63765e028363649` |
| Inventory.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/Inventory.csv` | `d4f9864d23c56d73ca18176761b34def` |
| InventoryAdjustment.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/InventoryAdjustment.csv` | `c52892d14efd0fe943d83ec420f07762` |
| InventoryTransfer.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/InventoryTransfer.csv` | `8e05c8ea77890ab418a874a2af186b31` |
| Sales.csv | `https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/Updated%20CSVs/Sales.csv` | `bc73a9a7060c778fe5dee7333018d794` |

All md5 values above were pasted from `md5sum` output on 2026-09-15 (never hand-typed).

Not downloaded (not retailer files): PlantTransfer.csv, Plant.csv, PlantDestruction.csv, Harvest 1.csv, LabTest (not linked on the page at fetch time).

## C. Other pages consulted (no pins; context only)

| Page | URL | On-disk | md5 |
|---|---|---|---|
| CCRS task list / bulletins | (saved from the CCRS section; the 08/19/2026 bulletin's "Sign-In Guide" link returned 404 — do not cite it) | `lcb/tasklist.html` | `0919e01de71fe7281cd9a38747b66284` |
| Approved integrators list | `https://lcb.wa.gov/ccrs/approved_integrators` | not saved | — |
| Integrator approval process | `https://lcb.wa.gov/ccrs/approval_process` | not saved | — |
| Superseded Upload User Guide (June 2025) | `https://lcb.wa.gov/sites/default/files/2025-06/CCRS%20Upload%20User%20Guide%20June%202025.pdf` | not saved | — (do not pin; Feb 2026 supersedes) |
| Portal (prod) | `https://cannabisreporting.lcb.wa.gov` | — | `[API L0070]`, `[LOGIN L0046]` |
| Portal (PREprod) | `https://precannabisreporting.lcb.wa.gov` | — | `[API L0074]` |
| API upload endpoints (integrators only) | `https://cannabisreporting.lcb.wa.gov/api/v1/upload`, `https://precannabisreporting.lcb.wa.gov/api/v1/upload` | — | `[API]` (Part 02 §3) |
| SAW | `https://secureaccess.wa.gov/` | — | `[LOGIN L0023]` `[LOGIN L0050]` |
| LCB IT helpdesk | `servicedesk@lcb.wa.gov`, 360-664-1776 | — | `[LOGIN L0009]` |
| Licensing changes | `LicensingChanges@lcb.wa.gov` | — | `[LOGIN L0057]` |

## D. Repo-side artefacts referenced by pins

| Artefact | Path | Note |
|---|---|---|
| Code anchors | `repo/` at commit `c1ca753` | Part 03 header stamps the commit; regenerate on change |
| Template mirror | `repo/docs/ccrs-templates/*.csv` | identical to §B |
| Golden CCRS outputs | `repo/tests/compliance/golden/ccrs/*.golden.csv` | regenerated only by `scripts/compliance/generate-golden-ccrs.ts` |
| Fixture | `repo/tests/compliance/fixtures/ccrs-fixture.ts` | license `413541`, submitted 2025-06-15 20:00Z |
| Generators | `/workspace/build_spec_part.py`, `/workspace/build_atlas_part.py` | outside repo; copy into `repo/scripts/ccrs-bible/` in the docs PR if the owner wants them versioned (ask) |
| Agent scratch | `/workspace/ccrs-notes.md` §A–§I, `/workspace/todo.md` | not authoritative |

## E. Re-verification commands

```bash
cd /workspace && md5sum lcb/guide-2026-02.pdf lcb/api-2026-08.pdf lcb/login.pdf lcb/admin-guide.pdf lcb/saw-guide.pdf \
  lcb/guide.txt lcb/faq.txt lcb/api.txt lcb/login.txt lcb/admin-guide.txt lcb/saw-guide.txt lcb/manifests.txt \
  lcb/templates/*.csv repo/docs/ccrs-templates/*.csv
# Re-fetch a template and compare:
curl -sL 'https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/Inventory.csv' | md5sum
# Re-extract guide text exactly as Part 02 expects (layout mode, footer last line of page):
pdftotext -layout lcb/guide-2026-02.pdf lcb/guide.txt
```

If any md5 differs from this table: stop, record the new value here with the date, diff the text, and open a Part 12 row for every pin whose line moved before touching Parts 04–12.

---

## F. Observed-behaviour sources (2026-09-17 PREproduction run)

These are **primary sources produced by CCRS itself**, not LCB publications. In four places
they are more authoritative than the guide, because they are the system describing its own
behaviour. They cannot be pinned `[G L####]`; cite them as **`[OBS 2026-09-17 T-xx]`**.

Location: `docs/ccrs-bible/evidence/2026-09-17-preprod-run/`

| Artifact | What it is | Provenance |
|---|---|---|
| `errors/` (14 CSVs) | Files CCRS returned, each the submitted file plus an `ErrorMessage` column | Emailed to the uploading account, 2026-09-17 12:54–13:40 Pacific |
| `success-emails-2026-09-17.txt` | 10 × `PRE: CCRS Processing Successful` from `info@lcb.wa.gov` | md5 `7552f806c5777df1d26e5dbc9d3ed8a0` |
| `examiner-reply-2026-09-17.txt` | Cannabis Examiner Unit reply (Brian McQuay, Data Consultant Supervisor) answering U-08, U-13, U-15, de-provisioning | md5 `2424fccaeee1dd999dbd3457c8c9cb5a` |
| `probes/` (23 folders) | The files exactly as uploaded, each keeping its CCRS-legal name | Generated by `scripts/compliance/generate-preprod-test-files.ts` |
| `*.py` (4 scripts) | Re-derive every figure in Part 15 | Run from that folder |

Uploaded to `https://precannabisreporting.lcb.wa.gov` under license 413541.
**PREPRODUCTION only** — *"These environments are autonomous and do not share administration
or reporting data."* `[FAQ L0096]`

**PENDING:** the examiner is preparing Greenway's Cultivera-filed CCRS records (possibly via
Box). When it arrives, add it here with its fetch date and checksum **before** using it —
it becomes the authority for Part 07 R-4/R-5 and the seed load for the S-05b ledger.

---

## G. 2026-10-19 sources (owner request + LCB re-fetch) — Part 17

Location: `docs/ccrs-bible/evidence/2026-10-19-owner-request/`. These files are versioned **in the repo** so that `check_pins.py` (its `REPO_SRC` table) verifies their pins without `/workspace/lcb`.

| Pin | Source | URL / provenance | Fetched | md5 (text as committed) | Lines |
|---|---|---|---|---|---|
| `[EXAM L####]` | Owner's 2026-10-19 message, verbatim (hub text, 10/07 PREprod success emails, full examiner thread 9/17–10/5) | Pasted by the owner; CR stripped | 2026-10-19 | `6da5d9498997fc140402d58a924c78f7` | 852 |
| `[FAQ19 L####]` | LCB CCRS FAQ (new revision) | `https://lcb.wa.gov/ccrs/faq` | 2026-10-19 | `9e0c507b1a2f309d5f23eccc5d85bc68` (html, not committed: `3d9acb411fdc7dc7cbdf998f9cd8ecf5`) | 781 |
| `[SIGNIN L####]` | CCRS User Sign-In Guide, CIB154 8/26 | `https://lcb.wa.gov/sites/default/files/2026-08/CCRS_User_SignIn_Guide.pdf` (PDF md5 `0a0ad5a5ba868ff227708fcc4079603d`, not committed) | 2026-10-19 | `85309bc9fa53207182c899898101a014` | 74 |
| (no pin; read by tests) | Hyperlink targets of the Sign-In Guide PDF: pdftotext drops them, so `signin-links.txt` records each link annotation (page, Rect) and the "here" word it covers | Same PDF, md5 `0a0ad5a5ba868ff227708fcc4079603d`, read with pypdf + `pdftotext -bbox-layout` | 2026-10-19 | `6ed13607088418c384a375239d19c0cd` | 13 |
| `[BUL1006 L####]` | LCB bulletin "Oct. 12: CCRS Transition to WA.gov Login" (sent 10/06/2026 11:08 AM PDT) | `https://content.govdelivery.com/accounts/WALCB/bulletins/42e03cc` (raw html committed, md5 `b2d8e3f0ee5d596045f16fa03286df07`) | 2026-10-19 | `67bee0924c49dec1d23d67d3540be2c4` | 21 |

**Re-verified unchanged 2026-10-19 (md5):**
- Upload User Guide PDF `cbfc4dd29b49c42639f1207f8078a6b4` (= §A).
- All seven templates (= §B, byte-identical to `docs/ccrs-templates/`).

So no `[G]` pin moved. Note on the FAQ: the old `[FAQ]` text (183 lines, 2026-09-15) remains the reference for existing `[FAQ L####]` pins. New citations from the current page use `[FAQ19]`.

**Owner-uploaded run files:** `evidence/P20261007A/files/` holds the 7 CSVs accepted by PREprod on 2026-10-07, plus MANIFEST. Their md5s are in that folder's README.

**Not yet received:** the post-cutover Service Desk copy (Part 17 §G, G-1). When it arrives, add it here with md5 **before** use.

---

## H. 2026-10-20 sources for S-18a (Gmail API, Google sign-in, LCB DNS)

No `[PIN]` tags: these are platform facts that the code depends on, and they are re-checked by reading the page. Each was fetched 2026-10-20.

| Fact used | Source | Where used |
|---|---|---|
| `q` "Supports the same query format as the Gmail search box"; `includeSpamTrash` "Include messages from SPAM and TRASH"; `maxResults` default 100, max 500; list returns only `id` and `threadId` | https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list | `buildCcrsQuery`, `listMessageIds` |
| `internalDate` "the time the message was originally accepted by Google, which is more reliable than the Date header" | https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages | `normalizeGmailMessage` |
| Quota: messages.list 5; messages.get 20 "(60 when format is full, raw, or html)"; messages.attachments.get 20; 6,000 units per minute per user per project | https://developers.google.com/workspace/gmail/api/reference/quota | `MAX_NEW_PER_TICK`, `MAX_CSV_PER_MESSAGE` (worst tick 4,025 units) |
| Service-account JWT: `"alg": "RS256"`; claims `iss`, `scope`, `aud` = `https://oauth2.googleapis.com/token`, `exp` "a maximum of 1 hour after the issued time", `iat`; `sub` = the user for delegated access; grant `urn:ietf:params:oauth:grant-type:jwt-bearer`; delegation by a super administrator under Security > Access and data control > API Controls > Domain wide delegation, with the numeric Client ID; "might take up to 24 hours to propagate" | https://developers.google.com/identity/protocols/oauth2/service-account | `serviceAccountJwtParts`, `getGmailAccessToken`, owner setup steps |
| A refresh token stops working when access is revoked, when it "has not been used for six months", or when "The user changed passwords and the refresh token contains Gmail scopes"; an External app in "Testing" gets a 7-day refresh token | https://developers.google.com/identity/protocols/oauth2 | OAuth mode warning, `.env.example` |
| `_dmarc.lcb.wa.gov` = `v=DMARC1; p=none; aspf=s; ...` (receivers are asked not to reject forged mail; SPF alignment is strict) | DNS TXT via https://dns.google/resolve, 2026-10-20 | `authVerdict` shown, never blocking (U-67). Google's own `dmarc=` result wins when present. The DKIM/SPF fallback is a relaxed (subdomain) reading, shown only |

