/**
 * src/lib/compliance/ccrs-upload-gate-core.ts — D252 S1 (pure).
 *
 * Production, week 11/01 (uploaded 2026-11-17 22:43-23:15 PT): the walkthrough
 * let Group 3 go up 10 minutes after Inventory. CCRS checked the Sale file at
 * 23:15 (its name token T2315338) but processed the Inventory file only at
 * 01:59 (T159360), with the Adjustment and Transfer files right after it
 * (T159563, T159579). So the Sale file was read against a lot list that did
 * not yet hold the 496 new lots: 313 sale lines, all on 149 of those new lots
 * and on no other lot, were refused "Invalid InventoryExternalIdentifier"
 * [G L1302-L1304] ("ensure that you have already reported the inventory in an
 * inventory.CSV"). Production answers came 3 hours after the upload, not the
 * 1-2 minutes PREprod showed.
 *
 * The examiner's rule is to wait for each file's answer (Update first, the
 * rest after its success email [EXAM2 L0029]). The gate: a group stays locked
 * while any file of an EARLIER group of this environment still waits for its
 * CCRS answer (emitted or uploaded, not yet success / error). The 10-minute
 * timer stays as a floor.
 */

export const UPLOAD_GROUP_TYPES = {
  1: ["Strain", "Area", "Product"],
  2: ["Inventory"],
  3: ["InventoryAdjustment", "InventoryTransfer", "Sale"],
} as const;

/** States in which CCRS has not answered yet (mirrors ccrs-answer-core's UNANSWERED). */
const WAITING: ReadonlySet<string> = new Set(["emitted", "uploaded"]);

export type GateFile = { fileType: string; fileName: string; state: string };

export type GroupGate = {
  locked: boolean;
  /** the earlier-group files still waiting for their CCRS email, by name */
  waitingFor: string[];
};

export type UploadGate = { group2: GroupGate; group3: GroupGate };

function gateOn(files: readonly GateFile[], types: readonly string[]): GroupGate {
  const waitingFor = files
    .filter((f) => types.includes(f.fileType) && WAITING.has(f.state))
    .map((f) => f.fileName)
    .sort();
  return { locked: waitingFor.length > 0, waitingFor };
}

/** The gate for the walkthrough, from this env's files still waiting (any week). */
export function uploadGate(files: readonly GateFile[]): UploadGate {
  return {
    group2: gateOn(files, UPLOAD_GROUP_TYPES[1]),
    group3: gateOn(files, [...UPLOAD_GROUP_TYPES[1], ...UPLOAD_GROUP_TYPES[2]]),
  };
}

/** One plain sentence for a locked group. */
export function gateNote(g: GroupGate, next: string): string {
  if (!g.locked) return "";
  const names = g.waitingFor.slice(0, 4).join(", ") + (g.waitingFor.length > 4 ? ` and ${g.waitingFor.length - 4} more` : "");
  return `Wait for CCRS's email on ${names} and Apply it in "CCRS email" below before uploading ${next}. Production can take hours to answer; a file checked before the one it depends on is refused.`;
}

export function __runCcrsUploadGateCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[ccrs-upload-gate-core] FAIL: ${m}`);
    }
  };
  const f = (fileType: string, state: string, n = "1"): GateFile => ({ fileType, state, fileName: `${fileType}_${n}.csv` });
  // The night of 2026-11-17, at 23:15: Inventory uploaded, unanswered.
  const night = [f("Strain", "uploaded"), f("Area", "uploaded"), f("Product", "uploaded"), f("Inventory", "uploaded")];
  const g = uploadGate(night);
  ok(g.group2.locked && g.group2.waitingFor.length === 3, "Inventory waits for Strain, Area and Product");
  ok(g.group3.locked && g.group3.waitingFor.includes("Inventory_1.csv"), "Group 3 waits for Inventory");
  // Group 1 answered (an error answer counts: the file is settled), Inventory still waiting.
  const g2 = uploadGate([f("Strain", "errored"), f("Area", "succeeded"), f("Product", "succeeded"), f("Inventory", "uploaded")]);
  ok(!g2.group2.locked, "errored and succeeded are answered");
  ok(g2.group3.locked && g2.group3.waitingFor.join() === "Inventory_1.csv", "only Inventory holds Group 3");
  // Inventory answered.
  const g3 = uploadGate([f("Inventory", "errored")]);
  ok(!g3.group3.locked, "an answered Inventory unlocks Group 3");
  // A file handed out and never uploaded still blocks (Abandon it, or upload and wait).
  ok(uploadGate([f("Product", "emitted")]).group2.locked, "emitted counts as waiting");
  // Group 3 files never lock anything.
  ok(!uploadGate([f("Sale", "uploaded")]).group2.locked && !uploadGate([f("Sale", "uploaded")]).group3.locked, "Sale locks nothing");
  ok(uploadGate([]).group2.locked === false, "nothing waiting, nothing locked");
  // Note text.
  ok(gateNote(g.group3, "Group 3").includes("Inventory_1.csv") && gateNote(g.group3, "Group 3").includes("hours"), "note names the file");
  ok(gateNote({ locked: false, waitingFor: [] }, "x") === "", "no note when open");
  const many = uploadGate(["a", "b", "c", "d", "e", "f"].map((n) => f("Product", "uploaded", n)));
  ok(gateNote(many.group2, "Inventory").includes("and 2 more"), "long lists are shortened");
  return { passed, failed };
}
