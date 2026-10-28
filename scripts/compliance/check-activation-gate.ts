/**
 * scripts/compliance/check-activation-gate.ts
 *
 * S-11 grep-guard (GAP M-8): every code path that flips an inventory lot to
 * status "active" MUST go through the lot-activation compliance gate
 * (evaluateLotBatchActivation — CCRS identifier + COA on record + passing lab
 * result) or be an explicitly reviewed non-intake release.
 *
 * The legacy acceptManifest/acceptManifestAction (which activated every
 * quarantined lot with NO gate) were deleted in S-11. This script fails when:
 *   1. any identifier named acceptManifest reappears anywhere in src/, or
 *   2. a `status: "active"` write against inventory_lots appears in a file
 *      that is NOT on the reviewed allow-list below.
 *
 * ALLOW-LIST (reviewed):
 *   • src/lib/inventory/intake-store.ts — finalizeManifestDispositions: the
 *     ONLY intake activation path; every accepted lot is evaluated against
 *     evaluateLotBatchActivation and dirty lots are HELD in quarantine.
 *   • src/lib/inventory/disposition.ts — restoreLotAfterEventCloses (an owner
 *     cancel or a partial destruction, Phase 1.3 G-28): puts a lot back from
 *     destruction-quarantine to active ONLY when the event recorded that it
 *     was Active (gate-passed) before scheduling, compare-and-set on
 *     quarantine; this is an un-quarantine, not an intake activation.
 *
 * Step 6 (Fix Phase 1.4, G-44): units held for a customer-return destruction
 * are never sellable (sale lot read, both planners, POS menu, sellability
 * report), never taken by another reduction, and the return is one transaction.
 *
 * Run: npx tsx scripts/compliance/check-activation-gate.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

function fail(msg: string): never {
  console.error(`ACTIVATION-GATE GUARD FAIL: ${msg}`);
  process.exit(1);
}

function grep(args: string[]): string[] {
  try {
    const out = execFileSync("grep", args, { cwd: root, encoding: "utf-8" });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    // grep exits 1 when nothing matches — that's success for us.
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return [];
    throw e;
  }
}

// 1. The retired ungated helpers must never come back as live identifiers.
//    (Comments explaining the retirement are fine — we flag declarations/calls.)
const acceptManifestHits = grep([
  "-rnE",
  "(function|const|=>)\\s*acceptManifest\\b|acceptManifest\\s*\\(",
  "src",
  "--include=*.ts",
  "--include=*.tsx",
]).filter((line) => {
  // grep output: file:lineno:content — ignore comment-only lines (the
  // retirement notes legitimately mention the old name).
  const content = line.split(":").slice(2).join(":").trimStart();
  return !content.startsWith("//") && !content.startsWith("*") && !content.startsWith("/*");
});
if (acceptManifestHits.length > 0) {
  fail(
    `retired ungated helper 'acceptManifest' has reappeared:\n  ${acceptManifestHits.join("\n  ")}`,
  );
}

// 2. Every `status: "active"` write on inventory lots must be in an allowed file.
// Fix Phase 1.1: this guard was red on main and no test ran it. The three
// files below were found by it and reviewed (each reason pinned):
//   • void-store.ts — the pre-0129 FALLBACK of applyLotDelta when a void
//     restocks a lot that had sold out (sold_out -> active). The lot already
//     passed the gate and was on sale; the 0129 RPC flips it the same way.
//   • import-service.ts — SLICE 46: the ONE-TIME Cultivera migration import
//     (file header: "A MIGRATION TOOL, NOT THE PRODUCT PIPELINE"); the lots it
//     creates were already on sale under Cultivera.
//   • inventory-audit-store.ts — a self-test fixture passed to assessLine,
//     not a database write.
const ALLOWED_FILES = new Set([
  "src/lib/inventory/intake-store.ts",
  "src/lib/inventory/disposition.ts",
  "src/lib/pos/void-store.ts",
  "src/lib/pos/import-service.ts",
  "src/lib/inventory/inventory-audit-store.ts",
]);
const activeWrites = grep([
  "-rn",
  'status: "active"',
  "src",
  "--include=*.ts",
  "--include=*.tsx",
]).filter((line) => {
  // Only lot-table writes matter: other tables (medical authorizations,
  // non-cannabis items, …) legitimately use an "active" status. A file is in
  // scope when it touches the inventory_lots table at all.
  const file = line.split(":")[0];
  try {
    return readFileSync(resolve(root, file), "utf-8").includes('from("inventory_lots")');
  } catch {
    return true; // unreadable ⇒ be conservative, flag it
  }
});
const offenders = activeWrites
  .map((line) => line.split(":")[0])
  .filter((file) => !ALLOWED_FILES.has(file));
if (offenders.length > 0) {
  fail(
    `lot activation ('status: "active"') found OUTSIDE the reviewed allow-list — route it through ` +
      `evaluateLotBatchActivation (finalizeManifestDispositions) or add it to the allow-list after review:\n  ` +
      [...new Set(offenders)].join("\n  "),
  );
}

// 3. The one intake activation site must still be gate-protected: the file
//    must call evaluateLotBatchActivation.
const intakeStore = readFileSync(resolve(root, "src/lib/inventory/intake-store.ts"), "utf-8");
if (!intakeStore.includes("evaluateLotBatchActivation")) {
  fail("intake-store.ts no longer references evaluateLotBatchActivation — the activation gate is gone");
}

// 4. Fix Phase 1.1 (G-19 req 3, G-22 req 6): EVERY write of a `status` key to
//    inventory_lots — literal or not — is checked. A non-literal value
//    (shorthand `status`, `status: someVar`) can be "active" or "destroyed" at
//    run time, which the grep in step 2 cannot see. Each such write must be in
//    the reviewed table below, with the reason it is safe.
//      • store.ts updateLotStatus: the ONLY non-literal writer. Its caller,
//        setLotStatusAction, runs evaluateLotLifecycleChange (go-live check on
//        Active, never Destroyed) and the function itself refuses any value
//        outside MANUAL_LOT_STATUSES.
//    And `"destroyed"` may only be written by disposition.ts completeDestruction,
//    after it has recorded the destruction event (the disposition record).
const REVIEWED_NONLITERAL: Record<string, string> = {
  "src/lib/inventory/store.ts": "updateLotStatus (gated by lot-lifecycle-core)",
};
const DESTROYED_WRITERS = new Set(["src/lib/inventory/disposition.ts"]);
function lotStatusWrites(): { file: string; line: number; value: string | null }[] {
  const files = grep(["-rl", 'from("inventory_lots")', "src", "--include=*.ts", "--include=*.tsx"]);
  const out: { file: string; line: number; value: string | null }[] = [];
  for (const file of files) {
    const s = readFileSync(resolve(root, file), "utf-8");
    const re = /\.(update|insert|upsert)\(\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const before = s.slice(0, m.index);
      const fm = [...before.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)].pop();
      if (!fm || fm[1] !== "inventory_lots") continue;
      let i = m.index + m[0].length;
      let depth = 0;
      const start = i;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === "(" || c === "{" || c === "[") depth++;
        else if (c === ")" || c === "}" || c === "]") {
          if (depth === 0) break;
          depth--;
        }
      }
      const arg = s.slice(start, i);
      const st = arg.match(/(?:^|[{,\s])status\s*(?::\s*([^,}\n]+))?\s*[,}\n]/);
      if (!st) continue;
      const raw = st[1]?.trim() ?? null;
      const lit = raw && /^"[a-z_]+"$/.test(raw) ? raw.slice(1, -1) : null;
      out.push({ file, line: before.split("\n").length, value: lit });
    }
  }
  return out;
}
const statusWrites = lotStatusWrites();
const nonLiteral = statusWrites.filter((w) => w.value === null && !(w.file in REVIEWED_NONLITERAL));
if (nonLiteral.length > 0) {
  fail(
    `non-literal lot status write found outside the reviewed list — it could write "active" or "destroyed" with no gate:\n  ` +
      nonLiteral.map((w) => `${w.file}:${w.line}`).join("\n  "),
  );
}
const destroyedOutside = statusWrites.filter((w) => w.value === "destroyed" && !DESTROYED_WRITERS.has(w.file));
if (destroyedOutside.length > 0) {
  fail(
    `lot status "destroyed" written outside Returns & Destruction (no disposition record):\n  ` +
      destroyedOutside.map((w) => `${w.file}:${w.line}`).join("\n  "),
  );
}
const activeOutside = statusWrites.filter((w) => w.value === "active" && !ALLOWED_FILES.has(w.file));
if (activeOutside.length > 0) {
  fail(`lot status "active" written outside the reviewed files:\n  ` + activeOutside.map((w) => `${w.file}:${w.line}`).join("\n  "));
}
const disposition = readFileSync(resolve(root, "src/lib/inventory/disposition.ts"), "utf-8");
const dIdx = disposition.indexOf('status: "destroyed"');
const cIdx = disposition.indexOf("export async function completeDestruction");
if (dIdx < 0 || cIdx < 0 || dIdx < cIdx || !disposition.slice(cIdx, dIdx).includes("getDestructionEvent")) {
  fail('disposition.ts must only write "destroyed" inside completeDestruction, after loading its destruction event');
}
const storeSrc = readFileSync(resolve(root, "src/lib/inventory/store.ts"), "utf-8");
if (!storeSrc.includes("isManualLotStatus(status)")) {
  fail("store.ts updateLotStatus no longer refuses statuses outside MANUAL_LOT_STATUSES");
}
const actionsSrc = readFileSync(resolve(root, "src/app/admin/inventory/actions.ts"), "utf-8");
if (!actionsSrc.includes("evaluateLotLifecycleChange(")) {
  fail("setLotStatusAction no longer runs evaluateLotLifecycleChange — the lot-page gate is gone");
}

// 5. Fix Phase 1.3 (G-28 req 5; F-05a-18, F-05a-19): no destruction path may
//    change a Recalled lot to anything but Destroyed (recalled product goes
//    back to the vendor, D65). So every Active / Quarantine lot-status write in
//    disposition.ts must be compare-and-set on the status it replaces
//    (`.eq("status", "active")` or `.eq("status", "quarantine")`), never a
//    blind write, and the scheduler must run evaluateDestructionSchedule.
{
  const dispoWrites = statusWrites.filter((w) => w.file === "src/lib/inventory/disposition.ts");
  const lines = disposition.split("\n");
  for (const w of dispoWrites) {
    if (w.value === "destroyed") continue;
    if (w.value !== "active" && w.value !== "quarantine") {
      fail(`disposition.ts:${w.line} writes lot status ${JSON.stringify(w.value)}; only active/quarantine (compare-and-set) or destroyed are allowed`);
    }
    const chain = lines.slice(w.line - 1, w.line + 6).join("\n");
    const stmt = chain.slice(0, chain.indexOf(";") >= 0 ? chain.indexOf(";") : chain.length);
    if (!/\.eq\(\s*"status"\s*,\s*"(active|quarantine)"\s*\)/.test(stmt)) {
      fail(`disposition.ts:${w.line} writes lot status "${w.value}" without a compare-and-set on the status it replaces (a Recalled lot could be overwritten)`);
    }
  }
  if (!disposition.includes("evaluateDestructionSchedule(")) {
    fail("disposition.ts scheduleDestruction no longer runs evaluateDestructionSchedule (Recalled lots could be scheduled)");
  }
  if (!disposition.includes("completionLotRefusal(")) {
    fail("disposition.ts completeDestruction no longer refuses a Recalled lot (D65)");
  }
}

// 6. Fix Phase 1.4 (G-44; F-15-6, F-15-7): a customer-returned unit marked
//    Destroy is HELD (inventory_lots.held_qty) and never sellable. The one
//    lot read a sale draws from must read held_qty, both callers must plan on
//    sellableQty(), the register menu and sellability report must subtract
//    it, and the return must be saved in one transaction (record_customer_return).
{
  const need: [string, string, string][] = [
    ["src/lib/inventory/sale-lot-read.ts", "held_qty", "the sale lot read no longer reads held_qty (held units could be sold)"],
    ["src/lib/inventory/sale-decrement.ts", "sellableQty(", "the sale decrement no longer plans on sellable units (held units could be sold)"],
    ["src/lib/accounting/sale-posting-service.ts", "sellableQty(", "the cost replan no longer plans on sellable units (it would disagree with the decrement)"],
    ["src/app/api/pos/menu/route.ts", "sellableQty(", "the POS menu no longer subtracts held units from register stock"],
    ["src/lib/inventory/register-sellability-store.ts", "sellableQty(", "the sellability report no longer subtracts held units"],
    ["src/lib/inventory/disposition.ts", "RECORD_CUSTOMER_RETURN_RPC", "createCustomerReturn no longer saves the return in one transaction"],
    ["src/lib/inventory/disposition.ts", "evaluateReductionAgainstHold(", "disposition reductions no longer protect held units"],
    ["src/lib/inventory/store.ts", "evaluateReductionAgainstHold(", "manual lot adjustments no longer protect held units"],
  ];
  for (const [file, token, why] of need) {
    if (!readFileSync(resolve(root, file), "utf8").includes(token)) fail(`${file}: ${why} (G-44)`);
  }
}

// 7. Fix Phase 1.5 (G-42; F-15-1, F-15-2, F-15-3, F-15-19): a vendor return
//    RESERVES its units at logging (held_qty) and on-hand only comes off at
//    departure, after the LCB success email. Steps go one at a time, cancel
//    is owner-only, Recalled lots can be returned, and the unsupported
//    "48-72 hours / Mon-Wed-Fri" guidance stays gone.
{
  const need: [string, string, string][] = [
    ["src/lib/inventory/disposition.ts", "RESERVE_VENDOR_RETURN_RPC", "createVendorReturn no longer reserves the units in one transaction (on-hand would drop at logging again)"],
    ["src/lib/inventory/disposition.ts", "DEPART_VENDOR_RETURN_RPC", "departure no longer posts the reduction and releases the hold together"],
    ["src/lib/inventory/disposition.ts", "evaluateVendorReturnStep(", "manifest steps are no longer checked in order (a return could depart before the LCB email)"],
    ["src/app/admin/inventory/disposition/actions.ts", "inventory.vendor_return.cancel", "cancelling a vendor return is no longer owner-only"],
    ["src/app/admin/inventory/disposition/page.tsx", "status: \"recalled\"", "Recalled lots are no longer offered for a vendor return (D65)"],
    ["src/app/admin/inventory/disposition/vendor-return-manifest/route.ts", "buildManifestCsv(", "the Manifest.CSV download no longer uses the checked builder"],
  ];
  for (const [file, token, why] of need) {
    if (!readFileSync(resolve(root, file), "utf8").includes(token)) fail(`${file}: ${why} (G-42)`);
  }
  for (const file of ["src/lib/inventory/disposition-core.ts", "src/lib/inventory/disposition-advisor.ts", "src/lib/inventory/vendor-return-core.ts"]) {
    const body = readFileSync(resolve(root, file), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    if (/48[-\u2013]72 hours|Mon\/Wed\/Fri/.test(body)) {
      fail(`${file}: the unsupported "48-72 hours before pickup / LCB confirms Mon/Wed/Fri" guidance is back (F-15-19)`);
    }
  }
}

// 8. Fix Phase 1.6a (G-43; D64; F-15-4, F-15-5, F-15-12, F-15-21): a
//    destruction is completed only with a second person from the roster as
//    witness and a camera reference, checked on the server; "Other method"
//    needs the LCB approval; scheduling cannot exceed the free units; the
//    hold message is in Pacific.
{
  const need: [string, string, string][] = [
    ["src/app/admin/inventory/disposition/actions.ts", "evaluateDestructionRecord(", "completing a destruction no longer checks the witness and camera on the server (D64)"],
    ["src/lib/inventory/disposition.ts", "evaluateScheduleQuantity(", "scheduling a destruction no longer checks the quantity against free units (F-15-12)"],
    ["src/lib/inventory/disposition-core.ts", "holdNotElapsedMessage(", "the hold refusal is no longer in Pacific time (F-15-5)"],
    ["src/app/admin/inventory/disposition/page.tsx", "witness_employee_id", "the destruction form no longer asks for the witness from the roster"],
    ["src/app/admin/inventory/disposition/page.tsx", "camera_name", "the destruction form no longer asks for the camera (D64)"],
  ];
  for (const [file, token, why] of need) {
    if (!readFileSync(resolve(root, file), "utf8").includes(token)) fail(`${file}: ${why} (G-43)`);
  }
  if (/name="witnessed_by"/.test(readFileSync(resolve(root, "src/app/admin/inventory/disposition/page.tsx"), "utf8"))) {
    fail("disposition page: the free-text Witnessed by box is back (the witness must come from the roster, G-43)");
  }
}

// 9. Fix Phase 1.6b (G-24; D36, D44; F-05a-8, F-05a-20): expired edibles,
//    liquid edibles, tinctures, capsules and RSO are refused at completion
//    with no override; other expired stock needs the warning; the draw is
//    FEFO; the nightly quarantine is compare-and-set on "active" only.
{
  const need: [string, string, string][] = [
    ["src/lib/orders/completion-gate.ts", "expiredBlockRefusal(", "the completion gate no longer refuses expired edibles / tinctures / capsules / RSO (D36, D44)"],
    ["src/lib/orders/completion-gate.ts", "readExpiredActiveLots(", "the completion gate no longer reads expiry dates"],
    ["src/lib/inventory/sale-lot-read.ts", '.order("expires_on", { ascending: true, nullsFirst: false })', "the sale draw is no longer First-Expired First-Out"],
    ["src/lib/inventory/expired-stock-core.ts", "resolveLedgerCategory(", "the hard block no longer reads the store category (RSO is CCRS Concentrate for Inhalation, F-05a-20)"],
    ["src/app/api/pos/menu/route.ts", "expiredIdx.blocked.has(", "the register menu no longer leaves out hard-blocked expired stock"],
    ["vercel.json", "/api/cron/expired-quarantine", "the nightly expired-stock quarantine is no longer scheduled"],
  ];
  for (const [file, token, why] of need) {
    if (!readFileSync(resolve(root, file), "utf8").includes(token)) fail(`${file}: ${why} (G-24)`);
  }
  const ws = statusWrites.filter((w) => w.file === "src/lib/inventory/expired-stock-store.ts");
  const storeLines = readFileSync(resolve(root, "src/lib/inventory/expired-stock-store.ts"), "utf8").split("\n");
  for (const w of ws) {
    const chain = storeLines.slice(w.line - 1, w.line + 6).join("\n");
    if (w.value !== "quarantine" || !/\.eq\(\s*"status"\s*,\s*"active"\s*\)/.test(chain)) {
      fail(`expired-stock-store.ts:${w.line} must only write "quarantine" with a compare-and-set on "active" (a Recalled lot could be overwritten)`);
    }
  }
  if (ws.length !== 1) fail(`expired-stock-store.ts should hold exactly one lot status write (found ${ws.length})`);
}

console.log(
  `ACTIVATION-GATE GUARD OK — no acceptManifest, ${activeWrites.length} activation write(s) all in reviewed files, gate present; ${statusWrites.length} lot status write(s) reviewed (non-literal and destroyed included).`,
);
