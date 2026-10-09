/**
 * src/lib/admin/issues-core.ts  (S28 — one Issues model for Publish, Inventory
 * and the Manifest page)
 *
 * PURE. No React, no next/*, no I/O. Embedded self-tests run in
 * scripts/compliance/run-pure-selftests.ts; tests/compliance/s28-issues-tabs.test.ts
 * renders the components and pins the page wiring.
 *
 * Every builder turns STORED state the page already read (persisted planner
 * diagnostics, lot stats, the intel command center, the sellability report,
 * lot rows) into Issue rows. Nothing here reads a URL result param, so an
 * issue disappears the moment its cause is fixed and the page reloads — never
 * because a banner was dismissed (bible S28 goal; PatternFly "Alert" guidance:
 * alerts that report a persistent condition disappear only when resolved).
 *
 * Severity (owner decision D-R2-1):
 *   - "blocking" → rendered under "Needs action"; drives the one summary line.
 *   - "warning"  → rendered under "Worth a look"; counted on the tab badge.
 *   - "fyi"      → NOT rendered on the Issues tab and NOT counted (it goes to
 *                  History / the timeline, collapsed).
 * The rule this file uses for "blocking": something is stopping product from
 * being sold or published right now, or a compliance ceiling / stop-sale rule
 * is crossed (recall, expired stock, WAC 314-55-079(10), WAC 314-55-080, a lot
 * held by the activation gate, stock the register cannot ring up). Everything
 * that is paperwork or data-completeness is a warning.
 *
 * Ordering is most-to-least severe (PatternFly "Notification drawer" ordering),
 * stable within a severity so each builder's own order is kept.
 */

import { explainDiagnostic, type DiagnosticExplanation } from "@/lib/pos/publish-guard-core";
import { draftsForManifestHref } from "@/lib/catalog/draft-deep-link-core";
import { waitingMenuFix, type WaitingMenuVersion } from "@/lib/pos/menu-waiting-link-core";
import { lotPageHref } from "@/lib/pos/issue-fix-link-core";
import type { LotGateReason } from "@/lib/inventory/lot-activation-gate-core";

export type IssueSeverity = "blocking" | "warning" | "fyi";

export type IssueFix = { href: string; label: string };

export type IssueExtra = { href: string; label: string };

export type Issue = {
  severity: IssueSeverity;
  /** Stable machine code (diagnostic code or a builder-owned code). */
  code: string;
  /** Short human title. */
  title: string;
  /** What it means for the owner, in plain English. */
  meaning: string;
  /** The ONE place that fixes it, or null when no page can (said honestly in `fixText`). */
  fix: IssueFix | null;
  /** "How to fix it" sentence. */
  fixText?: string | null;
  /** What it is about (a delivery, a lot) — shown above the title. */
  subject?: string | null;
  /** The raw message (planner diagnostic text), shown small. */
  detail?: string | null;
  /** Secondary destinations (S26 extras). */
  extra?: IssueExtra[];
  /** Optional "Why did this happen?" sentence. */
  why?: string | null;
};

export type IssueSummary = {
  blocking: number;
  warning: number;
  fyi: number;
  /** The summary-line text, or null when nothing blocks (D-R2-2). */
  headline: string | null;
};

const RANK: Record<IssueSeverity, number> = { blocking: 0, warning: 1, fyi: 2 };

/** Most-to-least severe; stable (keeps each builder's own order within a severity). */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => RANK[a.issue.severity] - RANK[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Counts + the summary-line headline. FYI is counted separately and never in
 * the headline or the tab badge (D-R2-1). Headline is null at blocking = 0, so
 * the summary line renders nothing (D-R2-2).
 */
export function summarizeIssues(issues: readonly Issue[]): IssueSummary {
  let blocking = 0;
  let warning = 0;
  let fyi = 0;
  let firstBlocking: Issue | null = null;
  for (const i of issues) {
    if (i.severity === "blocking") {
      blocking += 1;
      if (!firstBlocking) firstBlocking = i;
    } else if (i.severity === "warning") warning += 1;
    else fyi += 1;
  }
  const headline =
    blocking > 0 && firstBlocking
      ? `${blocking} ${plural(blocking, "item needs", "items need")} action \u2014 ${firstBlocking.title}`
      : null;
  return { blocking, warning, fyi, headline };
}

/** The Issues tab badge: blocking + warning (never fyi); danger only when something blocks. */
export function issuesTabBadge(s: IssueSummary): { count: number; countTone: "neutral" | "danger" } {
  return { count: s.blocking + s.warning, countTone: s.blocking > 0 ? "danger" : "neutral" };
}

/** The rows the Issues tab renders, split into its two sections (fyi dropped). */
export function splitIssueSections(issues: readonly Issue[]): { needsAction: Issue[]; worthALook: Issue[] } {
  const sorted = sortIssues(issues);
  return {
    needsAction: sorted.filter((i) => i.severity === "blocking"),
    worthALook: sorted.filter((i) => i.severity === "warning"),
  };
}

/** The chip text on a Publish row: "{n} issue{s} · open Issues" (bible S28.4). */
export function issueChipLabel(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = Math.floor(n);
  return `${c} issue${c === 1 ? "" : "s"} \u00b7 open Issues`;
}

// ---------------------------------------------------------------------------
// Publish (stored planner diagnostics, F-117)
// ---------------------------------------------------------------------------

export type StoredDiagnostic = { severity?: unknown; code?: unknown; message?: unknown; context?: unknown };

export type PublishIssueInput = {
  versionId: string;
  /** "Delivery M-1 from Acme" etc. — the row's own source line. */
  subject: string;
  /** summary_json.diagnostics as parsed by parseIntakeSummary. */
  diagnostics: readonly StoredDiagnostic[];
  /** What the fix links know about the delivery (no I/O here). */
  link: { manifestId: string | null; vendor: string | null; manifestNumber: string | null };
  /** menu_versions.warning_count — so a warning never goes uncounted. */
  warningCount: number;
  /** The row's review page (it runs the S26 lookups for per-draft links). */
  reviewHref: string;
  /** Why the row waits (publish-queue-core queueReason). */
  reason: "fact_review" | "publish_failed" | "needs_publish" | "pos_upload" | "cutover";
  /** The row's one primary action (publish-queue-core primaryAction). */
  action: { href: string; label: string };
};

/** Same slice the version page renders (version/[versionId]/page.tsx warnings.slice(0, 100)). */
export const PUBLISH_ISSUE_CAP = 100;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function fromExplanation(
  severity: IssueSeverity,
  code: string,
  message: string,
  x: DiagnosticExplanation,
  subject: string,
): Issue {
  return {
    severity,
    code,
    title: x.title,
    meaning: x.meaning,
    detail: message || null,
    fixText: x.fix,
    fix: x.fixHref && x.fixLabel ? { href: x.fixHref, label: x.fixLabel } : null,
    extra: x.extra && x.extra.length > 0 ? x.extra.map((e) => ({ href: e.href, label: e.label })) : undefined,
    why: x.why ?? null,
    subject,
  };
}

/**
 * One version's issues. Warnings come verbatim from the stored diagnostics,
 * explained by the SAME explainDiagnostic the version page uses (F-116), so
 * the two pages can never disagree. A held or failed publish is the one
 * blocking row (it cannot go live without a person). If the stored
 * warning_count exceeds what summary_json carries (POS uploads keep their
 * diagnostics in the import's own table), one honest row points at the review
 * page that lists them — a warning is never silently uncounted.
 */
export function buildPublishIssuesForVersion(v: PublishIssueInput): Issue[] {
  const out: Issue[] = [];
  if (v.reason === "fact_review") {
    out.push({
      severity: "blocking",
      code: "publish_held_fact_review",
      title: "Held for a fact check",
      meaning:
        "Some products on this update have facts the system flagged (potency, category or name). It will not go live until someone looks.",
      fixText: "Open the flagged facts, confirm or correct each one, then publish.",
      fix: { href: v.action.href, label: v.action.label.replace(/\s*\u2192$/, "") },
      subject: v.subject,
    });
  } else if (v.reason === "publish_failed") {
    out.push({
      severity: "blocking",
      code: "publish_failed",
      title: "Publish didn't finish",
      meaning: "The automatic publish for this update started but did not complete, so the live menu does not have these products yet.",
      fixText: "Open the review page and publish again. Nothing is published twice.",
      fix: { href: v.action.href, label: v.action.label.replace(/\s*\u2192$/, "") },
      subject: v.subject,
    });
  }
  const warnings = v.diagnostics.filter((d) => d && d.severity === "warning");
  const back = "/admin/publish";
  for (const d of warnings.slice(0, PUBLISH_ISSUE_CAP)) {
    const code = str(d.code);
    const message = str(d.message);
    const x = explainDiagnostic(code, message, { ...v.link, context: d.context, back });
    out.push(fromExplanation("warning", code, message, x, v.subject));
  }
  const shown = Math.min(warnings.length, PUBLISH_ISSUE_CAP);
  const unlisted = Math.max(0, Math.floor(v.warningCount) - shown);
  if (unlisted > 0) {
    out.push({
      severity: "warning",
      code: "publish_more_on_review",
      title: `${unlisted} more ${plural(unlisted, "note", "notes")} on the review page`,
      meaning: "This update carries more warnings than this page lists. The review page shows every one, each with its fix.",
      fixText: "Open the review page.",
      fix: { href: v.reviewHref, label: "Open the review page" },
      subject: v.subject,
    });
  }
  for (const d of v.diagnostics.filter((x) => x && x.severity === "info").slice(0, PUBLISH_ISSUE_CAP)) {
    const code = str(d.code);
    const message = str(d.message);
    out.push(fromExplanation("fyi", code, message, explainDiagnostic(code, message), v.subject));
  }
  return out;
}

export function buildPublishIssues(versions: readonly PublishIssueInput[]): Issue[] {
  return sortIssues(versions.flatMap(buildPublishIssuesForVersion));
}

/** Blocking + warning for one version — the number its row chip shows. */
export function publishChipCount(issues: readonly Issue[]): number {
  const s = summarizeIssues(issues);
  return s.blocking + s.warning;
}

// ---------------------------------------------------------------------------
// Inventory (lot stats, gap insights, sellability report)
// ---------------------------------------------------------------------------

export type GapRow = { key: string; label: string; count: number; href?: string; weight: number };

export type InventoryIssueInput = {
  /** receivedDateFlagMessage(...) — null when nothing is missing. */
  receivedDateFlag: string | null;
  /** stats.missingReceivedDateWithStock — stock on the floor with no evidenced date. */
  receivedMissingWithStock: number;
  /** inventoryGapInsights(stats). */
  gaps: readonly GapRow[];
  /** Register sellability: blocked counts by cause (summary.byCode), null when unread. */
  blockedByCause: Partial<Record<"no_product_link" | "no_menu_card" | "hidden_card" | "recall_hold", number>> | null;
  /** RestoreToSalePanel rows (86'd products with live stock). */
  restorableCount: number;
  /** How many expired-lot rows buildIntelIssues produced (0 → keep the stats row as the fallback). */
  intelExpiredRows: number;
};

/** Where the Issues tab's own sections sit (anchors on RegisterSellabilityBanner / RestoreToSalePanel). */
export const REGISTER_BLOCKED_ANCHOR = "register-blocked";
export const RESTORE_TO_SALE_ANCHOR = "restore-to-sale";

const BLOCKED_CAUSE_COPY: Record<"no_product_link" | "no_menu_card" | "hidden_card" | "recall_hold", string> = {
  no_product_link: "not linked to a product",
  no_menu_card: "not on the published menu",
  hidden_card: "hidden on the menu",
  recall_hold: "under a recall hold",
};

/**
 * Round 12 (owner: "make sure that the products from the Cultivera upload
 * specifically can reach the fix pages"). Three lot gaps are exactly the
 * fields the one-time Cultivera import leaves blank and Bulk fill can fill
 * (bulk-fill-core BULK_FILLABLE_FIELDS; eligibility = migration lots only).
 * The gap row used to offer only "Show these lots"; it now ALSO offers the
 * same filtered list opened straight into Bulk fill with the field chosen.
 * Keys are the lot-gap params (lot-gap-core LOT_GAP_DEFINITIONS).
 */
export const GAP_BULK_FILL_FIELD: Readonly<Record<string, "expires_on" | "unit_cost_minor_units" | "pos_product_key">> = {
  missingExpiry: "expires_on",
  unknownCost: "unit_cost_minor_units",
  missingProductLink: "pos_product_key",
};

/** The gap's own filtered list, opened in Bulk fill mode with its field preselected. */
export function gapBulkFillHref(key: string, href: string | undefined | null): string | null {
  const field = GAP_BULK_FILL_FIELD[key];
  if (!field || !href) return null;
  return `${href}${href.includes("?") ? "&" : "?"}bulk=1&bulkField=${field}`;
}

/** R34: the expiration-rules page (category / type rules that date undated lots). */
export const EXPIRATION_RULES_HREF = "/admin/inventory/expiration-rules";

/** Gap keys that mean "product that must not be sold may be on the floor" (stop-sale). */
const BLOCKING_GAPS = new Set(["recalled", "expired"]);

export function buildInventoryIssues(input: InventoryIssueInput): Issue[] {
  const out: Issue[] = [];

  // Register-blocked stock: product on the shelf the till cannot ring up.
  if (input.blockedByCause) {
    for (const cause of ["no_product_link", "no_menu_card", "hidden_card", "recall_hold"] as const) {
      const n = input.blockedByCause[cause] ?? 0;
      if (n <= 0) continue;
      out.push({
        severity: "blocking",
        code: `register_blocked_${cause}`,
        title: `${n} ${plural(n, "lot", "lots")} with stock the register cannot sell \u2014 ${BLOCKED_CAUSE_COPY[cause]}`,
        meaning:
          "These lots have units on hand, so a customer can ask for them, but the register will refuse the scan until the cause is fixed.",
        fixText: "Each lot is listed below with the one button that fixes it.",
        fix: { href: `#${REGISTER_BLOCKED_ANCHOR}`, label: "See the lots and their fixes" },
      });
    }
  }

  // SLICE 2 compliance flag (standing rule 3): never quietly filled in.
  if (input.receivedDateFlag) {
    out.push({
      severity: input.receivedMissingWithStock > 0 ? "blocking" : "warning",
      code: "received_date_missing",
      title: "Received dates missing",
      meaning: input.receivedDateFlag,
      fixText: "Open the worklist, then add the date from the paperwork on each lot.",
      fix: { href: "/admin/inventory?needsReceivedDate=1", label: "Show these lots" },
    });
  }

  for (const g of input.gaps) {
    if (g.count <= 0) continue;
    // Expired lots are listed one per lot by buildIntelIssues; the stats row
    // stays only as the fallback when the intel read produced none.
    if (g.key === "expired" && input.intelExpiredRows > 0) continue;
    const bulkHref = gapBulkFillHref(g.key, g.href);
    // R34: lots with no expiry date can ALSO be dated by the owner's
    // category / type expiration rules (any lot, not only Cultivera imports).
    const extras = [
      ...(bulkHref ? [{ href: bulkHref, label: "Bulk fill the Cultivera-import lots" }] : []),
      ...(g.key === "missingExpiry" ? [{ href: EXPIRATION_RULES_HREF, label: "Date them with expiration rules" }] : []),
    ];
    out.push({
      severity: BLOCKING_GAPS.has(g.key) ? "blocking" : "warning",
      code: `gap_${g.key}`,
      title: `${g.count} ${plural(g.count, "lot", "lots")} ${g.label}`,
      meaning: GAP_MEANING[g.key] ?? "Open the list to see exactly which lots.",
      fixText: g.href ? "Open the filtered list; every lot on it has this gap." : null,
      fix: g.href ? { href: g.href, label: "Show these lots" } : null,
      ...(extras.length > 0 ? { extra: extras } : {}),
    });
  }

  if (input.restorableCount > 0) {
    const n = input.restorableCount;
    out.push({
      severity: "warning",
      code: "restorable_86",
      title: `${n} ${plural(n, "product is", "products are")} marked unavailable but you have stock`,
      meaning:
        "Someone pressed \u201c86\u201d at a register, or they were emptied and restocked. The register already sells them; the website and reports still say unavailable.",
      fixText: "Restore each one below. It recomputes from live lot units, so it can never invent stock.",
      fix: { href: `#${RESTORE_TO_SALE_ANCHOR}`, label: "Restore to sale" },
    });
  }
  return sortIssues(out);
}

const GAP_MEANING: Record<string, string> = {
  recalled: "A recall is on these lots. They must be pulled from sale and handled as the recall notice says.",
  expired: "These active lots are past their expiry date. Expired product may not be sold; pull it and record the destruction.",
  quarantine: "Held out of sale, waiting for a decision (release, return or destroy).",
  missingCoa:
    "No lab result is linked to these lots in the system. The COA may exist on paper; the link is what CCRS reporting reads. Lots from the one-time Cultivera import never had one linked \u2014 a COA spreadsheet import for them is on the roadmap.",
  expiringSoon: "These lots expire soon. Sell them first (First-Expired, First-Out) or plan a markdown.",
  missingProductLink: "These lots are not tied to a product, so they cannot be sold at the register.",
  emptyActive: "Marked active with nothing on hand \u2014 usually a lot that should be sold out.",
  missingExpiry: "No expiry date on file, so expiry checks cannot protect these lots.",
  unknownCost: "No unit cost on file, so the on-hand value on this page is understated.",
};

// ---------------------------------------------------------------------------
// Inventory intelligence thresholds (D-R2-7)
// ---------------------------------------------------------------------------

export type IntelCenterLike = {
  supply: { months: number | null; overCeiling: boolean };
  overdue: { total: number };
  medicalInStock: number;
};

export type IntelLotLike = {
  id: string;
  productName: string | null;
  status: string;
  expiresOn: string | null;
};

/** One row per expired lot, up to this many; then one overflow row (never silent). */
export const EXPIRED_LOT_ROW_CAP = 50;

/**
 * Crossed thresholds from inventory-intel-core as rows. Nothing is emitted for
 * a threshold that is not crossed. `today` is the store's Pacific YYYY-MM-DD
 * (Rule 8). The medical rule only applies to an endorsed store
 * (WAC 314-55-080), read from tax settings — never assumed.
 */
export function buildIntelIssues(
  center: IntelCenterLike,
  opts: { today: string; lots: readonly IntelLotLike[]; medicalEndorsement: boolean },
): Issue[] {
  const out: Issue[] = [];
  if (center.supply.overCeiling) {
    const m = center.supply.months;
    out.push({
      severity: "blocking",
      code: "intel_supply_over_ceiling",
      title: "Over the 4-month inventory ceiling",
      meaning: `At the current sell-through you hold about ${m ?? "?"} months of supply. WAC 314-55-079(10) allows at most four months of average inventory on premises.`,
      fixText: "Slow or skip the next orders until sell-through catches up. The estimate is on the Insights tab.",
      fix: { href: "/admin/purchasing", label: "Open Purchasing" },
    });
  }
  if (opts.medicalEndorsement && center.medicalInStock === 0) {
    out.push({
      severity: "blocking",
      code: "intel_no_medical_stock",
      title: "No DOH-compliant (medical) product in stock",
      meaning:
        "Your store holds a medical endorsement, and an endorsed retailer must keep DOH-compliant product in stock or on order (WAC 314-55-080).",
      fixText: "Order compliant product from a processor.",
      fix: { href: "/admin/purchasing", label: "Open Purchasing" },
    });
  }
  const expired = opts.lots.filter(
    (l) => l.status === "active" && typeof l.expiresOn === "string" && l.expiresOn !== "" && l.expiresOn < opts.today,
  );
  for (const l of expired.slice(0, EXPIRED_LOT_ROW_CAP)) {
    out.push({
      severity: "blocking",
      code: "intel_expired_lot",
      title: `Expired and still active \u2014 ${l.productName?.trim() || "unnamed lot"}`,
      meaning: `Expired on ${l.expiresOn}. Expired product may not be sold.`,
      fixText: "Open the lot and change its status (or record the destruction under Adjust quantity).",
      fix: { href: lotPageHref(l.id, "lifecycle"), label: "Open lot to pull it" },
    });
  }
  if (expired.length > EXPIRED_LOT_ROW_CAP) {
    const more = expired.length - EXPIRED_LOT_ROW_CAP;
    out.push({
      severity: "blocking",
      code: "intel_expired_more",
      title: `\u2026and ${more} more expired ${plural(more, "lot", "lots")}`,
      meaning: "Only the first lots are listed one by one; the list shows every expired active lot.",
      fixText: "Open the filtered list.",
      fix: { href: "/admin/inventory?status=active&expiring=0", label: "Show all expired lots" },
    });
  }
  if (center.overdue.total > 0) {
    const n = center.overdue.total;
    out.push({
      severity: "warning",
      code: "intel_count_overdue",
      title: `${n} ${plural(n, "lot is", "lots are")} overdue for a cycle count`,
      meaning: "Past their count cadence (A monthly, B quarterly, C twice a year). Counting catches shrink before it grows.",
      fixText: "Start a cycle count.",
      fix: { href: "/admin/inventory/cycle-counts", label: "Open cycle counts" },
    });
  }
  return sortIssues(out);
}

/** How many expired-lot rows an intel issue list holds (feeds buildInventoryIssues). */
export function countExpiredLotRows(issues: readonly Issue[]): number {
  return issues.filter((i) => i.code === "intel_expired_lot" || i.code === "intel_expired_more").length;
}

// ---------------------------------------------------------------------------
// Manifest page (stored lot rows + the snapshot the page already read)
// ---------------------------------------------------------------------------

export type ManifestHeldLot = {
  id: string;
  label: string;
  /** evaluateLotActivation(...).reasons — empty means the gate would now pass. */
  reasons: readonly LotGateReason[];
};

export type ManifestIssueInput = {
  manifestId: string;
  /** pending / in_transit / received — receiving still open. */
  inProgress: boolean;
  /** Accepted lots still in quarantine after a finalize, with their gate verdicts. */
  heldLots: readonly ManifestHeldLot[];
  /** Lines with no COA while receiving is open. */
  missingCoaLines: number;
  /** Lines whose LCB type maps to no website category. */
  unmappedCategoryLines: number;
  /** intakeMenuStepSnapshot(...) — null when unread (then nothing is claimed). */
  menu: {
    pendingDrafts: number;
    stagedWaiting: boolean;
    /** R13a: the one waiting update and why - the row links where it is fixed. */
    waitingVersion?: WaitingMenuVersion | null;
  } | null;
};

const HELD_REASON_SHORT: Record<string, string> = {
  missing_ccrs_id: "CCRS identifier",
  missing_lab_result: "a COA / lab result",
  failed_lab_result: "a passing lab result (this one FAILED)",
};

/**
 * The manifest page's `?held=` as a tab-opening signal. finalizeIntakeAction
 * ALWAYS appends `&held=${result.blocked.length}` (intake/actions.ts), so
 * "0" is a clean finalize and must not open Issues; the pre-S28 banner
 * guarded `held !== "0"` for the same reason. Anything else non-empty opens it.
 */
export function manifestHeldAutoOpen(held: string | undefined): string | undefined {
  return typeof held === "string" && held.length > 0 && held !== "0" ? held : undefined;
}

export function buildManifestIssues(input: ManifestIssueInput): Issue[] {
  const out: Issue[] = [];
  if (!input.inProgress) {
    for (const lot of input.heldLots) {
      if (lot.reasons.length === 0) {
        out.push({
          severity: "warning",
          code: "manifest_held_now_clear",
          subject: lot.label,
          title: `Held in quarantine, now clear \u2014 ${lot.label}`,
          meaning:
            "This accepted lot was held when the intake was finalized. Its identifier and lab result now pass the go-live check.",
          fixText: "Open the lot and set its status to Active under Lifecycle status.",
          fix: { href: lotPageHref(lot.id, "lifecycle"), label: "Open lot to activate it" },
        });
        continue;
      }
      const failed = lot.reasons.some((r) => r.code === "failed_lab_result");
      const labIssue = failed || lot.reasons.some((r) => r.code === "missing_lab_result");
      const missing = lot.reasons.map((r) => HELD_REASON_SHORT[r.code] ?? r.code).join(" and ");
      out.push({
        severity: "blocking",
        code: "manifest_held_lot",
        subject: lot.label,
        title: `Held in quarantine \u2014 ${lot.label}`,
        meaning: `Missing: ${missing}. It cannot go live until that is resolved.`,
        detail: lot.reasons.map((r) => r.message).join(" "),
        fixText: failed
          ? "A FAILED result can never go live. Open the lot to see the result, then return it to the vendor or record the destruction."
          : "Open the lot to see what is on file. A COA or CCRS identifier arrives with the manifest at receiving; the lot page cannot attach one yet, so ask the vendor for a corrected manifest if it is missing.",
        fix: { href: lotPageHref(lot.id, labIssue ? "coa" : undefined), label: "Open lot" },
      });
    }
  }
  if (input.inProgress && input.missingCoaLines > 0) {
    const n = input.missingCoaLines;
    out.push({
      severity: "warning",
      code: "manifest_lines_missing_coa",
      title: `${n} ${plural(n, "line has", "lines have")} no COA / lab result`,
      meaning:
        "A lot with no lab result is held in quarantine at finalize. WA CCRS manifest reporting needs the COA\u2019s LabtestexternalIdentifier.",
      fixText: "Check the COA column on the lines; ask the vendor for the missing COA before you finalize.",
      fix: { href: `/admin/inventory/intake/${input.manifestId}#manifest-lines`, label: "Review the lines" },
    });
  }
  if (input.unmappedCategoryLines > 0) {
    const n = input.unmappedCategoryLines;
    out.push({
      severity: "warning",
      code: "manifest_unmapped_category",
      title: `${n} ${plural(n, "line has", "lines have")} an unmapped category`,
      meaning: "Their LCB inventory type is not mapped to a website category, so the menu would not know where to file them.",
      fixText: "Map the inventory type once; every future delivery uses it.",
      fix: { href: "/admin/settings/types?tab=inventory", label: "Open Types & Categories" },
    });
  }
  if (input.menu && !input.inProgress && input.menu.pendingDrafts > 0) {
    const n = input.menu.pendingDrafts;
    out.push({
      severity: "warning",
      code: "manifest_drafts_waiting",
      title: `${n} new ${plural(n, "product is", "products are")} waiting in Product Onboarding`,
      meaning: "They came in on this delivery but are not on the menu yet. Price and approve them to put them live.",
      fixText: "Open this delivery\u2019s drafts.",
      fix: { href: draftsForManifestHref(input.manifestId), label: "Open this delivery\u2019s drafts" },
    });
  }
  if (input.menu && input.menu.stagedWaiting && input.menu.waitingVersion) {
    // R13a: the link goes where the reason is FIXED (menu-waiting-link-core):
    // a fact hold to this delivery's approved products (Keep / Correct / Take
    // off), a cutover hold to the cutover page, anything else to the update's
    // own review page. Never the bare Publish page (owner: "nothing there").
    const w = waitingMenuFix({ manifestId: input.manifestId, version: input.menu.waitingVersion });
    out.push({
      severity: "warning",
      code: "manifest_menu_waiting",
      title: "This delivery\u2019s menu update is waiting",
      meaning: w.fixText,
      fixText: `${w.label}.`,
      fix: { href: w.href, label: w.label },
      ...(w.extra ? { extra: [{ href: w.extra.href, label: w.extra.label }] } : {}),
    });
  } else if (input.menu && input.menu.stagedWaiting) {
    out.push({
      severity: "warning",
      code: "manifest_menu_waiting",
      title: "This delivery\u2019s menu update is waiting on Publish",
      meaning: "The products were approved but the update did not go live by itself. The Publish page says why.",
      fixText: "Open Publish Menu.",
      fix: { href: "/admin/publish", label: "Open Publish Menu" },
    });
  }
  return sortIssues(out);
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runIssuesCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`issues-core self-test FAILED: ${what}`);
    }
  };

  const mk = (severity: IssueSeverity, code: string): Issue => ({ severity, code, title: code, meaning: "", fix: null });

  // sortIssues: severity order, stable within.
  const s = sortIssues([mk("fyi", "f1"), mk("warning", "w1"), mk("blocking", "b1"), mk("warning", "w2"), mk("blocking", "b2")]);
  ok(s.map((i) => i.code).join(",") === "b1,b2,w1,w2,f1", "sort blocking→warning→fyi, stable");
  ok(sortIssues([]).length === 0, "sort empty");

  // summarizeIssues + headline pluralisation; fyi never counted in the headline.
  const one = summarizeIssues([mk("blocking", "Lot A held"), mk("warning", "w"), mk("fyi", "f")]);
  ok(one.blocking === 1 && one.warning === 1 && one.fyi === 1, "summary counts");
  ok(one.headline === "1 item needs action \u2014 Lot A held", "headline singular");
  const two = summarizeIssues([mk("warning", "w"), mk("blocking", "First"), mk("blocking", "Second")]);
  ok(two.headline === "2 items need action \u2014 First", "headline plural + first blocking title");
  ok(summarizeIssues([mk("warning", "w"), mk("fyi", "f")]).headline === null, "no headline at blocking 0");
  ok(summarizeIssues([]).headline === null, "empty → null headline");

  // Badge: fyi never counted; danger only when blocking.
  ok(issuesTabBadge(summarizeIssues([mk("fyi", "f"), mk("fyi", "g")])).count === 0, "badge ignores fyi");
  ok(issuesTabBadge(summarizeIssues([mk("warning", "w")])).countTone === "neutral", "warning-only badge neutral");
  const bd = issuesTabBadge(summarizeIssues([mk("warning", "w"), mk("blocking", "b"), mk("fyi", "f")]));
  ok(bd.count === 2 && bd.countTone === "danger", "badge = blocking+warning, danger");

  // Sections: fyi dropped, Needs action holds blocking only.
  const sec = splitIssueSections([mk("fyi", "f"), mk("warning", "w"), mk("blocking", "b")]);
  ok(sec.needsAction.length === 1 && sec.needsAction[0].code === "b", "needs action = blocking");
  ok(sec.worthALook.length === 1 && sec.worthALook[0].code === "w", "worth a look = warning");

  // Chip label.
  ok(issueChipLabel(1) === "1 issue \u00b7 open Issues", "chip singular");
  ok(issueChipLabel(3) === "3 issues \u00b7 open Issues", "chip plural");
  ok(issueChipLabel(0) === null && issueChipLabel(-2) === null && issueChipLabel(Number.NaN) === null, "chip hidden at 0/neg/NaN");

  // Publish: warnings count equals the version page's warnings count.
  const base: PublishIssueInput = {
    versionId: "v1",
    subject: "Delivery M-1",
    diagnostics: [
      { severity: "warning", code: "intake_master_no_vendor", message: "no vendor", context: {} },
      { severity: "warning", code: "some_unknown_code", message: "odd" },
      { severity: "info", code: "draft_superseded_by_pos", message: "fyi" },
      { severity: "error", code: "x", message: "ignored" },
    ],
    link: { manifestId: "11111111-1111-4111-8111-111111111111", vendor: "Acme", manifestNumber: "M-1" },
    warningCount: 2,
    reviewHref: "/admin/menu-imports/version/v1",
    reason: "needs_publish",
    action: { href: "/admin/menu-imports/version/v1", label: "Review & publish \u2192" },
  };
  const p = buildPublishIssuesForVersion(base);
  const pw = p.filter((i) => i.severity === "warning");
  ok(pw.length === 2, "publish warnings == stored warning diagnostics");
  ok(p.filter((i) => i.severity === "fyi").length === 1, "info → fyi");
  ok(p.filter((i) => i.severity === "blocking").length === 0, "needs_publish is not blocking");
  ok(publishChipCount(p) === 2, "chip counts warnings only (no fyi)");
  ok(pw[0].subject === "Delivery M-1" && pw[0].detail === "no vendor", "subject + raw message kept");
  ok(pw[0].fix?.href === "/admin/inventory/intake/11111111-1111-4111-8111-111111111111#manifest-vendor", "S26 fix link carried");
  ok(pw.every((i) => typeof i.title === "string" && i.title.length > 0), "every row has a title");
  // Held → exactly one blocking row using the row's primary action.
  const held = buildPublishIssuesForVersion({ ...base, reason: "fact_review", action: { href: "/f", label: "Check the flagged facts \u2192" } });
  const hb = held.filter((i) => i.severity === "blocking");
  ok(hb.length === 1 && hb[0].fix?.href === "/f" && hb[0].fix?.label === "Check the flagged facts", "fact_review → one blocking row, arrow stripped");
  ok(buildPublishIssuesForVersion({ ...base, reason: "publish_failed" }).filter((i) => i.severity === "blocking").length === 1, "publish_failed blocking");
  ok(buildPublishIssuesForVersion({ ...base, reason: "cutover" }).filter((i) => i.severity === "blocking").length === 0, "cutover not blocking");
  // Uncounted warnings (POS upload keeps them elsewhere) → one honest row.
  const pos = buildPublishIssuesForVersion({ ...base, diagnostics: [], warningCount: 5, reason: "pos_upload" });
  ok(pos.length === 1 && pos[0].code === "publish_more_on_review" && pos[0].title.startsWith("5 more notes"), "uncounted warnings surfaced");
  ok(pos[0].fix?.href === base.reviewHref, "points at the review page");
  ok(buildPublishIssuesForVersion({ ...base, diagnostics: [], warningCount: 1, reason: "pos_upload" })[0].title.startsWith("1 more note "), "singular note");
  ok(buildPublishIssuesForVersion({ ...base, diagnostics: [], warningCount: 0 }).length === 0, "clean version → zero issues");
  // Cap mirrors the version page's 100.
  const many = Array.from({ length: 130 }, () => ({ severity: "warning", code: "c", message: "m" }));
  const capped = buildPublishIssuesForVersion({ ...base, diagnostics: many, warningCount: 130 });
  ok(capped.filter((i) => i.code === "c").length === 100, "cap 100 like the version page");
  ok(capped.some((i) => i.code === "publish_more_on_review" && i.title.startsWith("30 more")), "overflow counted honestly");
  ok(buildPublishIssues([]).length === 0, "no versions → no issues");
  const multi = buildPublishIssues([base, { ...base, versionId: "v2", reason: "fact_review" }]);
  ok(multi[0].severity === "blocking", "multi-version sorted blocking first");

  // Inventory.
  const empty: InventoryIssueInput = {
    receivedDateFlag: null,
    receivedMissingWithStock: 0,
    gaps: [],
    blockedByCause: null,
    restorableCount: 0,
    intelExpiredRows: 0,
  };
  ok(buildInventoryIssues(empty).length === 0, "clean inventory → zero issues (no padding)");
  const rd = buildInventoryIssues({ ...empty, receivedDateFlag: "3 lots have no received date on file.", receivedMissingWithStock: 0 });
  ok(rd.length === 1 && rd[0].severity === "warning" && rd[0].fix?.href === "/admin/inventory?needsReceivedDate=1", "received date → warning + worklist");
  ok(rd[0].fix?.label === "Show these lots" && rd[0].meaning === "3 lots have no received date on file.", "same copy + link as the banner");
  ok(buildInventoryIssues({ ...empty, receivedDateFlag: "x", receivedMissingWithStock: 2 })[0].severity === "blocking", "stock on floor → blocking");
  const gaps = buildInventoryIssues({
    ...empty,
    gaps: [
      { key: "recalled", label: "flagged RECALLED", count: 2, href: "/admin/inventory?status=recalled", weight: 3 },
      { key: "expired", label: "past their expiry date", count: 4, href: "/admin/inventory?status=active&expiring=0", weight: 3 },
      { key: "missingCoa", label: "active without COA", count: 1, href: "/admin/inventory?status=active&coa=no", weight: 3 },
      { key: "zero", label: "none", count: 0, weight: 1 },
      { key: "nohref", label: "no link", count: 1, weight: 1 },
    ],
  });
  ok(gaps.length === 4, "zero-count gaps dropped");
  ok(gaps.filter((i) => i.severity === "blocking").map((i) => i.code).join(",") === "gap_recalled,gap_expired", "recall + expired block");
  ok(gaps.find((i) => i.code === "gap_missingCoa")?.severity === "warning", "missing COA link is a warning");
  ok(gaps.find((i) => i.code === "gap_recalled")?.title === "2 lots flagged RECALLED", "gap title count + label");
  ok(gaps.find((i) => i.code === "gap_missingCoa")?.title === "1 lot active without COA", "gap title singular");
  ok(gaps.find((i) => i.code === "gap_nohref")?.fix === null, "no href → no invented fix");
  // Round 12: Cultivera bulk-fill extras on exactly the three fillable gaps.
  ok(gaps.every((i) => i.extra === undefined), "non-fillable gaps get no bulk extra");
  const fillable = buildInventoryIssues({
    ...empty,
    gaps: [
      { key: "missingExpiry", label: "no expiry", count: 5, href: "/admin/inventory?status=active&missingExpiry=1", weight: 2 },
      { key: "unknownCost", label: "no cost", count: 2, href: "/admin/inventory?status=active&unknownCost=1", weight: 2 },
      { key: "missingProductLink", label: "no link", count: 1, href: "/admin/inventory?status=active&missingProductLink=1", weight: 1 },
      { key: "emptyActive", label: "empty", count: 1, href: "/admin/inventory?status=active&emptyActive=1", weight: 1 },
    ],
  });
  ok(fillable.find((i) => i.code === "gap_missingExpiry")?.extra?.[0]?.href === "/admin/inventory?status=active&missingExpiry=1&bulk=1&bulkField=expires_on", "expiry bulk href");
  ok(fillable.find((i) => i.code === "gap_unknownCost")?.extra?.[0]?.href === "/admin/inventory?status=active&unknownCost=1&bulk=1&bulkField=unit_cost_minor_units", "cost bulk href");
  ok(fillable.find((i) => i.code === "gap_missingProductLink")?.extra?.[0]?.href === "/admin/inventory?status=active&missingProductLink=1&bulk=1&bulkField=pos_product_key", "link bulk href");
  ok(fillable.find((i) => i.code === "gap_emptyActive")?.extra === undefined, "empty-active gets no bulk extra");
  ok(fillable.find((i) => i.code === "gap_missingExpiry")?.extra?.[0]?.label === "Bulk fill the Cultivera-import lots", "bulk label");
  ok(fillable.find((i) => i.code === "gap_missingExpiry")?.extra?.[1]?.href === EXPIRATION_RULES_HREF, "R34: expiry gap also links the expiration rules");
  ok(fillable.find((i) => i.code === "gap_unknownCost")?.extra?.length === 1, "R34: rules link only on the expiry gap");
  ok(gapBulkFillHref("missingExpiry", null) === null, "no href, no bulk link");
  ok(gapBulkFillHref("missingExpiry", "/x") === "/x?bulk=1&bulkField=expires_on", "bulk href without query");
  ok(gapBulkFillHref("expired", "/x?a=1") === null, "expired is not bulk-fillable");
  ok(
    !buildInventoryIssues({ ...empty, intelExpiredRows: 3, gaps: [{ key: "expired", label: "x", count: 3, href: "/h", weight: 3 }] }).some(
      (i) => i.code === "gap_expired",
    ),
    "expired stats row dropped when intel lists lots",
  );
  const blocked = buildInventoryIssues({ ...empty, blockedByCause: { no_product_link: 3, no_menu_card: 0, recall_hold: 1 } });
  ok(blocked.length === 2 && blocked.every((i) => i.severity === "blocking"), "one blocking row per blocked cause");
  ok(blocked[0].fix?.href === "#register-blocked", "points at the per-lot list");
  ok(blocked[0].title.startsWith("3 lots with stock"), "blocked title count");
  ok(buildInventoryIssues({ ...empty, blockedByCause: { recall_hold: 1 } })[0].title.startsWith("1 lot with stock"), "blocked singular");
  const rs = buildInventoryIssues({ ...empty, restorableCount: 1 });
  ok(rs.length === 1 && rs[0].severity === "warning" && rs[0].fix?.href === "#restore-to-sale", "restorable → warning + anchor");
  ok(rs[0].title.startsWith("1 product is"), "restorable singular");

  // Intel thresholds: nothing for a healthy center; one row per crossed threshold.
  const healthy: IntelCenterLike = { supply: { months: 2, overCeiling: false }, overdue: { total: 0 }, medicalInStock: 4 };
  const T = "2026-07-01";
  ok(buildIntelIssues(healthy, { today: T, lots: [], medicalEndorsement: true }).length === 0, "healthy center → zero rows");
  const over = buildIntelIssues({ ...healthy, supply: { months: 5.2, overCeiling: true } }, { today: T, lots: [], medicalEndorsement: false });
  ok(over.length === 1 && over[0].severity === "blocking" && over[0].fix?.href === "/admin/purchasing", "over ceiling → blocking purchasing");
  ok(over[0].meaning.includes("5.2 months") && over[0].meaning.includes("WAC 314-55-079(10)"), "ceiling copy cites months + WAC");
  const med = buildIntelIssues({ ...healthy, medicalInStock: 0 }, { today: T, lots: [], medicalEndorsement: true });
  ok(med.length === 1 && med[0].code === "intel_no_medical_stock" && med[0].severity === "blocking", "no medical stock (endorsed) → blocking");
  ok(buildIntelIssues({ ...healthy, medicalInStock: 0 }, { today: T, lots: [], medicalEndorsement: false }).length === 0, "not endorsed → no medical row");
  const lots: IntelLotLike[] = [
    { id: "a", productName: "Old Kush", status: "active", expiresOn: "2026-06-30" },
    { id: "b", productName: null, status: "active", expiresOn: "2026-05-01" },
    { id: "c", productName: "Today", status: "active", expiresOn: T },
    { id: "d", productName: "Gone", status: "destroyed", expiresOn: "2026-01-01" },
    { id: "e", productName: "No date", status: "active", expiresOn: null },
  ];
  const ex = buildIntelIssues(healthy, { today: T, lots, medicalEndorsement: false });
  ok(ex.length === 2 && ex.every((i) => i.code === "intel_expired_lot"), "one row per expired ACTIVE lot (today not expired)");
  ok(ex[0].fix?.href === "/admin/inventory/a#lifecycle", "expired → lot lifecycle control");
  ok(ex[1].title.endsWith("unnamed lot"), "unnamed lot label");
  ok(countExpiredLotRows(ex) === 2, "countExpiredLotRows");
  const lotsMany = Array.from({ length: 53 }, (_, i) => ({ id: `x${i}`, productName: "P", status: "active", expiresOn: "2020-01-01" }));
  const exMany = buildIntelIssues(healthy, { today: T, lots: lotsMany, medicalEndorsement: false });
  ok(exMany.length === 51 && exMany[50].code === "intel_expired_more" && exMany[50].title.includes("3 more"), "cap 50 + overflow row");
  ok(countExpiredLotRows(exMany) === 51, "overflow row counted");
  const od = buildIntelIssues({ ...healthy, overdue: { total: 1 } }, { today: T, lots: [], medicalEndorsement: false });
  ok(od.length === 1 && od[0].severity === "warning" && od[0].fix?.href === "/admin/inventory/cycle-counts", "overdue → warning cycle counts");
  ok(od[0].title.startsWith("1 lot is"), "overdue singular");

  // Manifest.
  const M = "22222222-2222-4222-8222-222222222222";
  const mEmpty: ManifestIssueInput = {
    manifestId: M,
    inProgress: false,
    heldLots: [],
    missingCoaLines: 0,
    unmappedCategoryLines: 0,
    menu: { pendingDrafts: 0, stagedWaiting: false },
  };
  ok(buildManifestIssues(mEmpty).length === 0, "clean manifest → zero issues");
  const hl = buildManifestIssues({
    ...mEmpty,
    heldLots: [
      { id: "l1", label: "Blue Dream 1g", reasons: [{ code: "missing_lab_result", message: "No lab result" }] },
      { id: "l2", label: "Ghost", reasons: [{ code: "missing_ccrs_id", message: "No id" }] },
      { id: "l3", label: "Bad", reasons: [{ code: "failed_lab_result", message: "FAILED" }] },
      { id: "l4", label: "Fixed", reasons: [] },
    ],
  });
  ok(hl.filter((i) => i.code === "manifest_held_lot").length === 3, "one blocking row per held lot");
  ok(hl[0].title === "Held in quarantine \u2014 Blue Dream 1g" && hl[0].meaning.startsWith("Missing: a COA / lab result"), "bible S28.4 copy");
  ok(hl[0].fix?.href === "/admin/inventory/l1#coa", "lab reason → lot #coa");
  ok(hl[1].fix?.href === "/admin/inventory/l2", "id reason → lot page");
  ok(hl[2].fixText?.includes("can never go live") === true, "failed result honest copy");
  ok(!hl.some((i) => (i.fixText ?? "").includes("add the identifier")), "never promises an in-page fix that does not exist");
  const clear = hl.find((i) => i.code === "manifest_held_now_clear");
  ok(clear?.severity === "warning" && clear.fix?.href === "/admin/inventory/l4#lifecycle", "gate now passes → activate via lifecycle");
  ok(buildManifestIssues({ ...mEmpty, inProgress: true, heldLots: [{ id: "z", label: "z", reasons: [{ code: "missing_ccrs_id", message: "" }] }] }).length === 0, "in-progress: no held rows");
  const coa = buildManifestIssues({ ...mEmpty, inProgress: true, missingCoaLines: 2 });
  ok(coa.length === 1 && coa[0].fix?.href === `/admin/inventory/intake/${M}#manifest-lines`, "missing COA lines → #manifest-lines");
  ok(buildManifestIssues({ ...mEmpty, missingCoaLines: 2 }).length === 0, "missing COA only while receiving is open");
  const um = buildManifestIssues({ ...mEmpty, unmappedCategoryLines: 1 });
  ok(um.length === 1 && um[0].fix?.href === "/admin/settings/types?tab=inventory" && um[0].title.startsWith("1 line has"), "unmapped → types");
  const dr = buildManifestIssues({ ...mEmpty, menu: { pendingDrafts: 3, stagedWaiting: true } });
  ok(dr.length === 2, "drafts + staged rows");
  ok(dr[0].fix?.href === draftsForManifestHref(M), "drafts row → this delivery's drafts");
  ok(dr[1].fix?.href === "/admin/publish", "staged (legacy flag only) → publish");
  // R13a: with the named waiting row the fix lands where the reason is fixed.
  const heldRow = buildManifestIssues({ ...mEmpty, menu: { pendingDrafts: 0, stagedWaiting: true, waitingVersion: { id: "v1", state: "held_for_fact_review" } } });
  ok(heldRow.length === 1 && heldRow[0].code === "manifest_menu_waiting", "held row present");
  ok(heldRow[0].fix?.href === `/admin/inventory/drafts?status=approved&manifest=${M}`, "fact hold → this delivery's approved products");
  ok(heldRow[0].extra?.[0]?.href.startsWith("/admin/menu-imports/version/v1?back=") === true, "fact hold extra → the update page");
  const failRow = buildManifestIssues({ ...mEmpty, menu: { pendingDrafts: 0, stagedWaiting: true, waitingVersion: { id: "v9", state: "auto_publish_failed" } } });
  ok(failRow[0].fix?.href.startsWith("/admin/menu-imports/version/v9") === true && failRow[0].extra === undefined, "failed → the update page, no extra");
  const cutRow = buildManifestIssues({ ...mEmpty, menu: { pendingDrafts: 0, stagedWaiting: true, waitingVersion: { id: "v2", state: "held_for_cutover" } } });
  ok(cutRow[0].fix?.href === "/admin/menu-imports/cutover", "cutover → cutover page");
  ok(buildManifestIssues({ ...mEmpty, menu: { pendingDrafts: 0, stagedWaiting: false, waitingVersion: { id: "v1", state: "held_for_fact_review" } } }).length === 0, "no waiting flag → no row");
  ok(buildManifestIssues({ ...mEmpty, inProgress: true, menu: { pendingDrafts: 3, stagedWaiting: false } }).length === 0, "drafts row only after finalize");
  ok(buildManifestIssues({ ...mEmpty, menu: null }).length === 0, "unread snapshot claims nothing");
  ok(manifestHeldAutoOpen("0") === undefined, "held=0 (clean finalize) does not open Issues");
  ok(manifestHeldAutoOpen("2") === "2", "held=2 opens Issues");
  ok(manifestHeldAutoOpen(undefined) === undefined && manifestHeldAutoOpen("") === undefined, "absent/empty held opens nothing");
  ok(summarizeIssues(hl).blocking === 3 && summarizeIssues(hl).warning === 1, "held lots drive the summary");

  return { passed, failed };
}
