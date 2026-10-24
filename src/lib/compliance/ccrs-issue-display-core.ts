/**
 * src/lib/compliance/ccrs-issue-display-core.ts — CCRS Bible Part 17, slice S-17a.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-10-19 the owner's production hub said "17 lot(s) were left out of
 * Inventory.csv … Each row says why" — and showed no rows. The builder had
 * collected every row with its reason (`CcrsSyncIssue.rows`), but the submit
 * gate's input type had no `rows` field, so the page and the export refusal
 * dropped them (Part 17 §C.4 defect 1; evidence:
 * docs/ccrs-bible/evidence/2026-10-19-owner-screenshots/). An error that says
 * "each row says why" and then hides the rows is not something an operator can
 * act on, so the batch stayed blocked with no way forward.
 *
 * This module is the ONE place that turns a withheld row's reason into:
 *   1. a reason CLASS (so 17 rows can be summarised "12 × not in the published
 *      menu, 5 × …" instead of 17 lines to read), and
 *   2. the NEXT STEP the operator takes for that class, in plain words, naming
 *      the exact button or section of the hub.
 * and renders a plain-text block (every row, never capped) for the copy button
 * and for the export route's 409 refusal.
 *
 * Grounding: the reasons classified here are the literal strings produced by
 * src/lib/compliance/ccrs-ledger-core.ts (routeOperation, resolveProductName,
 * planLedgerBatch). A test reads that file and fails if any reason string there
 * is not classified, so a new reason cannot silently fall into "unclassified".
 * Insert/Update rule: [G L0246-L0248]. Name join: [G L0580-L0583].
 *
 * PURE. No I/O, no React, no `server-only`.
 */
import { NO_PRODUCT_ID_REASON, type LedgerEnv } from "./ccrs-ledger-core";
import { CULTIVERA_NOT_ON_RECORD_REASON } from "./ccrs-identity-guard-core";

/** One row of an issue (structurally identical to CcrsIssueRow in ccrs-preflight-core). */
export type DisplayRow = { id: string; label: string; detail?: string };

/** What the display layer needs from an issue. GateIssue satisfies this. */
export type DisplayIssue = {
  severity: "error" | "warning";
  file: string;
  message: string;
  count?: number;
  code?: string;
  specPin?: string;
  rows?: readonly DisplayRow[];
};

export const WITHHOLD_CLASSES = [
  "no-product-id",
  "not-in-published-menu",
  "uncertain",
  "deleted-id",
  "unknown-status",
  "filed-product-unproven",
  "name-already-filed",
  "conflicting-renames",
  "cannot-delete",
  "cultivera-not-on-record",
  "unclassified",
] as const;
export type WithholdClass = (typeof WITHHOLD_CLASSES)[number];

const PRODUCT_WITHHELD_PREFIX = "its product is withheld: ";

/**
 * Classify one withhold reason. A lot withheld because ITS PRODUCT is withheld
 * is classified by the product's reason (the fix is the product's fix).
 * Order matters only where prefixes could overlap; each test below is exact.
 */
export function classifyWithholdReason(reason: string | null | undefined): WithholdClass {
  let r = (reason ?? "").trim();
  if (r.startsWith(PRODUCT_WITHHELD_PREFIX)) r = r.slice(PRODUCT_WITHHELD_PREFIX.length).trim();
  if (r === NO_PRODUCT_ID_REASON) return "no-product-id";
  // S-17b enriches this reason with WHY in brackets (ccrs-lot-product-core
  // enrichLotWithholdReason): "… menu (hidden in the published menu: …)".
  if (r === "its product is not in the published menu" || r.startsWith("its product is not in the published menu (")) return "not-in-published-menu";
  if (r.startsWith("last file outcome is uncertain")) return "uncertain";
  if (r.startsWith("id was Deleted in CCRS")) return "deleted-id";
  if (r.startsWith("id status is unknown")) return "unknown-status";
  if (
    r === "filed lot has no filed Product Identifier" ||
    /^filed Product .+ is not in the Product ledger$/.test(r) ||
    /^filed Product .+ is in state ".*"$/.test(r) ||
    /^filed Product .+ has no filed Name$/.test(r)
  ) {
    return "filed-product-unproven";
  }
  if (r.startsWith("this exact name is already filed under CCRS product")) return "name-already-filed";
  if (r.startsWith("conflicting renames of filed Product")) return "conflicting-renames";
  if (r.startsWith("cannot Delete a record")) return "cannot-delete";
  // R74 S25: held by ccrs-identity-guard-core (exact constant).
  if (r === CULTIVERA_NOT_ON_RECORD_REASON) return "cultivera-not-on-record";
  return "unclassified";
}

/** Short label for a class, used in the per-issue summary line. */
export const WITHHOLD_CLASS_LABEL: Record<WithholdClass, string> = {
  "no-product-id": "no CCRS Product id assigned",
  "not-in-published-menu": "product not in the published menu",
  uncertain: "last CCRS outcome uncertain",
  "deleted-id": "id was Deleted in CCRS",
  "unknown-status": "CCRS status unknown",
  "filed-product-unproven": "filed product cannot be proven",
  "name-already-filed": "name already filed under another CCRS product",
  "conflicting-renames": "two different renames chosen",
  "cannot-delete": "cannot Delete (not on file)",
  "cultivera-not-on-record": "Cultivera lot not on the CCRS record",
  unclassified: "other reason (read the row)",
};

/**
 * The operator's next step for a class, in the environment being viewed.
 * Every hint names a real control on /admin/compliance/ccrs or a bible part;
 * none tells the operator to send anything to CCRS on a guess.
 */
export function nextStepFor(cls: WithholdClass, env: LedgerEnv): string {
  switch (cls) {
    case "no-product-id":
      return env === "prod"
        ? 'Press "Assign CCRS Product ids (GWP-)" in the blue box above the verdict, then rebuild. Production only; ids are permanent.'
        : 'Scroll to "CCRS files — PREprod", PREprod set-up step 2, and press "Assign PREprod ids". PREprod ids are separate from production ids by design, so assigning in production does not carry over.';
    case "not-in-published-menu":
      return "The lot's POS product key matches no visible item in the published menu, so Product.csv cannot name it. Open Menu review: if the item is hidden, fix the reason it is hidden and publish; if it is only in a staged version, publish that version; if no item has this key, the lot's product key is wrong. Then rebuild.";
    case "uncertain":
      return 'The last file that carried this record has no recorded CCRS answer. In "CCRS files" below, record that file\'s success or error email (or "No email" after 60 minutes), then rebuild. See Part 06.';
    case "deleted-id":
      return "CCRS ids are never re-used after a Delete. Do not re-send this record; decide with compliance what replaces it (Part 07) before rebuilding.";
    case "unknown-status":
      return "We do not know whether CCRS holds this id. Nothing is sent until the fresh CCRS data copy (Part 17 §G) or probe P-07 settles it.";
    case "filed-product-unproven":
      return "CCRS holds this lot, but the product it was filed under is not proven in our ledger copy, so we cannot write the exact filed product name [G L0580-L0583]. This is fixed by re-seeding from the fresh CCRS data copy (Part 17 §G, slice S-15), not by editing the lot.";
    case "name-already-filed":
      return "CCRS already holds a different product with this exact name, and Inventory joins Product by name [G L0580-L0583]. Rename our product so the name is unique, or point the lot at the filed product, then rebuild.";
    case "conflicting-renames":
      return "Two different new names were chosen for one filed product. Choose one name for that product, then rebuild.";
    case "cannot-delete":
      return "A Delete was asked for a record CCRS does not hold. Nothing is sent; check the record before rebuilding.";
    case "cultivera-not-on-record":
      return "This lot came over from Cultivera, but its id is not in our copy of what CCRS holds, so sending it would create a NEW record instead of updating Cultivera's filing. Merge the fresh CCRS data copy (re-seed, Part 17 \u00a7G, slice S-15). If the lot's id is wrong, correct it to the barcode Cultivera filed. Then rebuild. Until then these lots are HELD BACK: the rest of the batch still uploads, and the lots stay on the \"Still owed to CCRS\" list. Re-seed: npx tsx scripts/compliance/reseed-ccrs-ledger.ts --as-of <copy date> --inventory Inventory.csv --product Product.csv --strain Strain.csv --area Area.csv --psql \"<PGURL>\" --report reseed-plan.md (plan, writes nothing), then the same with --expect and --apply.";
    case "unclassified":
      return "No automatic advice for this reason. Read the reason on the row. The record is held back (not sent) until it is understood; the rest of the batch still uploads.";
  }
}

export type ReasonGroup = { cls: WithholdClass; label: string; count: number; nextStep: string };

/** Group an issue's rows by reason class, largest first; ties keep WITHHOLD_CLASSES order. */
export function groupRowsByReason(rows: readonly DisplayRow[], env: LedgerEnv): ReasonGroup[] {
  const counts = new Map<WithholdClass, number>();
  for (const r of rows) {
    const c = classifyWithholdReason(r.detail);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts]
    .map(([cls, count]) => ({ cls, label: WITHHOLD_CLASS_LABEL[cls], count, nextStep: nextStepFor(cls, env) }))
    .sort((a, b) => b.count - a.count || WITHHOLD_CLASSES.indexOf(a.cls) - WITHHOLD_CLASSES.indexOf(b.cls));
}

/** Issues whose rows are ledger withholds and get reason grouping + next steps. */
export function isWithholdIssue(i: Pick<DisplayIssue, "code">): boolean {
  return i.code === "E41_LEDGER_WITHHELD" || i.code === "E52_CULTIVERA_LOT_NOT_ON_RECORD";
}

/** One row as one plain-text line. Never truncated. */
export function rowLine(r: DisplayRow): string {
  const label = r.label && r.label !== r.id ? `${r.label} [${r.id}]` : r.id || r.label;
  return r.detail ? `${label} — ${r.detail}` : label;
}

/**
 * Plain-text block for one issue: header, then (for withholds) one summary line
 * per reason class with its next step, then EVERY row. Used by the copy button
 * and the export refusal. No cap: a capped list hides findings (Part 05 §H).
 */
export function issuePlainText(i: DisplayIssue, env: LedgerEnv, indent = ""): string[] {
  const rows = i.rows ?? [];
  const out: string[] = [];
  const tag = i.code ? ` [${i.code}]` : "";
  out.push(`${indent}${i.file}${tag}: ${i.message}${i.count ? ` (${i.count})` : ""}`);
  if (rows.length === 0) return out;
  if (isWithholdIssue(i)) {
    for (const g of groupRowsByReason(rows, env)) {
      out.push(`${indent}  ${g.count} × ${g.label}. Next step: ${g.nextStep}`);
    }
  }
  out.push(`${indent}  Every row (${rows.length}):`);
  for (const r of rows) out.push(`${indent}    - ${rowLine(r)}`);
  return out;
}

/** Plain-text block for a whole verdict section (copy-all). */
export function issuesPlainText(issues: readonly DisplayIssue[], env: LedgerEnv, title: string): string {
  const lines = [title, ""];
  for (const i of issues) {
    lines.push(...issuePlainText(i, env));
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Merge rows of a duplicate issue into the kept one (dedupe must never drop a
 * row). Rows are identical when id AND detail match.
 */
export function mergeRows(
  kept: readonly DisplayRow[] | undefined,
  extra: readonly DisplayRow[] | undefined,
): DisplayRow[] | undefined {
  if (!kept && !extra) return undefined;
  const out = [...(kept ?? [])];
  const seen = new Set(out.map((r) => `${r.id}\u0000${r.detail ?? ""}`));
  for (const r of extra ?? []) {
    const k = `${r.id}\u0000${r.detail ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ── Self-tests (tsx) ─────────────────────────────────────────────────────────

export function __runCcrsIssueDisplayTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  ok(classifyWithholdReason(NO_PRODUCT_ID_REASON) === "no-product-id", "no id");
  ok(
    classifyWithholdReason(`its product is withheld: ${NO_PRODUCT_ID_REASON}`) === "no-product-id",
    "lot inherits its product's class",
  );
  ok(classifyWithholdReason("its product is not in the published menu") === "not-in-published-menu", "menu");
  ok(
    classifyWithholdReason("its product is not in the published menu (only in a staged menu version that is not published yet)") ===
      "not-in-published-menu",
    "S-17b enriched menu reason keeps its class",
  );
  ok(classifyWithholdReason("its product is not in the published menuX") === "unclassified", "no loose prefix match");
  ok(classifyWithholdReason("last file outcome is uncertain — reconcile first (Part 06)") === "uncertain", "uncertain");
  ok(classifyWithholdReason('filed Product 1234.ABC is in state "deleted"') === "filed-product-unproven", "filed state");
  ok(classifyWithholdReason("something new") === "unclassified", "unknown reason is unclassified, not guessed");
  ok(classifyWithholdReason(undefined) === "unclassified", "missing reason");
  ok(nextStepFor("no-product-id", "prod").includes("Assign CCRS Product ids"), "prod hint names prod button");
  ok(classifyWithholdReason(CULTIVERA_NOT_ON_RECORD_REASON) === "cultivera-not-on-record", "R74 S25: held Cultivera lot classified");
  ok(isWithholdIssue({ code: "E52_CULTIVERA_LOT_NOT_ON_RECORD" }), "R74 S25: E52 rows get reason grouping");
  ok(nextStepFor("no-product-id", "preprod").includes("Assign PREprod ids"), "preprod hint names preprod button");

  const rows: DisplayRow[] = [
    { id: "a", label: "LOT-A", detail: "its product is not in the published menu" },
    { id: "b", label: "LOT-B", detail: `its product is withheld: ${NO_PRODUCT_ID_REASON}` },
    { id: "c", label: "LOT-C", detail: "its product is not in the published menu" },
  ];
  const g = groupRowsByReason(rows, "prod");
  ok(g.length === 2 && g[0].cls === "not-in-published-menu" && g[0].count === 2, "grouped largest first");
  const txt = issuePlainText({ severity: "error", file: "Inventory", message: "m", count: 3, code: "E41_LEDGER_WITHHELD", rows }, "prod");
  ok(txt.filter((l) => l.includes("    - ")).length === 3, "every row printed");
  ok(mergeRows([rows[0]], [rows[0], rows[1]])!.length === 2, "merge keeps distinct rows once");
  ok(mergeRows(undefined, undefined) === undefined, "merge of nothing stays undefined");

  if (failed === 0) console.log(`ccrs-issue-display-core: all ${passed} tests passed`);
  return { passed, failed };
}
