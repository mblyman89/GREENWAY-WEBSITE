/**
 * R50 S2c — pure helpers for the "Rebuild Cultivera manifests" screen and its
 * actions: links, audit action names, plain-English exception text, the
 * result sentence and the stage of the run (never guessed: derived from the
 * plan's own counts). No I/O.
 */
import type { ControlTotals, RehomeExceptionCode, RehomePlan } from "@/lib/inventory/cultivera-rehome-core";

export const REHOME_AUDIT = {
  applied: "cultivera_rehome.applied",
  applyProblems: "cultivera_rehome.applied_with_problems",
  applyRefused: "cultivera_rehome.refused",
  rolledBack: "cultivera_rehome.rolled_back",
} as const;

export function rehomeHref(importId: string, q: { done?: string; error?: string } = {}): string {
  const base = `/admin/menu-imports/${encodeURIComponent(importId)}/manifests`;
  const p = new URLSearchParams();
  if (q.done) p.set("done", q.done);
  if (q.error) p.set("error", q.error);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** What each exception means to a manager, and whether they need to act. */
export const REHOME_EXCEPTION_TEXT: Record<RehomeExceptionCode, { title: string; action: string }> = {
  planned_barcode_without_lot: {
    title: "Barcode in Cultivera's transfer but not on this import's manifest",
    action: "Someone already moved that lot, or it was never created. It is left exactly where it is.",
  },
  lot_not_in_plan: {
    title: "Lot with no Cultivera transfer or received date to group it by",
    action: "It stays on the import manifest. Check its paper manifest if you want it on a real one.",
  },
  lot_on_foreign_manifest: {
    title: "Lot already on a manifest that is not from this import",
    action: "The rebuild refuses until this is resolved, so nothing is moved off a native delivery.",
  },
  transfer_date_after_acceptance: {
    title: "Cultivera's transfer date is after its acceptance time",
    action: "This is how Cultivera recorded it. The real acceptance time is used for the received date.",
  },
};

export type RehomeStage = "nothing" | "ready" | "partial" | "done" | "refused";

/** Stage of the run, from the plan's own counts. */
export function rehomeStage(plan: Pick<RehomePlan, "ok" | "summary">): RehomeStage {
  const s = plan.summary;
  if (!plan.ok) return "refused";
  if (s.manifestsPlanned === 0) return "nothing";
  if (s.manifestsToCreate === 0 && s.lotsToMove === 0) return "done";
  if (s.manifestsAlreadyCreated > 0 || s.lotsAlreadyHome > 0) return "partial";
  return "ready";
}

export function formatCents(c: number): string {
  const neg = c < 0;
  const a = Math.abs(Math.round(c));
  const d = Math.floor(a / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}$${d}.${String(a % 100).padStart(2, "0")}`;
}

export function totalsLine(t: ControlTotals): string {
  return `${t.lots.toLocaleString("en-US")} lots · ${t.onHandUnits.toLocaleString("en-US")} units on hand · ${formatCents(t.costValueCents)} at cost`;
}

/** The one sentence shown after Apply. */
export function rehomeSummaryText(r: {
  ok: boolean;
  created: number;
  reused: number;
  moved: number;
  skippedByGuard: number;
  warnings: string[];
  problems: string[];
  before: ControlTotals;
}): string {
  const head = r.ok
    ? `Rebuilt ${r.created} manifest(s)${r.reused > 0 ? ` (${r.reused} already existed)` : ""} and moved ${r.moved} lot(s). Verified against the database: ${totalsLine(r.before)}, unchanged.`
    : `Stopped with ${r.problems.length} problem(s): ${r.problems.join("; ")}. Run Apply again to resume; nothing is duplicated.`;
  const guard = r.skippedByGuard > 0 ? ` ${r.skippedByGuard} lot(s) were moved by someone else meanwhile and were left alone.` : "";
  const warn = r.warnings.length > 0 ? ` ${r.warnings.join(" ")}` : "";
  return head + guard + warn;
}

export function __runCultiveraRehomeUiCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL cultivera-rehome-ui-core:", name);
    }
  };
  const sum = (o: Partial<RehomePlan["summary"]>): RehomePlan["summary"] => ({
    manifestsPlanned: 2,
    manifestsToCreate: 2,
    manifestsAlreadyCreated: 0,
    transferManifests: 1,
    rebuiltManifests: 1,
    lotsToMove: 3,
    lotsAlreadyHome: 0,
    lotsStayOnSource: 0,
    lotsPlacedByEmail: 0,
    vendorIdsSet: 0,
    exceptionCounts: { planned_barcode_without_lot: 0, lot_not_in_plan: 0, lot_on_foreign_manifest: 0, transfer_date_after_acceptance: 0 },
    ...o,
  });
  ok(rehomeStage({ ok: true, summary: sum({}) }) === "ready", "ready");
  ok(rehomeStage({ ok: false, summary: sum({}) }) === "refused", "refused wins");
  ok(rehomeStage({ ok: true, summary: sum({ manifestsToCreate: 0, lotsToMove: 0, manifestsAlreadyCreated: 2, lotsAlreadyHome: 3 }) }) === "done", "done");
  ok(rehomeStage({ ok: true, summary: sum({ manifestsToCreate: 1, manifestsAlreadyCreated: 1 }) }) === "partial", "partial (manifests)");
  ok(rehomeStage({ ok: true, summary: sum({ manifestsToCreate: 0, manifestsAlreadyCreated: 2, lotsToMove: 1, lotsAlreadyHome: 2 }) }) === "partial", "partial (lots)");
  ok(rehomeStage({ ok: true, summary: sum({ manifestsPlanned: 0, manifestsToCreate: 0, lotsToMove: 0 }) }) === "nothing", "nothing");
  ok(formatCents(65867005) === "$658,670.05" && formatCents(5) === "$0.05" && formatCents(-150) === "-$1.50", "cents");
  ok(rehomeHref("a b") === "/admin/menu-imports/a%20b/manifests", "href encodes id");
  ok(rehomeHref("x", { done: "ok & done" }) === "/admin/menu-imports/x/manifests?done=ok+%26+done", "href query");
  const t = { lots: 3762, onHandUnits: 25851, receivedUnits: 1, costValueCents: 65867005 };
  ok(totalsLine(t) === "3,762 lots · 25,851 units on hand · $658,670.05 at cost", "totals line");
  const good = rehomeSummaryText({ ok: true, created: 679, reused: 0, moved: 3762, skippedByGuard: 0, warnings: [], problems: [], before: t });
  ok(good.startsWith("Rebuilt 679 manifest(s) and moved 3762 lot(s). Verified") && !good.includes("already existed"), "ok sentence");
  const bad = rehomeSummaryText({ ok: false, created: 1, reused: 2, moved: 0, skippedByGuard: 2, warnings: ["w"], problems: ["p1"], before: t });
  ok(bad.includes("Stopped with 1 problem(s): p1") && bad.includes("2 lot(s) were moved by someone else") && bad.endsWith(" w"), "problem sentence");
  ok(Object.keys(REHOME_EXCEPTION_TEXT).length === 4, "every exception code explained");
  return { passed, failed };
}
