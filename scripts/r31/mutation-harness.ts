/**
 * R31 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the R31 logic (one-button finalize: receive-on-finalize, receipt order and
 * exclusions, the self-naming Finalize label, the AI-extract advice, the
 * product-identity line chips, the de-cluttered page). The test command must
 * then FAIL. A survivor is a hole in the tests. Every file is restored in
 * `finally`. A CONTROL pass first proves the command is green on clean code,
 * and every anchor must be found exactly once.
 *
 *   npx tsx scripts/r31/mutation-harness.ts
 *   R31_ONLY=<substring> npx tsx scripts/r31/mutation-harness.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const R31 =
  "npx vitest run tests/compliance/r31-manifest-review-walk.test.tsx tests/compliance/intake-checklist-core.test.ts tests/compliance/guided-accept.test.ts";

const ACT = "src/app/admin/inventory/intake/actions.ts";
const RCPT = "src/lib/accounting/receipt-service.ts";
const LABEL = "src/lib/inventory/finalize-label-core.ts";
const ADV = "src/lib/inventory/ai-extract-advice-core.ts";
const CHIP = "src/lib/inventory/line-identity-chip-core.ts";
const CHECK = "src/lib/inventory/intake-checklist-core.ts";
const PAGE = "src/app/admin/inventory/intake/[id]/page.tsx";
const DISPO = "src/components/admin/inventory/ManifestLotDisposition.tsx";

const MUTANTS: Mutant[] = [
  // --- actions.ts: receive-on-finalize ---
  {
    name: "action: finalize no longer marks the delivery received",
    file: ACT,
    old: "  await markArrivedOnFinalize(manifestId, session.userId);\n",
    neu: "",
    cmd: R31,
  },
  {
    name: "action: an already-received delivery is re-stamped (received_at moves)",
    file: ACT,
    old: "  if (!m || !shouldMarkArrivedOnFinalize(m.status)) return;",
    neu: "  if (!m) return;",
    cmd: R31,
  },
  {
    name: "action: receipt posted even when the ledger already has one",
    file: ACT,
    old: '    if (evidence.kind === "raised") return "";',
    neu: "",
    cmd: R31,
  },
  {
    name: "action: receipt posted for a wholly rejected delivery",
    file: ACT,
    old: '  if (acceptedCount <= 0) return "";',
    neu: "",
    cmd: R31,
  },
  {
    name: "action: held lots not counted as received goods",
    file: ACT,
    old: "    result.activated + result.blocked.length,",
    neu: "    result.activated,",
    cmd: R31,
  },
  {
    name: "action: receipt refusal swallowed",
    file: ACT,
    old: '  if (receiptNote && !booksNote.startsWith("&booksError=")) booksNote = receiptNote;',
    neu: "",
    cmd: R31,
  },
  {
    name: "action: receipt refusal overwrites the bill refusal",
    file: ACT,
    old: '  if (receiptNote && !booksNote.startsWith("&booksError=")) booksNote = receiptNote;',
    neu: "  if (receiptNote) booksNote = receiptNote;",
    cmd: R31,
  },
  {
    name: "action: refused receipt returns no booksError",
    file: ACT,
    old: '    return booked.ok ? "" : `&booksError=${encodeURIComponent(booked.message.slice(0, 300))}`;',
    neu: '    return "";',
    cmd: R31,
  },
  {
    name: "action: receipt outcome not written to the timeline",
    file: ACT,
    old: "    const ev = receiptEventFor(booked);\n    await logManifestEvent(manifestId, ev.eventType, ev.note, userId);",
    neu: "",
    cmd: R31,
  },
  // --- receipt-service: exclusions ---
  {
    name: "receipt: dock-refused lots are capitalised",
    file: RCPT,
    old: 'export const RECEIPT_EXCLUDED_LOT_STATUSES = new Set(["rejected"]);',
    neu: "export const RECEIPT_EXCLUDED_LOT_STATUSES = new Set<string>([]);",
    cmd: R31,
  },
  {
    name: "receipt: receivableLots bypassed",
    file: RCPT,
    old: "  const lots = receivableLots((lotRows ?? []) as (ManifestLotRow & { status?: string | null })[]);",
    neu: "  const lots = ((lotRows ?? []) as (ManifestLotRow & { status?: string | null })[]);",
    cmd: R31,
  },
  // --- finalize-label-core ---
  {
    name: "label: undecided lines treated as rejected",
    file: LABEL,
    old: '    if (l.disposition === "rejected_at_dock") {',
    neu: '    if (l.disposition !== "accepted") {',
    cmd: R31,
  },
  {
    name: "label: mixed label drops the counts",
    file: LABEL,
    old: "  else label = `Accept ${accept} \u00b7 Reject ${reject} & Finalize`;",
    neu: '  else label = "Finalize";',
    cmd: R31,
  },
  {
    name: "label: all-accept wording changed",
    file: LABEL,
    old: '  else if (reject === 0) label = total === 1 ? "Accept & Finalize" : "Accept All & Finalize";',
    neu: '  else if (reject === 0) label = "Finalize intake";',
    cmd: R31,
  },
  {
    name: "label: in_transit not stamped received",
    file: LABEL,
    old: '  return status === "pending" || status === "in_transit";',
    neu: '  return status === "pending";',
    cmd: R31,
  },
  // --- ai-extract-advice-core ---
  {
    name: "advice: COA PDFs counted as readable",
    file: ADV,
    old: '  const readable = pdfs.filter((d) => d.role !== "coa")',
    neu: "  const readable = pdfs.filter(() => true)",
    cmd: R31,
  },
  {
    name: "advice: button shown with nothing to read",
    file: ADV,
    old: "      detail:\n        \"No PDF is archived for this delivery, so the AI has nothing to read. Everything on this page came from the transfer file. Type any missing transport details into the form below.\",\n      reads,\n      skips,\n      have,\n      missing,\n      showButton: false,",
    neu: "      detail:\n        \"No PDF is archived for this delivery, so the AI has nothing to read. Everything on this page came from the transfer file. Type any missing transport details into the form below.\",\n      reads,\n      skips,\n      have,\n      missing,\n      showButton: true,",
    cmd: R31,
  },
  {
    name: "advice: route notes count as a key missing field",
    file: ADV,
    old: "      if (!OPTIONAL_FIELDS.has(f)) missingKey += 1;",
    neu: "      missingKey += 1;",
    cmd: R31,
  },
  // --- line-identity-chip-core ---
  {
    name: "chips: two live cards auto-pick the first",
    file: CHIP,
    old: "    if (cards.length === 1) {",
    neu: "    if (cards.length >= 1) {",
    cmd: R31,
  },
  {
    name: "chips: on-menu check ignored",
    file: CHIP,
    old: "    if (key && f.publishedKeys.has(key)) {",
    neu: "    if (false) {",
    cmd: R31,
  },
  // --- checklist ---
  {
    name: "checklist: retry anchor dropped",
    file: CHECK,
    old: '    anchor: kbPromoted || !(finished && !rejectedWhole) ? null : "#manifest-kb",',
    neu: "    anchor: null,",
    cmd: R31,
  },
  // --- page ---
  {
    name: "page: Mark received button returns",
    file: PAGE,
    old: "          {/* R31: no Mark in transit / Mark received buttons.",
    neu: "          <form><Button type=\"submit\">📦 Mark received</Button></form>\n          {/* R31: no Mark in transit / Mark received buttons.",
    cmd: R31,
  },
  {
    name: "page: Finalize button back to a fixed label",
    file: PAGE,
    old: "                  ✓ {finalizePlan.label}",
    neu: "                  ✓ Finalize intake",
    cmd: R31,
  },
  {
    name: "page: Promote to KB always shown",
    file: PAGE,
    old: "        {kbRetryNeeded && (",
    neu: "        {true && (",
    cmd: R31,
  },
  {
    name: "page: AI button shown regardless of advice",
    file: PAGE,
    old: "            {aiAdvice.showButton && (",
    neu: "            {true && (",
    cmd: R31,
  },
  {
    name: "page: advice fed the vendor-suggested defaults",
    file: PAGE,
    old: "      transporter_name: manifest.transporter_name,",
    neu: "      transporter_name: originNameDefault,",
    cmd: R31,
  },
  {
    name: "page: planner loses the lab gate (no held prediction)",
    file: PAGE,
    old: "        hasLabResult: l.lab_result_id != null,\n        labPassed: l.lab_result_id ? (labFacts.get(l.lab_result_id)?.passed ?? null) : null,\n      },\n    })),\n  );\n  const hasRefusedLine",
    neu: "        hasLabResult: true,\n        labPassed: true,\n      },\n    })),\n  );\n  const hasRefusedLine",
    cmd: R31,
  },
  {
    name: "page: note requirement decoupled from the planner",
    file: PAGE,
    old: "  const hasRefusedLine = finalizePlan.noteRequired;",
    neu: "  const hasRefusedLine = false;",
    cmd: R31,
  },
  // --- per-line control ---
  {
    name: "dispo: Will accept chip removed",
    file: DISPO,
    old: "        Will accept\n",
    neu: "        \n",
    cmd: R31,
  },
];

// Optional: R31_ONLY=<substring> runs just the matching mutants.
const ONLY = process.env.R31_ONLY;
if (ONLY) MUTANTS.splice(0, MUTANTS.length, ...MUTANTS.filter((m) => m.name.includes(ONLY)));

// Every anchor must exist exactly once BEFORE anything runs.
for (const m of MUTANTS) {
  const n = readFileSync(m.file, "utf8").split(m.old).length - 1;
  if (n !== 1) {
    console.error(`HARNESS ERROR (${m.name}): anchor found ${n}x in ${m.file}`);
    process.exit(2);
  }
}

// CONTROL: every command must PASS on the unmutated code.
for (const cmd of [...new Set(MUTANTS.map((m) => m.cmd))]) {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 600_000 });
    console.log(`CONTROL ok   ${cmd.slice(0, 90)}`);
  } catch (e) {
    console.error(`CONTROL FAILED (clean code must pass): ${cmd}\n${String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 800)}`);
    process.exit(2);
  }
}

let killed = 0;
const survivors: string[] = [];
for (const m of MUTANTS) {
  const original = readFileSync(m.file, "utf8");
  try {
    writeFileSync(m.file, original.replace(m.old, m.neu));
    let failed = false;
    try {
      execSync(m.cmd, { stdio: "pipe", timeout: 600_000 });
    } catch {
      failed = true;
    }
    if (failed) {
      killed += 1;
      console.log(`KILLED   ${m.name}`);
    } else {
      survivors.push(m.name);
      console.log(`SURVIVED ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, original);
  }
}
console.log(`\n${killed}/${MUTANTS.length} mutants killed`);
if (survivors.length) {
  console.log("Survivors:\n - " + survivors.join("\n - "));
  process.exit(1);
}
