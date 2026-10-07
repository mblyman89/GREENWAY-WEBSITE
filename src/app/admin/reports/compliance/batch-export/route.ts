/**
 * GET /admin/reports/compliance/batch-export?from=&to=[&env=preprod]
 *
 * Download the FULL CCRS retailer batch (Slice 54) as a single .zip in upload
 * order: Strain, Area, Product → Inventory → InventoryAdjustment, Sale.
 *
 * S-12b — the Transactional Outbox (Part 05 §A–C, §G–H):
 *   1. The builder routes every row against the ledger (ccrs_ledger_slice).
 *   2. The hard gate (Slice 105) refuses a batch with blocking errors.
 *   3. planOutboxFiles splits each file into chunks of 10,000 data rows and
 *      gives every chunk its OWN second (base, base+1 s, …), after every stamp
 *      already stored. Empty files are not emitted [FAQ L0049].
 *   4. verifyOutboxAgainstLedger re-reads the EXACT bytes: Insert ↔ absent,
 *      Update/Delete ↔ present, every Product/Strain/Area string held [FAQ
 *      L0052-L0053]. Any problem refuses the export (409).
 *   5. ccrs_emit_files stores bytes + rows + issues in ONE transaction BEFORE
 *      the zip is returned. Same bytes again → the stored file is returned
 *      under its stored name ("the same file name will not be accepted twice,
 *      nor the same data" [BRIAN A29]).
 * Steps 4–5 run only once the production seed is finalized (the ledger is
 * "loaded"); until then the export behaves as before S-12b, plus chunking.
 *
 * Zip entry names are the CCRS file names EXACTLY (UploadType_LicenseNumber_
 * YYYYMMDDHHMMSS [G L0046]). The stamps already sort in upload order.
 *
 * Generating regulatory files requires the "Change settings" permission.
 */
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
import {
  assertCcrsBatchSubmittable,
  verdictSummary,
  type GateIssue,
} from "@/lib/compliance/ccrs-submit-gate-core";
import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
import { emitOutboxFiles, readStoredFile } from "@/lib/compliance/ccrs-ledger-store";
import {
  emitPayload,
  planOutboxFiles,
  verifyOutboxAgainstLedger,
  outboxReadmeLines,
  type EmitIssue,
} from "@/lib/compliance/ccrs-outbox-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildZip } from "@/lib/reports/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A full batch reads ~4,200 lots and writes up to tens of thousands of rows in one transaction. */
export const maxDuration = 300;

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

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
  const env = parseLedgerEnv(url.searchParams.get("env"));

  const batch = await buildCcrsBatch(range.fromISO, range.toISO, { env });

  // Slice 94/95: verify the ASSEMBLED files are byte-correct offline.
  const verification = verifyCcrsBatch(batch.files.map((f) => ({ type: f.type, csv: f.csv })));

  // Slice 105 — AUTHORITATIVE HARD GATE.
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
  const refuse = (title: string, lines: string[]) =>
    new Response(
      [
        "============================================================",
        `⛔ EXPORT REFUSED — ${title}`,
        "============================================================",
        "",
        "The CCRS batch was NOT generated because it would be rejected by the",
        "LCB (and could constitute a bad submission). Fix the items below in the",
        "app, then re-export. The files were deliberately not created.",
        "",
        `License: ${batch.licenseNumber || "(not set)"}`,
        `Range: ${range.fromDate} to ${range.toDate}`,
        `Environment: ${env}`,
        "",
        ...lines,
        "",
      ].join("\r\n"),
      { status: 409, headers: TEXT },
    );

  if (!verdict.submittable) {
    return refuse(`${verdict.errorCount} blocking CCRS error(s).`, [
      "BLOCKING ERRORS:",
      ...verdict.errors.map(fmt),
      "",
      verdict.warningCount ? `Advisory warnings (${verdict.warningCount}) — also worth reviewing:` : "No advisory warnings.",
      ...verdict.warnings.map(fmt),
    ]);
  }

  // S-12b step 3: chunk + stamp the exact bytes.
  const planned = planOutboxFiles(
    batch.files.map((f) => ({ type: f.type, csv: f.csv })),
    {
      licenseNumber: batch.licenseNumber,
      now: new Date(batch.generatedAt),
      lastStamp: batch.ledger.lastStamp ? new Date(batch.ledger.lastStamp) : null,
    },
  );
  if (planned.length === 0) {
    return new Response(
      `Nothing to report for ${range.fromDate} to ${range.toDate}: every file is empty, and CCRS has no "no change" report [FAQ L0049].\r\n`,
      { status: 200, headers: TEXT },
    );
  }

  let zipFiles: { name: string; content: string }[] = planned.map((f) => ({ name: f.fileName, content: f.csv }));
  let outboxNote: string[];

  if (batch.ledger.view) {
    // S-12b step 4: ledger self-check on the exact bytes. Any problem refuses.
    const problems = verifyOutboxAgainstLedger(batch.ledger.view, planned);
    if (problems.length > 0) {
      return refuse(`${problems.length} row(s) disagree with what CCRS holds.`, [
        "LEDGER SELF-CHECK (Part 05 §D.4) — every row, no cap:",
        ...problems.map((p) => `  ${p.fileName} row ${p.row} [${p.code}]: ${p.message}`),
      ]);
    }

    // S-12b step 5: the outbox. Bytes, rows and issues are stored in one
    // transaction BEFORE the operator receives anything.
    const general: EmitIssue[] = batch.syncIssues
      .filter((s) => s.file === "General")
      .map((s) => ({ severity: s.severity, code: s.code ?? "GENERAL", message: s.message }));
    const issuesFor = (type: string): EmitIssue[] =>
      batch.syncIssues
        .filter((s) => s.file === type)
        .map((s) => ({ severity: s.severity, code: s.code ?? "BUILDER", message: s.message }));
    const payload = emitPayload(planned, (f) => issuesFor(f.type));
    const admin = createSupabaseAdminClient();
    const result = await emitOutboxFiles(admin, env, payload, general);

    // A duplicate is served from the STORED bytes under the STORED name.
    zipFiles = [];
    for (let i = 0; i < result.length; i += 1) {
      const r = result[i];
      if (r.status === "emitted") zipFiles.push({ name: r.file_name, content: payload[i].content });
      else zipFiles.push(await readStoredFile(admin, r.id).then((s) => ({ name: s.fileName, content: s.csv })));
    }
    const dupes = result.filter((r) => r.status === "duplicate");
    outboxNote = [
      `Recorded in the CCRS outbox (${env}): ${result.length - dupes.length} new file(s), ${dupes.length} already emitted.`,
      ...dupes.map((d) => `  ALREADY EMITTED (${d.state}): ${d.file_name} — same bytes as before; do NOT upload it again if CCRS already processed it.`),
    ];
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "ccrs.batch.emit",
      entityType: "ccrs_files",
      entityId: null,
      after: { env, range: [range.fromDate, range.toDate], files: result.map((r) => ({ id: r.id, name: r.file_name, status: r.status })) },
    });
  } else {
    const why =
      batch.ledger.absentReason === "migration-not-applied"
        ? "migration 0248 is not applied yet"
        : batch.ledger.absentReason === "seed-not-finalized"
          ? `the ${env} ledger seed is not finalized yet`
          : "the ledger is unavailable";
    outboxNote = [
      `NOT recorded in the CCRS outbox: ${why}. Rows were routed as before S-12b`,
      "(every row Insert, our ids). Do not upload a production batch until the seed is finalized.",
    ];
  }

  const gate = [
    "============================================================",
    `✅ ${verdictSummary(verdict)}`,
    "   (No blocking errors — the hard gate passed. Review any advisory",
    "   warnings below before uploading.)",
    "============================================================",
    "",
  ];
  const warnings = verdict.warnings;
  const readme = [
    "CCRS batch — Greenway Marijuana",
    `Generated: ${batch.generatedAt}`,
    `License: ${batch.licenseNumber || "(not set)"}`,
    `Range: ${range.fromDate} to ${range.toDate}`,
    `Environment: ${env}`,
    "",
    ...gate,
    ...outboxNote,
    "",
    ...outboxReadmeLines(planned, zipFiles.map((z) => z.name)),
    "",
    "Do not rename any file and do not open and save it in Excel: CCRS matches its emails by exact file name,",
    "and refuses the same file name or the same data twice [BRIAN A29].",
    "",
    warnings.length ? `Advisory warnings (${warnings.length}):` : "No advisory warnings.",
    ...warnings.map(fmt),
  ].join("\r\n");
  zipFiles.push({ name: "00_README.txt", content: readme + "\r\n" });

  const zip = buildZip(zipFiles, new Date(batch.generatedAt));
  const zipName = `CCRS_batch_${batch.licenseNumber || "LICENSE"}_${env}_${range.fromDate}_${range.toDate}.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Cache-Control": "no-store",
    },
  });
}
