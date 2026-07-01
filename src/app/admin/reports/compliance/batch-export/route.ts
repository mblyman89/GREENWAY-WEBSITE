/**
 * GET /admin/reports/compliance/batch-export?from=&to=
 *
 * Download the FULL CCRS retailer batch (Slice 54) as a single .zip containing
 * every required file in upload order: Strain, Area, Product, Inventory,
 * InventoryAdjustment, InventoryTransfer, Sale. Each file carries the correct
 * 3-row header + NumberRecords + template columns.
 *
 * Generating regulatory files requires the "Change settings" permission.
 */
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
import {
  assertCcrsBatchSubmittable,
  verdictSummary,
  type GateIssue,
} from "@/lib/compliance/ccrs-submit-gate-core";
import { buildZip } from "@/lib/reports/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requirePermission("reports.view");
  if (!can(session.profile.role, "settings.manage")) {
    return new Response("Generating the CCRS batch requires the Change settings permission.", { status: 403 });
  }

  const url = new URL(request.url);
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const batch = await buildCcrsBatch(range.fromISO, range.toISO);

  // Number the files by upload group so the folder sorts in the required order.
  const files = batch.files.map((f, i) => ({
    name: `${String(i + 1).padStart(2, "0")}_${f.fileName}`,
    content: f.csv,
  }));

  // Slice 94/95: verify the ASSEMBLED files are byte-correct offline, and merge
  // those findings with the builder sync issues. The dry-run catches structural
  // problems (bad header, NumberRecords mismatch, invalid enum, CRLF, dates).
  const verification = verifyCcrsBatch(
    batch.files.map((f) => ({ type: f.type, csv: f.csv })),
  );

  // Slice 105 — AUTHORITATIVE HARD GATE. Consolidate every problem source
  // (builder sync issues + offline verifier problems + per-file warnings, the
  // last classified with the SAME classifyWarning the app trusts) into one
  // verdict. If ANY blocking error exists, we REFUSE to emit the .zip — the
  // malformed CSVs never leave the building. This is the difference between
  // "we warned you" and "we protected you."
  const verdict = assertCcrsBatchSubmittable({
    syncIssues: batch.syncIssues.map((s) => ({
      severity: s.severity,
      file: String(s.file),
      message: s.message,
      count: s.count,
    })),
    verifierProblems: verification.problems.map((p) => ({
      severity: p.severity,
      file: String(p.file),
      message: p.message,
    })),
    files: batch.files.map((f) => ({ type: f.type, warnings: f.warnings, empty: f.empty })),
    classifyWarning,
  });

  const fmt = (i: GateIssue) => `  ${i.file}: ${i.message}${i.count ? ` (${i.count})` : ""}`;

  if (!verdict.submittable) {
    // 409 Conflict — the batch is not in a submittable state. Return a precise,
    // human-readable report of exactly what to fix. No CSVs are produced.
    const body = [
      "============================================================",
      `⛔ EXPORT REFUSED — ${verdict.errorCount} blocking CCRS error(s).`,
      "============================================================",
      "",
      "The CCRS batch was NOT generated because it would be rejected by the",
      "LCB (and could constitute a bad submission). Fix the items below in the",
      "app, then re-export. The malformed files were deliberately not created.",
      "",
      `License: ${batch.licenseNumber || "(not set)"}`,
      `Range: ${range.fromDate} to ${range.toDate}`,
      "",
      "BLOCKING ERRORS:",
      ...verdict.errors.map(fmt),
      "",
      verdict.warningCount ? `Advisory warnings (${verdict.warningCount}) — also worth reviewing:` : "No advisory warnings.",
      ...verdict.warnings.map(fmt),
      "",
    ].join("\r\n");
    return new Response(body, {
      status: 409,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const warnings = verdict.warnings;
  const gate = [
    "============================================================",
    `✅ ${verdictSummary(verdict)}`,
    "   (No blocking errors — the hard gate passed. Review any advisory",
    "   warnings below before uploading.)",
    "============================================================",
    "",
  ];

  // A README documenting the batch + upload order for the employee.
  const readme = [
    "CCRS batch — Greenway Marijuana",
    `Generated: ${batch.generatedAt}`,
    `License: ${batch.licenseNumber || "(not set)"}`,
    `Range: ${range.fromDate} to ${range.toDate}`,
    "",
    ...gate,
    "Upload these files at https://cannabisreporting.lcb.wa.gov/ (SAW login) in this order:",
    ...batch.files.map((f) => `  Group ${f.group}: ${f.fileName} — ${f.recordCount} records${f.empty ? " (empty)" : ""}`),
    "",
    "The LCB validates dependencies in order (Strain/Area/Product → Inventory → Adjustment/Transfer/Sale).",
    "On error the LCB emails you; review the sync report in the app before uploading.",
    "",
    warnings.length ? `Advisory warnings (${warnings.length}):` : "No advisory warnings.",
    ...warnings.map(fmt),
  ].join("\r\n");
  files.push({ name: "00_README.txt", content: readme + "\r\n" });

  const zip = buildZip(files, new Date(batch.generatedAt));
  const zipName = `CCRS_batch_${batch.licenseNumber || "LICENSE"}_${range.fromDate}_${range.toDate}.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Cache-Control": "no-store",
    },
  });
}
