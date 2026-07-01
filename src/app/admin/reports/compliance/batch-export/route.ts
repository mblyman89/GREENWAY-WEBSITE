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
import { verifyCcrsBatch } from "@/lib/compliance/ccrs-batch-core";
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

  // Combine builder sync issues + verifier problems; split by severity so blocking
  // errors are impossible to miss.
  type Issue = { severity: "error" | "warning"; file: string; message: string; count?: number };
  const allIssues: Issue[] = [
    ...batch.syncIssues.map((s) => ({ severity: s.severity, file: String(s.file), message: s.message, count: s.count })),
    ...verification.problems.map((p) => ({ severity: p.severity, file: String(p.file), message: p.message })),
  ];
  // De-duplicate identical (severity+file+message) lines.
  const seen = new Set<string>();
  const issues = allIssues.filter((i) => {
    const k = `${i.severity}|${i.file}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const fmt = (i: Issue) => `  ${i.file}: ${i.message}${i.count ? ` (${i.count})` : ""}`;

  // Slice 95: a prominent DO-NOT-UPLOAD gate when any blocking error exists.
  const gate = errors.length
    ? [
        "============================================================",
        `⛔ DO NOT UPLOAD — ${errors.length} blocking error(s) must be fixed first.`,
        "   The LCB will reject the batch (and every dependent file) until",
        "   these are resolved. Fix the mapping/data in the app, then re-export.",
        "============================================================",
        "",
        "BLOCKING ERRORS:",
        ...errors.map(fmt),
        "",
      ]
    : [
        "============================================================",
        "✅ SAFE TO UPLOAD — no blocking errors detected in this batch.",
        "   (Still review any advisory warnings below.)",
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
