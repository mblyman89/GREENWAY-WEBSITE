#!/usr/bin/env python3
"""Generate docs/ccrs-bible/03-code-anchor-atlas.md from the working tree.
Line numbers are read from the files at generation time; the git commit is recorded so
a future agent can `git diff <commit> -- <file>` to see whether an anchor moved.
Run from /workspace.
"""
import os, re, subprocess, datetime

REPO = os.environ.get("CCRS_REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
OUT = f"{REPO}/docs/ccrs-bible/03-code-anchor-atlas.md"
COMMIT = subprocess.check_output(["git", "-C", REPO, "rev-parse", "HEAD"]).decode().strip()

def lines(rel):
    with open(f"{REPO}/{rel}", encoding="utf-8") as f:
        return f.read().split("\n")

def exports(rel):
    out = []
    for i, l in enumerate(lines(rel), 1):
        if re.match(r"^export\s+(async\s+)?(function|const|type|interface|class|default|\{)", l):
            out.append((i, l.strip()[:150]))
    return out

def snippet(rel, a, b, note=""):
    if not os.path.exists(f"{REPO}/{rel}"):
        return [f"`{rel}` — MISSING at this commit (re-locate before citing)", ""]
    ls = lines(rel)
    out = [f"`{rel}` L{a}-L{b}" + (f" — {note}" if note else ""), "", "```ts"]
    for i in range(a, min(b, len(ls)) + 1):
        out.append(f"{i:4d}| {ls[i-1].rstrip()[:170]}")
    out += ["```", ""]
    return out

def grep(rel, pattern, maxn=40):
    out = []
    if not os.path.exists(f"{REPO}/{rel}"):
        return [f"- `{rel}` MISSING at this commit"]
    for i, l in enumerate(lines(rel), 1):
        if re.search(pattern, l):
            out.append(f"- L{i}: `{l.strip()[:150]}`")
            if len(out) >= maxn: break
    return out

D = []
A = D.append
A("# 03 — Code Anchor Atlas (generated from the tree)")
A("")
A(f"Generated {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%MZ')} at commit `{COMMIT}` by `build_atlas_part.py`.")
A("")
A("**Rules for using this part**")
A("")
A("1. Every `L####` here was read from the file at the commit above. Before editing, run `git diff " + COMMIT[:7] + " -- <file>`; if the file changed, re-run the generator and re-pin.")
A("2. Snippets are verbatim. If a snippet here disagrees with the file, the FILE wins and this part must be regenerated — never 'fix' the atlas by hand.")
A("3. Anchors are grouped by the flow they belong to: (A) batch builders, (B) core/pure helpers, (C) identifiers, (D) week/ledger, (E) triage/gate, (F) adjustments & corrections, (G) returns/disposition, (H) intake & Cultivera identity, (I) routes/pages/components, (J) schema.")
A("")

MODS = [
 "src/lib/compliance/ccrs-batch.ts",
 "src/lib/compliance/ccrs-batch-core.ts",
 "src/lib/compliance/ccrs-sales.ts",
 "src/lib/compliance/ccrs-identifiers.ts",
 "src/lib/compliance/ccrs-week-core.ts",
 "src/lib/compliance/ccrs-week-store.ts",
 "src/lib/compliance/ccrs-error-triage-core.ts",
 "src/lib/compliance/ccrs-submit-gate-core.ts",
 "src/lib/compliance/ccrs-inventory-adjustment-core.ts",
 "src/lib/compliance/ccrs-inventory-adjustment.ts",
 "src/lib/compliance/ccrs-sale-correction-core.ts",
 "src/lib/compliance/ccrs-filing-status.ts",
 "src/lib/compliance/ccrs-product-name-core.ts",
 "src/lib/compliance/ccrs-deadline-core.ts",
 "src/lib/inventory/disposition.ts",
 "src/lib/inventory/disposition-core.ts",
 "src/lib/inventory/intake-store.ts",
 "src/lib/inventory/intake-parser.ts",
 "src/lib/inventory/ccrs-manifest-csv-core.ts",
 "src/lib/inventory/sale-decrement.ts",
 "src/lib/pos/import-lot-core.ts",
 "src/lib/pos/import-service.ts",
 "src/lib/pos/returns-core.ts",
 "src/lib/pos/returns-store.ts",
 "src/lib/pos/variant-lot-core.ts",
 "src/app/admin/compliance/ccrs/page.tsx",
 "src/app/admin/compliance/ccrs/actions.ts",
 "src/app/admin/reports/compliance/page.tsx",
 "src/app/admin/reports/compliance/batch-export/route.ts",
 "src/app/admin/reports/compliance/adjustment-export/route.ts",
 "src/app/admin/reports/compliance/advisor-action.ts",
 "src/app/admin/inventory/disposition/sale-correction-export/route.ts",
 "src/components/admin/compliance/UploadWalkthrough.tsx",
 "src/components/admin/compliance/ErrorTriagePanel.tsx",
 "src/components/admin/compliance/PushRemindersPanel.tsx",
 "src/components/admin/reports/CcrsAdvisorPanel.tsx",
 "src/components/admin/reports/LicenseSettingsForm.tsx",
 "src/components/admin/reports/ReportTabs.tsx",
 "src/components/admin/admin-nav-data.ts",
]

A("## 0. Module inventory (line counts + every `export` with its line)")
A("")
for m in MODS:
    p = f"{REPO}/{m}"
    if not os.path.exists(p):
        A(f"### `{m}` — **MISSING at this commit** (re-locate with `grep -rn` before citing)")
        A("")
        continue
    n = len(lines(m))
    A(f"### `{m}` ({n} L)")
    A("")
    ex = exports(m)
    if ex:
        for i, l in ex:
            A(f"- L{i}: `{l}`")
    else:
        A("- (no top-level exports matched; see snippets below)")
    A("")

A("## A. Batch builders — `src/lib/compliance/ccrs-batch.ts`")
A("")
D += snippet("src/lib/compliance/ccrs-batch.ts", 160, 193, "buildStrainFile — NOTE: no guard for Unknown/THC/Other (guide p.12 L358: 'Strain name is invalid, cannot be Unknown, THC, or Other'). Defaults StrainType to Hybrid.")
D += snippet("src/lib/compliance/ccrs-batch.ts", 201, 213, "buildAreaFile — emits Area 'Quarantine' IsQuarantine=TRUE whenever hasQuarantine. FAQ (Data Reporting, IsQuarantine Q): 'There are no quarantine requirements for cannabis products. You will have an entry as FALSE.' → compliance question, Part 04 flag N-01.")
D += snippet("src/lib/compliance/ccrs-batch.ts", 215, 260, "buildProductFile (part 1) — weightByKey from lots; grams may be '' when no lot weight.")
D += snippet("src/lib/compliance/ccrs-batch.ts", 280, 349, "buildProductFile (part 2) — classification via deriveCcrsClassificationFromType; E4 error message; clamps; warnings.slice(0,30).")
D += snippet("src/lib/compliance/ccrs-batch.ts", 351, 417, "buildInventoryFile — ext id derive; Area choice; TotalCost = unit_cost_minor_units*received_qty (0 when cost missing → guide p.17 L614 'TotalCost cannot equal 0'); IsMedical hard 'FALSE'; Operation Insert.")
D += snippet("src/lib/compliance/ccrs-batch.ts", 424, 500, "buildCcrsBatch (part 1) — license/Supabase guards E1/E2; published menu; lots pagedAll excluding status=destroyed.")
D += snippet("src/lib/compliance/ccrs-batch.ts", 540, 652, "buildCcrsBatch (part 2) — InventoryTransfer emitted EMPTY with an explanatory note (guide p.33 L1162 says it 'is required weekly by any licensed facility that receives inventory'); sort; E3; orphan products; verifySaleNumericColumns; WARNING_CAP_PER_FILE.")

A("## B. Core/pure helpers — `src/lib/compliance/ccrs-batch-core.ts`")
A("")
D += snippet("src/lib/compliance/ccrs-batch-core.ts", 37, 140, "CCRS_COLUMNS — must equal row 4 of each official template (Part 02 §8).")
D += snippet("src/lib/compliance/ccrs-batch-core.ts", 139, 180, "CCRS_SALE_TYPES / saleTypeForOrder / CCRS_STRAIN_TYPES / normalizeStrainType")
D += snippet("src/lib/compliance/ccrs-batch-core.ts", 560, 660, "CCRS_UPLOAD_GROUPS, uploadGroupOf, ccrsCell, ccrsDate, ccrsFileStamp (UTC — FAQ says filename 'referenced in PST'), ccrsFileName, assembleCcrsFile (header rows NOT comma-padded; templates ARE).")
D += snippet("src/lib/compliance/ccrs-batch-core.ts", 776, 830, "verifyCcrsFile header checks")

A("## C. Identifiers — `src/lib/compliance/ccrs-identifiers.ts`")
A("")
D += snippet("src/lib/compliance/ccrs-identifiers.ts", 30, 60, "sanitizeExternalId — replaces every non-alphanumeric run with '-' (would alter a vendor-issued id containing '_' or '.'); validateExternalId")
D += snippet("src/lib/compliance/ccrs-identifiers.ts", 215, 262, "deriveInventoryExternalId (explicit → lot_code → pos_product_key → LOT-<id>) and resolveSaleInventoryExternalId")

A("## D. Week / ledger")
A("")
D += snippet("src/lib/compliance/ccrs-week-core.ts", 78, 140, "weekFromStart (due = end+1), lastCompletedWeek, WeekStatus, weekDeadline")
D += snippet("src/lib/compliance/ccrs-week-core.ts", 213, 260, "ReminderStage + planWeeklyReminders")
D += snippet("src/lib/compliance/ccrs-week-store.ts", 40, 157, "listWeekSubmissions, getWeekResolutions, getWeeklyOverview, resolveWeek, unresolveWeek, setWeekErrorStatus")

A("## E. Triage / gate")
A("")
D += snippet("src/lib/compliance/ccrs-error-triage-core.ts", 40, 165, "Rule type + RULES table (needle substrings, first match wins) + ERROR_HINT + triageCcrsErrorEmail head")
D += snippet("src/lib/compliance/ccrs-error-triage-core.ts", 226, 280, "LCB_CONTACTS + buildExaminerDraft")
D += snippet("src/lib/compliance/ccrs-submit-gate-core.ts", 60, 148, "defaultClassifyWarning + assertCcrsBatchSubmittable + verdictSummary")

A("## F. Adjustments & sale corrections")
A("")
D += snippet("src/lib/compliance/ccrs-inventory-adjustment-core.ts", 28, 135, "CCRS_ADJUSTMENT_REASONS, mapAdjustmentReason (return→Other; comment says detail REQUIRED), isReportableAdjustment, adjustmentDetail (returns '' for null — E13)")
D += snippet("src/lib/compliance/ccrs-inventory-adjustment-core.ts", 135, 235, "ADJUSTMENT_COLUMNS, mapAdjustmentRow, buildAdjustmentFile, makeAdjustmentFileName")
D += snippet("src/lib/compliance/ccrs-inventory-adjustment.ts", 45, 111, "buildCcrsInventoryAdjustmentCsv (DB read + skipReason warnings W16)")
D += snippet("src/lib/compliance/ccrs-sale-correction-core.ts", 80, 160, "mapSaleCorrectionRow (Delete full / Update partial), buildSaleCorrectionFile, makeSaleCorrectionFileName")

A("## G. Returns / disposition — `src/lib/inventory/disposition.ts`")
A("")
D += snippet("src/lib/inventory/disposition.ts", 455, 480, "createCustomerReturn contract (FAQ: 'sale identifier should be deleted … inventory identifier reported on an Inventory Adjustment as a return')")
D += snippet("src/lib/inventory/disposition.ts", 595, 630, "CCRS Sale-row snapshot + medical mirror")
D += snippet("src/lib/inventory/disposition.ts", 675, 705, "postAddition 'return' + destroy branch")
D += snippet("src/lib/inventory/disposition.ts", 780, 800, "createVendorReturn (reducing 'other' adjustment)")
D += snippet("src/lib/inventory/disposition.ts", 968, 985, "completeDestruction head ('destruction')")

A("## H. Intake & Cultivera identity lineage")
A("")
D += snippet("src/lib/pos/import-lot-core.ts", 14, 30, "Cultivera CSV import — header comment: Barcode is the CCRS-filed inventory identifier; one lot per barcode")
D += snippet("src/lib/pos/import-lot-core.ts", 45, 50, "PlannedLot.barcode doc")
D += snippet("src/lib/pos/import-lot-core.ts", 78, 83, "lot_code = barcode; ccrsExternalId = sanitized barcode")
D += snippet("src/lib/pos/import-lot-core.ts", 416, 426, "L420: ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode")
D += snippet("src/lib/pos/import-service.ts", 440, 460, "Dedupe by ccrs_inventory_external_id; why imported lots are 'active' (already reported by Cultivera as integrator)")
D += snippet("src/lib/inventory/intake-store.ts", 650, 668, "Intake writes ccrs_inventory_external_id via deriveInventoryExternalId({pos_product_key, lot_code})")
D += snippet("src/lib/inventory/intake-parser.ts", 368, 416, "WCIA JSON: lot_code ← item.inventory_id (the VENDOR's CCRS InventoryExternalIdentifier); pos_product_key ← sku ?? lot_code")
D += snippet("src/lib/inventory/intake-parser.ts", 438, 446, "WCIA JSON: manifest_number ← transfer_id/external_id; vendor_label ← from_license_name")
D += snippet("src/lib/inventory/intake-parser.ts", 278, 284, "WCIA detection requires from_license_number (→ vendors.license_number, migration 0064)")
D += snippet("src/lib/inventory/ccrs-manifest-csv-core.ts", 488, 505, "CCRS manifest.csv import: lot_code and pos_product_key ← InventoryExternalIdentifier (the VENDOR's id)")
D += snippet("src/lib/inventory/sale-decrement.ts", 175, 205, "Sale decrement resolves ccrsExternalId for the sold lot (must match Sale.csv builder)")
D += snippet("src/lib/pos/variant-lot-core.ts", 50, 60, "lotKeyForSaleLine")

A("## I. Routes / pages / components")
A("")
D += snippet("src/app/admin/reports/compliance/batch-export/route.ts", 26, 70, "GET: range → buildCcrsBatch → verifyCcrsBatch → assertCcrsBatchSubmittable (refuses zip on any error)")
D += snippet("src/app/admin/reports/compliance/batch-export/route.ts", 130, 145, "zip name CCRS_batch_<license>_<from>_<to>.zip")
D += snippet("src/app/admin/reports/compliance/adjustment-export/route.ts", 18, 30, "GET adjustment CSV for a range")
D += snippet("src/app/admin/inventory/disposition/sale-correction-export/route.ts", 28, 40, "GET sale corrections")
D += snippet("src/app/admin/inventory/disposition/sale-correction-export/route.ts", 74, 82, "markCorrectionsExported after download")
D += snippet("src/app/admin/compliance/ccrs/page.tsx", 81, 110, "CcrsCommandCenterPage head")
for pat, note in [(r"title=\"Step|title=\{`Step|title=\"DOH|title=\"Monthly|title=\"Submission ledger|<CcrsAdvisorPanel|<UploadWalkthrough|<ErrorTriagePanel|<PushRemindersPanel", "hub page section anchors")]:
    A(f"`src/app/admin/compliance/ccrs/page.tsx` — {note}")
    A("")
    D += grep("src/app/admin/compliance/ccrs/page.tsx", pat)
    A("")
A("`src/app/admin/compliance/ccrs/actions.ts` — server actions")
A("")
D += grep("src/app/admin/compliance/ccrs/actions.ts", r"^export async function|revalidatePath|requirePermission")
A("")
D += snippet("src/components/admin/compliance/UploadWalkthrough.tsx", 26, 35, "PORTAL_URL + WAIT_MINUTES constants")
D += snippet("src/components/admin/compliance/UploadWalkthrough.tsx", 144, 256, "steps array (8 steps) — the current human upload procedure encoded in UI")
A("`src/app/admin/reports/compliance/page.tsx` — Reports-tab compliance page (to be retired to a pointer, owner decision Q6)")
A("")
D += grep("src/app/admin/reports/compliance/page.tsx", r"<section|<h2|title=|href=\"/admin/compliance/ccrs|LicenseSettingsForm|batch-export|adjustment-export", 40)
A("")
D += snippet("src/components/admin/reports/LicenseSettingsForm.tsx", 1, 40, "License settings editor (license_number, submitted_by, trade_name) — lives on Reports tab, NOT in the hub")
A("`src/components/admin/admin-nav-data.ts` — nav entries mentioning CCRS/compliance")
A("")
D += grep("src/components/admin/admin-nav-data.ts", r"ccrs|compliance|CCRS", 20)
A("")

A("## J. Schema anchors (Supabase migrations)")
A("")
SCHEMA = [
 ("supabase/migrations/0023_pos_inventory_lots.sql", 20, 40, "inbound_manifests — NO column for the vendor's inventory external id; raw_payload jsonb keeps the full vendor JSON"),
 ("supabase/migrations/0023_pos_inventory_lots.sql", 83, 115, "inventory_lots base columns (lot_code, manifest_id, received_qty, on_hand_qty, unit_cost_minor_units, status enum comment)"),
 ("supabase/migrations/0024_pos_coa_potency.sql", 25, 34, "inventory_lots: strain_name, category, inventory_type, unit_weight, unit_weight_uom, is_sample, is_medical"),
 ("supabase/migrations/0031_ccrs_license_export.sql", 10, 48, "license_settings singleton + order_lines.ccrs_inventory_external_id override"),
 ("supabase/migrations/0034_ccrs_lot_external_id.sql", 1, 40, "inventory_lots.ccrs_inventory_external_id + SQL backfill mirroring deriveInventoryExternalId"),
 ("supabase/migrations/0040_medical_doh.sql", 80, 106, "medical_exempt_sales (WAC 314-55-090(2))"),
 ("supabase/migrations/0059_intake_lot_disposition.sql", 20, 60, "lot disposition / reject_reason columns"),
 ("supabase/migrations/0064_vendor_license_number.sql", 1, 20, "vendors.license_number (FromLicenseNumber source)"),
 ("supabase/migrations/0118_ccrs_command_center.sql", 25, 110, "ccrs_week_submissions, compliance_reminder_log, push_subscriptions"),
 ("supabase/migrations/0131_pacific_sale_date_default.sql", 1, 32, "medical_exempt_sales.sale_date default → Pacific date"),
 ("supabase/migrations/0214_inventory_lot_received_date.sql", 25, 55, "inventory_lots.received_on (+source/set_by/set_at) — the honest CCRS CreatedDate/TransferDate source"),
]
for rel, a, b, note in SCHEMA:
    if os.path.exists(f"{REPO}/{rel}"):
        D += snippet(rel, a, b, note)
    else:
        A(f"`{rel}` — MISSING at this commit")
        A("")

A("## K. Tests and fixtures")
A("")
for rel in ["tests/compliance/ccrs-batch.test.ts", "tests/compliance/pure-selftests.test.ts"]:
    if os.path.exists(f"{REPO}/{rel}"):
        A(f"### `{rel}` ({len(lines(rel))} L) — `describe`/`it` titles")
        A("")
        D += grep(rel, r"^\s*(describe|it|test)\(", 120)
        A("")
import glob
gold = sorted(glob.glob(f"{REPO}/tests/compliance/golden/ccrs/*.golden.csv"))
A("### Golden fixtures (`tests/compliance/golden/ccrs/`)")
A("")
for g in gold:
    with open(g, "rb") as f:
        raw = f.read().decode("utf-8", "replace")
    rows = raw.split("\n")
    A(f"- `{os.path.basename(g)}`: rows={len([r for r in rows if r.strip()])}, CRLF={'yes' if chr(13) in raw else 'no'}; R1=`{rows[0].strip()}`; R4=`{rows[3].strip()[:120]}`")
A("")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(D) + "\n")
print(OUT, len(D), "lines")
