# 08 — Target Design: the Single CCRS Hub (Command Center)

Owner decision D-05 (Part 05), verbatim: "one central command center/ HUB that allows me to do all work flows from that one centralized hub. if it is ccrs weekly upload related, it should live in the hub."

This part is the design the slices in Part 09 build toward. Every element below names (a) the LCB rule it serves, pinned to Part 02, (b) the code that exists today, pinned to Part 03 at commit `c1ca753`, and (c) the slice that ships it. Nothing here is built yet unless its row says DONE.

Route: `/admin/compliance/ccrs` (`src/app/admin/compliance/ccrs/page.tsx`, 674 L today; nav entry `admin-nav-data.ts` L105 label "CCRS Command Center", permission `reports.view`, group "CCRS"). The hub stays at this route. Nothing CCRS-weekly is added anywhere else.

## A. What exists today on the two pages (verified anchors)

### A.1 Hub `/admin/compliance/ccrs` (`page.tsx`)

| Anchor | What | Keep / change |
|---|---|---|
| L86 `requirePermission("reports.view")` | page gate | keep; write actions stay `settings.manage` (`actions.ts` L28) |
| L92 `getWeeklyOverview({ lookbackWeeks: 6 })` | week strip | keep |
| L93 `listWeekSubmissions(12)` | ledger rows | keep; ledger becomes derived from events (§E) |
| L109 `getCcrsLicenseSettings()` | license identity read | keep; editor moves here (§B Step 0) |
| L112 `buildCcrsBatch(range.fromISO, range.toISO)` | full batch for the selected week | keep; batch grows `env` (§F) |
| L143 `getEndorsementConfig()`, L162 exempt rows | DOH block | keep (Part 10) |
| L196 `getCcrsFilingOverview(todayIso, { lookbackMonths: 2 })` | LIQ-1295 block | keep |
| L221 link → `/admin/compliance/health`, L224 → `/admin/compliance/regulatory` | sibling pages, not weekly-upload | keep as links |
| L227 link → `/admin/reports/compliance` | **link-out to the second page** | remove once §B is complete (S-08) |
| L282 "Step 1 — Pick the reporting week" | week picker Sun–Sat Pacific | keep; rule `[FAQ L0041]` |
| L313 "Step 2 — Review week …" StatCards "Blocking errors"/"Warnings"; error list; warnings `slice(0, 25)` | validation summary | replace with §C error summary + §D queue; **no `slice()` caps on errors** |
| L378 `<CcrsAdvisorPanel …>` | AI drafts-only helper | keep, move below the queue |
| L382 `<UploadWalkthrough … batchZipHref="/admin/reports/compliance/batch-export?…">` | 7-file step list, `localStorage` progress (`UploadWalkthrough.tsx` L54-L64), `PORTAL_URL` L30 prod only, `WAIT_MINUTES` L31 | keep component; persist steps server-side (§E.3); portal URL from `env` (§F) |
| L397 "Step 3 — Record this week" → `resolveWeekAction` (`actions.ts` L27) | ledger write | keep; add "paste LCB email" (§E.2) |
| L532 "DOH / Medical sales" | four legs | keep (Part 10) |
| L587 "Monthly LIQ-1295 (tax report)" | monthly | keep |
| L626 "Submission ledger" | table of `ccrs_week_submissions` | keep; add events drill-down (§E.4) |

### A.2 Reports tab `/admin/reports/compliance` (`src/app/admin/reports/compliance/page.tsx`, 477 L)

| Anchor | What | Fate |
|---|---|---|
| L14 import `LicenseSettingsForm` from `@/components/admin/reports/LicenseSettingsForm`; L449 Section "License identity"; L452 `<LicenseSettingsForm …>`; action `reports/compliance/actions.ts` L14 `saveLicenseSettingsAction` | the only place to set `license_settings.license_number` / `submitted_by` (0031 L29-L40) | **move** to hub Step 0 (S-08). E1 today blocks at `ccrs-batch.ts` L444 with a message pointing here |
| L220 link → `/admin/compliance/ccrs` | cross-link | becomes the only content of this page (§G) |
| L252 Section "Full CCRS batch" (comment "Slice 54"); L259 "Out of sync — fix before uploading" list; L279 warnings `slice(0, 30)`; L291 per-file table Group/File/Records/Skipped; L334 `Link` → `batch-export?…` ".zip"; L354 "Download blocked — N error(s) to fix" | duplicate of hub Step 2 with a different layout | **delete**; hub §C/§D is the single copy |
| L371 text "cannabisreporting.lcb.wa.gov. These are drafts…" | prod URL hard-coded | replaced by §F |
| L384 Section "Generate CCRS Sale.csv" → `export/route.ts` | single-file Sale download | **move** into hub §D "per-file download" (same route, new link location) |
| L407 Section "Generate CCRS InventoryAdjustment.csv" → `adjustment-export/route.ts` (L18/L28) | single-file download | same |
| L462 Section "Recent CCRS exports" (reads `ccrs_export_runs` or similar via `admin` L97) | export history | **fold** into ledger events (§E) |
| `excise-export/route.ts` | excise/LIQ-1295 helper CSV | move link to hub LIQ-1295 block (L587) |

Routes under `src/app/admin/reports/compliance/*/route.ts` are **not** moved in S-08 (URLs are bookmarked in the walkthrough and tests). They stay; only their links move. A later slice may add `/admin/compliance/ccrs/export/*` aliases; not required.

## B. Hub layout — top to bottom (target)

Each section has: an id used by Part 09 acceptance criteria, the rule it serves, what it renders, and its data source.

### Step 0 — Licence & identity (`#identity`) — S-08

- Rule: header row 1 `SubmittedBy` and every row's `LicenseNumber`/`CreatedBy` `[G L0209-L0253]`; file name carries the licence `[G L0046]`; six-digit licence numbers `[FAQ L0079]`.
- Renders: current `license_number`, `submitted_by`; inline `LicenseSettingsForm` (moved component, same server action, action file relocated to `compliance/ccrs/actions.ts` or imported from its current path — either is acceptable, import path is the smaller diff).
- Empty state: red banner "CCRS files cannot be generated until the licence number is set" — the same condition `ccrs-batch.ts` L444 raises as E1; the banner replaces the dead-end message with the form itself.
- Also shows the **environment switch** (§F) and the **integrator status** line from Part 07 §F ("Integrator on file: Cultivera — until cutover Sunday YYYY-MM-DD"), stored in `license_settings` (new nullable columns `integrator_name text`, `integrator_removed_on date`; S-05 or S-08 migration, whichever lands first — Part 09 assigns S-08).

### Step 1 — Reporting week (`#week`) — exists (L282)

- Rule: "Week is defined as Sunday - Saturday." `[FAQ L0041]`; due the following Sunday (repo convention `ccrs-week-core.ts` L137 `weekDeadline`); Pacific calendar (AGENTS.md).
- Renders: 6-week strip with status chips (from `getWeeklyOverview`), selected week, "Due Sunday …".
- No change except the chip reads from the derived ledger (§E.4) so a week with `errors_reported` shows amber, not green.

### Step 2 — Pre-flight (`#preflight`) — S-02, S-03, S-04, S-05 supply the checks; S-08 the layout

Two parts: **C. Error summary** and **D. Validation queue**. See those sections.

### Step 3 — Files (`#files`) — S-08 layout, S-06 events

Table, one row per retailer file type in upload order `[G L0143-L0144]`, groups per the 10-minute rule `[G L0530]` (the FAQ has no such text — do not cite FAQ for the wait):

| Col | Source |
|---|---|
| Group (1/2/3) | `ccrs-batch-core.ts` L560/L570 group constants |
| File | `CcrsFile.type` |
| File name | `ccrsFileName` L615 (after S-01: Pacific stamp `[FAQ L0075]`) |
| Records | `NumberRecords` `[G L0204-L0205]` |
| Operation mix | count Insert / Update / Delete (new; needed for N-03 and returns `[FAQ L0039]`) |
| Download | per-file link (existing routes) + "Download group N (.zip)" + "Download all (.zip)" (`batch-export/route.ts` L26) |
| Uploaded at | from `ccrs_upload_events` (§E.1) — blank until the walkthrough step is ticked |
| LCB verdict | from pasted email (§E.2): "no email (silence)", "errors N", "resolved" |

Rows with 0 records are rendered but greyed; the file is still produced when the guide requires it weekly (Inventory "only when unreported/updates" — Part 04 N-03 decides whether an unchanged week yields 0 rows).

### Step 4 — Upload walkthrough (`#upload`) — exists (L382), persistence S-06, env S-07

`UploadWalkthrough.tsx` steps L144-L256 already encode the three groups and the two waits. Changes:

1. `PORTAL_URL` L30 → from `env` prop: `https://cannabisreporting.lcb.wa.gov` (prod) or `https://precannabisreporting.lcb.wa.gov` (PREprod) `[API L0070]`, `[API L0074]`, `[FAQ L0088]`.
2. Step ticks write `ccrs_upload_events` rows (`kind='uploaded'`) via a server action instead of `localStorage` L54-L64 (E17). Read state back on load, so phone and desktop agree.
3. The "wait ≥10 minutes" timers become server-anchored: the tick time of the last file in group N is stored; UI shows "Group 2 may start at HH:MM Pacific" computed from the event, not from the browser clock.
4. Login wording: today "SAW login" (`batch-export/route.ts` L125, `compliance-reminders.ts` L100, `UploadWalkthrough.tsx` L178). Replace with a single `loginLabel` from Part 11 §C (`"SAW"` until the WA.gov date, then `"WA.gov"`), driven by `license_settings.portal_login_mode` (S-09).

### Step 5 — Record & verdict (`#record`) — exists (L397), extended S-06

- Existing: `resolveWeekAction` writes `ccrs_week_submissions` (0118 L31-L62) with `files_json` snapshot (`actions.ts` L40-L48).
- Add: **"Paste LCB email"** textarea + "Which file?" select + "Received at" (default now, Pacific). Submits to `recordLcbEmailAction` (new, `actions.ts`) → inserts `ccrs_upload_events` `kind='lcb_email'` with `raw_text`, runs `triageCcrsErrorEmail` (`ccrs-error-triage-core.ts` RULES L54-L159) and stores `triage_json`. Owner said YES (D-04).
- Add: **"Mark resolved"** per event → `resolved_at`, `resolution_note`, and the week's derived `error_status` flips to `resolved` when no open events remain.
- The old free-text `error_status` select (`setWeekErrorStatusAction` L104) stays as a manual override but is labelled "manual override — prefer pasting the email".
- Rule basis: errors arrive **only** by email `[G L0051]`; only the uploader's address receives it `[FAQ L0102]`; success has no notification (U-11, Part 12) — so "no email after N hours" is the only positive signal and the hub must say so in words, not imply success.

### Step 6 — Ledger (`#ledger`) — exists (L626), extended S-06

See §E.4.

### Below the weekly flow (kept, not weekly-upload but CCRS-adjacent)

- DOH / Medical (L532) — Part 10.
- LIQ-1295 (L587) — monthly; link to `excise-export/route.ts` moves here from the Reports tab.
- Advisor panel (L378) — drafts only; stays below the queue so it never appears above real errors.

## B1. Design corrections forced by the 2026-09-17 run (Part 15)

Four things in this design were written against the documentation. The run showed the
documentation was incomplete. Apply these before building §C–§E.

1. **"Clean" is an observed positive, not a timeout.** A success email arrives in 30–90 s
   (`PRE: CCRS Processing Successful`). States are `submitted → confirmed | rejected`, with
   a timeout only as the genuinely *unknown* branch. Store the confirmation and its receipt
   token. This removes the old "wait and hope" UX entirely.
2. **Never point at a row using CCRS's `ErrorMessage`.** It is stamped per **file**, on
   every returned row, including innocent ones (T-17's `AREA-2` had never been submitted
   and still read "Duplicate External Identifier"). Render it as the **file's** verdict;
   use our own pre-flight to identify the row. A UI that says "row 7 is wrong" on this
   basis would be confidently and traceably wrong.
3. **Rejected means nothing was filed** (U-17, 14/14 files returned every row). The hub can
   therefore say plainly: *"No rows were filed. Fix and re-send the whole file."* No
   double-post warning is needed — and the opposite warning would be wrong.
4. **Surface the filed-identifier ledger** (S-05b). Insert-vs-Update correctness now depends
   on it, so the operator needs to see which ids are filed, which are new, and which the
   examiner's export seeded.

## C. Error summary (GOV.UK pattern, adapted)

Pattern: one box at the top of Step 2 listing every blocking error as a link that jumps to the row in the queue (§D) or to the fixing screen. This is the well-known "error summary" component pattern; we use the pattern, not the library.

Rendering rules (binding for S-08):

1. Heading: "N blocking error(s) — the zip is disabled until these are fixed" when N>0; "Pre-flight passed — no blocking errors" when N=0 and the gate (`assertCcrsBatchSubmittable`, `ccrs-submit-gate-core.ts` L77-L137) agrees. The gate is the single source of truth; the UI never computes "ok" separately (today `page.tsx` L313-L344 and `batch-export/route.ts` L61 both call the gate — keep it that way).
2. Every error line: `[File] [code] message (count)` with a link `#issue-<code>-<file>` into §D. No truncation. `slice(0, 25)` / `slice(0, 30)` are forbidden for errors (Part 04 W12).
3. Warnings: collapsed by default under "N warning(s) — non-blocking"; expand shows all, grouped by code; each has a link into §D.
4. Colour is never the only signal: prefix "⛔" for error, "⚠" for warning (accessibility; also matches existing hub copy at `reports/compliance/page.tsx` L354).
5. The summary receives focus on load when N>0 (a11y pattern).

Data shape (S-03 introduces; S-08 renders). Extend `CcrsSyncIssue` (`ccrs-batch.ts` L57-L62) **backward-compatibly**:

```ts
export type CcrsSyncIssue = {
  severity: "error" | "warning";
  file: CcrsRetailerFileType | "General";
  message: string;
  count?: number;
  // NEW (S-03):
  code?: CcrsIssueCode;            // stable id, e.g. "E7_TOTALCOST_ZERO"
  specPin?: string;                // e.g. "[G L0614]" — shown in the queue tooltip
  rows?: CcrsIssueRow[];           // every affected row, never capped
};
export type CcrsIssueRow = {
  id: string;                      // lot id / order id / product id
  label: string;                   // human label (lot code, order number, product name)
  href: string;                    // fix-link target (§D.2)
  detail?: string;                 // e.g. "TotalCost 0.00", "on_hand 12 > received 10"
};
```

`code` list is defined in `ccrs-batch-core.ts` next to `classifyWarning` (L544) as a `const` union so tests can assert on codes, not on message text. Codes and their pins (this list is the contract; Part 09 slices must use these exact strings):

| Code | Severity | Spec pin | Producer (target) |
|---|---|---|---|
| `E1_LICENSE_MISSING` | error | `[G L0046]` `[G L0209-L0253]` | `buildCcrsBatch` L444 |
| `E3_LOT_NO_ID` | error | `[G L0224]` | L572-L587 |
| `E4_PRODUCT_ENUM` | error | guide p.13-15 (Part 02 §1) | `buildProductFile` L287/L301 |
| `E7_TOTALCOST_ZERO` | error | `[G L0614]` `[FAQ L0035]` `[FAQ L0057]` | `buildInventoryFile` L384 (S-02) |
| `E8_ONHAND_GT_INITIAL` | error | `[G L0597]` | `buildInventoryFile` (S-02) |
| `E9_UNITWEIGHT_ZERO_USABLE` | error | `[G L0434]` `[G L0490]` `[FAQ L0061-L0066]` | `buildProductFile` L249 (S-02) |
| `E10_DESCRIPTION_REQUIRED` | error | guide p.14 (Part 02 §1) | `buildProductFile` (S-02) |
| `E11_STRAIN_NAME_RESERVED` | error | `[G L0358]` `[FAQ L0014]` | `buildStrainFile` L160-L193 (S-02) |
| `E12_EXCISE_NOT_37PCT` | error | `[G L1377]` `[FAQ L0155-L0160]` | `ccrs-sales.ts` L388-L390 (S-02) |
| `E13_ADJUSTMENT_DETAIL_MISSING` | error | `[G L1111]` | `ccrs-inventory-adjustment-core.ts` L127 (S-02) |
| `E14_TRANSFER_FIELD_MISSING` | error | `[G L1158-L1205]` | new transfer builder (S-05) |
| `E14_TRANSFER_SAME_LICENSE` | error | `[G L1205]` | S-05 |
| `E14_TRANSFER_VENDOR_ID_UNKNOWN` | error | `[G L1191]` | S-05 (N-02) |
| `W1_SALE_NO_INVENTORY_ID` → `E_SALE_NO_INVENTORY_ID` | error | guide Table 6 p.41 (Part 02 §1) | `ccrs-sales.ts` L447 (S-03) |
| `W2_SALE_POS_KEY_FALLBACK` → error unless proven filed (Part 07 R-2) | error | same | L452 (S-03) |
| `W3_SALE_ID_SANITIZED` | warning | — (U-06) | L457 |
| `W4_SALE_QUARANTINED_LOT` → error | error | `[G L1305]` | L462 (S-03) |
| `W5_SALE_LINES_SKIPPED` | warning | — | L467 (S-03 adds rows) |
| `W6_MEDICAL_*` | deferred | `[FAQ L0117-L0121]` | Part 10 |
| `W7_STRAIN_TYPE_DEFAULTED` | warning | guide p.12 | L185 |
| `W10_NAME_CLAMPED` / `W11_DESCRIPTION_CLAMPED` | warning | Text(75)/Text(250) p.13-14 | L307/L322/L314 |
| `W12_LOT_NO_ID_SKIPPED` → error | error | `[G L0224]` | L368 (S-03) |
| `W13_LOT_NO_PRODUCT` | warning | `[G L0579]` | L379 |
| `W14_EXTERNAL_ID_RULE` | warning | `[G L0224]` | L414 |
| `W15_NO_PUBLISHED_MENU` / `W15_ORPHAN_LOTS` → error | error | — (no Product file possible → every Inventory row fails `[G L0579]`) | L471 / L599 (S-03) |
| `W16_ADJUSTMENT_SKIPPED` | warning | — | `ccrs-inventory-adjustment.ts` ~L100 |
| `N01_AREA_QUARANTINE_TRUE` | error (after U-04 confirms) / warning (until) | `[G L0298]` `[FAQ L0051]` | `buildAreaFile` L201-L213 (S-04) |
| `N09_SALEDETAIL_NOT_UNIQUE` | error | `[G L1390-L1399]` | `checkSaleIdentifierIntegrity` (`ccrs-identifiers.ts` L146) into the gate (S-03) |

`classifyWarning` L544 (message-regex based) is retired in favour of explicit `code`+`severity` set by the producer; S-03 keeps `classifyWarning` as a fallback for any producer that still emits a bare string, and adds a test that no producer in `buildCcrsBatch` emits a bare string (walk `syncIssues`, assert `code` present).

## D. Validation queue

### D.1 Layout

Under the summary. One collapsible group per `code`, header `⛔/⚠ [File] message — N rows`, tooltip shows `specPin`. Body: table `label | detail | Fix →`. All rows, virtualised only if > 500 (unlikely for a single store week; do not add a dependency for this — plain table first).

Filter chips: "Errors only" (default when errors exist), "All", per-file.

### D.2 Fix-link targets (where `href` points). Routes verified by `ls src/app/admin/**` at `c1ca753`:

| Condition | Target (verified route) |
|---|---|
| lot cost / TotalCost (E7) | `/admin/inventory/lots/[id]` (exists) |
| on-hand > received (E8) | `/admin/inventory/lots/[id]`; cycle counts at `/admin/inventory/cycle-counts` (exists) |
| unit weight / description / enum (E4, E9, E10) | `/admin/products/[key]` (exists; key = `pos_product_key`) or `/admin/menu-imports` for unmapped imports (exists) |
| strain reserved name (E11) | `/admin/knowledge-base` (exists; `StrainEditor.tsx`) |
| excise mismatch (E12) | `/admin/orders/[id]` (exists) |
| adjustment detail (E13) | `/admin/inventory/disposition` (exists) with `?id=` query (NEW query param, S-02) |
| transfer vendor id unknown (E14/N-02) | `/admin/inventory/intake/[id]` (exists — the manifest/intake detail) with a NEW field to enter the vendor's `InventoryExternalIdentifier` by hand (S-05) |
| quarantined lot sold (W4) | `/admin/inventory/lots/[id]` + `/admin/orders/[id]` (two links) |
| no published menu (W15) | `/admin/publish` (exists) |
| area quarantine (N-01) | Step 0 setting "Hold area IsQuarantine" (S-04) |
| licence missing (E1) | `#identity` (same page anchor) |

Note: the FAQ has no "10 minutes" text (grep of `lcb/faq.txt` for "min" returns nothing); the 10-minute wait is `[G L0530]` only. Part 08 §B Step 3 is corrected accordingly.

Every fix-link opens in the same tab; the hub remembers the selected week in the URL (`?week=`) so "Back" returns to the same state (already the convention: `actions.ts` L22 `back(weekKey)`).

### D.3 Behaviour after a fix

The hub re-runs `buildCcrsBatch` on every load (L112) — there is no cache — so returning from a fix-link recomputes. No "re-validate" button needed. Document this on the page in one sentence so the operator is not looking for one.

## E. Persistence: `ccrs_upload_events`

### E.1 Table (S-06 migration, next free number after `0224`)

```sql
create table if not exists public.ccrs_upload_events (
  id            uuid primary key default gen_random_uuid(),
  week_key      text not null,                        -- 'W-YYYY-MM-DD' Sunday, same as ccrs_week_submissions.week_key (0118 L35)
  env           text not null check (env in ('prod','preprod')),
  kind          text not null check (kind in ('generated','uploaded','lcb_email','resolved','note')),
  file_type     text,                                 -- Strain|Area|Product|Inventory|InventoryAdjustment|InventoryTransfer|Sale|null
  file_name     text,                                 -- exact name as downloaded (ccrsFileName)
  record_count  integer,
  operation_mix jsonb,                                -- {"Insert":n,"Update":n,"Delete":n}
  occurred_at   timestamptz not null default now(),   -- when the human ticked / pasted; Pacific rendering in UI
  actor_email   text,
  raw_text      text,                                 -- kind='lcb_email': the pasted email verbatim
  triage_json   jsonb,                                -- kind='lcb_email': output of triageCcrsErrorEmail
  resolved_at   timestamptz,
  resolution_note text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ccrs_upload_events_week on public.ccrs_upload_events(week_key, env, occurred_at desc);
-- RLS: mirror 0118 L111-L120 (staff read, admin write).
```

Why a separate table and not more columns on `ccrs_week_submissions`: a week has 7 files × N attempts × M emails; 0118 is one row per week by design (comment L29). Events are many-per-week. The week row stays the "resolution" record; `error_status` becomes **derived**:

- any `lcb_email` with `resolved_at is null` → `errors_reported`
- all `lcb_email` resolved → `resolved`
- no `lcb_email` → `clean` (which means "silence", and the UI says "no error email received" not "accepted")

The derivation is a PURE function in a new `ccrs-upload-events-core.ts` with `__runCcrsUploadEventsTests()`, registered in `tests/compliance/pure-selftests.test.ts`.

### E.2 Email paste → triage

`triageCcrsErrorEmail` (`ccrs-error-triage-core.ts`, RULES L54-L159, `buildExaminerDraft` L245) already parses error strings into `{ruleId, severity: benign|fixable|..., advice}`. S-06:

1. Extends RULES to every error string in Part 02 §1 (E16). One rule per guide error line, `pin` field mandatory (`"[G L1191]"`), test asserts each rule's `pin` resolves to a line in `lcb/guide.txt` containing the rule's sample text (test reads the file from `docs/ccrs-bible/02-authoritative-spec.md` so it runs in CI without `/workspace/lcb`).
2. The paste handler stores `raw_text` untouched and `triage_json` = the rule hits, plus the file type guessed from the email's file name if present (emails reference the uploaded file name — U-11/observed in PREprod T-series will confirm the exact format; until then the operator selects the file type manually and the guess is advisory).
3. Each triage hit renders in the hub with the same fix-link map as §D.2, so an LCB error and a pre-flight error lead to the same screen.

### E.3 Walkthrough persistence (E17)

`UploadWalkthrough.tsx` L54-L64 reads/writes `localStorage`. S-06 replaces with: props `events: UploadEvent[]` from the server; a server action `markFileUploadedAction(weekKey, env, fileType, fileName)` inserts `kind='uploaded'`; an "undo" inserts `kind='note'` with text "undo <fileType>" and the derived state ignores the last `uploaded` for that file (append-only; never delete events — evidence trail).

### E.4 Ledger rendering

The ledger table (L626) gains an expander per week: events in time order, Pacific, `kind` icon, file, record count, actor, and for `lcb_email` the raw text in a `<details>` with the triage hits. This is the "compliance evidence (who, when, on time or late)" the existing subtitle at L398 promises, now with the LCB verdict attached.

Retention: never purge (medical ledger rule of 5 years in AGENTS.md sets the floor; CCRS has no stated minimum in the sources — Part 12 U-13 to ask the examiner).

## F. Environment switch (PREPROD / PROD)

Rule basis: PREprod exists for all licensees `[FAQ L0088]`; the two environments "do not share administration or reporting data" `[FAQ L0096]`; URLs `[API L0070]`, `[API L0074]`. Owner: "we should know sooner than later" (D-06) — testing is in PREprod, never prod (Part 01 §E).

Design (S-07):

1. Column `license_settings.ccrs_env text not null default 'prod' check (ccrs_env in ('prod','preprod'))`.
2. Step 0 shows a two-state control. Switching to PREPROD requires typing the word `PREPROD` (no accidental toggles); switching back to PROD requires the same.
3. When `preprod`: a persistent amber banner at the top of the hub "PREPRODUCTION — files generated now are for https://precannabisreporting.lcb.wa.gov only"; the walkthrough's `PORTAL_URL` becomes the PREprod URL; every `ccrs_upload_events` row carries `env='preprod'`; the weekly ledger (`ccrs_week_submissions`) **cannot** be resolved while in preprod (action refuses; message "switch to PROD to record a real week") — a PREprod test week is never compliance evidence.
4. File content is identical in both envs (same licence number, same builders). Nothing in the files says which env they are for — so the file name is not enough to tell them apart afterwards; the event row is. The zip's `README.txt` (`batch-export/route.ts` L125 writes the upload instructions) includes the env and the URL.
5. Part 06 test rows are executed with this switch on PREPROD; the recording rule there (Part 06 §A) assumes the ledger events exist — S-07 must land before T-10.

## G. What the Reports tab becomes

`/admin/reports/compliance/page.tsx` → a single card: "CCRS weekly upload has moved to the CCRS Command Center" with a link (the existing L220 link) and, for one release, a list of the sections that moved and where. Nav entry for the Reports tab (if any in `admin-nav-data.ts` — grep found none for `reports/compliance`; it is reached from the Reports index) is left alone. The `route.ts` handlers stay.

`docs/CCRS_WEEKLY_UPLOAD_BIBLE.md` (v1) is deleted in the same PR (Part 00 "Relationship to older docs").

## H. States the hub must render (acceptance checklist for S-08)

| State | Expected render |
|---|---|
| Supabase not configured | one grey note (today L344 "Connect Supabase…"); no crash |
| licence missing | Step 0 red banner + form; Step 2 shows `E1_LICENSE_MISSING` only; zip disabled |
| week in progress (today < Saturday) | Step 2 preview allowed; Step 3 record disabled with reason (today L314 subtitle) |
| errors > 0 | summary focused; zip disabled; queue defaults to "Errors only" |
| errors = 0, warnings > 0 | green heading; warnings collapsed; zip enabled |
| nothing to report (0 rows all files) | Step 3 offers `nothing_to_report` (`[FAQ L0049]` "no 'no change' report" — the ledger records it locally; nothing is uploaded) |
| preprod | amber banner; record disabled; portal URL PREprod |
| week has unresolved `lcb_email` | week chip amber; ledger row `errors_reported`; Step 5 lists open events with fix-links |
| all events resolved | chip green with "resolved" tag, never "clean" (history preserved) |

## I. Things this design deliberately does not do

- No automatic upload. Licensees upload via the portal; the API is for approved integrators `[API]` (Part 02 §3) — Greenway is not one, and the FAQ says there is no licensee API `[FAQ L0179]`.
- No inference of "accepted". Silence is the only positive signal `[G L0051]` `[FAQ L0102]`; the UI words it that way.
- No deletion of events. Append-only.
- No medical UI changes (Part 10) beyond keeping what exists.
- No new dependency for the error-summary pattern; plain React + existing `Section` component (`page.tsx` L61 pattern).
