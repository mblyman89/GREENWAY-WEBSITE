/**
 * src/lib/pos/menu-waiting-link-core.ts  (Round 13 - R13a)
 *
 * PURE. Where "this delivery's menu update is waiting" sends the owner.
 *
 * THE DEAD END THIS REPLACES (owner report, Round 13)
 *   "every single button that sends me to the publish page has absolutely
 *    nothing for me to do there."
 * Before R13a both the ribbon step (menu-live-step-core) and the delivery's
 * Issues row (issues-core manifest_menu_waiting) linked to the bare Publish
 * page, and the ribbon decided "waiting" from a COUNT of staged receiving
 * rows (intake-menu-staging intakeMenuStepSnapshot). Two faults:
 *   1. The count included rows the S15 rule archives on the next publish
 *      (publish-archive-rule-core isSuperseded) - the Publish page moves those
 *      into "Will be replaced" (publish-queue-core splitQueue), so the owner
 *      arrived and found no waiting row for his delivery.
 *   2. Even when a row was there, a fact hold is not fixed on the Publish
 *      page. The fact decisions (S30) are made on Product Onboarding's
 *      Approved view for the delivery: drafts/page.tsx renders
 *      IntakeFactReviewPanel for each row with an open flag
 *      (loadOpenIntakeFactFlags, view === "approved" only).
 *
 * THE RULE
 *   Read the delivery's newest staged receiving rows by NAME (id, created_at,
 *   publish_outcome state), drop every row the S15 rule would archive, keep
 *   the newest survivor. Then the link goes where the work is:
 *     held_for_fact_review -> Product Onboarding, Approved view, this delivery
 *                             (the Keep / Correct / Take off controls)
 *     held_for_cutover     -> the Cultivera cutover page (S18)
 *     anything else        -> that exact update's review page, which shows
 *                             its warnings with fix buttons and the Publish
 *                             button (menu-imports/version/[versionId])
 *
 * No fs, no network, no Supabase, no clock.
 */
import { draftsHref, isUuid } from "@/lib/catalog/draft-deep-link-core";
import { isSuperseded } from "@/lib/pos/publish-archive-rule-core";
import { CUTOVER_ACTION_HREF } from "@/lib/pos/publish-queue-core";
import { parseIntakeSummary } from "@/lib/pos/intake-version-copy-core";

/** Named JSON-path select for the delivery's staged receiving rows. */
export const WAITING_VERSION_SELECT = "id, created_at, state:summary_json->publish_outcome->>state";

/**
 * How many of the delivery's newest staged rows are read. Only the newest
 * non-superseded one matters; a few spare rows keep that true when a publish
 * just landed and older copies have not been archived yet.
 */
export const WAITING_VERSION_READ_LIMIT = 5;

export type WaitingVersionRow = {
  id: string | null;
  created_at: string | null;
  state: string | null;
};

export type WaitingMenuVersion = {
  id: string;
  /** summary_json.publish_outcome.state, or null when none was recorded. */
  state: string | null;
};

/**
 * The one waiting update for a delivery, or null. `rows` are staged receiving
 * rows for ONE manifest; `published` is the live version (null = none). A row
 * the S15 rule archives on the next publish is never "waiting". Rows are
 * ranked here too (newest created_at, then id), so input order cannot matter.
 */
export function pickWaitingVersion(
  rows: readonly WaitingVersionRow[] | null | undefined,
  published: { id: string; created_at: string } | null,
): WaitingMenuVersion | null {
  const usable = (rows ?? []).filter(
    (r): r is { id: string; created_at: string; state: string | null } =>
      Boolean(r) && typeof r.id === "string" && r.id.length > 0 && typeof r.created_at === "string",
  );
  const live = usable.filter(
    (r) => !(published && isSuperseded(published, { id: r.id, status: "staged", created_at: r.created_at })),
  );
  if (live.length === 0) return null;
  live.sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    const na = Number.isFinite(ta) ? ta : -Infinity;
    const nb = Number.isFinite(tb) ? tb : -Infinity;
    if (na !== nb) return nb - na;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const top = live[0];
  const state = typeof top.state === "string" && top.state.trim() ? top.state.trim() : null;
  return { id: top.id, state };
}

export type WaitingMenuFix = {
  href: string;
  label: string;
  /** One plain sentence: what is waiting and what to do on arrival. */
  fixText: string;
  /** A second place that helps (the update's own review page), or null. */
  extra: { href: string; label: string } | null;
};

/** The update's own review page, returning to the delivery. */
export function waitingVersionReviewHref(versionId: string, manifestId: string | null): string {
  const back = manifestId && isUuid(manifestId) ? `/admin/inventory/intake/${manifestId}` : null;
  const base = `/admin/menu-imports/version/${encodeURIComponent(versionId)}`;
  return back ? `${base}?back=${encodeURIComponent(back)}` : base;
}

export const WAITING_COPY = {
  factLabel: "Check the flagged facts",
  factText:
    "This delivery's menu update is held because a product has a fact that needs a second look. Open this delivery's approved products: each flagged one shows Keep, Correct, or Take off the menu. The update goes live by itself once every flag has a decision.",
  cutoverLabel: "Open the Cultivera cutover",
  cutoverText:
    "This delivery's menu update is held until the Cultivera upload is published. The cutover page shows the upload to publish, and rebuilds this update afterwards.",
  reviewLabel: "Review & publish this update",
  reviewText:
    "This delivery's menu update did not go live by itself. Its review page lists exactly what it changes, each warning with its fix button, and the Publish button.",
  extraLabel: "See this update",
} as const;

/** Where the waiting update is fixed. Never the bare Publish page. */
export function waitingMenuFix(opts: {
  manifestId: string | null;
  version: WaitingMenuVersion;
}): WaitingMenuFix {
  // Both builders below validate the id themselves (draftsHref via uuidOrNull,
  // waitingVersionReviewHref via isUuid), so a bad id is never linked.
  const manifestId = opts.manifestId;
  const reviewHref = waitingVersionReviewHref(opts.version.id, manifestId);
  if (opts.version.state === "held_for_fact_review") {
    return {
      href: draftsHref({ status: "approved", manifestId }),
      label: WAITING_COPY.factLabel,
      fixText: WAITING_COPY.factText,
      extra: { href: reviewHref, label: WAITING_COPY.extraLabel },
    };
  }
  if (opts.version.state === "held_for_cutover") {
    return {
      href: CUTOVER_ACTION_HREF,
      label: WAITING_COPY.cutoverLabel,
      fixText: WAITING_COPY.cutoverText,
      extra: { href: reviewHref, label: WAITING_COPY.extraLabel },
    };
  }
  return { href: reviewHref, label: WAITING_COPY.reviewLabel, fixText: WAITING_COPY.reviewText, extra: null };
}

/**
 * The delivery a receiving update belongs to, from its own summary_json
 * (manifest header id first, then the flat manifest_id S00 wrote). Only a
 * real uuid is returned - a link is never built from a guessed id.
 */
export function publishRowManifestId(summary: unknown): string | null {
  const p = parseIntakeSummary(summary);
  for (const c of [p.manifest?.id, p.manifestId]) {
    if (typeof c === "string" && isUuid(c.trim())) return c.trim().toLowerCase();
  }
  return null;
}

/** Where a fact-held update is decided: the delivery's flagged products. */
export function factHoldHref(summary: unknown): string | null {
  const m = publishRowManifestId(summary);
  return m ? `${draftsHref({ status: "approved", manifestId: m })}#flagged-facts` : null;
}

// ---------------------------------------------------------------------------
// The flagged-facts worklist (drafts page, Approved view)
// ---------------------------------------------------------------------------

/** The fields of an open flag the worklist needs (intake-fact-review-core OpenFactFlag). */
export type WorklistFlag = {
  manifestId: string;
  draftId: string | null;
  productName: string;
  reasons: readonly string[];
};

export type FactWorklistRow = {
  draftId: string;
  productName: string;
  reason: string;
  /** Pins the row: its own Keep / Correct / Take off panel, whatever page it is on. */
  href: string;
  /** True when the row is already on the page being shown (link is an anchor jump). */
  onThisPage: boolean;
};

/**
 * Every open fact flag for ONE delivery, as a list with a link each. The
 * Approved view is paged (onboarding-list-core DRAFT_PAGE_SIZES), so on a
 * big delivery a flagged product can sit on page 3 while page 1 shows no
 * panel at all - the "nothing to do there" dead end. This list is built from
 * the flags themselves, not from the page, so every flag is reachable.
 * Sorted by product name, then draft id (stable).
 */
export function factFlagWorklist(
  flags: Iterable<WorklistFlag> | null | undefined,
  manifestId: string | null,
  onPageDraftIds: ReadonlySet<string>,
): FactWorklistRow[] {
  if (!manifestId) return [];
  const m = manifestId.toLowerCase();
  const out: FactWorklistRow[] = [];
  const seen = new Set<string>();
  for (const f of flags ?? []) {
    if (!f || typeof f.manifestId !== "string" || f.manifestId.toLowerCase() !== m) continue;
    const draftId = typeof f.draftId === "string" && isUuid(f.draftId) ? f.draftId : null;
    if (!draftId || seen.has(draftId)) continue;
    seen.add(draftId);
    const onThisPage = onPageDraftIds.has(draftId);
    const reason = (f.reasons ?? []).map((r) => (typeof r === "string" ? r.trim() : "")).find(Boolean) ?? "A fact needs a second look.";
    const name = typeof f.productName === "string" && f.productName.trim() ? f.productName.trim() : "Unnamed product";
    out.push({
      draftId,
      productName: name,
      reason,
      href: onThisPage ? `#draft-${draftId}` : draftsHref({ status: "approved", manifestId: m, draftId }),
      onThisPage,
    });
  }
  out.sort((a, b) =>
    a.productName.localeCompare(b.productName) || (a.draftId < b.draftId ? -1 : a.draftId > b.draftId ? 1 : 0),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runMenuWaitingLinkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`menu-waiting-link-core FAIL: ${m}`);
    }
  };
  const M = "11111111-2222-4333-8444-555555555555";
  const P = { id: "pub", created_at: "2026-03-10T12:00:00Z" };
  const row = (id: string, at: string, state: string | null = null): WaitingVersionRow => ({ id, created_at: at, state });

  // pickWaitingVersion
  ok(pickWaitingVersion([], P) === null, "no rows -> null");
  ok(pickWaitingVersion(null, P) === null, "null rows -> null");
  ok(pickWaitingVersion(undefined, null) === null, "undefined rows -> null");
  ok(pickWaitingVersion([row("old", "2026-03-09T00:00:00Z")], P) === null, "older than live -> superseded -> null");
  ok(pickWaitingVersion([row("same", P.created_at)], P)?.id === "same", "same instant is not older -> waiting");
  ok(pickWaitingVersion([row("pub", "2026-03-01T00:00:00Z")], P)?.id === "pub", "the live id itself is never 'superseded'");
  ok(pickWaitingVersion([row("new", "2026-03-11T00:00:00Z", "held_for_fact_review")], P)?.state === "held_for_fact_review", "newer row keeps state");
  ok(pickWaitingVersion([row("old", "2026-03-09T00:00:00Z")], null)?.id === "old", "no live menu -> nothing superseded");
  const mixed = pickWaitingVersion(
    [row("a", "2026-03-11T00:00:00Z", "auto_publish_failed"), row("b", "2026-03-12T00:00:00Z", "held_for_fact_review"), row("c", "2026-03-01T00:00:00Z")],
    P,
  );
  ok(mixed?.id === "b" && mixed.state === "held_for_fact_review", "newest survivor wins regardless of input order");
  const tie = pickWaitingVersion([row("a", "2026-03-11T00:00:00Z"), row("b", "2026-03-11T00:00:00Z")], P);
  ok(tie?.id === "b", "tie on created_at -> larger id (matches order id desc)");
  const tie2 = pickWaitingVersion([row("b", "2026-03-11T00:00:00Z"), row("a", "2026-03-11T00:00:00Z")], P);
  ok(tie2?.id === "b", "tie independent of input order");
  ok(pickWaitingVersion([row("x", "not-a-date")], P)?.id === "x", "unparseable time is never archived (S15) -> waiting");
  const nanVsGood = pickWaitingVersion([row("x", "not-a-date"), row("y", "2026-03-11T00:00:00Z")], P);
  ok(nanVsGood?.id === "y", "a dated row outranks an undated one");
  const nanFirst = pickWaitingVersion([row("y", "2026-03-11T00:00:00Z"), row("x", "not-a-date")], P);
  ok(nanFirst?.id === "y", "undated row never outranks, either order");
  ok(pickWaitingVersion([{ id: null, created_at: "2026-03-11T00:00:00Z", state: null }], P) === null, "row without id ignored");
  ok(pickWaitingVersion([{ id: "", created_at: "2026-03-11T00:00:00Z", state: null }], P) === null, "empty id ignored");
  ok(pickWaitingVersion([{ id: "z", created_at: null, state: null }], P) === null, "row without created_at ignored");
  ok(pickWaitingVersion([row("s", "2026-03-11T00:00:00Z", "  ")], P)?.state === null, "blank state -> null");
  ok(pickWaitingVersion([row("s", "2026-03-11T00:00:00Z", " held_for_cutover ")], P)?.state === "held_for_cutover", "state trimmed");

  // waitingVersionReviewHref
  ok(waitingVersionReviewHref("v1", M) === `/admin/menu-imports/version/v1?back=${encodeURIComponent(`/admin/inventory/intake/${M}`)}`, "review href returns to the delivery");
  ok(waitingVersionReviewHref("v1", null) === "/admin/menu-imports/version/v1", "no manifest -> no back");
  ok(waitingVersionReviewHref("v1", "not-a-uuid") === "/admin/menu-imports/version/v1", "non-uuid manifest -> no back");
  ok(waitingVersionReviewHref("a b", null) === "/admin/menu-imports/version/a%20b", "id encoded");

  // waitingMenuFix
  const fact = waitingMenuFix({ manifestId: M, version: { id: "v1", state: "held_for_fact_review" } });
  ok(fact.href === `/admin/inventory/drafts?status=approved&manifest=${M}`, "fact hold -> this delivery's approved products");
  ok(fact.label === WAITING_COPY.factLabel && fact.fixText.includes("Keep, Correct, or Take off"), "fact copy names the controls");
  ok(fact.extra?.href === waitingVersionReviewHref("v1", M), "fact hold also offers the update page");
  const factNoM = waitingMenuFix({ manifestId: null, version: { id: "v1", state: "held_for_fact_review" } });
  ok(factNoM.href === "/admin/inventory/drafts?status=approved", "fact hold without manifest -> approved view");
  const cut = waitingMenuFix({ manifestId: M, version: { id: "v2", state: "held_for_cutover" } });
  ok(cut.href === CUTOVER_ACTION_HREF && cut.href === "/admin/menu-imports/cutover", "cutover hold -> cutover page");
  ok(cut.label === WAITING_COPY.cutoverLabel && cut.extra !== null, "cutover label + extra");
  for (const st of ["auto_publish_failed", "auto_publish_attempted", null, "???"]) {
    const f = waitingMenuFix({ manifestId: M, version: { id: "v3", state: st } });
    ok(f.href === waitingVersionReviewHref("v3", M) && f.extra === null, `${String(st)} -> the update's review page`);
    ok(f.label === WAITING_COPY.reviewLabel, `${String(st)} -> review label`);
  }
  for (const f of [fact, factNoM, cut]) ok(f.href !== "/admin/publish", "never the bare Publish page");
  ok(!/\/admin\/publish(\?|$)/.test(waitingMenuFix({ manifestId: M, version: { id: "v", state: null } }).href), "fallback never the bare Publish page");

  // factFlagWorklist
  const D1 = "aaaaaaaa-1111-4111-8111-111111111111";
  const D2 = "bbbbbbbb-2222-4222-8222-222222222222";
  const flagsIn: WorklistFlag[] = [
    { manifestId: M, draftId: D2, productName: "Zeta Gummies", reasons: ["  ", "mg per piece unclear"] },
    { manifestId: M, draftId: D1, productName: "Alpha Vape", reasons: [] },
    { manifestId: M, draftId: D1, productName: "dup", reasons: ["x"] },
    { manifestId: "other", draftId: "cccccccc-3333-4333-8333-333333333333", productName: "Other", reasons: ["x"] },
    { manifestId: M, draftId: null, productName: "No draft", reasons: ["x"] },
    { manifestId: M, draftId: "not-a-uuid", productName: "Bad", reasons: ["x"] },
  ];
  const wl = factFlagWorklist(flagsIn, M, new Set([D2]));
  ok(wl.length === 2, "only this delivery, real draft ids, de-duplicated");
  ok(wl[0].productName === "Alpha Vape" && wl[1].productName === "Zeta Gummies", "sorted by name");
  ok(wl[0].reason === "A fact needs a second look.", "no reasons -> plain fallback");
  ok(wl[1].reason === "mg per piece unclear", "first non-blank reason");
  ok(wl[0].href === `/admin/inventory/drafts?status=approved&manifest=${M}&draft=${D1}#draft-${D1}` && !wl[0].onThisPage, "off-page -> pinned link");
  ok(wl[1].href === `#draft-${D2}` && wl[1].onThisPage, "on-page -> anchor jump");
  ok(factFlagWorklist(flagsIn, null, new Set()).length === 0, "no delivery -> no list");
  ok(factFlagWorklist(null, M, new Set()).length === 0, "no flags -> empty");
  ok(factFlagWorklist(flagsIn, M.toUpperCase(), new Set()).length === 2, "manifest match is case-insensitive");
  const ties = factFlagWorklist(
    [
      { manifestId: M, draftId: D2, productName: "Same", reasons: [] },
      { manifestId: M, draftId: D1, productName: "Same", reasons: [] },
    ],
    M,
    new Set(),
  );
  ok(ties[0].draftId === D1 && ties[1].draftId === D2, "name tie -> draft id order");
  ok(factFlagWorklist([{ manifestId: M, draftId: D1, productName: "  ", reasons: [] }], M, new Set())[0].productName === "Unnamed product", "blank name fallback");

  // publishRowManifestId / factHoldHref
  ok(publishRowManifestId({ manifest_id: M }) === M, "flat manifest_id");
  ok(publishRowManifestId({ manifest_id: M.toUpperCase() }) === M, "normalized to lower case");
  ok(publishRowManifestId({ manifest_id: "nope" }) === null, "non-uuid refused");
  ok(publishRowManifestId(null) === null && publishRowManifestId([]) === null, "no summary -> null");
  ok(factHoldHref({ manifest_id: M }) === `/admin/inventory/drafts?status=approved&manifest=${M}#flagged-facts`, "fact hold href");
  ok(factHoldHref({}) === null, "no delivery -> no fact link");

  // Constants the server read depends on.
  ok(WAITING_VERSION_SELECT === "id, created_at, state:summary_json->publish_outcome->>state", "named select");
  ok(WAITING_VERSION_READ_LIMIT === 5, "read limit");

  if (failed === 0) console.log(`menu-waiting-link-core: PASSED ${passed} assertions`);
  return { passed, failed };
}
