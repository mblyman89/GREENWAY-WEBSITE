/**
 * src/lib/pos/cultivera-wcia-coverage-core.ts — R74 S2 "vendor files fail LOUD" (pure).
 *
 * Owner (R74 round 2, #10): "I want the system to fail loud when it doesn't succeed to get all the
 * jsons or whatever. I want the jsons it can get to still stage receiving/ onboarding for
 * enrichment. The failing silently is exactly what I saw."
 *
 * Before R74 a wcia_json miss was a quiet orange "partial" and the import went ahead. Now:
 *
 *   - vendorFileCoverage(...)   counts, from the run's OWN transfer details, every transfer that
 *                               has a vendor file (JsonFile set) and how many of those the run
 *                               actually saved as a readable WCIA document. The crawler's own
 *                               coverage block (state.json stages.wcia_json.coverage) and any file
 *                               problem (checksum / unreadable lines / not downloaded) are folded
 *                               in. Never guesses: no transfer details and no crawler block ⇒
 *                               "unknown", which is NOT complete.
 *   - coverageCheck(...)        the ✗/✓ line the go / no-go report shows ("vendor_files_complete").
 *                               It is reported apart from GO (the obtained files must still stage),
 *                               but a real import with missing files needs the owner to tick
 *                               "stage without them" (importDecision, cultivera-fetch-button-core).
 *
 * Reads nothing, writes nothing. No money.
 */

import { isWciaDocumentText, parseTransferId } from "@/lib/inventory/cultivera-wcia-core";

/** The crawler's stages.wcia_json.coverage block (crawler/app/cultivera_pos.py wcia_coverage). */
export type CrawlerWciaCoverage = {
  expected?: unknown;
  saved?: unknown;
  missing?: unknown;
  refused?: unknown;
  errors?: unknown;
  stoppedForTime?: unknown;
  complete?: unknown;
};

export type VendorFileCoverageInput = {
  /** transfer_details.jsonl records (undefined when the run has none). */
  transferDetails?: readonly unknown[];
  /** wcia_json.jsonl records that passed verification ([] when none / not verified). */
  records: readonly { Id?: unknown; JsonFile?: unknown }[];
  /** loaded.wcia.problem — checksum mismatch, unreadable lines, download failure. */
  problem: string | null;
  /** state.json stages.wcia_json (status + coverage + error), when present. */
  stage?: { status?: unknown; coverage?: CrawlerWciaCoverage; error?: unknown } | null;
};

export type VendorFileCoverage = {
  /** "details" = counted from the run's transfer details; "crawler" = the crawler's block only; "unknown" = neither. */
  basis: "details" | "crawler" | "unknown";
  expected: number;
  saved: number;
  missing: number;
  /** Up to 50 transfer ids with no saved vendor file (sorted), for the report. */
  missingTransferIds: number[];
  refused: number;
  errors: number;
  stoppedForTime: boolean;
  stageError: string | null;
  problem: string | null;
  complete: boolean;
  /** One plain sentence when NOT complete (shown in red); null when complete. */
  loud: string | null;
};

const MAX_IDS = 50;
const n0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Transfers that have a vendor file, from the run's own transfer details (deduped by id). */
export function transfersWithVendorFile(details: readonly unknown[]): number[] {
  const ids = new Set<number>();
  for (const raw of details) {
    const d = (raw && typeof raw === "object" ? raw : {}) as { Id?: unknown; JsonFile?: unknown };
    const id = parseTransferId(d.Id);
    if (id === null) continue;
    if (typeof d.JsonFile !== "string" || d.JsonFile.trim() === "") continue;
    ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export function vendorFileCoverage(i: VendorFileCoverageInput): VendorFileCoverage {
  const savedIds = new Set<number>();
  for (const r of i.records) {
    const id = parseTransferId(r?.Id);
    if (id !== null && isWciaDocumentText(r?.JsonFile)) savedIds.add(id);
  }
  const cov = i.stage?.coverage ?? null;
  const stageError = typeof i.stage?.error === "string" && i.stage.error ? i.stage.error : null;
  const refused = n0(cov?.refused);
  const errors = n0(cov?.errors);
  const stoppedForTime = cov?.stoppedForTime === true;

  let basis: VendorFileCoverage["basis"];
  let expected: number;
  let saved: number;
  let missingIds: number[] = [];
  if (i.transferDetails) {
    basis = "details";
    const want = transfersWithVendorFile(i.transferDetails);
    expected = want.length;
    missingIds = want.filter((id) => !savedIds.has(id));
    saved = expected - missingIds.length;
  } else if (cov) {
    basis = "crawler";
    expected = n0(cov.expected);
    saved = Math.min(savedIds.size, expected);
  } else {
    basis = "unknown";
    expected = 0;
    saved = savedIds.size;
  }
  const missing = expected - saved;
  const complete = basis !== "unknown" && missing === 0 && !i.problem && !stageError;

  let loud: string | null = null;
  if (!complete) {
    const why: string[] = [];
    if (stoppedForTime) why.push("the time budget ran out");
    if (errors > 0) why.push(`${errors} errors`);
    if (refused > 0) why.push(`${refused} refused paths`);
    if (stageError) why.push(`stage error: ${stageError}`);
    if (i.problem) why.push(i.problem);
    const tail = why.length ? ` (${why.join("; ")})` : "";
    loud =
      basis === "unknown"
        ? `Vendor transfer files: coverage UNKNOWN. The run has no transfer details and no crawler coverage${tail}. ${saved} saved still stage.`
        : `Vendor transfer files: ${missing} of ${expected} MISSING${tail}. The ${saved} saved still stage for receiving and onboarding.`;
  }
  return {
    basis,
    expected,
    saved,
    missing,
    missingTransferIds: missingIds.slice(0, MAX_IDS),
    refused,
    errors,
    stoppedForTime,
    stageError,
    problem: i.problem,
    complete,
    loud,
  };
}

/** The report line. Shown with the go / no-go checks, but kept OUT of GO (obtained files still stage). */
export function coverageCheck(c: VendorFileCoverage): { id: "vendor_files_complete"; pass: boolean; detail: string } {
  return {
    id: "vendor_files_complete",
    pass: c.complete,
    detail: c.complete ? `${c.saved} / ${c.expected} vendor files saved` : (c.loud ?? "incomplete"),
  };
}

/** How many vendor files a real import must acknowledge as missing (unknown coverage counts as 1+). */
export function missingToAcknowledge(c: VendorFileCoverage | null): number {
  if (!c || c.complete) return 0;
  return Math.max(1, c.missing);
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraWciaCoverageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-wcia-coverage-core: " + msg);
    passed += 1;
  };
  const doc = JSON.stringify({ inventory_transfer_items: [] });
  const details = [
    { Id: 11, JsonFile: "wa_pos/a.json" },
    { Id: 12, JsonFile: "wa_pos/b.json" },
    { Id: 13, JsonFile: "" },
    { Id: 14 },
    { Id: 12, JsonFile: "wa_pos/b.json" },
    { Id: "x", JsonFile: "wa_pos/c.json" },
    null,
  ];
  ok(transfersWithVendorFile(details).join() === "11,12", "only transfers with a JsonFile, deduped, bad ids skipped");

  const full = vendorFileCoverage({ transferDetails: details, records: [{ Id: 11, JsonFile: doc }, { Id: 12, JsonFile: doc }], problem: null });
  ok(full.complete && full.basis === "details" && full.expected === 2 && full.saved === 2 && full.missing === 0 && full.loud === null, "all saved → complete, silent");
  ok(coverageCheck(full).pass && coverageCheck(full).detail === "2 / 2 vendor files saved", "complete check line");
  ok(missingToAcknowledge(full) === 0, "nothing to acknowledge");

  const part = vendorFileCoverage({
    transferDetails: details,
    records: [{ Id: 11, JsonFile: doc }, { Id: 12, JsonFile: "<html>" }, { Id: 99, JsonFile: doc }],
    problem: null,
    stage: { status: "partial", coverage: { errors: 1, stoppedForTime: true, refused: 0 } },
  });
  ok(!part.complete && part.missing === 1 && part.saved === 1 && part.missingTransferIds.join() === "12", "unreadable doc is missing; a stray id does not count");
  ok(part.loud === "Vendor transfer files: 1 of 2 MISSING (the time budget ran out; 1 errors). The 1 saved still stage for receiving and onboarding.", "loud sentence names why");
  ok(!coverageCheck(part).pass && coverageCheck(part).detail === part.loud, "failing check carries the loud sentence");
  ok(missingToAcknowledge(part) === 1, "acknowledge 1");

  const prob = vendorFileCoverage({ transferDetails: details, records: [{ Id: 11, JsonFile: doc }, { Id: 12, JsonFile: doc }], problem: "wcia_json.jsonl: checksum differs from the manifest" });
  ok(!prob.complete && prob.missing === 0 && prob.loud!.includes("checksum differs"), "file problem is never complete");
  ok(missingToAcknowledge(prob) === 1, "a problem with 0 missing still needs an acknowledgment");

  const err = vendorFileCoverage({ transferDetails: details, records: [], problem: null, stage: { status: "partial", error: "failed after 2 tries" } });
  ok(!err.complete && err.missing === 2 && err.loud!.includes("stage error: failed after 2 tries"), "stage error, nothing saved → 2 missing");

  const none = vendorFileCoverage({ transferDetails: [{ Id: 1, JsonFile: "" }], records: [], problem: null });
  ok(none.complete && none.expected === 0, "no transfer has a vendor file → complete (nothing to get)");

  const crawlerOnly = vendorFileCoverage({ records: [{ Id: 5, JsonFile: doc }], problem: null, stage: { coverage: { expected: 3, saved: 1 } } });
  ok(crawlerOnly.basis === "crawler" && crawlerOnly.expected === 3 && crawlerOnly.missing === 2 && !crawlerOnly.complete, "no details → crawler's expected count");

  const unknown = vendorFileCoverage({ records: [], problem: null });
  ok(unknown.basis === "unknown" && !unknown.complete && unknown.loud!.includes("coverage UNKNOWN"), "never guesses: unknown is not complete");
  ok(missingToAcknowledge(unknown) === 1 && missingToAcknowledge(null) === 0, "unknown needs an acknowledgment; no report → 0");

  const many = vendorFileCoverage({ transferDetails: Array.from({ length: 80 }, (_, k) => ({ Id: k + 1, JsonFile: "wa_pos/x.json" })), records: [], problem: null });
  ok(many.missing === 80 && many.missingTransferIds.length === 50 && many.missingTransferIds[0] === 1, "ids capped at 50, count is exact");
  ok(vendorFileCoverage({ transferDetails: details, records: [], problem: null, stage: { coverage: { refused: -3, errors: "x" } } }).refused === 0, "junk crawler numbers read as 0");

  return { passed, failed: 0 };
}
