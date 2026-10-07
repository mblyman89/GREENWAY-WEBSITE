#!/usr/bin/env python3
"""
Mutation harness — "test the tests" (Part 05 D-10).

A test that cannot fail is not a test. This script deliberately breaks the
implementation one edit at a time and asserts that the named test file goes
RED. If a mutation survives (tests still pass), the test suite has a hole and
the script exits non-zero.

The target file is ALWAYS restored from an in-memory copy of the original in a
finally-block, so an interrupted run cannot leave a mutated file behind.

Usage:
    python3 scripts/ccrs-bible/mutate_check.py
"""

from __future__ import annotations

import os
import subprocess
import sys

REPO = os.environ.get(
    "CCRS_REPO",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
)

CORE = "src/lib/compliance/ccrs-batch-core.ts"
GATE = "src/lib/compliance/ccrs-submit-gate-core.ts"
PREFLIGHT = "src/lib/compliance/ccrs-preflight-core.ts"
ADJCORE = "src/lib/compliance/ccrs-inventory-adjustment-core.ts"

STAMP_TESTS = "tests/compliance/ccrs-file-stamp.test.ts"
SELF_TESTS = "tests/compliance/pure-selftests.test.ts"
BATCH_TESTS = "tests/compliance/ccrs-batch.test.ts"
PREFLIGHT_TESTS = "tests/compliance/ccrs-preflight.test.ts"

# The PREproduction generator writes the files the owner actually uploads to
# the LCB. It is not application code, but a silent defect here costs a real
# ten-minute upload cycle and teaches us a false lesson, so it is mutated too.
GENERATOR = "scripts/compliance/generate-preprod-test-files.ts"
GENERATOR_TESTS = "tests/compliance/ccrs-preprod-generator.test.ts"

# S-10 identifier pass-through (Bible v2 Part 09).
IDS = "src/lib/compliance/ccrs-identifiers.ts"
IMPORTLOT = "src/lib/pos/import-lot-core.ts"
BATCHSRV = "src/lib/compliance/ccrs-batch.ts"
DISPO = "src/lib/inventory/disposition.ts"
S10_TESTS = "tests/compliance/s10-identifier-passthrough.test.ts"
# S-09 RFC 4180 encoder + E38 (Bible v2 Part 05 §F.1, Part 12 U-25).
SALES = "src/lib/compliance/ccrs-sales.ts"
ADJSRV = "src/lib/compliance/ccrs-inventory-adjustment.ts"
ADJCORE = "src/lib/compliance/ccrs-inventory-adjustment-core.ts"
PREFLIGHT = "src/lib/compliance/ccrs-preflight-core.ts"
SCROUTE = "src/app/admin/inventory/disposition/sale-correction-export/route.ts"
S09_TESTS = "tests/compliance/ccrs-csv-fidelity.test.ts"
P04GEN = "scripts/compliance/generate-p04-fidelity-probe.ts"
P04_TESTS = "tests/compliance/p04-fidelity-probe.test.ts"
# S-11 ledger routing (Bible v2 Part 03 §D.3, slice plan S-11).
LEDGER = "src/lib/compliance/ccrs-ledger-core.ts"
S11_TESTS = "tests/compliance/ccrs-ledger-routing.test.ts"
# S-12a ledger schema + seed (Bible v2 Part 03 §D.4, Part 05 §A).
FSTATE = "src/lib/compliance/ccrs-file-state-core.ts"
SEEDCORE = "src/lib/compliance/ccrs-ledger-seed-core.ts"
SEEDCLI = "scripts/compliance/seed-ccrs-ledger.ts"
MIG0247 = "supabase/migrations/0247_ccrs_ledger.sql"
RESETCORE = "src/lib/accounting/factory-reset-core.ts"
S12A_TESTS = "tests/compliance/s12a-ccrs-ledger.test.ts"
# S-12b ledger-backed routing, chunked outbox, emit (Part 05 sections B-D).
OUTBOX = "src/lib/compliance/ccrs-outbox-core.ts"
CHUNK = "src/lib/compliance/ccrs-chunk-core.ts"
STORECORE = "src/lib/compliance/ccrs-ledger-store-core.ts"
EXPROUTE = "src/app/admin/reports/compliance/batch-export/route.ts"
OUTBOX_TESTS = "tests/compliance/ccrs-outbox-core.test.ts"
CHUNK_TESTS = "tests/compliance/ccrs-chunk-core.test.ts"
S12B_TESTS = "tests/compliance/s12b-ccrs-outbox.test.ts"
P11GEN = "scripts/compliance/generate-p11-chunk-naming-probe.ts"
P11_TESTS = "tests/compliance/p11-chunk-naming-probe.test.ts"

# (id, file, old_fragment, new_fragment, test_target, why)
MUTATIONS = [
    (
        "M1-stamp-utc",
        CORE,
        "  const t = pacificParts(now); // America/Los_Angeles wall clock",
        "  const t = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1,\n"
        "    day: now.getUTCDate(), hour: now.getUTCHours(),\n"
        "    minute: now.getUTCMinutes(), second: now.getUTCSeconds() };",
        STAMP_TESTS,
        "Regression to UTC stamping must be caught (FAQ L0075: name is PST).",
    ),
    (
        "M2-stamp-no-pad",
        CORE,
        '  const p = (n: number, w = 2) => String(n).padStart(w, "0");',
        "  const p = (n: number, _w = 2) => String(n);",
        STAMP_TESTS,
        "Dropping zero-pad must be caught (stamp must always be 14 digits).",
    ),
    (
        "M3-stamp-month-off-by-one",
        CORE,
        "    `${t.year}${p(t.month)}${p(t.day)}`",
        "    `${t.year}${p(t.month - 1)}${p(t.day)}`",
        STAMP_TESTS,
        "Off-by-one in month must be caught.",
    ),
    (
        "M4-pad-not-idempotent",
        CORE,
        "    if (cells.length >= width) continue; // already padded (idempotent)",
        "    // mutated: idempotence guard removed",
        STAMP_TESTS,
        "Padding twice must not double-pad; guard removal must be caught.",
    ),
    (
        "M5-pad-touches-data-rows",
        CORE,
        "  for (let i = 0; i < 3; i += 1) {",
        "  for (let i = 0; i < lines.length; i += 1) {",
        STAMP_TESTS,
        "Padding must touch ONLY the 3 header rows, never data rows.",
    ),
    (
        "M6-pad-drops-trailing-crlf",
        CORE,
        '  return lines.join("\\r\\n") + (hadTrailingCrLf ? "\\r\\n" : "");',
        '  return lines.join("\\r\\n");',
        STAMP_TESTS,
        "Dropping the trailing CRLF must be caught by verifyCcrsFile round-trip.",
    ),
    (
        "M7-gate-always-submittable",
        GATE,
        "submittable: errors.length === 0,",
        "submittable: true,",
        SELF_TESTS,
        "The registered gate self-test must actually fail when the gate breaks.",
    ),
    # ---- S-02: pre-flight blocking errors E7-E13 ----
    (
        "M9-strain-substring-match",
        PREFLIGHT,
        "  return (RESERVED_STRAIN_NAMES as readonly string[]).includes(n);",
        "  return (RESERVED_STRAIN_NAMES as readonly string[]).some((r) => n.includes(r));",
        PREFLIGHT_TESTS,
        "E11 must be EXACT match — a substring test would reject 'Other Kush'.",
    ),
    (
        "M10-totalcost-allows-zero",
        PREFLIGHT,
        "  if (minor == null || !Number.isFinite(minor) || minor <= 0) return { value: null, ok: false };",
        "  if (minor == null || !Number.isFinite(minor) || minor < 0) return { value: null, ok: false };",
        PREFLIGHT_TESTS,
        "E7: TotalCost of exactly 0 must still be an error [G L0614].",
    ),
    (
        "M11-sample-wrong-cost",
        PREFLIGHT,
        'export const TRADE_SAMPLE_TOTAL_COST = "0.01";',
        'export const TRADE_SAMPLE_TOTAL_COST = "0.00";',
        PREFLIGHT_TESTS,
        "E7: a trade sample must report exactly $0.01 [FAQ L0035].",
    ),
    (
        "M12-excise-wrong-rate",
        PREFLIGHT,
        "export const CCRS_EXCISE_BPS = 3700;",
        "export const CCRS_EXCISE_BPS = 3500;",
        PREFLIGHT_TESTS,
        "E12: the rate is 37%, and must reproduce the FAQ's $4.44 exactly.",
    ),
    (
        "M13-excise-ignores-discount",
        PREFLIGHT,
        "  return Math.max(0, quantity * unitPriceMinorUnits - discountMinorUnits);",
        "  return Math.max(0, quantity * unitPriceMinorUnits);",
        PREFLIGHT_TESTS,
        "E12: the taxable base is POST-discount [FAQ L0155-L0160].",
    ),
    (
        "M14-excise-tolerance-too-wide",
        PREFLIGHT,
        "export const EXCISE_TOLERANCE_MINOR_UNITS = 1;",
        "export const EXCISE_TOLERANCE_MINOR_UNITS = 100;",
        PREFLIGHT_TESTS,
        "E12: a dollar of slack would let a real mismatch through.",
    ),
    (
        "M15-medical-exempt-always",
        PREFLIGHT,
        "  if (input.isMedicalExempt) return null; // [G L1378] \"Only Medical … 0\"",
        "  return null; // mutated: everything exempt",
        PREFLIGHT_TESTS,
        "E12 must still fire for NON-exempt rows (today IsMedical is always FALSE).",
    ),
    (
        "M16-type-gate-misses-guide-spelling",
        PREFLIGHT,
        '    .replace(/^useable /, "usable ");',
        "    ;",
        PREFLIGHT_TESTS,
        "E9/E10: the guide spells it 'Useable cannabis'; missing it skips real rows.",
    ),
    (
        "M17-adjustment-detail-not-required",
        PREFLIGHT,
        'export const DETAIL_REQUIRED_REASONS = ["Other", "Theft"] as const;',
        'export const DETAIL_REQUIRED_REASONS = ["Other"] as const;',
        PREFLIGHT_TESTS,
        "E13: Theft also requires a detail [G L1111].",
    ),
    (
        "M18-issue-rows-capped",
        PREFLIGHT,
        "  return { code, severity, specPin: specPinFor(code), message, rows };",
        "  return { code, severity, specPin: specPinFor(code), message, rows: rows.slice(0, 25) };",
        PREFLIGHT_TESTS,
        "Part 08: row lists are NEVER capped — a cap hides the blocking row.",
    ),
    (
        "M19-verdict-emits-bad-row",
        PREFLIGHT,
        "  if (f.onHandQty > f.initialQty) {",
        "  if (false) {",
        PREFLIGHT_TESTS,
        "E8 rows must be WITHHELD; emitting one gets the whole file rejected.",
    ),
    (
        "M20-verdict-order-e7-first",
        PREFLIGHT,
        "  if (f.onHandQty > f.initialQty) {\n    return {\n      emit: false,\n      code: \"E8_ONHAND_GT_INITIAL\",",
        "  if (f.onHandQty > f.initialQty) {\n    return {\n      emit: false,\n      code: \"E7_TOTALCOST_ZERO\",",
        PREFLIGHT_TESTS,
        "A count problem must be reported as E8, not mislabelled E7.",
    ),
    (
        "M21-product-returns-first-only",
        PREFLIGHT,
        "  if (!f.description.trim()) {",
        "  if (out.length === 0 && !f.description.trim()) {",
        PREFLIGHT_TESTS,
        "Both E9 and E10 must surface together; hiding one causes a second rejection.",
    ),
    (
        "M22-e13-not-enforced",
        ADJCORE,
        "  if (adjustmentDetailRequired(ccrsReason) && !detail) {",
        "  if (false) {",
        PREFLIGHT_TESTS,
        "E13: an Other/Theft row with no detail must be withheld [G L1111].",
    ),
    (
        "M23-generator-emits-lf",
        GENERATOR,
        '    writeFileSync(join(outDir, fileName), csv, "utf8");',
        "    writeFileSync(join(outDir, fileName), "
        'csv.replace(/\\r\\n/g, "\\n"), "utf8");',
        GENERATOR_TESTS,
        "The owner uploads these files to CCRS. LF instead of CRLF is the most "
        "likely real-world rejection [G L0196], and it is invisible on screen.",
    ),
    (
        "M24-generator-probe-accidentally-valid",
        GENERATOR,
        "  if (t.breakNumberRecords) {",
        "  if (false && t.breakNumberRecords) {",
        GENERATOR_TESTS,
        "An EXPECT-ERROR file that is secretly VALID is worse than a broken "
        "one: CCRS accepts it and we record the wrong lesson for T-54.",
    ),
    (
        "M8-filename-stamp-literal",
        CORE,
        "  return `${type}_${lic}_${ccrsFileStamp(now)}.csv`;",
        '  return `${type}_${lic}_20250615130000.csv`;',
        STAMP_TESTS,
        "Filename must derive from the live stamp, not a hard-coded value.",
    ),
    (
        "M25-s10-resanitize-assigned",
        IDS,
        "  if (assigned) return assigned;",
        "  if (assigned) return mintExternalId(assigned);",
        S10_TESTS,
        "S-10: a filed dotted id rewritten to hyphens addresses a different, "
        "nonexistent CCRS lot.",
    ),
    (
        "M26-s10-passthrough-rewrites",
        IDS,
        '  return (raw ?? "").trim();',
        '  return (raw ?? "").trim().replace(/[.]/g, "-");',
        S10_TESTS,
        "S-10: pass-through may trim only; any rewrite breaks the exact match.",
    ),
    (
        "M27-s10-export-mints-fallback",
        IDS,
        "  return v ? v : null;",
        '  return v ? v : (src as { lot_code?: string | null }).lot_code ?? null;',
        S10_TESTS,
        "S-10: export must withhold an unassigned lot (E3), never invent an "
        "id from lot_code.",
    ),
    (
        "M28-s10-adjustment-drops-assigned",
        ADJCORE,
        "    ccrs_inventory_external_id: src.lot?.ccrs_inventory_external_id ?? null,",
        "    ccrs_inventory_external_id: null,",
        S10_TESTS,
        "S-10: InventoryAdjustment must carry the same id as Inventory.csv.",
    ),
    (
        "M29-s10-import-sanitizes-barcode",
        IMPORTLOT,
        "      ? deriveInventoryExternalId({ ccrs_inventory_external_id: barcode }) ?? barcode",
        "      ? deriveInventoryExternalId({ lot_code: barcode }) ?? barcode",
        S10_TESTS,
        "S-10: the Cultivera barcode IS the filed id; minting it from "
        "lot_code rewrites dots.",
    ),
    (
        "M30-s10-batch-mints-again",
        BATCHSRV,
        "    const ext = assignedInventoryExternalId(l);",
        "    const ext = assignedInventoryExternalId(l) ?? l.lot_code;",
        S10_TESTS,
        "S-10: Inventory.csv must not fall back to an id CCRS never saw.",
    ),
    (
        "M31-s10-disposition-drops-assigned",
        DISPO,
        "      ccrs_inventory_external_id: lotRow.ccrs_inventory_external_id ?? null,",
        "      ccrs_inventory_external_id: null,",
        S10_TESTS,
        "S-10: a sale-correction must address the lot by its filed id.",
    ),
    (
        "M32-s10-validator-allows-comma",
        IDS,
        '  if (/[\\r\\n,"]/.test(v))',
        '  if (/[\\r\\n"]/.test(v))',
        S10_TESTS,
        "S-10: an unencoded comma in an id shifts every CSV column after it.",
    ),
    (
        'M33-s09b-encoder-adds-quotes',
        CORE,
        "  return s;\n}\n\n/**\n * Split one data line the way CCRS's reader does",
        '  return / $|^ /.test(s) ? `"${s}"` : s;\n}\n\n/**\n * Split one data line the way CCRS\'s reader does',
        S09_TESTS,
        'S-09b: CCRS ignores quoting, so added quotes become part of the value.',
    ),
    (
        'M34-s09b-comma-not-detected',
        CORE,
        '  if (s.includes(",")) return "comma";',
        '  if (s.includes(",,")) return "comma";',
        S09_TESTS,
        'S-09b: a comma splits the row in CCRS (P20261005A).',
    ),
    (
        'M35-s09c-quote-withheld-again',
        CORE,
        '  if (s.includes(",")) return "comma";',
        '  if (s.includes(",") || s.includes(\'"\')) return "comma";',
        S09_TESTS,
        'S-09c: a double quote is accepted by CCRS (P20261006A) and must pass through, not be withheld.',
    ),
    (
        'M36-s09b-verifier-rfc-split',
        CORE,
        '    const cells = ccrsReaderSplit(line);',
        '    const cells = splitCsvLine(line);',
        S09_TESTS,
        'S-09b: the verifier must count columns the way CCRS does, or it passes a file CCRS rejects.',
    ),
    (
        'M37-s09-linebreak-no-throw',
        CORE,
        '  if (reason !== null) {\n    throw new CcrsEncodeError(',
        '  if (reason === "line break") {\n    throw new CcrsEncodeError(',
        S09_TESTS,
        'S-09/S-09b: the encoder tripwire must refuse every unencodable value.',
    ),
    (
        'M38-s09-withhold-noop',
        CORE,
        '    const bad = r.findIndex((c) => ccrsUnencodableReason(c) !== null);',
        '    const bad = -1 as number;',
        S09_TESTS,
        'S-09 E38/E42: unencodable rows must be withheld, not sent.',
    ),
    (
        'M39-s09-e38-nonblocking',
        CORE,
        '  return `Error — ${parts.join(" ")}`;',
        '  return `Note: ${parts.join(" ")}`;',
        S09_TESTS,
        'S-09 E38: a withheld row must block, not pass as a warning.',
    ),
    (
        'M40-s09-e38-cap-off',
        CORE,
        '    const list = these.slice(0, 10).map(',
        '    const list = these.map(',
        S09_TESTS,
        'S-09 E38: the message stays readable (first 10, then a count).',
    ),
    (
        "M41-s09-batch-push-no-withhold",
        BATCHSRV,
        "    const rows = e38.rows;",
        "    const rows = rawRows;",
        S09_TESTS,
        "S-09 E38: the weekly batch must withhold before assembling.",
    ),
    (
        "M42-s09-sales-no-withhold",
        SALES,
        "  result.csv = buildFile(e38.rows, license);",
        "  result.csv = buildFile(rows, license);",
        S09_TESTS,
        "S-09 E38: Sale.csv must withhold before assembling.",
    ),
    (
        "M43-s09-adjustment-no-withhold",
        ADJSRV,
        "  result.csv = buildAdjustmentFile(e38.rows, license);",
        "  result.csv = buildAdjustmentFile(rows, license);",
        S09_TESTS,
        "S-09 E38: InventoryAdjustment.csv must withhold before assembling.",
    ),
    (
        "M44-s09-route-marks-withheld-exported",
        SCROUTE,
        "    await markCorrectionsExported(exportIds);",
        "    await markCorrectionsExported(includedIds);",
        S09_TESTS,
        "S-09 E38: a withheld correction must stay pending, not be lost.",
    ),
    (
        "M45-s09-adjustment-cell-strips",
        ADJCORE,
        "  return ccrsCell(v);",
        """  return ccrsCell(v == null ? v : String(v).replace(/"/g, ""));""",
        S09_TESTS,
        "S-09: the adjustment encoder must be the same lossless encoder.",
    ),
    (
        "M46-s09-e38-pin-wrong",
        PREFLIGHT,
        '  E38_FIELD_HAS_LINE_BREAK: "[G L0167-L0169]",',
        '  E38_FIELD_HAS_LINE_BREAK: "[G L1057-L1058]",',
        S09_TESTS,
        "S-09 E38: the pin must cite the CSV rule, not file dependency.",
    ),
    (
        'M47-p04-run-prefix-dropped',
        P04GEN,
        '    `${run}-L-${c.code}`, by, today,',
        '    `L-${c.code}`, by, today,',
        P04_TESTS,
        'P-04: an unprefixed id can collide with the 2026-09-17 run.',
    ),
    (
        'M48-p04-quote-case-lost',
        P04GEN,
        'name: (r) => `"${r} Mama J\'s Quoted - 3.5g"`, rawQuote: true },',
        "name: (r) => `${r} Mama J's Quoted - 3.5g`, rawQuote: true },",
        P04_TESTS,
        'P-04b: Q2 must actually carry the leading/trailing quote it probes.',
    ),
    (
        "M49-p04-same-stamp",
        P04GEN,
        "    const at = new Date(start.getTime() + k * 1000);",
        "    const at = new Date(start.getTime());",
        P04_TESTS,
        "P-04: two files with one name cannot both be uploaded unambiguously.",
    ),
    (
        "M50-p04-cli-no-refusal",
        P04GEN,
        "  if (!run || !RUN_RE.test(run)) {\n    console.error(",
        "  if (false) {\n    console.error(",
        P04_TESTS,
        "P-04: running without a run id must be refused (Part 06 §A.2).",
    ),
    # ---- S-11 ledger routing --------------------------------------------
    ("M51-s11-strain-lot-casing", LEDGER,
     '  if (filed && filed.length > 0) return { kind: "case-variant", value: filed[0], ours: strain };',
     '  if (filed && filed.length > 0) return { kind: "case-variant", value: strain, ours: strain };',
     S11_TESTS, "Slice-plan mandated: returning the lot casing sends a Brian-A16 case variant."),
    ("M52-s11-closed-not-update", LEDGER,
     '    case "confirmed":\n    case "closed":\n      return { op: "Update"',
     '    case "confirmed":\n      return { op: "Update"',
     S11_TESTS, "Part 03 §D.3: a closed lot may be re-stated by Update."),
    ("M53-s11-uncertain-updates", LEDGER,
     '    case "uncertain":\n      return { op: "withhold"',
     '    case "uncertain":\n      return { op: "Update"',
     S11_TESTS, "Uncertain ids must be reconciled before any row is sent."),
    ("M54-s11-delete-unproven", LEDGER,
     '    return e && PRESENT.has(e.state)\n      ? { op: "Delete"',
     '    return e\n      ? { op: "Delete"',
     S11_TESTS, "Never Delete a record not proven on file."),
    ("M55-s11-absent-update", LEDGER,
     '  if (!e) return { op: "Insert", state, reason: "not on file" };',
     '  if (!e) return { op: "Update", state, reason: "not on file" };',
     S11_TESTS, "[G L0247] Update alters an EXISTING record."),
    ("M56-s11-reference-closed-ok", LEDGER,
     '  return { ok: !!e && PRESENT.has(e.state), state: e?.state ?? null };',
     '  return { ok: !!e && e.state !== "uncertain", state: e?.state ?? null };',
     S11_TESTS, "Event rows may only name seed/filed/confirmed lots."),
    ("M57-s11-product-our-name", LEDGER,
     '  return { kind: "filed", name: p.filedName, productExternalId: pid, differs: ourName !== p.filedName };',
     '  return { kind: "filed", name: ourName, productExternalId: pid, differs: ourName !== p.filedName };',
     S11_TESTS, "[G L0580-L0583] filed lots must name the product as filed."),
    ("M58-s11-product-unproven-ok", LEDGER,
     '  if (!PRESENT.has(p.state)) return { kind: "withhold"',
     '  if (false) return { kind: "withhold"',
     S11_TESTS, "A filed product in uncertain/deleted state is not proof."),
    ("M59-s11-strain-batch-variant", LEDGER,
     '    } else if (first !== s) {\n      strainCaseVariants.push({ ours: s, value: first, source: "batch" });\n      value = first;',
     '    } else if (first !== s) {\n      strainCaseVariants.push({ ours: s, value: first, source: "batch" });',
     S11_TESTS, "In-batch case variants must share one spelling in every file."),
    ("M60-s11-resend-filed-strain", LEDGER,
     '      if (r.kind !== "new") {\n        strainCanonical.set(s, value);\n        return value;\n      }',
     '      if (false) {\n        strainCanonical.set(s, value);\n        return value;\n      }',
     S11_TESTS, "A strain on file in any casing is never re-sent."),
    ("M61-s11-no-name-collision", LEDGER,
     '        if (r.op === "Insert" && holders.length > 0) {',
     '        if (false) {',
     S11_TESTS, "Gap N-12: never Insert a second product under a filed name."),
    ("M62-s11-unassigned-legacy-id", LEDGER,
     '    products.set(p.key, { action: "withhold", reason: NO_PRODUCT_ID_REASON });',
     '    products.set(p.key, { action: "emit", op: "Insert", ext: p.legacyId });',
     S11_TESTS, "Never invent a Product id at export time (standing rule 3)."),
    ("M63-s11-rename-conflict-moves", LEDGER,
     '    if (names.size === 1) renames.set(',
     '    if (names.size >= 1) renames.set(',
     S11_TESTS, "Two new names for one filed product: nobody moves."),
    ("M64-s11-apply-keeps-op", LEDGER,
     '    row[iOp] = pp.op;\n',
     '',
     S11_TESTS, "Product Operation must come from the plan."),
    ("M65-s11-apply-drops-rename", LEDGER,
     '    row[iOp] = "Update";\n    out.push(row);',
     '    row[iOp] = "Update";',
     S11_TESTS, "A rename must emit its Product Update row (U-39)."),
    ("M66-s11-inv-op-insert", BATCHSRV,
     '      planned.op,\n    ]);',
     '      "Insert",\n    ]);',
     S11_TESTS, "Inventory Operation must come from the plan."),
    ("M67-s11-strain-lowercase-dedupe", BATCHSRV,
     '    if (!plan.strainEmit.has(strain)) continue;\n',
     '',
     S11_TESTS, "Strain file must not re-send filed strains."),
    ("M68-s11-pin", PREFLIGHT,
     '  E39_STRAIN_CASE_VARIANT: "[G L0359]",',
     '  E39_STRAIN_CASE_VARIANT: "[G L0358]",',
     S11_TESTS, "Pins are verbatim-checked; a drifted pin must fail."),
    (
        'M69-s09b-free-text-not-rewritten',
        CORE,
        '  return v.replace(/,/g, ";");',
        '  return v;',
        S09_TESTS,
        "S-09b E44: Description commas must become ';' or every product with one is withheld.",
    ),
    (
        'M70-s09b-free-text-list-widened',
        CORE,
        '  Product: ["Description"],',
        '  Product: ["Description", "Name"],',
        S09_TESTS,
        'S-09b: Name is a join key [G L0580-L0583] and must never be rewritten.',
    ),
    (
        'M71-s09b-batch-no-free-text',
        BATCHSRV,
        '      CCRS_FREE_TEXT_COLUMNS[type] ?? [],',
        '      [],',
        S09_TESTS,
        'S-09b: the weekly batch must rewrite Description, not withhold the product.',
    ),
    (
        'M72-s09b-adjustment-no-free-text',
        ADJSRV,
        '    CCRS_FREE_TEXT_COLUMNS.InventoryAdjustment,\n  );',
        '  );',
        S09_TESTS,
        'S-09b: an adjustment note with a comma must be rewritten, not lost.',
    ),
    (
        'M73-s09c-verifier-flags-quote',
        CORE,
        '    for (const c of dateCols) {',
        '    if (line.includes(\'"\')) err(`Data row ${rowNo} contains a double quote.`);\n    for (const c of dateCols) {',
        S09_TESTS,
        'S-09c: the verifier must not block a file for a double quote (P20261006A accepted it).',
    ),
    (
        'M77-s09c-free-text-quote-rewritten',
        CORE,
        '  return v.replace(/,/g, ";");',
        '  return v.replace(/,/g, ";").replace(/"/g, "\'");',
        S09_TESTS,
        'S-09c: free text keeps a double quote; only commas are rewritten.',
    ),
    (
        'M74-s09b-pin-wrong',
        PREFLIGHT,
        '  E42_FIELD_HAS_COMMA: "[G L0167-L0169]",',
        '  E42_FIELD_HAS_COMMA: "[G L0168]",',
        S09_TESTS,
        'S-09b: E42 carries the CSV-columns pin.',
    ),
    (
        'M75-p04b-shared-product-file',
        P04GEN,
        '    add("1", `${pad(3 + i)}-Product-${c.code}`, "Product",',
        '    add("1", `${pad(3)}-Product-${c.code}`, "Product",',
        P04_TESTS,
        'P-04b: one Product file per case, so one bad class cannot fail the rest.',
    ),
    (
        'M76-p04b-comma-in-description',
        P04GEN,
        '`P-04b fidelity case ${c.code}: ${c.what}`',
        '`P-04b fidelity case ${c.code}, ${c.what}`',
        P04_TESTS,
        "P-04b: a comma anywhere in a probe file repeats run A's failure.",
    ),
    (
        'M78-s12a-extra-transition',
        FSTATE,
        '  "errored>reconciling",\n  "reconciling>closed",\n];',
        '  "errored>reconciling",\n  "reconciling>closed",\n  "uploaded>abandoned",\n];',
        S12A_TESTS,
        'S-12a: once uploaded the State has the file; it can never be abandoned (TS == SQL).',
    ),
    (
        'M79-s12a-sql-extra-transition',
        MIG0247,
        "    'reconciling>closed'\n  ];",
        "    'reconciling>closed',\n    'closed>draft'\n  ];",
        S12A_TESTS,
        'S-12a: SQL guard edges must equal the TypeScript list exactly.',
    ),
    (
        'M80-s12a-immutable-field-dropped',
        FSTATE,
        '["sha256", "fileName", "numberRecords", "env", "fileType", "storagePath"] as const;',
        '["sha256", "fileName", "numberRecords", "env", "fileType"] as const;',
        S12A_TESTS,
        'S-12a: storage path is frozen once a file leaves draft.',
    ),
    (
        'M81-s12a-inflight-ignores-operation',
        FSTATE,
        '`${r.env}\\u0000${r.fileType}\\u0000${r.externalId}\\u0000${r.operation ?? ""}`;',
        '`${r.env}\\u0000${r.fileType}\\u0000${r.externalId}`;',
        S12A_TESTS,
        'S-12a: in-flight key includes operation (Insert and Update are different rows).',
    ),
    (
        'M82-s12a-qoh-closed-flipped',
        SEEDCORE,
        'if (Number(qoh) === 0) { e.state = "closed"; inventoryClosed += 1; }',
        'if (Number(qoh) !== 0) { e.state = "closed"; inventoryClosed += 1; }',
        S12A_TESTS,
        'S-12a: only QoH 0 lots are seeded closed.',
    ),
    (
        'M83-s12a-unknown-product-dropped',
        SEEDCORE,
        'if (SEED_UNKNOWN_PRODUCT_IDS.has(id)) { e.state = "unknown"; unknownProducts += 1; }',
        '',
        S12A_TESTS,
        'S-12a: junk Product id "1" must be unknown (withheld), never treated as filed.',
    ),
    (
        'M84-s12a-on-conflict-update',
        SEEDCORE,
        '"\\non conflict (env, file_type, external_id) do nothing;",',
        '"\\non conflict (env, file_type, external_id) do update set state = excluded.state;",',
        S12A_TESTS,
        'S-12a: a re-run must never overwrite a row routing has since moved.',
    ),
    (
        'M85-s12a-conflicts-discarded',
        SEEDCORE,
        'e.seedConflicts = all.length > 1 ? all : null;',
        'e.seedConflicts = null;',
        S12A_TESTS,
        'S-12a: duplicate rows are kept as evidence, not silently thrown away.',
    ),
    (
        'M86-s12a-header-check-loosened',
        SEEDCORE,
        'if (header.length !== want.length || header.some((h, i) => h !== want[i])) {',
        'if (header.length !== want.length) {',
        S12A_TESTS,
        'S-12a: a re-ordered column must be refused, not shifted silently.',
    ),
    (
        'M87-s12a-sqltext-no-escape',
        SEEDCORE,
        "return `'${v.replace(/'/g, \"''\")}'`;",
        "return `'${v}'`;",
        S12A_TESTS,
        "S-12a: names like Mack's GAK must be quoted safely in SQL.",
    ),
    (
        'M88-s12a-ledger-wiped-by-reset',
        RESETCORE,
        '{ table: "ccrs_filed_entities", disposition: "KEEP",',
        '{ table: "ccrs_filed_entities", disposition: "WIPE",',
        S12A_TESTS,
        'S-12a: a factory reset must never forget what the State holds.',
    ),
    (
        'M89-s12a-expected-count-drift',
        SEEDCLI,
        '  inventoryClosed: 17998,',
        '  inventoryClosed: 17999,',
        S12A_TESTS,
        'S-12a: the CLI refusal counts must equal what the delivery measures.',
    ),
    (
        'M90-s12b-seed-routes-insert',
        LEDGER,
        '    case "seed":\n    case "filed":',
        '    case "seed":\n      return { op: "Insert", state, reason: "mutant" };\n    case "filed":',
        S11_TESTS,
        'S-12b acceptance: every seeded shelf lot must be an Update, never re-Inserted.',
    ),
    (
        'M91-s12b-chunk-off-by-one',
        CHUNK,
        '  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));',
        '  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size - 1));',
        CHUNK_TESTS,
        'S-12b D-07/D-08: 10,000-row chunks must not drop the last row of a chunk.',
    ),
    (
        'M92-s12b-stamp-reuse',
        CHUNK,
        '  const next = floorToSecond(lastUsed).getTime() + 1000;',
        '  const next = floorToSecond(lastUsed).getTime();',
        CHUNK_TESTS,
        'Part 05 B: a regeneration must never reuse a stamp already emitted.',
    ),
    (
        'M93-s12b-insert-on-file-allowed',
        OUTBOX,
        '          if (e && e.state !== "deleted") push("L_INSERT_ON_FILE",',
        '          if (false && e && e.state !== "deleted") push("L_INSERT_ON_FILE",',
        OUTBOX_TESTS,
        'The self-check must refuse an Insert of an id CCRS already holds.',
    ),
    (
        'M94-s12b-update-not-on-file-allowed',
        OUTBOX,
        '          if (!createdHere && !(e && UPDATABLE.has(e.state))) {',
        '          if (false) {',
        OUTBOX_TESTS,
        'The self-check must refuse an Update CCRS cannot apply [FAQ L0053].',
    ),
    (
        'M95-s12b-event-lot-closed-ok',
        OUTBOX,
        '          if (!(e && PRESENT.has(e.state)) && !newIds.has(key("Inventory", inv))) {',
        '          if (!(e && UPDATABLE.has(e.state)) && !newIds.has(key("Inventory", inv))) {',
        OUTBOX_TESTS,
        'Part 03 L189: an event row naming a closed lot is not enough.',
    ),
    (
        'M96-s12b-sha-not-utf8',
        OUTBOX,
        '  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");',
        '  return createHash("sha256").update(Buffer.from(s, "latin1")).digest("hex");',
        OUTBOX_TESTS,
        'The stored hash must be of the exact UTF-8 bytes the operator uploads.',
    ),
    (
        'M97-s12b-slice-other-error-fails-open',
        STORECORE,
        '    bad(`${error.code ?? "?"} ${error.message ?? ""}`.trim());',
        '    return { kind: "absent", reason: "migration-not-applied" };',
        S12B_TESTS,
        'A timeout must never silently fall back to legacy (all-Insert) routing.',
    ),
    (
        'M98-s12b-slice-env-echo-unchecked',
        STORECORE,
        '  if (d.env !== env) bad(',
        '  if (false) bad(',
        S12B_TESTS,
        'A PREprod ledger must never route a production file.',
    ),
    (
        'M99-s12b-env-case-folded',
        STORECORE,
        '  return raw === "preprod" ? "preprod" : "prod";',
        '  return raw?.toLowerCase() === "preprod" ? "preprod" : "prod";',
        S12B_TESTS,
        'Only an exact "preprod" may target PREprod (no accidental env switch).',
    ),
    (
        'M100-s12b-verify-refusal-dropped',
        EXPROUTE,
        '    if (problems.length > 0) {\n      return refuse(',
        '    if (problems.length < 0) {\n      return refuse(',
        OUTBOX_TESTS,
        'A ledger self-check problem must refuse the download (409), not ship it.',
    ),
    (
        'M101-s12b-area-held-name-reinserted',
        BATCHSRV,
        '    if (held.has(name)) continue;',
        '    if (false && held.has(name)) continue;',
        S12B_TESTS,
        'E23: an Area name CCRS holds must never be Inserted again under a new id.',
    ),
    (
        'M102-s12b-file-contents-wiped-by-reset',
        RESETCORE,
        '{ table: "ccrs_file_contents", disposition: "KEEP",',
        '{ table: "ccrs_file_contents", disposition: "WIPE",',
        S12B_TESTS,
        'A factory reset must never delete the bytes we sent to the State.',
    ),
    (
        'M103-s12b-finalize-not-last',
        SEEDCLI,
        '  const chunks = [...seedInsertSql(seed.entities), fin];',
        '  const chunks = [fin, ...seedInsertSql(seed.entities)];',
        S12B_TESTS,
        'Finalize must run after every insert, or the ledger looks loaded while short.',
    ),
    (
        'M104-p11-not-production-names',
        P11GEN,
        '{ licenseNumber: license, now: at(3), lastStamp: at(2), chunkRows: 1 }',
        '{ licenseNumber: license, now: at(3), lastStamp: at(3), chunkRows: 1 }',
        P11_TESTS,
        'P-11 must upload exactly the names the production planner emits.',
    ),
    (
        'M105-p11-update-misses-chunk-2',
        P11GEN,
        'rows: [inv("L01", "Update"), inv("L02", "Update")]',
        'rows: [inv("L01", "Update")]',
        P11_TESTS,
        'P-11: the Update must name the chunk-2 lot, or it cannot prove chunk 2 was stored.',
    ),
    (
        'M106-p11-run-prefix-dropped',
        P11GEN,
        '    `${run}-${lot}`, BY, today,',
        '    `X-${lot}`, BY, today,',
        P11_TESTS,
        'Part 06 A.2: every PREprod id carries the run prefix.',
    ),
    (
        'M107-s12b-assign-keyset-unchecked',
        STORECORE,
        '  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {',
        '  if (false) {',
        S12B_TESTS,
        'D-01a: every product key asked for must come back with exactly one id.',
    ),
    (
        'M108-s12b-assign-id-shape-loosened',
        STORECORE,
        '  const idRe = env === "prod" ? /^GWP-[0-9]{6}$/ :',
        '  const idRe = env === "prod" ? /GWP-[0-9]+/ :',
        S12B_TESTS,
        'D-01a: a production Product id is exactly GWP-<6 digits>, no run prefix.',
    ),
    (
        'M109-s12b-unassigned-includes-other-withholds',
        BATCHSRV,
        '.filter(([, pp]) => pp.action === "withhold" && pp.reason === NO_PRODUCT_ID_REASON)',
        '.filter(([, pp]) => pp.action === "withhold")',
        S12B_TESTS,
        'Only products withheld for lack of an id may be offered for assignment.',
    ),
    (
        'M110-s12b-seed-file-not-one-transaction',
        SEEDCLI,
        '  return `begin;\\nset local statement_timeout = 0;\\n${chunks.join("\\n")}\\ncommit;\\n`;',
        '  return chunks.map((c) => `begin;\\n${c}\\ncommit;\\n`).join("");',
        S12B_TESTS,
        'A half-loaded seed would look like a partial ledger; the file must be atomic.',
    ),
    (
        'M111-s12b-seed-file-overwrites',
        SEEDCLI,
        '    if (existsSync(sqlFile)) { console.error(`REFUSED: ${sqlFile} already exists`); return 2; }',
        '',
        S12B_TESTS,
        'The seed writer must never silently overwrite an existing file.',
    ),
]


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=REPO, capture_output=True, text=True, timeout=300
    )


def vitest(target: str) -> subprocess.CompletedProcess:
    # NOTE: Vitest 4 removed the "basic" reporter; passing it makes vitest try
    # to import "basic" as a custom reporter module and exit non-zero BEFORE
    # running a single test. That would mark every mutation "killed" for the
    # wrong reason — a false green. "dot" is a real Vitest 4 reporter.
    res = run(["npx", "vitest", "run", target, "--reporter=dot"])
    # Guard against infrastructure failures masquerading as test failures.
    if "ERR_LOAD_URL" in res.stderr or "Failed to load url" in res.stderr:
        raise RuntimeError(
            f"vitest infrastructure error (not a test failure) for {target}:\n"
            f"{res.stderr[-1500:]}"
        )
    return res


def main() -> int:
    # 1. Baseline: everything must be GREEN before we start.
    print("=" * 66)
    print("BASELINE (all targets must be green before mutating)")
    print("=" * 66)
    baseline_targets = (
        STAMP_TESTS,
        SELF_TESTS,
        BATCH_TESTS,
        PREFLIGHT_TESTS,
        GENERATOR_TESTS,
        S10_TESTS,
        S09_TESTS,
        P04_TESTS,
        S11_TESTS,
        S12A_TESTS,
        OUTBOX_TESTS,
        CHUNK_TESTS,
        S12B_TESTS,
        P11_TESTS,
    )
    for target in baseline_targets:
        res = vitest(target)
        state = "PASS" if res.returncode == 0 else "FAIL"
        print(f"  [{state}] {target}")
        if res.returncode != 0:
            print("ABORT: baseline is not green; fix that first.")
            print(res.stdout[-3000:])
            return 1

    survived: list[str] = []
    killed: list[str] = []

    for mid, path, old, new, target, why in MUTATIONS:
        full = os.path.join(REPO, path)
        with open(full, "r", encoding="utf-8") as fh:
            original = fh.read()

        if original.count(old) != 1:
            print(f"\n[{mid}] ABORT: anchor not unique in {path} "
                  f"(found {original.count(old)}x). No guessing — fix anchor.")
            return 1

        try:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(original.replace(old, new, 1))

            res = vitest(target)
            out = res.stdout + res.stderr
            # A mutation counts as KILLED only if tests actually RAN and
            # reported failures. A non-zero exit with no "failed" tally means
            # the harness broke, not the code — that must not read as success.
            ran_and_failed = "failed" in out and "Tests " in out
            if res.returncode != 0 and ran_and_failed:
                killed.append(mid)
                verdict = "KILLED  (test went red — good)"
            elif res.returncode != 0:
                print(f"\n[{mid}] INCONCLUSIVE: vitest exited {res.returncode} "
                      f"without a test tally. Not counting as killed.")
                print(out[-2000:])
                return 1
            else:
                survived.append(mid)
                verdict = "SURVIVED (TEST HOLE!)"
            tally = ""
            for line in out.splitlines():
                if line.strip().startswith("Tests "):
                    tally = line.strip()
                    break
            print(f"\n[{mid}] {verdict}")
            print(f"    file : {path}")
            print(f"    test : {target}")
            print(f"    why  : {why}")
            if tally:
                print(f"    tally: {tally}")
        finally:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(original)

        # Prove the restore worked before moving on.
        with open(full, "r", encoding="utf-8") as fh:
            if fh.read() != original:
                print(f"[{mid}] FATAL: restore of {path} failed.")
                return 1

    print("\n" + "=" * 66)
    print(f"RESULT: {len(killed)} killed, {len(survived)} survived")
    print("=" * 66)
    if survived:
        for mid in survived:
            print(f"  SURVIVED: {mid}")
        return 1

    # Final proof: working tree is byte-identical to how we found it.
    res = run(["git", "diff", "--stat", CORE, GATE, PREFLIGHT, ADJCORE, GENERATOR])
    print("\nPost-run git diff vs index (S-01 edits only, no mutations):")
    print(res.stdout or "  (clean)")
    print("\nAll mutations killed. The tests can fail. ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
