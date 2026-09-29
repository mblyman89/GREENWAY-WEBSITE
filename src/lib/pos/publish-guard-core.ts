/**
 * src/lib/pos/publish-guard-core.ts
 *
 * SLICE 76 — plain-English publish safety for the menu.
 *
 * The `publish_menu_version` RPC atomically makes the published update the
 * live menu. Publishing an older update would therefore take off every product
 * added since it was staged - the trap the owner once hit (an 18-item menu
 * shrank to 3). S16 keeps every guard and rewrites the words: the normal path
 * reads as normal, and a removal is a named list plus a tick box.
 *
 * This PURE module (no DB, no React, no server-only) turns raw diff numbers
 * and diagnostics into owner-readable language:
 *
 *   - buildPublishVerdict: safe / caution / danger verdict for a draft, with
 *     a headline and detail sentence. Any removal requires an explicit
 *     confirmation (the server action enforces it; the UI shows a checkbox).
 *   - flagDraftFreshness (S15): what each waiting draft would do to the live
 *     menu, decided by its item SET (the diff), not its timestamp.
 *   - explainDiagnostic: translates every known "to fix" diagnostic code into
 *     what it means, how to fix it, and WHERE (a fix-it link).
 *
 * Self-tests at the bottom follow the house `__runXxxTests()` pattern and are
 * registered in scripts/compliance/run-pure-selftests.ts.
 */

import { approvedFromPhrase } from "@/lib/catalog/draft-deep-link-core";
import {
  EMPTY_ISSUE_LOOKUPS,
  ISSUE_COPY,
  ISSUE_LINKED_CODES,
  fixLinkForDiagnostic,
  issueContextFor,
  type IssueExtraLink,
  type IssueLookups,
} from "@/lib/pos/issue-fix-link-core";

/**
 * S16 (bible S16.4, F-056): the one sentence at the top of the Publish page.
 * The old copy explained snapshot theory ("REPLACES the whole menu ... never
 * adds to it") and so framed the NORMAL path - approving a product, which
 * publishes itself and keeps everything live - as a threat. The page now only
 * lists the updates that need a person, so that is what it says.
 */
export const PUBLISH_SEMANTICS_COPY =
  "Products you approve go live by themselves. This page lists the few updates that need a human first.";

/**
 * S16: "How publishing works", collapsed by default on the Publish page. Every
 * sentence is something the code does today:
 *   1. approve with a price -> auto-publish (intake-menu-staging.ts, S00 copy),
 *   2. an update waits only when held for a fact or the auto-publish failed
 *      (publish_outcome states, S01),
 *   3. publishing makes the update the live menu and archives the old one
 *      (publish_menu_version),
 *   4. older waiting updates are archived automatically (S15 rule),
 *   5. anything that would come off needs a tick (actions.ts removal gate).
 */
export const PUBLISH_HELP_STEPS: readonly string[] = [
  "When you approve a received product with a price, it goes live on the website and the register by itself. No Publish click.",
  "An update only waits here when a product fact needs a second look, or the automatic publish didn't finish. Each one says why and has one button.",
  "Publishing makes that update your live menu. The menu it replaces is archived, never deleted.",
  "When a newer menu goes live, older waiting updates are archived automatically, so you never have to pick between them.",
  "If publishing would take any product off the menu, the page names them and asks you to tick a box first.",
  "POS-export uploads and import history stay under Menu Imports (Settings).",
];

/** S16: the short note above every Publish button (was "replaces the WHOLE live menu"). */
export const PUBLISH_SWAP_NOTE =
  "Publishing makes this update your live menu and refreshes the public site. The menu it replaces is archived, not deleted.";

/** How many product names a verdict spells out before summarising the rest. */
export const REMOVED_NAMES_MAX = 5;

function products(n: number): string {
  return `${n} product${n === 1 ? "" : "s"}`;
}

/** "A, B and 3 more" - names are trimmed, blanks dropped, never invented. */
export function nameList(names: readonly string[] | null | undefined, total: number): string | null {
  const clean = (names ?? []).map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0);
  if (clean.length === 0) return null;
  const shown = clean.slice(0, REMOVED_NAMES_MAX);
  const rest = Math.max(0, Math.max(total, clean.length) - shown.length);
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** S16: title of the list of products that would come off (was "Will be REMOVED"). */
export function removalListTitle(n: number): string {
  return `Would come off the live menu (${n})`;
}

/** S16: the confirmation checkbox label. The server gate is unchanged. */
export function removalConfirmCopy(n: number): string {
  return `I understand ${products(n)} will come off the live menu (listed above), and that's what I want.`;
}

/** S16: the message when Publish is pressed without ticking the box. */
export function removalRefusedCopy(n: number): string {
  return `Not published yet: ${products(n)} would come off the live menu. Tick the box if that's what you want. Otherwise nothing changes and the live menu stays as it is.`;
}

export type PublishVerdictLevel = "safe" | "caution" | "danger";

export type PublishVerdict = {
  level: PublishVerdictLevel;
  /** One-line answer to "is it safe to publish this?" */
  headline: string;
  /** Plain-English explanation of what publishing will do. */
  detail: string;
  addedCount: number;
  removedCount: number;
  priceChangedCount: number;
  /** True whenever publishing would remove products - the server refuses without an explicit confirmation. */
  requiresRemovalConfirm: boolean;
};

export type PublishVerdictInput = {
  added: number;
  removed: number;
  priceChanged: number;
  unchanged: number;
  /** Is there a published menu at all? */
  hasLiveMenu: boolean;
  /** ISO timestamps used to detect "this update is older than the live menu". */
  stagedCreatedAt?: string | null;
  publishedCreatedAt?: string | null;
  /** S16: names of the products that would come off (from the same diff). */
  removedNames?: readonly string[] | null;
};

function olderThanLive(input: PublishVerdictInput): boolean {
  if (!input.stagedCreatedAt || !input.publishedCreatedAt) return false;
  const staged = Date.parse(input.stagedCreatedAt);
  const published = Date.parse(input.publishedCreatedAt);
  // An unparseable time is NaN, and NaN < x is false: never "older".
  return staged < published;
}

/**
 * Turn diff counts into a plain-English verdict for one update (S16 copy).
 * Leads with what stays and what is added; a removal count appears only when
 * it is above zero, with the names and the reason.
 */
export function buildPublishVerdict(input: PublishVerdictInput): PublishVerdict {
  const base = {
    addedCount: input.added,
    removedCount: input.removed,
    priceChangedCount: input.priceChanged,
    requiresRemovalConfirm: input.removed > 0,
  };
  // Products that stay on the menu = in both versions (same or new price).
  const kept = input.unchanged + input.priceChanged;
  const keptLive = `${products(kept)} that ${kept === 1 ? "is" : "are"} live now`;

  if (!input.hasLiveMenu) {
    return {
      ...base,
      level: "safe",
      headline: "Safe to publish \u2014 this becomes your first live menu.",
      detail: `There is no live menu yet, so nothing comes off. Publishing puts ${products(input.added)} on your public menu.`,
    };
  }

  if (input.removed === 0) {
    const changes: string[] = [];
    if (input.added > 0) changes.push(`Adds ${products(input.added)}`);
    if (input.priceChanged > 0) changes.push(`${changes.length ? "updates" : "Updates"} ${input.priceChanged} price${input.priceChanged === 1 ? "" : "s"}`);
    const detail =
      changes.length === 0
        ? `No product changes. Keeps all ${products(kept)} exactly as they are.`
        : `${changes.join(" and ")}. Keeps all ${keptLive}.`;
    return { ...base, level: "safe", headline: "Safe to publish \u2014 nothing comes off.", detail };
  }

  const names = nameList(input.removedNames, input.removed);
  const offList = names ? `: ${names}` : "";

  if (olderThanLive(input)) {
    return {
      ...base,
      level: "danger",
      headline: `This update is older than your live menu, so it doesn't include ${products(input.removed)} that ${input.removed === 1 ? "is" : "are"} live now.`,
      detail: `Publishing it would take them off the menu${offList}. You rarely want this: the live menu is newer. If a newer update is waiting, publish that one instead.`,
    };
  }

  return {
    ...base,
    level: "caution",
    headline: `Publishing ${joinAnd([
      `keeps ${products(kept)}`,
      `adds ${input.added}`,
      ...(input.priceChanged > 0 ? [`updates ${input.priceChanged} price${input.priceChanged === 1 ? "" : "s"}`] : []),
    ])}.`,
    detail: `${products(input.removed)} would come off the menu${offList}. Continue only if that's intended (sold out or discontinued).`,
  };
}

// ---------------------------------------------------------------------------
// Draft freshness - by item SET, not by timestamp (S15, bible F-057)
// ---------------------------------------------------------------------------

/**
 * What a waiting draft would do to the live menu, decided from what it
 * CONTAINS (the diff against live), with age used only to spot drafts the
 * S15 archival rule supersedes.
 *
 *   latest       keeps every live product (removes 0) and is the NEWEST such
 *                draft - the recommended one.
 *   complete     also keeps every live product, but a newer complete draft
 *                exists.
 *   would_remove newer than the live menu but missing N live products (a
 *                number to read, not a threat - maybe intentional).
 *   superseded   created BEFORE the live menu. The S15 rule archives these
 *                on every publish; one still waiting means the sweep has not
 *                run on it yet.
 *   unknown      the comparison with the live menu could not be read in full.
 *                Never shown as safe (never guess).
 *
 * Before S15 the newest draft by timestamp was "latest" and every other one
 * "outdated": a Cultivera upload minutes old ranked Latest with ZERO received
 * products in it, and every receiving draft read Outdated.
 */
export type DraftFreshness = "latest" | "complete" | "would_remove" | "superseded" | "unknown";

export type FlaggedDraft<T> = T & {
  freshness: DraftFreshness;
  /** Live products this draft would take off the menu; null when unknown. */
  removedCount: number | null;
};

export type DraftFreshnessInput = {
  /** created_at of the live (published) version; null when nothing is live. */
  liveCreatedAt: string | null;
  /**
   * Per draft id: how many live products its diff removes, or null when the
   * diff read was incomplete. A draft missing from the map is unknown.
   */
  removedById: ReadonlyMap<string, number | null>;
};

function timeOrNegInf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function usableRemoved(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * Flag every waiting draft by what it contains. Output is newest-first
 * (order verified, not assumed; an unparseable created_at sorts last).
 */
export function flagDraftFreshness<T extends { id: string; created_at: string }>(
  drafts: readonly T[],
  input: DraftFreshnessInput,
): FlaggedDraft<T>[] {
  const sorted = [...drafts].sort((a, b) => timeOrNegInf(b.created_at) - timeOrNegInf(a.created_at));
  const live = input.liveCreatedAt ? Date.parse(input.liveCreatedAt) : Number.NaN;
  let latestTaken = false;
  return sorted.map((d) => {
    const raw = input.removedById.get(d.id);
    const removedCount = usableRemoved(raw) ? raw : null;
    const created = Date.parse(d.created_at);
    let freshness: DraftFreshness;
    if (!Number.isNaN(live) && !Number.isNaN(created) && created < live) freshness = "superseded";
    else if (removedCount === null) freshness = "unknown";
    else if (removedCount > 0) freshness = "would_remove";
    else if (!latestTaken) {
      freshness = "latest";
      latestTaken = true;
    } else freshness = "complete";
    return { ...d, freshness, removedCount };
  });
}

/** Chip copy per freshness, used verbatim by every page that shows it. */
export const FRESHNESS_CHIP: Record<DraftFreshness, string> = {
  latest: "Latest \u2014 publish this one",
  complete: "Keeps everything live",
  would_remove: "Would take products off",
  superseded: "Superseded (archived automatically)",
  unknown: "Couldn't compare \u2014 open to check",
};

/** Chip copy for a waiting draft, with the removal count when there is one. */
export function freshnessChip(f: { freshness: DraftFreshness; removedCount: number | null }): string {
  if (f.freshness === "would_remove" && f.removedCount !== null) {
    return `Would take ${f.removedCount} product${f.removedCount === 1 ? "" : "s"} off`;
  }
  return FRESHNESS_CHIP[f.freshness];
}

// ---------------------------------------------------------------------------
// Plain-English diagnostic explanations ("N to fix" translated)
// ---------------------------------------------------------------------------

export type DiagnosticExplanation = {
  /** Short human title, e.g. "No website category yet". */
  title: string;
  /** What this actually means for the owner. */
  meaning: string;
  /** What to do about it, in plain English. */
  fix: string;
  /** Where to do it (admin href), or null when no action is needed. */
  fixHref: string | null;
  /** Button label for the fix link, or null. */
  fixLabel: string | null;
  /** True for FYI-only entries that need no action. */
  informational: boolean;
  /** S26: secondary destinations (e.g. "Re-file just this product"). */
  extra?: IssueExtraLink[];
  /** S26: optional "Why did this happen?" sentence (merge_ambiguous). */
  why?: string | null;
};

type ExplanationRule = Omit<DiagnosticExplanation, "meaning"> & { meaning?: string };

/**
 * Known diagnostic codes → owner-readable explanations with fix-it links.
 * Codes verified against draft-injection-core.ts and intake-mastering-core.ts.
 */
const EXPLANATIONS: Record<string, ExplanationRule> = {
  draft_inject_no_pos_key: {
    title: "Product has no POS key",
    meaning:
      "This approved product isn't in your point-of-sale system yet, so the menu can't place it automatically.",
    fix: "Add the product in your POS, then it will ride along on the next menu update. You can re-check it under Product Onboarding.",
    fixHref: "/admin/inventory/drafts",
    fixLabel: "Open onboarding",
    informational: false,
  },
  draft_inject_unmapped_category: {
    title: "No website category yet",
    meaning:
      "This product's inventory type isn't mapped to a website category, so it was left OFF the menu rather than guessed.",
    fix: "Map the type to a website category under Types & Categories (Inventory types tab), then the next menu update will include the product.",
    fixHref: "/admin/settings/types?tab=inventory",
    fixLabel: "Open Types & Categories",
    informational: false,
  },
  draft_inject_no_price: {
    title: "No approved price",
    meaning: "This product was approved without a sale price, so it can't be sold or shown.",
    fix: "Re-approve it with a price under Product Onboarding.",
    fixHref: "/admin/inventory/drafts",
    fixLabel: "Open onboarding",
    informational: false,
  },
  draft_inject_potency_capped: {
    title: "Potency looked wrong and was capped",
    meaning:
      "The source THC/CBD number was impossibly high, so it was capped at a sane value instead of shown as-is.",
    // S26: the enrichment page has no potency field (F-101); lab numbers come
    // from the COA on the lot page.
    fix: ISSUE_COPY.potencyFix,
    fixHref: "/admin/inventory",
    fixLabel: "Open inventory",
    informational: false,
  },
  fact_extraction_review: {
    title: "A product fact needs your eyes",
    meaning:
      "The system wasn't confident about one of this product's facts (name, potency, size), so it flagged it instead of guessing.",
    fix: "Review the product under Product Onboarding and confirm or correct the flagged fact.",
    fixHref: "/admin/inventory/drafts?status=approved",
    fixLabel: "Open onboarding",
    informational: false,
  },
  intake_master_no_vendor: {
    title: "No vendor on the manifest",
    meaning:
      "This product arrived without a vendor, so it was added as its own menu card (products are only grouped per vendor).",
    fix: ISSUE_COPY.noVendorFix,
    fixHref: "/admin/inventory/intake",
    fixLabel: "Open receiving",
    informational: false,
  },
  intake_master_ambiguous_name: {
    title: "Name too ambiguous to group",
    meaning:
      "The product's name was too vague to safely group with others, so it became its own card.",
    // S26: there is no rename control; never promise one.
    fix: ISSUE_COPY.ambiguousNameFix,
    fixHref: "/admin/inventory/drafts",
    fixLabel: "Open onboarding",
    informational: false,
  },
  intake_master_merge_ambiguous: {
    title: "Matched more than one live card",
    meaning:
      "This product looked like it belonged to several live menu cards, so it was added as a NEW card instead of merging on a guess.",
    // S26 (F-096): Product Mastering is never read by the merge. Compare the
    // live cards instead; the remembered choice is S32.
    fix: ISSUE_COPY.mergeFix,
    fixHref: "/admin/products",
    fixLabel: "Compare the cards",
    informational: false,
  },
  // FYI-only codes — no action needed.
  draft_superseded_by_pos: {
    title: "Already in your POS export",
    fix: "Nothing to do — the POS row was used.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  draft_inject_category_human: {
    title: "Category chosen by the approver",
    fix: "Nothing to do — your choice was kept.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  thc_package_total_override: {
    title: "THC uses the verified package total",
    fix: "Nothing to do — the inconsistent source value was set aside.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  intake_master_grouped: {
    title: "Lots rolled up into one card",
    fix: "Nothing to do — each option still sells against its own lot.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  intake_master_restock: {
    title: "Restock merged into a live card",
    fix: "Nothing to do — no duplicate card was created.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  intake_display_name_built: {
    title: "Cleaner menu name built",
    fix: "Nothing to do — the manifest name stays on file.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  intake_lot_already_live: {
    title: "Already a size on a live card",
    fix: "Nothing to do — nothing was added twice.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
  draft_injected: {
    title: "Product added to the draft",
    fix: "Nothing to do — this is the success note.",
    fixHref: null,
    fixLabel: null,
    informational: true,
  },
};

/**
 * S02 — codes whose fix happens on ONE approved onboarding draft. Only the
 * receiving pipeline emits them, and it only ever reads APPROVED drafts
 * (intake-menu-staging.ts: `.eq("status", "approved")`), so the product is
 * always on the Approved tab by the time the warning exists (F-060).
 */
export const DRAFT_LINKED_CODES: ReadonlySet<string> = new Set([
  "draft_inject_no_pos_key",
  "draft_inject_no_price",
  "fact_extraction_review",
  "intake_master_ambiguous_name",
]);

/**
 * S02 — what the page knows about a diagnostic beyond its code + message:
 * the diagnostic's own persisted `context` (draft-injection-core puts
 * `draft_id`, `productName` there) and the delivery the version came from
 * (summary_json.manifest, written by S01). Every field is optional and
 * untrusted: anything missing or malformed degrades to today's list link.
 */
export type DiagnosticLinkContext = {
  /** The diagnostic's persisted `context` object (unknown shape). */
  context?: unknown;
  /** summary_json.manifest.id / manifest_id of the version. */
  manifestId?: string | null;
  /** summary_json.manifest.vendor. */
  vendor?: string | null;
  /** summary_json.manifest.number. */
  manifestNumber?: string | null;
  /**
   * S26: what the page read (draft rows by id / by key, live keys). Missing =
   * nothing read; every link degrades to the best one the context alone gives.
   */
  lookups?: IssueLookups;
  /** S26: the in-admin page the product-page links should come back to. */
  back?: string | null;
};

function ctxString(ctx: unknown, key: string): string | null {
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return null;
  const v = (ctx as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Explain a diagnostic in plain English. Unknown codes fall back to the raw
 * message (never hidden, never guessed).
 *
 * S02: pass `link` and the draft-linked codes point at the exact product —
 * `/admin/inventory/drafts?status=approved&draft=<id>#draft-<id>` when the
 * diagnostic names its draft, else that delivery's approved products when
 * the manifest is known, else the list URL (backward compatible).
 */
export function explainDiagnostic(
  code: string,
  message: string,
  link?: DiagnosticLinkContext,
): DiagnosticExplanation {
  const base = explainDiagnosticBase(code, message);
  // S26: every actionable receiving code resolves through ONE registry
  // (issue-fix-link-core). FYI + unknown codes keep their static entry.
  if (!ISSUE_LINKED_CODES.includes(code)) return base;
  const issue = link
    ? issueContextFor(
        { code, context: link.context },
        { manifestId: link.manifestId ?? null, back: link.back ?? null },
        link.lookups ?? EMPTY_ISSUE_LOOKUPS,
      )
    : {};
  const f = fixLinkForDiagnostic(code, issue);
  if (!f) return base;
  const out: DiagnosticExplanation = {
    ...base,
    fix: f.fix ?? base.fix,
    fixHref: f.href,
    fixLabel: f.label,
    extra: f.extra,
    why: f.why,
  };
  const name = ctxString(link?.context, "displayName") ?? ctxString(link?.context, "productName");
  if (code === "fact_extraction_review" && f.kind === "item" && name) {
    out.fix =
      `Open ${name}${approvedFromPhrase(link?.vendor, link?.manifestNumber)} \u2014 it is highlighted on ` +
      "Product Onboarding with the flagged fact and Approve / Fix / Keep-off controls on its row. Check it " +
      "against the package or COA and settle it there (the update is rebuilt with your answer), or, if it's " +
      "right, press Publish on this page and the update goes live.";
  }
  return out;
}

function explainDiagnosticBase(code: string, message: string): DiagnosticExplanation {
  const rule = EXPLANATIONS[code];
  if (!rule) {
    return {
      title: "Needs a look",
      meaning: message,
      fix: "Read the note above — it says exactly what happened. If it names a page, fix it there.",
      fixHref: null,
      fixLabel: null,
      informational: false,
    };
  }
  return {
    title: rule.title,
    meaning: rule.meaning ?? message,
    fix: rule.fix,
    fixHref: rule.fixHref,
    fixLabel: rule.fixLabel,
    informational: rule.informational,
  };
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runPublishGuardTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL publish-guard-core: " + msg);
    passed += 1;
  };

  // First publish: always safe, no confirm.
  const first = buildPublishVerdict({
    added: 18, removed: 0, priceChanged: 0, unchanged: 0, hasLiveMenu: false,
  });
  ok(first.level === "safe", "first publish is safe");
  ok(!first.requiresRemovalConfirm, "first publish needs no confirm");
  ok(first.detail === "There is no live menu yet, so nothing comes off. Publishing puts 18 products on your public menu.", "first publish copy");

  // Pure adds: safe, leads with adds (S16.2 "Adds 3 products, keeps all 412").
  const adds = buildPublishVerdict({
    added: 3, removed: 0, priceChanged: 2, unchanged: 410, hasLiveMenu: true,
  });
  ok(adds.level === "safe", "adds-only is safe");
  ok(!adds.requiresRemovalConfirm, "adds-only needs no confirm");
  ok(adds.headline === "Safe to publish \u2014 nothing comes off.", "safe headline");
  ok(adds.detail === "Adds 3 products and updates 2 prices. Keeps all 412 products that are live now.", "adds lead, kept = unchanged + repriced");
  const one = buildPublishVerdict({ added: 1, removed: 0, priceChanged: 1, unchanged: 0, hasLiveMenu: true });
  ok(one.detail === "Adds 1 product and updates 1 price. Keeps all 1 product that is live now.", "singulars");

  // No changes at all: still safe, says so.
  const same = buildPublishVerdict({
    added: 0, removed: 0, priceChanged: 0, unchanged: 18, hasLiveMenu: true,
  });
  ok(same.level === "safe" && same.detail === "No product changes. Keeps all 18 products exactly as they are.", "no-op publish reads as no changes");
  const priceOnly = buildPublishVerdict({ added: 0, removed: 0, priceChanged: 2, unchanged: 3, hasLiveMenu: true });
  ok(priceOnly.detail === "Updates 2 prices. Keeps all 5 products that are live now.", "price-only never says Adds 0");
  const addOnly = buildPublishVerdict({ added: 2, removed: 0, priceChanged: 0, unchanged: 5, hasLiveMenu: true });
  ok(addOnly.detail === "Adds 2 products. Keeps all 5 products that are live now.", "adds only");

  // Removals + staged older than live = the owner's exact trap -> danger (S16.4 row 2).
  const trap = buildPublishVerdict({
    added: 0, removed: 15, priceChanged: 0, unchanged: 3, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-01T10:00:00Z",
    publishedCreatedAt: "2026-02-02T10:00:00Z",
    removedNames: ["Alpha", "Bravo"],
  });
  ok(trap.level === "danger", "older update with removals is danger");
  ok(trap.requiresRemovalConfirm, "danger requires confirm");
  ok(trap.headline === "This update is older than your live menu, so it doesn't include 15 products that are live now.", "danger headline (bible S16.4)");
  ok(trap.detail.startsWith("Publishing it would take them off the menu: Alpha, Bravo and 13 more."), "danger names them, then counts the rest");
  const trap1 = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 0, unchanged: 3, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-01T10:00:00Z", publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(trap1.headline.endsWith("doesn't include 1 product that is live now."), "danger singular");
  ok(trap1.detail.startsWith("Publishing it would take them off the menu. "), "no names -> no invented list");

  // Removals but newer: caution, leads with keeps + adds (S16.4 row 3).
  const newer = buildPublishVerdict({
    added: 3, removed: 2, priceChanged: 0, unchanged: 412, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-03T10:00:00Z",
    publishedCreatedAt: "2026-02-02T10:00:00Z",
    removedNames: ["Gelato 1g", "  ", "OG 3.5g"],
  });
  ok(newer.level === "caution", "newer update with removals is caution");
  ok(newer.requiresRemovalConfirm, "caution requires confirm");
  ok(newer.headline === "Publishing keeps 412 products and adds 3.", "caution leads with keeps + adds");
  const newerP = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 2, unchanged: 10, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-03T10:00:00Z", publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(newerP.headline === "Publishing keeps 12 products, adds 0 and updates 2 prices.", "caution with prices joins cleanly");
  ok(newerP.detail.startsWith("1 product would come off the menu. "), "caution singular, no names");
  ok(newer.detail === "2 products would come off the menu: Gelato 1g and OG 3.5g. Continue only if that's intended (sold out or discontinued).", "caution names what comes off");

  // Missing timestamps degrade to caution, never crash.
  const noTs = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 0, unchanged: 5, hasLiveMenu: true,
  });
  ok(noTs.level === "caution", "missing timestamps -> caution not danger");
  const badTs = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 0, unchanged: 5, hasLiveMenu: true,
    stagedCreatedAt: "garbage", publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(badTs.level === "caution", "unparseable timestamps -> caution not crash");
  const tieTs = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 0, unchanged: 5, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-02T10:00:00Z", publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(tieTs.level === "caution", "same timestamp is not older");

  // nameList.
  ok(nameList(null, 3) === null && nameList([" ", ""], 2) === null, "no usable names -> null");
  ok(nameList(["A"], 1) === "A", "one name");
  ok(nameList(["A", "B"], 2) === "A and B", "two names");
  ok(nameList(["A", "B", "C"], 3) === "A, B and C", "three names");
  ok(nameList(["A", "B", "C", "D", "E", "F", "G"], 7) === "A, B, C, D, E and 2 more", "capped at five");
  ok(nameList(["A"], 4) === "A and 3 more", "total beyond the names given");
  ok(REMOVED_NAMES_MAX === 5, "five names max");

  // Removal copy used by the pages and the server action.
  ok(removalListTitle(4) === "Would come off the live menu (4)", "list title");
  ok(removalConfirmCopy(1) === "I understand 1 product will come off the live menu (listed above), and that's what I want.", "confirm singular");
  ok(removalConfirmCopy(3).startsWith("I understand 3 products will come off"), "confirm plural");
  ok(removalRefusedCopy(2).startsWith("Not published yet: 2 products would come off the live menu."), "refusal copy");

  // S16.6: no capitalised REMOVE, no "replaces the WHOLE menu", anywhere in the copy.
  const allCopy = [
    PUBLISH_SEMANTICS_COPY, PUBLISH_SWAP_NOTE, ...PUBLISH_HELP_STEPS,
    first.headline, first.detail, adds.headline, adds.detail, same.detail,
    trap.headline, trap.detail, newer.headline, newer.detail,
    removalListTitle(2), removalConfirmCopy(2), removalRefusedCopy(2),
  ].join("\n");
  ok(!/REMOVE/.test(allCopy), "no capitalised REMOVE");
  ok(!/replaces the whole/i.test(allCopy), "no 'replaces the whole menu'");
  ok(!/OLDER|NEWEST|WHOLE|REPLACES/.test(allCopy), "no shouting");

  // flagDraftFreshness (S15): by item SET, not timestamp.
  const LIVE = "2026-02-02T00:00:00Z";
  const fr = (
    drafts: { id: string; created_at: string }[],
    removed: Record<string, number | null>,
    liveAt: string | null = LIVE,
  ) => flagDraftFreshness(drafts, { liveCreatedAt: liveAt, removedById: new Map(Object.entries(removed)) });
  // The F-057 case: a Cultivera upload minutes old with ZERO received cards
  // (removes 5) must NOT be latest; the older receiving superset must be.
  const f57 = fr(
    [
      { id: "cultivera", created_at: "2026-02-03T10:05:00Z" },
      { id: "receiving", created_at: "2026-02-03T10:00:00Z" },
    ],
    { cultivera: 5, receiving: 0 },
  );
  ok(f57[0].id === "cultivera" && f57[0].freshness === "would_remove", "newest-by-time that removes products is NOT latest");
  ok(f57[0].removedCount === 5, "removal count carried");
  ok(f57[1].id === "receiving" && f57[1].freshness === "latest", "superset is latest even with an older timestamp");
  // Two supersets: the newer is latest, the older is complete.
  const two = fr(
    [
      { id: "old", created_at: "2026-02-03T00:00:00Z" },
      { id: "new", created_at: "2026-02-04T00:00:00Z" },
    ],
    { old: 0, new: 0 },
  );
  ok(two[0].id === "new" && two[0].freshness === "latest", "newest superset is latest (input re-sorted)");
  ok(two[1].freshness === "complete", "older superset is complete, not outdated");
  // Created before the live menu: superseded, whatever it contains.
  const sup = fr([{ id: "s", created_at: "2026-02-01T00:00:00Z" }], { s: 0 });
  ok(sup[0].freshness === "superseded", "created before live -> superseded even if a superset");
  const eq = fr([{ id: "e", created_at: LIVE }], { e: 0 });
  ok(eq[0].freshness === "latest", "same instant as live is not older (strict, like 0236)");
  // Unknown: a failed read is never safe.
  const unk = fr([{ id: "u", created_at: "2026-02-03T00:00:00Z" }, { id: "m", created_at: "2026-02-03T01:00:00Z" }], { u: null });
  ok(unk.every((d) => d.freshness === "unknown" && d.removedCount === null), "null or missing diff -> unknown, never latest");
  const junk = fr([{ id: "j", created_at: "2026-02-03T00:00:00Z" }], { j: -1 });
  ok(junk[0].freshness === "unknown", "negative count -> unknown");
  const frac = fr([{ id: "k", created_at: "2026-02-03T00:00:00Z" }], { k: 1.5 });
  ok(frac[0].freshness === "unknown", "non-integer count -> unknown");
  // Unknown does not take the latest slot from a later superset.
  const mix = fr(
    [{ id: "u", created_at: "2026-02-05T00:00:00Z" }, { id: "g", created_at: "2026-02-04T00:00:00Z" }],
    { u: null, g: 0 },
  );
  ok(mix[1].freshness === "latest", "an unknown newer draft does not steal latest");
  // Nothing live: every draft is compared with an empty menu.
  const none = fr([{ id: "a", created_at: "2026-01-01T00:00:00Z" }], { a: 0 }, null);
  ok(none[0].freshness === "latest", "no live menu -> nothing superseded");
  const badLive = fr([{ id: "a", created_at: "2026-01-01T00:00:00Z" }], { a: 0 }, "garbage");
  ok(badLive[0].freshness === "latest", "unparseable live time -> no superseded guess");
  const badDraft = fr(
    [{ id: "x", created_at: "garbage" }, { id: "y", created_at: "2026-02-03T00:00:00Z" }],
    { x: 0, y: 0 },
  );
  ok(badDraft[0].id === "y" && badDraft[1].id === "x", "unparseable draft time sorts last");
  ok(badDraft[0].freshness === "latest" && badDraft[1].freshness === "complete", "and is never superseded by a guess");
  ok(fr([], {}).length === 0, "empty list is fine");
  // Chip copy.
  ok(FRESHNESS_CHIP.superseded === "Superseded (archived automatically)", "bible S15.4 chip copy");
  ok(freshnessChip({ freshness: "would_remove", removedCount: 1 }) === "Would take 1 product off", "singular chip");
  ok(freshnessChip({ freshness: "would_remove", removedCount: 4 }) === "Would take 4 products off", "plural chip");
  ok(freshnessChip({ freshness: "latest", removedCount: 0 }) === FRESHNESS_CHIP.latest, "latest chip");
  ok(Object.values(FRESHNESS_CHIP).every((c) => !/outdated/i.test(c)), "no chip says Outdated any more");

  // explainDiagnostic: every actionable code has a fix link; FYIs don't.
  const unmapped = explainDiagnostic("draft_inject_unmapped_category", "raw msg");
  ok(unmapped.fixHref === "/admin/settings/types?tab=inventory", "unmapped category → Types & Categories, Inventory tab (S26)");
  ok(!unmapped.informational, "unmapped category is actionable");
  const noPrice = explainDiagnostic("draft_inject_no_price", "raw msg");
  ok(noPrice.fixHref === "/admin/inventory/drafts", "no price → onboarding");
  const noKey = explainDiagnostic("draft_inject_no_pos_key", "raw msg");
  ok(noKey.fixHref === "/admin/inventory/drafts", "no POS key → onboarding");
  const potency = explainDiagnostic("draft_inject_potency_capped", "raw msg");
  ok(potency.fixHref === "/admin/inventory", "potency capped → inventory (no potency field on enrichment, S26)");
  ok(!/enrichment page/.test(potency.fix), "potency copy no longer promises an enrichment edit");
  const noVendor = explainDiagnostic("intake_master_no_vendor", "raw msg");
  ok(noVendor.fixHref === "/admin/inventory/intake", "no vendor → receiving");
  const ambig = explainDiagnostic("intake_master_merge_ambiguous", "raw msg");
  ok(ambig.fixHref === "/admin/products", "merge ambiguous → compare cards, never Mastering (F-096)");
  ok(ambig.why === ISSUE_COPY.mergeWhy, "merge ambiguous carries the why");
  ok(!/remember/i.test(ambig.fix.replace("having that choice remembered) arrives", "")), "no remembered-choice promise before S32");
  const ambName = explainDiagnostic("intake_master_ambiguous_name", "raw msg");
  ok(!/Rename it/.test(ambName.fix), "ambiguous name makes no rename promise");
  const factRev = explainDiagnostic("fact_extraction_review", "raw msg");
  // S02 (F-060): the held product is APPROVED, so even without context the
  // link opens the Approved tab — the review queue could never show it.
  ok(factRev.fixHref === "/admin/inventory/drafts?status=approved", "fact review → approved tab");

  // S02: context-aware deep links.
  const DID = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
  const MID = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
  const deep = explainDiagnostic("fact_extraction_review", "raw msg", {
    context: { draft_id: DID, productName: "Kiva Gummies 100mg", displayName: "Kiva Gummies 100mg" },
    manifestId: MID,
    vendor: "Acme Farms",
    manifestNumber: "0042",
  });
  ok(deep.fixHref === `/admin/inventory/drafts?status=approved&draft=${DID}#draft-${DID}`,
    "fact review with draft_id → the exact approved draft, anchored");
  ok(deep.fixHref !== null && deep.fixHref.includes(DID), "fixHref contains the draft id");
  ok(deep.fix.includes("Kiva Gummies 100mg (approved from Acme Farms manifest 0042)"), "fix names product + delivery");
  ok(deep.fix.includes("press Publish"), "fix states the real next step (manual Publish until S30)");
  ok(deep.fix.includes("settle it there"), "S30: fix points at the inline controls on the row");
  ok(!/publishes itself/i.test(deep.fix), "no promise of auto-publish the code does not keep");
  ok(deep.fixLabel === "Open Kiva Gummies 100mg", "button names the product");
  ok(deep.title === factRev.title, "title unchanged");
  const noDraft = explainDiagnostic("fact_extraction_review", "raw msg", { context: { productName: "X" } });
  ok(noDraft.fixHref === factRev.fixHref && noDraft.fix === factRev.fix, "no draft id, no manifest → list fallback");
  const byManifest = explainDiagnostic("intake_master_ambiguous_name", "raw msg", {
    context: { pos_product_key: "K" },
    manifestId: MID,
  });
  ok(byManifest.fixHref === `/admin/inventory/drafts?status=approved&manifest=${MID}`,
    "no draft id but manifest known → that delivery's approved products");
  ok(byManifest.fixLabel === "Open this delivery's products", "manifest-scoped label");
  const badId = explainDiagnostic("draft_inject_no_price", "raw msg", { context: { draft_id: "nope" } });
  ok(badId.fixHref === "/admin/inventory/drafts", "malformed draft id → list fallback, never a broken query");
  const noPriceDeep = explainDiagnostic("draft_inject_no_price", "raw msg", { context: { draft_id: DID } });
  ok(noPriceDeep.fixHref === `/admin/inventory/drafts?status=approved&draft=${DID}#draft-${DID}`, "no price → exact draft");
  ok(noPriceDeep.fixLabel === "Open this product", "nameless draft label");
  // S26: non-draft codes resolve through the issue registry.
  const LID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
  const lk: IssueLookups = {
    draftsById: new Map([[DID, { id: DID, lot_id: LID, inventory_type: "Solid Edible", pos_product_key: "K1", name: "Gummies" }]]),
    draftsByKey: new Map(),
    liveKeys: new Set(["K1"]),
  };
  const notDraftCode = explainDiagnostic("draft_inject_unmapped_category", "raw", { context: { draft_id: DID } });
  ok(notDraftCode.fixHref === "/admin/settings/types?tab=inventory", "unmapped with no lookups → inventory tab list");
  const typed = explainDiagnostic("draft_inject_unmapped_category", "raw", { context: { draft_id: DID, pos_product_key: "K1" }, lookups: lk });
  ok(typed.fixHref === "/admin/settings/types?tab=inventory&type=Solid%20Edible#type-solid-edible", "unmapped + draft row → that type row");
  ok(typed.fixLabel === "Map \u201cSolid Edible\u201d", "typed label names the type");
  ok(typed.extra?.[0]?.href === `/admin/inventory/${LID}#website-category`, "re-file-just-this-product extra");
  const pot = explainDiagnostic("draft_inject_potency_capped", "raw", { context: { draft_id: DID, pos_product_key: "K1" }, lookups: lk, back: "/admin/menu-imports/version/v1" });
  ok(pot.fixHref === `/admin/inventory/${LID}#coa`, "potency → the lot's COA panel");
  ok(pot.extra?.[0]?.href === "/admin/products/K1?back=%2Fadmin%2Fmenu-imports%2Fversion%2Fv1", "live card extra with back");
  const nv = explainDiagnostic("intake_master_no_vendor", "raw", { context: { pos_product_key: "K1" }, manifestId: MID });
  ok(nv.fixHref === `/admin/inventory/intake/${MID}#manifest-vendor`, "no vendor → the manifest's vendor block");
  // S26: the static entry of every linked code IS the registry's no-context
  // link, so the two can never drift (the static one is what an unknown
  // caller would see if the registry ever returned null).
  for (const c of ISSUE_LINKED_CODES) {
    const r = fixLinkForDiagnostic(c, {})!;
    ok(EXPLANATIONS[c].fixHref === r.href && EXPLANATIONS[c].fixLabel === r.label, `static link = registry link (${c})`);
  }
  const base0 = explainDiagnostic("draft_inject_superseded_by_pos_fake", "m", { context: { draft_id: DID }, lookups: lk });
  ok(base0.fixHref === null && base0.extra === undefined, "unknown code gets no registry link even with lookups");
  const junkCtx = explainDiagnostic("fact_extraction_review", "raw msg", { context: ["x"] });
  ok(junkCtx.fixHref === factRev.fixHref, "array context tolerated");
  ok(DRAFT_LINKED_CODES.size === 4, "exactly four draft-linked codes");
  const grouped = explainDiagnostic("intake_master_grouped", "raw msg");
  ok(grouped.informational && grouped.fixHref === null, "grouped is FYI-only");
  ok(grouped.meaning === "raw msg", "FYI without meaning falls back to the raw message");

  // Unknown code: raw message preserved, nothing invented.
  const unknown = explainDiagnostic("some_new_code", "the raw message");
  ok(unknown.meaning === "the raw message", "unknown code keeps the raw message");
  ok(unknown.fixHref === null, "unknown code invents no link");

  // S16.4: the shared sentence, verbatim from the bible.
  ok(PUBLISH_SEMANTICS_COPY === "Products you approve go live by themselves. This page lists the few updates that need a human first.", "semantics copy is the bible's");
  ok(PUBLISH_HELP_STEPS.length === 6, "six help steps");

  return { passed };
}
