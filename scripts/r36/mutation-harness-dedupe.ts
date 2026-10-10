/**
 * R36 #2 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the duplicate-manifest fix: the delivery key, the claim decision, the HTTP
 * answer, the error classifiers, the twin finder, the dismiss pre-check, the
 * webhook wiring (claim before the slow work, completes the same row,
 * releases on crash, maxDuration), the store claim (insert-first, safe
 * fallback, conditional take-over), the duplicate-path document hand-off,
 * the oldest-twin rule and the dismissed/rejected table filters. Its kill
 * command must then FAIL. A CONTROL pass first proves the kill command is
 * green on clean code. Every anchor must be found exactly once and every file
 * is restored in `finally`. (The SQL side has its own 18-mutant harness:
 * scripts/r36/mutate-dismiss-sql.sh.)
 *
 *   npx tsx scripts/r36/mutation-harness-dedupe.ts
 *   R36_ONLY=<substring> npx tsx scripts/r36/mutation-harness-dedupe.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const VT = "npx vitest run tests/compliance/r36-inbound-dedupe.test.ts";
const CORE = "src/lib/inventory/inbound-dedupe-core.ts";
const DEDUPE = "src/lib/inventory/manifest-dedupe-core.ts";
const ROUTE = "src/app/api/webhooks/inbound-email/route.ts";
const STORE = "src/lib/inbound-email/inbound-store.ts";
const TABLE = "src/lib/inventory/manifest-table-core.ts";
const PIPE = "src/lib/inventory/manifest-pipeline-core.ts";
const ACT = "src/app/admin/inventory/intake/actions.ts";

const MUTANTS: Mutant[] = [
  // --- delivery key ---
  { name: "key: svix preferred over email_id", file: CORE, old: "  const emailId = cleanPart(input.emailId);\n  if (emailId) return `resend:email:${emailId}`;\n  const svixId = cleanPart(input.svixId);\n  if (svixId) return `svix:${svixId}`;", neu: "  const svixId = cleanPart(input.svixId);\n  if (svixId) return `svix:${svixId}`;\n  const emailId = cleanPart(input.emailId);\n  if (emailId) return `resend:email:${emailId}`;", cmd: VT },
  { name: "key: no length cap", file: CORE, old: "if (!t || t.length > MAX_KEY_PART) return null;", neu: "if (!t) return null;", cmd: VT },
  { name: "key: no charset guard", file: CORE, old: "if (!/^[\\x21-\\x7e]+$/.test(t)) return null;", neu: "", cmd: VT },
  { name: "key: one namespace", file: CORE, old: "if (svixId) return `svix:${svixId}`;", neu: "if (svixId) return `resend:email:${svixId}`;", cmd: VT },
  // --- claim decision ---
  { name: "claim: final disposition not done", file: CORE, old: 'if (disp && disp !== "received") return { kind: "done" };', neu: 'if (disp === "staged") return { kind: "done" };', cmd: VT },
  { name: "claim: stale boundary > instead of >=", file: CORE, old: "return ageMs >= staleMs ?", neu: "return ageMs > staleMs ?", cmd: VT },
  { name: "claim: undatable claim blocks forever", file: CORE, old: 'if (!Number.isFinite(t)) return { kind: "take_over", ageMs: Number.POSITIVE_INFINITY };', neu: 'if (!Number.isFinite(t)) return { kind: "in_flight", ageMs: 0 };', cmd: VT },
  { name: "claim: negative age allowed", file: CORE, old: "const ageMs = Math.max(0, now.getTime() - t);", neu: "const ageMs = now.getTime() - t;", cmd: VT },
  { name: "claim: stale window 4 min (< maxDuration)", file: CORE, old: "export const CLAIM_STALE_MS = 6 * 60 * 1000;", neu: "export const CLAIM_STALE_MS = 4 * 60 * 1000;", cmd: VT },
  { name: "claim: in-flight answered 200 (Svix stops retrying)", file: CORE, old: "    status: 409,", neu: "    status: 200,", cmd: VT },
  // --- classifiers ---
  { name: "classifier: any 23505 is ours", file: CORE, old: "  return t.includes(index) || t.includes(`(${column})=`);", neu: "  return true;", cmd: VT },
  { name: "classifier: code not checked", file: CORE, old: '  if (String(e.code ?? "") !== "23505") return false;\n  const t = errText(e);', neu: "  const t = errText(e);", cmd: VT },
  { name: "dismiss msg: missing fn not named", file: CORE, old: 'if (code === "PGRST202" || code === "42883" ||', neu: 'if (code === "PGRST202" ||', cmd: VT },
  // --- twins / dismiss check ---
  // (Removing the explicit "dismissed" skip is an EQUIVALENT mutant - a
  // dismissed row is neither live nor dismissable, so it can never be offered
  // or kept; measured R36: it survives for that reason. The skip stays as
  // defence in depth. Replaced by a mutant that changes behaviour:)
  { name: "twins: rows with no manifest # grouped", file: CORE, old: "    const k = groupKey(r);\n    if (!k) continue;\n    const g = groups.get(k);", neu: "    const k = groupKey(r) ?? \"\";\n    const g = groups.get(k);", cmd: VT },
  { name: "twins: keep may be itself", file: CORE, old: "const keep = live.find((l) => l.id !== r.id);", neu: "const keep = live[0];", cmd: VT },
  { name: "twins: keep newest, not oldest", file: CORE, old: ".filter((r) => isBlockingStatus(r.status)).sort(compareOldestFirst);", neu: ".filter((r) => isBlockingStatus(r.status)).sort((a, b) => compareOldestFirst(b, a));", cmd: VT },
  { name: "dismissable: accepted allowed", file: CORE, old: 'export const DISMISSABLE_STATUSES = ["pending", "in_transit", "received", "rejected"] as const;', neu: 'export const DISMISSABLE_STATUSES = ["pending", "in_transit", "received", "rejected", "accepted"] as const;', cmd: VT },
  { name: "check: identity not compared", file: CORE, old: "  if (!a || !b || a !== b) {", neu: "  if (false) {", cmd: VT },
  { name: "check: keep liveness not checked", file: CORE, old: "  if (!isBlockingStatus(keep.status)) {", neu: "  if (false) {", cmd: VT },
  { name: "describe: invoice carry not reported", file: CORE, old: 'if (r.invoice_carried) parts.push("invoice # moved to the kept manifest");', neu: "", cmd: VT },
  // --- staging dedupe ---
  { name: "dedupe: first-listed twin, not oldest", file: DEDUPE, old: "    if (!best || compareOldestFirst(row, best) < 0) best = row;", neu: "    if (!best) best = row;", cmd: VT },
  { name: "dedupe: received not blocking", file: DEDUPE, old: '  "in_transit",\n  "received",\n  "accepted",', neu: '  "in_transit",\n  "accepted",', cmd: VT },
  // --- webhook wiring ---
  { name: "route: no maxDuration", file: ROUTE, old: "export const maxDuration = 300;", neu: "", cmd: VT },
  { name: "route: claim after the slow fetch", file: ROUTE, old: "    const claim = await claimInboundDelivery({ provider: \"resend\", key });\n    if (claim.kind === \"duplicate\") {\n      const res = claimResponse(claim.decision);\n      return NextResponse.json(res.body, { status: res.status });\n    }\n    const logId = claim.kind === \"claimed\" ? claim.logId : null;\n    try {\n      const enriched = await enrichResendInbound(raw);", neu: "    const enriched = await enrichResendInbound(raw);\n    const claim = await claimInboundDelivery({ provider: \"resend\", key });\n    if (claim.kind === \"duplicate\") {\n      const res = claimResponse(claim.decision);\n      return NextResponse.json(res.body, { status: res.status });\n    }\n    const logId = claim.kind === \"claimed\" ? claim.logId : null;\n    try {", cmd: VT },
  { name: "route: svix-id not used", file: ROUTE, old: "deliveryKey({ emailId: extractEmailIdFromWebhook(raw), svixId })", neu: "deliveryKey({ emailId: extractEmailIdFromWebhook(raw) })", cmd: VT },
  { name: "route: no release on crash", file: ROUTE, old: "      if (logId) await releaseInboundDelivery(logId);\n", neu: "", cmd: VT },
  { name: "route: intake log not completing the claim", file: ROUTE, old: "    manifestId: staged.manifestIds[0] ?? null,\n    logId,", neu: "    manifestId: staged.manifestIds[0] ?? null,", cmd: VT },
  // --- store claim ---
  { name: "store: claim not insert-first", file: STORE, old: '        disposition: "received",\n        delivery_key: params.key,', neu: '        disposition: "staged",\n        delivery_key: params.key,', cmd: VT },
  { name: "store: missing column not tolerated", file: STORE, old: "    if (ins.error && isMissingColumnError(ins.error)) {", neu: "    if (false) {", cmd: VT },
  { name: "store: take-over not conditional", file: STORE, old: 'q = holder.claimed_at === null ? q.is("claimed_at", null) : q.eq("claimed_at", holder.claimed_at);', neu: "", cmd: VT },
  { name: "store: logId ignored (second row)", file: STORE, old: "    if (params.logId) {", neu: "    if (false) {", cmd: VT },
  { name: "store: duplicate JSON path keeps docs", file: STORE, old: "        await archiveDocsToExistingIfNone(staged.existingManifestId, email.attachments);\n      }\n      console.warn(\"[inbound-email] duplicate manifest skipped:\"", neu: "      }\n      console.warn(\"[inbound-email] duplicate manifest skipped:\"", cmd: VT },
  { name: "store: archive onto a row that has docs", file: STORE, old: "if (meta === null || meta.length > 0 || attachments.length === 0) return 0;", neu: "if (meta === null || attachments.length === 0) return 0;", cmd: VT },
  // --- table / pipeline ---
  { name: "table: dismissed shown in All", file: TABLE, old: "  const real = rows.filter((r) => !isDismissedManifest(r.status));", neu: "  const real = rows.slice();", cmd: VT },
  { name: "table: rejected stays in Needs attention", file: TABLE, old: 'return stage === "accepted" || stage === "partially_accepted" || stage === "rejected";', neu: 'return stage === "accepted" || stage === "partially_accepted";', cmd: VT },
  { name: "table: partial stays in Needs attention", file: TABLE, old: 'return stage === "accepted" || stage === "partially_accepted" || stage === "rejected";', neu: 'return stage === "accepted" || stage === "rejected";', cmd: VT },
  { name: "table: dismissed counted as hidden", file: TABLE, old: "(n, r) => n + (isProcessedManifest(r.status) && !isDismissedManifest(r.status) ? 1 : 0),", neu: "(n, r) => n + (isProcessedManifest(r.status) || isDismissedManifest(r.status) ? 1 : 0),", cmd: VT },
  { name: "pipeline: dismissed folded into pending", file: PIPE, old: '  // real manifests; kept (not deleted) for the audit trail.\n  "dismissed",\n', neu: "  // real manifests; kept (not deleted) for the audit trail.\n", cmd: VT },
  { name: "actions: scan still includes dismissed", file: ACT, old: '.not("status", "in", "(rejected,dismissed)")', neu: '.neq("status", "rejected")', cmd: VT },
];

function run(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 300_000 });
    return true;
  } catch {
    return false;
  }
}

const only = process.env.R36_ONLY;
const list = only ? MUTANTS.filter((m) => m.name.includes(only)) : MUTANTS;

for (const m of list) {
  const src = readFileSync(m.file, "utf8");
  const n = src.split(m.old).length - 1;
  if (n !== 1) {
    console.error(`ANCHOR ${n}x (need 1): ${m.name}`);
    process.exit(2);
  }
}
for (const cmd of [...new Set(list.map((m) => m.cmd))]) {
  if (!run(cmd)) {
    console.error(`CONTROL FAILED (clean code is red): ${cmd}`);
    process.exit(2);
  }
}
console.log(`CONTROL ok on ${new Set(list.map((m) => m.cmd)).size} kill commands`);

let killed = 0;
const survivors: string[] = [];
for (const m of list) {
  const orig = readFileSync(m.file, "utf8");
  try {
    writeFileSync(m.file, orig.replace(m.old, m.neu));
    if (run(m.cmd)) {
      survivors.push(m.name);
      console.log(`SURVIVED  ${m.name}`);
    } else {
      killed += 1;
      console.log(`killed    ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, orig);
  }
}
console.log(`\nR36 #2 mutants: ${killed}/${list.length} killed`);
if (survivors.length) {
  console.log("SURVIVORS:\n  " + survivors.join("\n  "));
  process.exit(1);
}
