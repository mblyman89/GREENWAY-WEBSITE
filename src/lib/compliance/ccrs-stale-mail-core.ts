/**
 * src/lib/compliance/ccrs-stale-mail-core.ts  (D255)
 *
 * PURE. Old CCRS emails that can no longer answer anything.
 *
 * Owner (D255, verbatim): "when I try to use it, I get this error, \"21 CCRS
 * email(s) wait to be applied (first: PRE: CCRS Processing Successful; PRE:
 * CCRS Processing Successful; PRE: CCRS errors for file:
 * Area_413541_20261020163351_20261020T16440.csv). Apply or set them aside in
 * \"CCRS email\" first: one may answer a file this run would send again.\" I
 * have cleared every email in the list."
 *
 * What the database showed (2026-11-19): 21 emails still "new", all received
 * 10/20 to 10/25 (the first PREprod tests). The hub listed only the newest 25
 * emails, and 76 to 89 newer ones were already handled, so these 21 were
 * never on screen. Every file they name is "abandoned" in the ledger (15
 * PREprod, 5 production-ledger files that were in fact sent to PREprod on
 * 10/20, 1 "not processed" notice for an abandoned PREprod Product file).
 *
 * The start blocker exists because an open email "may answer a file this run
 * would send again". A run only sends files that are emitted or uploaded. An
 * email whose every named file is in any other state (abandoned, closed,
 * succeeded, errored, reconciling) cannot change what a run sends, and its
 * Apply would refuse anyway ("no file waiting for an answer has this name").
 * Such an email is STALE: it may be set aside, with the facts in the note.
 *
 * An email is never stale when it names no file, when a name matches no file
 * of ours, or when any named file still waits for an answer. Those stay for
 * the owner.
 */
import type { LedgerEnv } from "./ccrs-ledger-core";
import { parseNotProcessed } from "./ccrs-whole-file-core";

/** The file states a run sends and an Apply answers (same as WAITING_STATES in ccrs-hub-view-core). */
export const ANSWERABLE_STATES: readonly string[] = ["emitted", "uploaded"];

export type StaleMailInput = {
  id: string;
  kind: string;
  subject: string;
  /** The stored env, already nulled when it is not verified (as the start blocker reads it). */
  env: LedgerEnv | null;
  bodyText: string;
  /** analysis.successes[].fileName of a confirmation. */
  successNames: readonly string[];
};

export type LedgerFileFact = { fileName: string; env: LedgerEnv; state: string };

export type StaleVerdict = { stale: boolean; names: string[]; why: string };

const OUR_NAME_IN_SUBJECT = /for file:\s*((?:Strain|Area|Product|InventoryAdjustment|InventoryTransfer|Inventory|Sale)_\d+_\d{14})(?:_[0-9A-Za-z]+)?\.csv/i;
const OUR_NAME = /^(?:Strain|Area|Product|InventoryAdjustment|InventoryTransfer|Inventory|Sale)_\d+_\d{14}\.csv$/;

/** Our file name(s) an email answers: confirmation list, error subject, or "not processed" body. */
export function ourNamesOfMail(m: Pick<StaleMailInput, "kind" | "subject" | "bodyText" | "successNames">): string[] {
  let names: string[] = [];
  if (m.kind === "success") names = [...m.successNames];
  else if (m.kind === "error") {
    const hit = OUR_NAME_IN_SUBJECT.exec(m.subject);
    names = hit ? [`${hit[1]}.csv`] : [];
  } else names = parseNotProcessed(m.bodyText);
  return [...new Set(names.filter((n) => OUR_NAME.test(n)))];
}

const ENV_WORD: Record<LedgerEnv, string> = { preprod: "PREprod", prod: "production" };

export function staleVerdict(m: StaleMailInput, files: readonly LedgerFileFact[]): StaleVerdict {
  const names = ourNamesOfMail(m);
  if (names.length === 0) return { stale: false, names, why: "it names no file of ours; read it yourself" };
  const parts: string[] = [];
  for (const n of names) {
    const hits = files.filter((f) => f.fileName === n);
    if (hits.length === 0) return { stale: false, names, why: `${n} is not in our ledger; read it yourself` };
    const live = hits.find((f) => ANSWERABLE_STATES.includes(f.state));
    if (live) return { stale: false, names, why: `${n} still waits for an answer (${ENV_WORD[live.env]}, ${live.state}); apply it` };
    parts.push(`${n} is ${hits.map((f) => `${f.state} (${ENV_WORD[f.env]})`).join(" and ")}`);
  }
  return { stale: true, names, why: `${parts.join("; ")}: no run sends it again and Apply would refuse it` };
}

/** The open emails that block a run of `env` (same scope as mailBlocksStart). */
export function inStartScope(m: Pick<StaleMailInput, "env">, env: LedgerEnv): boolean {
  return m.env === env || m.env === null;
}

export type StalePlan = { setAside: { id: string; note: string }[]; keep: { id: string; why: string }[] };

/** Which open emails of this env's start scope may be set aside, each with its note. */
export function planStaleSetAside(mails: readonly StaleMailInput[], files: readonly LedgerFileFact[], env: LedgerEnv): StalePlan {
  const out: StalePlan = { setAside: [], keep: [] };
  for (const m of mails) {
    if (!inStartScope(m, env)) continue;
    const v = staleVerdict(m, files);
    if (v.stale) out.setAside.push({ id: m.id, note: `D255 old email set aside: ${v.why}.`.slice(0, 2000) });
    else out.keep.push({ id: m.id, why: v.why });
  }
  return out;
}

/** The hub list: EVERY open email (they block the uploader), then the newest handled ones. Newest first. */
export function mergeHubMail<T extends { id: string; state: string; received_at: string | null }>(open: readonly T[], recent: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...open.filter((x) => x.state === "new"), ...recent]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  const t = (r: T) => (r.received_at ? Date.parse(r.received_at) : 0);
  return out.sort((a, z) => t(z) - t(a));
}

/* ------------------------------------------------------------------ *
 * Self-tests (run-pure-selftests + vitest).
 * ------------------------------------------------------------------ */

export function __runCcrsStaleMailCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[ccrs-stale-mail-core] FAIL: ${msg}`);
    }
  };
  const mail = (id: string, kind: string, subject: string, extra: Partial<StaleMailInput> = {}): StaleMailInput => ({ id, kind, subject, env: "preprod", bodyText: "", successNames: [], ...extra });
  // The real 10/20 to 10/25 facts.
  const files: LedgerFileFact[] = [
    { fileName: "Area_413541_20261020163351.csv", env: "prod", state: "abandoned" },
    { fileName: "Strain_413541_20261020163350.csv", env: "prod", state: "abandoned" },
    { fileName: "Product_413541_20261025122117.csv", env: "preprod", state: "abandoned" },
    { fileName: "Inventory_413541_20261020165831.csv", env: "preprod", state: "abandoned" },
    { fileName: "Sale_413541_20261118220000.csv", env: "preprod", state: "emitted" },
    { fileName: "Sale_413541_20261118220000.csv", env: "prod", state: "closed" },
    { fileName: "Product_413541_20261110101605.csv", env: "preprod", state: "succeeded" },
  ];
  const errArea = mail("e1", "error", "PRE: CCRS errors for file: Area_413541_20261020163351_20261020T16440.csv", { env: null });
  ok(ourNamesOfMail(errArea).join() === "Area_413541_20261020163351.csv", "error subject gives our file name without CCRS's suffix");
  ok(staleVerdict(errArea, files).stale, "an error email for an abandoned file is stale");
  ok(staleVerdict(errArea, files).why.includes("abandoned (production)"), "the note says the state and the ledger");
  const okStrain = mail("s1", "success", "PRE: CCRS Processing Successful", { successNames: ["Strain_413541_20261020163350.csv"] });
  ok(staleVerdict(okStrain, files).stale, "a confirmation for an abandoned file is stale");
  const np = mail("u1", "unknown", "PRE: CCRS Processing Error: Product_413541_20261025122117_20261025T1415944.csv", {
    env: null,
    bodyText: "PRE The file Product_413541_20261025122117_20261025T1415944.csv you submitted has not been processed. For assistance contact",
  });
  ok(ourNamesOfMail(np).join() === "Product_413541_20261025122117.csv", "a not-processed notice gives our file name");
  ok(staleVerdict(np, files).stale, "a not-processed notice for an abandoned file is stale");
  const live = mail("s2", "success", "PRE: CCRS Processing Successful", { successNames: ["Sale_413541_20261118220000.csv"] });
  ok(!staleVerdict(live, files).stale, "a file still emitted in ANY env keeps its email (it may be sent again)");
  ok(staleVerdict(live, files).why.includes("apply it"), "the kept reason says to apply it");
  const done = mail("s3", "success", "PRE: CCRS Processing Successful", { successNames: ["Product_413541_20261110101605.csv"] });
  ok(staleVerdict(done, files).stale, "a file already succeeded (answered) is stale");
  const unknownName = mail("s4", "success", "PRE: CCRS Processing Successful", { successNames: ["Product_413541_20991231000000.csv"] });
  ok(!staleVerdict(unknownName, files).stale, "a name not in our ledger is never stale");
  ok(!staleVerdict(mail("u2", "unknown", "PRE: something"), files).stale, "an email that names no file is never stale");
  ok(!staleVerdict(mail("e2", "error", "PRE: CCRS errors for file: weird.csv"), files).stale, "an error subject without our name is never stale");
  const two = mail("s5", "success", "x", { successNames: ["Strain_413541_20261020163350.csv", "Sale_413541_20261118220000.csv"] });
  ok(!staleVerdict(two, files).stale, "one live name among several keeps the email");
  ok(ourNamesOfMail(mail("s6", "success", "x", { successNames: ["a.csv", "Strain_413541_20261020163350.csv", "Strain_413541_20261020163350.csv"] })).length === 1, "names are de-duplicated and must look like ours");
  // Scope: same as the start blocker.
  ok(inStartScope({ env: null }, "prod") && inStartScope({ env: null }, "preprod"), "unverified env is in both scopes");
  ok(!inStartScope({ env: "preprod" }, "prod"), "a PREprod email is not in production's scope");
  const plan = planStaleSetAside([errArea, okStrain, np, live, unknownName, mail("p1", "success", "CCRS Processing Successful", { env: "prod", successNames: ["Area_413541_20261020163351.csv"] })], files, "preprod");
  ok(plan.setAside.map((x) => x.id).join() === "e1,s1,u1", `plan sets aside only stale emails in scope (got ${plan.setAside.map((x) => x.id).join()})`);
  ok(plan.keep.map((x) => x.id).join() === "s2,s4", "plan keeps the others with a reason");
  ok(plan.setAside.every((x) => x.note.startsWith("D255 old email set aside: ")), "every note is tagged D255");
  ok(planStaleSetAside([], files, "prod").setAside.length === 0, "nothing open, nothing to do");
  // Hub list.
  type R = { id: string; state: string; received_at: string | null };
  const open: R[] = [
    { id: "o1", state: "new", received_at: "2026-10-20T23:44:19Z" },
    { id: "o2", state: "new", received_at: "2026-11-19T06:00:00Z" },
  ];
  const recent: R[] = [
    { id: "o2", state: "new", received_at: "2026-11-19T06:00:00Z" },
    { id: "d1", state: "applied", received_at: "2026-11-19T05:00:00Z" },
  ];
  const merged = mergeHubMail(open, recent);
  ok(merged.map((r) => r.id).join() === "o2,d1,o1", `every open email is listed, once, newest first (got ${merged.map((r) => r.id).join()})`);
  ok(mergeHubMail([{ id: "x", state: "applied", received_at: null }], []).length === 0, "the open list only adds open emails");
  ok(ANSWERABLE_STATES.join() === "emitted,uploaded", "answerable = the states a run sends");
  return { passed, failed };
}
