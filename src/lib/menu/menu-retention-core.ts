/**
 * src/lib/menu/menu-retention-core.ts  (PERF round P1/P2, PURE)
 *
 * Owner (2026-11-05): "A lot of the pages, main admin cockpit included, are very very slow to
 * load ... I need my back office to be lightning fast." Then: "Please proceed to fix all issues,
 * big and small ... I want optimization and efficiency to be paramount now that we are in live
 * production."
 *
 * Measured: every intake stage wrote a full copy of the menu (about 2,200 products) and nothing
 * removed the old copies: 720,163 menu_items rows for 2,288 products in five days. Migration 0344
 * adds prune_menu_version_items (bounded, keeps the newest archived copies) and product_latest_facts
 * (one row per product key, so reports no longer sort every copy).
 *
 * This module holds the decisions, with no I/O:
 *   - how many archived copies to keep and how many to clear per publish;
 *   - reading the prune function's answer (or its "not applied yet" error) without guessing;
 *   - which latest_menu_facts errors mean "the function is not there" (then the original read is
 *     the right answer) versus "it failed" (then the error is reported, never a 2-second-per-page
 *     walk of every row ever written that times out in turn: the spiral measured on 2026-11-05).
 */

/** Archived intake copies always kept with their items (the function refuses fewer than 3). */
export const MENU_COPIES_KEPT = 5;
/** Old copies cleared after each publish: a publish creates one, so this always catches up. */
export const MENU_COPIES_PRUNED_PER_PUBLISH = 4;
export const PRUNE_MENU_RPC = "prune_menu_version_items";

export type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** PostgREST "function not found" (PGRST202) or Postgres undefined_function (42883). */
export function isMissingFunction(error: DbError): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toUpperCase();
  if (code === "PGRST202" || code === "42883") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || /function .* does not exist/.test(msg);
}

export type PruneOutcome =
  | { kind: "pruned"; versions: number; items: number; remaining: number }
  | { kind: "not_applied" }
  | { kind: "error"; message: string };

function count(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Read the prune RPC answer. Anything not exactly {versions, items, remaining} is an error. */
export function readPruneResult(data: unknown, error: DbError): PruneOutcome {
  if (error) {
    if (isMissingFunction(error)) return { kind: "not_applied" };
    return { kind: "error", message: error.message || error.code || "prune failed" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { kind: "error", message: "prune returned no answer" };
  }
  const o = data as Record<string, unknown>;
  const versions = count(o.versions);
  const items = count(o.items);
  const remaining = count(o.remaining);
  if (versions === null || items === null || remaining === null) {
    return { kind: "error", message: `prune answer not understood: ${JSON.stringify(data).slice(0, 200)}` };
  }
  return { kind: "pruned", versions, items, remaining };
}

/** One plain line for the server log (and the publish timeline if ever shown). */
export function describePrune(o: PruneOutcome): string {
  if (o.kind === "not_applied") return "Old menu copies not cleared: migration 0344 is not applied yet.";
  if (o.kind === "error") return `Old menu copies not cleared: ${o.message}`;
  if (o.versions === 0) return o.remaining === 0 ? "No old menu copies to clear." : `No old menu copies cleared; ${o.remaining} waiting.`;
  return `Cleared ${o.versions} old menu ${o.versions === 1 ? "copy" : "copies"} (${o.items} product rows); ${o.remaining} still waiting.`;
}

/**
 * latest_menu_facts failed: what next? "walk" only when the function does not exist (a database
 * before 0305): the original read is then the only source. Any other failure is reported.
 */
export function factsFallback(error: DbError): "walk" | "report" {
  return isMissingFunction(error) ? "walk" : "report";
}

export function __runMenuRetentionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL menu-retention-core: ${name}`);
    }
  };

  ok(MENU_COPIES_KEPT >= 3, "keeps at least 3 (the SQL refuses fewer)");
  ok(MENU_COPIES_PRUNED_PER_PUBLISH >= 2, "clears more than one per publish, so it catches up");
  ok(isMissingFunction({ code: "PGRST202", message: "x" }), "PGRST202 missing");
  ok(isMissingFunction({ code: "42883", message: "x" }), "42883 missing");
  ok(isMissingFunction({ message: "Could not find the function public.prune_menu_version_items" }), "message missing");
  ok(!isMissingFunction({ code: "57014", message: "canceling statement due to statement timeout" }), "timeout is not missing");
  ok(!isMissingFunction(null), "no error is not missing");

  ok(readPruneResult(null, { code: "PGRST202" }).kind === "not_applied", "not applied");
  const e = readPruneResult(null, { code: "57014", message: "timeout" });
  ok(e.kind === "error" && e.message === "timeout", "timeout is an error");
  const p = readPruneResult({ versions: 4, items: 8800, remaining: 2 }, null);
  ok(p.kind === "pruned" && p.versions === 4 && p.items === 8800 && p.remaining === 2, "pruned read");
  ok(readPruneResult({ versions: "3", items: "10", remaining: "0" }, null).kind === "pruned", "numeric strings read");
  ok(readPruneResult(null, null).kind === "error", "no data is an error, never zero");
  ok(readPruneResult({ versions: 1, items: 2 }, null).kind === "error", "missing remaining is an error");
  ok(readPruneResult({ versions: -1, items: 2, remaining: 0 }, null).kind === "error", "negative is an error");
  ok(readPruneResult([1, 2], null).kind === "error", "array is an error");

  ok(describePrune({ kind: "not_applied" }).includes("0344"), "describe not applied");
  ok(describePrune({ kind: "pruned", versions: 1, items: 2200, remaining: 0 }).startsWith("Cleared 1 old menu copy "), "describe one");
  ok(describePrune({ kind: "pruned", versions: 0, items: 0, remaining: 0 }) === "No old menu copies to clear.", "describe none");
  ok(describePrune({ kind: "pruned", versions: 0, items: 0, remaining: 7 }).includes("7 waiting"), "describe waiting");

  ok(factsFallback({ code: "PGRST202" }) === "walk", "missing function walks");
  ok(factsFallback({ code: "57014", message: "timeout" }) === "report", "timeout reports, never walks");
  ok(factsFallback({ message: "fetch failed" }) === "report", "network reports");

  return { passed, failed };
}
