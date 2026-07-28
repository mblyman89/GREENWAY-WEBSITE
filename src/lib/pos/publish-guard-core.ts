/**
 * src/lib/pos/publish-guard-core.ts
 *
 * SLICE 76 — plain-English publish safety for the menu.
 *
 * The live menu is a SNAPSHOT: the `publish_menu_version` RPC atomically
 * swaps the whole published version for the draft you publish. Publishing an
 * OLDER draft therefore silently REMOVES every product added since it was
 * staged — exactly the trap the owner hit (published an 18-item draft, then a
 * stale 3-item draft, and the live menu shrank to 3).
 *
 * This PURE module (no DB, no React, no server-only) turns raw diff numbers
 * and diagnostics into owner-readable language:
 *
 *   - buildPublishVerdict: safe / caution / danger verdict for a draft, with
 *     a headline and detail sentence. Any removal requires an explicit
 *     confirmation (the server action enforces it; the UI shows a checkbox).
 *   - flagOutdatedDrafts: newest intake draft = "latest", the rest are
 *     "outdated" (publishing one would drop newer products).
 *   - explainDiagnostic: translates every known "to fix" diagnostic code into
 *     what it means, how to fix it, and WHERE (a fix-it link).
 *
 * Self-tests at the bottom follow the house `__runXxxTests()` pattern and are
 * registered in scripts/compliance/run-pure-selftests.ts.
 */

/** One sentence, used verbatim on every publish surface so the story never drifts. */
export const PUBLISH_SEMANTICS_COPY =
  "Your live menu is a snapshot. Publishing a draft REPLACES the whole menu with that draft — it never adds to it. Always publish the NEWEST draft; older drafts are missing products added after them.";

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
  /** True whenever publishing would remove products — the server refuses without an explicit confirmation. */
  requiresRemovalConfirm: boolean;
};

export type PublishVerdictInput = {
  added: number;
  removed: number;
  priceChanged: number;
  unchanged: number;
  /** Is there a published menu at all? */
  hasLiveMenu: boolean;
  /** ISO timestamps used to detect "this draft is OLDER than the live menu". */
  stagedCreatedAt?: string | null;
  publishedCreatedAt?: string | null;
};

function olderThanLive(input: PublishVerdictInput): boolean {
  if (!input.stagedCreatedAt || !input.publishedCreatedAt) return false;
  const staged = Date.parse(input.stagedCreatedAt);
  const published = Date.parse(input.publishedCreatedAt);
  if (Number.isNaN(staged) || Number.isNaN(published)) return false;
  return staged < published;
}

/** Turn diff counts into a plain-English safety verdict for one draft. */
export function buildPublishVerdict(input: PublishVerdictInput): PublishVerdict {
  const base = {
    addedCount: input.added,
    removedCount: input.removed,
    priceChangedCount: input.priceChanged,
    requiresRemovalConfirm: input.removed > 0,
  };

  if (!input.hasLiveMenu) {
    return {
      ...base,
      level: "safe",
      headline: "Safe to publish — this becomes your first live menu.",
      detail: `There is no live menu yet, so nothing can be removed. Publishing puts ${input.added} product(s) on your public menu.`,
    };
  }

  if (input.removed === 0) {
    const changes: string[] = [];
    if (input.added > 0) changes.push(`adds ${input.added} product(s)`);
    if (input.priceChanged > 0) changes.push(`updates ${input.priceChanged} price(s)`);
    if (changes.length === 0) changes.push("makes no product changes");
    return {
      ...base,
      level: "safe",
      headline: "Safe to publish — nothing gets removed.",
      detail: `Publishing ${changes.join(" and ")} and keeps all ${input.unchanged} other live product(s) exactly as they are.`,
    };
  }

  if (olderThanLive(input)) {
    return {
      ...base,
      level: "danger",
      headline: `Careful — this draft is OLDER than your live menu and would REMOVE ${input.removed} product(s).`,
      detail: `This draft was staged BEFORE the menu that's live right now, so it doesn't know about the newer products. Publishing it would take ${input.removed} product(s) OFF your public menu. Almost always you want the newest draft instead.`,
    };
  }

  return {
    ...base,
    level: "caution",
    headline: `Heads up — publishing removes ${input.removed} product(s) from the live menu.`,
    detail: `This draft doesn't include ${input.removed} product(s) that are live right now, so publishing takes them off the public menu. If that's intentional (sold out, discontinued), confirm below; if not, pick a newer draft.`,
  };
}

// ---------------------------------------------------------------------------
// Outdated-draft flagging
// ---------------------------------------------------------------------------

export type DraftFreshness = "latest" | "outdated";

export type FlaggedDraft<T> = T & { freshness: DraftFreshness };

/**
 * Flag which intake drafts are safe to look at. Input is the staged-draft list
 * ordered newest-first (how listIntakeStagedVersions returns it); the first is
 * "latest", everything after is "outdated" — an older snapshot whose publish
 * would DROP products added since. Order is verified, not assumed.
 */
export function flagOutdatedDrafts<T extends { id: string; created_at: string }>(
  draftsNewestFirst: readonly T[],
): FlaggedDraft<T>[] {
  // Verify newest-first ordering instead of trusting the caller (never guess).
  const sorted = [...draftsNewestFirst].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  return sorted.map((d, i) => ({ ...d, freshness: i === 0 ? "latest" : "outdated" }));
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
    fix: "Map the type to a website category under Types & Categories, then the next menu update will include the product.",
    fixHref: "/admin/settings/types",
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
    fix: "Check the real potency on the COA and correct it on the product's enrichment page.",
    fixHref: "/admin/products",
    fixLabel: "Open enrichment",
    informational: false,
  },
  fact_extraction_review: {
    title: "A product fact needs your eyes",
    meaning:
      "The system wasn't confident about one of this product's facts (name, potency, size), so it flagged it instead of guessing.",
    fix: "Review the product under Product Onboarding and confirm or correct the flagged fact.",
    fixHref: "/admin/inventory/drafts",
    fixLabel: "Open onboarding",
    informational: false,
  },
  intake_master_no_vendor: {
    title: "No vendor on the manifest",
    meaning:
      "This product arrived without a vendor, so it was added as its own menu card (products are only grouped per vendor).",
    fix: "Fix the manifest's vendor under Receiving if this product should group with others.",
    fixHref: "/admin/inventory/intake",
    fixLabel: "Open receiving",
    informational: false,
  },
  intake_master_ambiguous_name: {
    title: "Name too ambiguous to group",
    meaning:
      "The product's name was too vague to safely group with others, so it became its own card.",
    fix: "Rename it under Product Onboarding if it should roll up with its siblings.",
    fixHref: "/admin/inventory/drafts",
    fixLabel: "Open onboarding",
    informational: false,
  },
  intake_master_merge_ambiguous: {
    title: "Matched more than one live card",
    meaning:
      "This product looked like it belonged to several live menu cards, so it was added as a NEW card instead of merging on a guess.",
    fix: "Consolidate the duplicate live cards under Product Mastering.",
    fixHref: "/admin/products/masters",
    fixLabel: "Open mastering",
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
 * Explain a diagnostic in plain English. Unknown codes fall back to the raw
 * message (never hidden, never guessed).
 */
export function explainDiagnostic(code: string, message: string): DiagnosticExplanation {
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
  ok(first.detail.includes("18"), "first publish counts the adds");

  // Pure adds: safe.
  const adds = buildPublishVerdict({
    added: 3, removed: 0, priceChanged: 2, unchanged: 15, hasLiveMenu: true,
  });
  ok(adds.level === "safe", "adds-only is safe");
  ok(!adds.requiresRemovalConfirm, "adds-only needs no confirm");
  ok(adds.detail.includes("adds 3") && adds.detail.includes("updates 2"), "adds-only detail lists both changes");

  // No changes at all: still safe, says so.
  const same = buildPublishVerdict({
    added: 0, removed: 0, priceChanged: 0, unchanged: 18, hasLiveMenu: true,
  });
  ok(same.level === "safe" && same.detail.includes("no product changes"), "no-op publish reads as no changes");

  // Removals + staged OLDER than live = the owner's exact trap → danger.
  const trap = buildPublishVerdict({
    added: 0, removed: 15, priceChanged: 0, unchanged: 3, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-01T10:00:00Z",
    publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(trap.level === "danger", "older draft with removals is DANGER");
  ok(trap.requiresRemovalConfirm, "danger requires confirm");
  ok(trap.headline.includes("OLDER") && trap.headline.includes("15"), "danger headline names the count");

  // Removals but staged is newer: caution (maybe intentional).
  const newer = buildPublishVerdict({
    added: 1, removed: 2, priceChanged: 0, unchanged: 16, hasLiveMenu: true,
    stagedCreatedAt: "2026-02-03T10:00:00Z",
    publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(newer.level === "caution", "newer draft with removals is caution");
  ok(newer.requiresRemovalConfirm, "caution requires confirm");

  // Missing timestamps degrade to caution, never crash.
  const noTs = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 0, unchanged: 5, hasLiveMenu: true,
  });
  ok(noTs.level === "caution", "missing timestamps → caution not danger");
  const badTs = buildPublishVerdict({
    added: 0, removed: 1, priceChanged: 0, unchanged: 5, hasLiveMenu: true,
    stagedCreatedAt: "garbage", publishedCreatedAt: "2026-02-02T10:00:00Z",
  });
  ok(badTs.level === "caution", "unparseable timestamps → caution not crash");

  // flagOutdatedDrafts: newest = latest, rest outdated; re-sorts if needed.
  const flagged = flagOutdatedDrafts([
    { id: "b", created_at: "2026-02-02T00:00:00Z" },
    { id: "a", created_at: "2026-02-01T00:00:00Z" },
  ]);
  ok(flagged[0].id === "b" && flagged[0].freshness === "latest", "newest flagged latest");
  ok(flagged[1].id === "a" && flagged[1].freshness === "outdated", "older flagged outdated");
  const resorted = flagOutdatedDrafts([
    { id: "old", created_at: "2026-01-01T00:00:00Z" },
    { id: "new", created_at: "2026-03-01T00:00:00Z" },
  ]);
  ok(resorted[0].id === "new", "mis-ordered input is re-sorted, order verified not assumed");
  ok(flagOutdatedDrafts([]).length === 0, "empty draft list is fine");
  const solo = flagOutdatedDrafts([{ id: "x", created_at: "2026-02-02T00:00:00Z" }]);
  ok(solo[0].freshness === "latest", "single draft is latest");

  // explainDiagnostic: every actionable code has a fix link; FYIs don't.
  const unmapped = explainDiagnostic("draft_inject_unmapped_category", "raw msg");
  ok(unmapped.fixHref === "/admin/settings/types", "unmapped category → Types & Categories");
  ok(!unmapped.informational, "unmapped category is actionable");
  const noPrice = explainDiagnostic("draft_inject_no_price", "raw msg");
  ok(noPrice.fixHref === "/admin/inventory/drafts", "no price → onboarding");
  const noKey = explainDiagnostic("draft_inject_no_pos_key", "raw msg");
  ok(noKey.fixHref === "/admin/inventory/drafts", "no POS key → onboarding");
  const potency = explainDiagnostic("draft_inject_potency_capped", "raw msg");
  ok(potency.fixHref === "/admin/products", "potency capped → enrichment");
  const noVendor = explainDiagnostic("intake_master_no_vendor", "raw msg");
  ok(noVendor.fixHref === "/admin/inventory/intake", "no vendor → receiving");
  const ambig = explainDiagnostic("intake_master_merge_ambiguous", "raw msg");
  ok(ambig.fixHref === "/admin/products/masters", "merge ambiguous → mastering");
  const factRev = explainDiagnostic("fact_extraction_review", "raw msg");
  ok(factRev.fixHref === "/admin/inventory/drafts", "fact review → onboarding");
  const grouped = explainDiagnostic("intake_master_grouped", "raw msg");
  ok(grouped.informational && grouped.fixHref === null, "grouped is FYI-only");
  ok(grouped.meaning === "raw msg", "FYI without meaning falls back to the raw message");

  // Unknown code: raw message preserved, nothing invented.
  const unknown = explainDiagnostic("some_new_code", "the raw message");
  ok(unknown.meaning === "the raw message", "unknown code keeps the raw message");
  ok(unknown.fixHref === null, "unknown code invents no link");

  // Shared copy pins the swap semantics in one place.
  ok(PUBLISH_SEMANTICS_COPY.includes("REPLACES the whole menu"), "semantics copy states the swap");
  ok(PUBLISH_SEMANTICS_COPY.includes("NEWEST draft"), "semantics copy says publish the newest");

  return { passed };
}
