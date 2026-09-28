/**
 * src/lib/inventory/cutover-guard-core.ts
 *
 * S18 - the Cultivera cutover guard: publish Cultivera first, then receive
 * (bible S18, chapter 7.3 / 7.4; F-041, F-074, F-076, F-088).
 *
 * WHY THIS EXISTS (bible 7.2 "Carry-forward ... Order-dependent"):
 *   Every intake menu update is a SNAPSHOT: the live menu carried forward
 *   plus the newly approved products (F-041). If receiving publishes while the
 *   one-time Cultivera upload sits staged-but-unpublished, the receiving
 *   update is built WITHOUT the Cultivera products, and publishing Cultivera
 *   later replaces it (the receiving products vanish unless they happened to
 *   be injected at upload time, F-074). The order must be: publish Cultivera,
 *   then every receiving update publishes on top of it.
 *
 * WHAT THE GUARD DOES (safe by construction, bible S18 goal):
 *   1. HOLD. While a real (is_test = false) Cultivera upload is staged, an
 *      intake update is still staged (nothing is lost) but NOT auto-published;
 *      it is born with publish_outcome "held_for_cutover" and the timeline
 *      gets event "menu_publish_held_for_cutover" with the S18.4 copy.
 *   2. REFUSE a hand publish of any OTHER version while that upload is staged
 *      (publishing a receiving update first is exactly the wrong order).
 *   3. RELEASE. The moment the owner publishes the Cultivera upload, each
 *      delivery with a held update is RE-STAGED on top of the now-live
 *      Cultivera menu (never the held snapshot itself - it predates
 *      Cultivera and publishing it would take the Cultivera products off,
 *      bible 7.4 "Do not publish an older staged version"). The re-staged
 *      update publishes itself; the held rows are archived by the S15 rule.
 *   4. ONE-TIME. After cutover (a real Cultivera menu went live AND a
 *      receiving update was published after it), a second real Cultivera
 *      upload is refused (bible 7.4 "Do not run the Cultivera import a second
 *      time after cutover"). Test-mode rehearsals stay allowed.
 *
 * Flag INTAKE_CUTOVER_GUARD (bible S18.7 "Flag."): on unless an off-word.
 * Off restores the pre-S18 behaviour exactly (no hold, no refusals).
 *
 * PURE: no DB, no React, no server-only. Self-tests at the bottom.
 */

export const CUTOVER_GUARD_ENV = "INTAKE_CUTOVER_GUARD";

const OFF_WORDS = new Set(["off", "0", "false", "no", "disabled"]);

/** On unless explicitly switched off (house flag pattern). */
export function cutoverGuardEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !OFF_WORDS.has(v);
}

/** The timeline event written when an intake update is held (bible S18.2). */
export const CUTOVER_EVENT = "menu_publish_held_for_cutover";

/** The outcome state persisted on a held update (bible S18.2). */
export const CUTOVER_OUTCOME = "held_for_cutover";

/** The staging reason returned to callers when held. */
export const CUTOVER_REASON = "held-for-cutover";

/** Bible S18.4 hold message, verbatim. */
export const CUTOVER_HOLD_COPY =
  "Your one-time Cultivera menu is uploaded but not published yet. Publish it under Menu Imports first \u2014 then every receiving update publishes itself on top of it.";

/** Refusal when someone publishes a receiving update by hand while Cultivera waits. */
export const CUTOVER_PUBLISH_REFUSED_COPY =
  "Publish your one-time Cultivera menu first. Publishing this update now would leave the Cultivera products out of it. Once Cultivera is live, every held receiving update rebuilds itself on top of it and publishes automatically.";

/** Refusal for a second real Cultivera upload after cutover (bible 7.4). */
export const CUTOVER_REUPLOAD_REFUSED_COPY =
  "The one-time Cultivera upload is already done and receiving has published on top of it. A second upload would replace your menu with an old POS export. New products come in through receiving now. (A Test-mode upload is still allowed for rehearsals.)";

/** Where the runbook lives in the app and in the repo. */
export const CUTOVER_RUNBOOK_HREF = "/admin/menu-imports/cutover";
export const CUTOVER_RUNBOOK_DOC = "docs/CULTIVERA_CUTOVER_RUNBOOK.md";

/**
 * Most deliveries rebuilt by one Cultivera publish (bounded work per click:
 * each rebuild is one staging run, so 10 keeps the click well inside a
 * serverless request). The rest are reported and rebuild one-by-one when
 * someone presses Publish on them (decidePublish -> "rebuild").
 */
export const CUTOVER_RELEASE_MAX = 10;

// ---------------------------------------------------------------------------
// 1. The hold decision
// ---------------------------------------------------------------------------

export type CutoverRow = {
  id?: unknown;
  import_id?: unknown;
  status?: unknown;
  is_test?: unknown;
};

/**
 * A row that blocks receiving from publishing: a REAL Cultivera upload
 * (import_id set, is_test not true) that is still staged. Test-mode uploads
 * never block (bible S18.8).
 */
export function isBlockingCultiveraRow(row: CutoverRow | null | undefined): boolean {
  if (!row) return false;
  if (typeof row.import_id !== "string" || row.import_id.length === 0) return false;
  if (row.status !== "staged") return false;
  return row.is_test !== true;
}

/** Most blocking rows read at once (more than one real upload can be staged). */
export const CUTOVER_BLOCKER_READ_MAX = 10;

export type CutoverBlocking = { versionIds: string[] };

/**
 * Every blocking row's version id (input order, distinct), or null when none
 * blocks. Rows without a usable id are skipped (never guess).
 */
export function blockingCultivera(
  rows: readonly CutoverRow[] | null | undefined,
): CutoverBlocking | null {
  const ids: string[] = [];
  for (const r of rows ?? []) {
    if (isBlockingCultiveraRow(r) && typeof r.id === "string" && r.id.length > 0 && !ids.includes(r.id)) {
      ids.push(r.id);
    }
  }
  return ids.length > 0 ? { versionIds: ids } : null;
}

/**
 * Should a hand publish of `versionId` be refused? Only when a real Cultivera
 * upload is staged AND the version being published is not one of those
 * uploads (publishing ANY staged real upload is the right order; the RPC
 * archives the older ones). Unknown (read failed) never refuses: the pre-S18
 * behaviour, so a flaky read can never lock the owner out of publishing.
 */
export function refuseHandPublish(
  versionId: string,
  blocking: CutoverBlocking | null | "unknown",
): boolean {
  if (blocking === null || blocking === "unknown") return false;
  return !blocking.versionIds.includes(versionId);
}

/** Did this publish just put a blocking Cultivera upload live? (release trigger) */
export function publishedTheBlocker(
  versionId: string,
  blocking: CutoverBlocking | null | "unknown",
): boolean {
  return blocking !== null && blocking !== "unknown" && blocking.versionIds.includes(versionId);
}

// ---------------------------------------------------------------------------
// 2. The release plan
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The held-row read's shape (named columns + JSON paths, so the diagnostics
 * blob is never downloaded just to learn a manifest id):
 *   id, import_id, status, origin:summary_json->>origin,
 *   state:summary_json->publish_outcome->>state, manifest_id:summary_json->>manifest_id
 */
export type HeldRow = {
  id?: unknown;
  import_id?: unknown;
  status?: unknown;
  created_at?: unknown;
  origin?: unknown;
  state?: unknown;
  manifest_id?: unknown;
  reason?: unknown;
};

/** The select string for the held-row read (pinned by the tests). */
export const HELD_ROW_SELECT =
  "id, import_id, status, created_at, origin:summary_json->>origin, state:summary_json->publish_outcome->>state, manifest_id:summary_json->>manifest_id, reason:summary_json->>archived_reason";

/** Most held rows read by one release (bounded memory; far above real use). */
export const HELD_READ_MAX = 200;

/** Is this row an intake update held for cutover and still staged? */
export function isHeldForCutover(row: HeldRow | null | undefined): boolean {
  return needsRebuildAtCutover(row) && row!.state === CUTOVER_OUTCOME;
}

/**
 * Does this row need rebuilding when the Cultivera upload goes live? Every
 * receiving (intake-origin) update that is still staged at that moment was
 * built on the menu that was live BEFORE Cultivera, so publishing it later
 * would take the Cultivera products off (bible 7.4). That is true whatever it
 * waits for: a cutover hold, a fact-review hold, or an unfinished publish.
 * 0236 only archives staged rows created BEFORE the published upload, and a
 * row that waited for cutover was created AFTER it, so without this rebuild
 * it would linger. The query filters the same way; this re-check means a
 * loosened query can never rebuild a row that is not one (defence in depth).
 */
export function needsRebuildAtCutover(row: HeldRow | null | undefined): boolean {
  if (!row || row.import_id !== null || row.status !== "staged") return false;
  return row.origin === "intake";
}

/**
 * The deliveries to re-stage after Cultivera goes live: distinct manifest ids
 * (lower-cased UUIDs) of rows that need a rebuild, in input order, capped. Each manifest
 * carries the held row ids to retire once its rebuild succeeds. Rows that are
 * not held, or whose manifest id is not a UUID, are skipped (never guess).
 */
export function manifestsToRelease(
  rows: readonly HeldRow[] | null | undefined,
  max: number = CUTOVER_RELEASE_MAX,
): { manifests: string[]; heldIds: Record<string, string[]>; overflow: number } {
  const seen: string[] = [];
  const heldIds: Record<string, string[]> = {};
  for (const r of rows ?? []) {
    if (!needsRebuildAtCutover(r)) continue;
    if (typeof r.manifest_id !== "string" || !UUID_RE.test(r.manifest_id)) continue;
    const m = r.manifest_id.toLowerCase();
    if (!seen.includes(m)) seen.push(m);
    if (typeof r.id === "string" && r.id.length > 0) (heldIds[m] ??= []).push(r.id);
  }
  const cap = Math.max(0, Math.floor(max));
  const manifests = seen.slice(0, cap);
  const kept: Record<string, string[]> = {};
  for (const m of manifests) kept[m] = heldIds[m] ?? [];
  return { manifests, heldIds: kept, overflow: Math.max(0, seen.length - cap) };
}

/**
 * Retire the old held row once its delivery was rebuilt? Only when the old
 * row would otherwise linger:
 *   - published rebuild: NO write needed - publish_menu_version (0236)
 *     already archived every staged row created before it, atomically;
 *   - staged-but-waiting rebuild (e.g. a fact hold): YES - the new snapshot
 *     carries everything, and the old one must not be published by mistake;
 *   - nothing new to stage (the products are already live): YES;
 *   - any failure: NO - the held row stays, so a retry can rebuild it.
 */
export function shouldRetireHeld(
  outcome: { staged?: unknown; published?: unknown; reason?: unknown } | null | undefined,
): boolean {
  if (!outcome || outcome.published === true) return false;
  return outcome.staged === true || outcome.reason === "no-new-items";
}

/**
 * Which statuses a retire may touch. A waiting rebuild retires only a row
 * that is still staged. A "nothing new" rebuild may also mark a leftover a
 * publish already archived, so it drops off the "still to rebuild" list
 * (pendingRebuilds) instead of sitting there forever.
 */
export function retireStatuses(outcome: { staged?: unknown } | null | undefined): string[] {
  return outcome?.staged === true ? ["staged"] : ["staged", "archived"];
}

/** archived_reason prefix for a held row retired by the release. */
export const CUTOVER_RETIRED_PREFIX = "cutover_rebuilt:";

/**
 * The summary_json of a retired held row: every existing key kept (same
 * shape rule as 0236's merge), plus why and when. `replacedBy` is the new
 * snapshot id, or "no-changes" when the products were already live.
 */
export function retiredSummary(
  summary: unknown,
  replacedBy: string | null,
  atIso: string,
): Record<string, unknown> {
  let base: Record<string, unknown>;
  if (summary === null || summary === undefined) base = {};
  else if (typeof summary === "object" && !Array.isArray(summary)) base = summary as Record<string, unknown>;
  else base = { summary_before_archive: summary };
  // A row already archived by a publish keeps that earlier reason beside the
  // new one (the audit trail never loses a step).
  const before = typeof base.archived_reason === "string" ? { archived_reason_before: base.archived_reason } : {};
  return { ...base, ...before, archived_reason: CUTOVER_RETIRED_PREFIX + (replacedBy ?? "no-changes"), archived_at: atIso };
}

/**
 * Deliveries whose NEWEST receiving update is still a cutover hold that was
 * never published and never retired by a rebuild: the "still to rebuild" list
 * on the cutover page. It catches every leftover - a delivery past the
 * release cap (its held row is archived as superseded by the next publish),
 * a rebuild that failed, or a hold whose Cultivera upload was deleted. Once a
 * newer update of the delivery exists (staged, published, or a retired
 * no-changes rebuild), the delivery drops off. Rows are the delivery's
 * receiving updates (any status); unparseable times are skipped.
 */
export function pendingRebuilds(
  rows: readonly HeldRow[] | null | undefined,
): Array<{ manifestId: string; versionId: string; status: string }> {
  const newest = new Map<string, { row: HeldRow; t: number }>();
  for (const r of rows ?? []) {
    if (r.import_id !== null || r.origin !== "intake") continue;
    if (typeof r.manifest_id !== "string" || !UUID_RE.test(r.manifest_id)) continue;
    const t = Date.parse(String(r.created_at ?? ""));
    if (Number.isNaN(t)) continue;
    const m = r.manifest_id.toLowerCase();
    const cur = newest.get(m);
    if (!cur || t > cur.t) newest.set(m, { row: r, t });
  }
  const out: Array<{ manifestId: string; versionId: string; status: string }> = [];
  for (const [m, { row }] of newest) {
    if (row.state !== CUTOVER_OUTCOME || row.status === "published") continue;
    if (typeof row.reason === "string" && row.reason.startsWith(CUTOVER_RETIRED_PREFIX)) continue;
    if (typeof row.id !== "string" || typeof row.status !== "string") continue;
    out.push({ manifestId: m, versionId: row.id, status: row.status });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2b. The hand-publish decision (one pure verdict for publishVersion)
// ---------------------------------------------------------------------------

export type PublishDecision =
  /** Publish as before. `release` = this is the Cultivera upload: rebuild held updates after. */
  | { kind: "allow"; release: boolean }
  /** Refuse: a real Cultivera upload is staged and this is not it. */
  | { kind: "refuse" }
  /** Do not publish this stale snapshot; rebuild its delivery on the live menu instead. */
  | { kind: "rebuild"; manifestId: string };

/**
 * The one verdict for a hand publish of `versionId`:
 *   1. It IS a staged real Cultivera upload -> allow, then release.
 *   2. Another real Cultivera upload is staged -> refuse (wrong order).
 *   3. The target is a snapshot held for cutover -> never publish it (it was
 *      built before Cultivera went live; bible 7.4 "Do not publish an older
 *      staged version"). Rebuild its delivery instead, which stages a fresh
 *      snapshot on the live menu and publishes it by the normal rules.
 *   4. Otherwise allow (pre-S18 behaviour; also every "unknown" read).
 */
export function decidePublish(
  versionId: string,
  blocking: CutoverBlocking | null | "unknown",
  target: HeldRow | null | "unknown",
): PublishDecision {
  if (publishedTheBlocker(versionId, blocking)) return { kind: "allow", release: true };
  if (refuseHandPublish(versionId, blocking)) return { kind: "refuse" };
  if (target !== "unknown" && isHeldForCutover(target)) {
    const m = target!.manifest_id;
    if (typeof m === "string" && UUID_RE.test(m)) return { kind: "rebuild", manifestId: m.toLowerCase() };
  }
  return { kind: "allow", release: false };
}

/** The target read's select string: the same shape as the held-row read. */
export const TARGET_SELECT = HELD_ROW_SELECT;

/**
 * Copy after pressing Publish on a stale held update (rebuild path). `ok`
 * means "something was published" (the page's green banner); every other
 * outcome is told plainly in the notice banner.
 */
export function rebuildNote(outcome: { staged?: unknown; published?: unknown; reason?: unknown } | null | undefined): {
  ok: boolean;
  text: string;
} {
  if (outcome?.published === true) {
    return { ok: true, text: "Rebuilt this delivery's update on top of the live menu and published it." };
  }
  if (outcome?.staged === true) {
    return {
      ok: false,
      text: "Rebuilt this delivery's update on top of the live menu. It is waiting under Admin \u2192 Publish Menu \u2014 open it to see why.",
    };
  }
  if (outcome?.reason === "no-new-items") {
    return { ok: false, text: "Nothing to rebuild: every product in this delivery is already on the live menu." };
  }
  return { ok: false, text: "Could not rebuild this delivery's update just now. Try again in a moment." };
}

// ---------------------------------------------------------------------------
// 3. One-time: has cutover already happened?
// ---------------------------------------------------------------------------

/**
 * Cutover is DONE when a real Cultivera menu went live (latestCultiveraPublishedAt)
 * and at least one receiving update was published strictly after it. Unknown
 * inputs never claim "done" (a refusal must be certain).
 */
export function cutoverDone(
  latestCultiveraPublishedAt: string | null | undefined,
  intakePublishedAfterCount: number | null | undefined,
): boolean {
  if (typeof latestCultiveraPublishedAt !== "string") return false;
  if (Number.isNaN(Date.parse(latestCultiveraPublishedAt))) return false;
  return typeof intakePublishedAfterCount === "number" && intakePublishedAfterCount > 0;
}

/** Refuse a new upload? Only real (non-test) uploads, only after cutover. */
export function refuseUpload(isTest: boolean, done: boolean): boolean {
  return !isTest && done;
}

// ---------------------------------------------------------------------------
// 4. Feedback
// ---------------------------------------------------------------------------

/** Shown when Cultivera went live but another real upload is still staged. */
export const CUTOVER_STILL_BLOCKED_COPY =
  "Cultivera menu published. Another real Cultivera upload is still waiting, so receiving updates keep waiting too \u2014 publish the newest Cultivera upload to finish.";

/** Audit/timeline summary of a release. */
export function releaseNote(restaged: number, published: number, overflow: number): string {
  const parts = [
    `Cultivera menu published. Rebuilt ${restaged} held receiving update${restaged === 1 ? "" : "s"} on top of it`,
    `${published} published automatically`,
  ];
  let s = parts.join("; ") + ".";
  if (overflow > 0) s += ` ${overflow} more deliver${overflow === 1 ? "y is" : "ies are"} still held - approve any product in ${overflow === 1 ? "it" : "them"} to rebuild.`;
  return s;
}

// ---------------------------------------------------------------------------
// 5. The in-app runbook (bible 7.3, short by design)
// ---------------------------------------------------------------------------

/**
 * The cutover checklist shown on /admin/menu-imports/cutover. Eight short
 * steps. Evidence for keeping it short: the WHO Surgical Safety Checklist
 * study (Haynes et al., NEJM 2009;360:491-9) and Gawande's "short, extremely
 * simple"; a written playbook ~3x MTTR vs "winging it" (Google SRE book ch.1).
 */
export const CUTOVER_RUNBOOK_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "Pause approvals (recommended)",
    detail: "Don't approve products on Product Onboarding until step 5. The guard makes this safe anyway: approvals wait instead of publishing.",
  },
  {
    title: "Upload PRODUCTS.xlsx + INVENTORIES.xlsx with Test mode off",
    detail: "On Menu Imports. Check the upload's item, variant and vendor counts. Rehearse first with Test mode on if you like; Clean Slate removes rehearsals.",
  },
  {
    title: "Resolve the upload's fact review",
    detail: "On the upload's page, open fact review. Uncertain facts go to a person, never to customers.",
  },
  {
    title: "Publish the Cultivera upload",
    detail: "Receiving updates that were waiting are rebuilt on top of it and publish themselves. The page tells you how many.",
  },
  {
    title: "Check the lots and the menu",
    detail: "On the upload's page: one compliance lot per Barcode (press Backfill lots if offered). The public menu shows the Cultivera cards.",
  },
  {
    title: "Check nothing is waiting",
    detail: "Publish Menu shows nothing waiting, and 'Still to rebuild' below says none. Press Rebuild on any delivery listed.",
  },
  {
    title: "Start receiving",
    detail: "From now on receiving is the only product door: approve with a price and it is published automatically.",
  },
  {
    title: "Never upload Cultivera again",
    detail: "A second real upload would replace your menu with an old export, so the app refuses it. To restore something, re-approve it from receiving.",
  },
];

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCutoverGuardTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cutover-guard-core: " + msg);
    passed += 1;
  };

  // Flag.
  ok(CUTOVER_GUARD_ENV === "INTAKE_CUTOVER_GUARD", "env name");
  ok(cutoverGuardEnabled(undefined) && cutoverGuardEnabled("") && cutoverGuardEnabled("on"), "on by default");
  for (const w of ["off", "0", "false", "no", "disabled", " OFF "]) ok(!cutoverGuardEnabled(w), `off-word ${w}`);

  // Blocking rows.
  const real = { id: "v1", import_id: "imp1", status: "staged", is_test: false };
  ok(isBlockingCultiveraRow(real), "real staged upload blocks");
  ok(isBlockingCultiveraRow({ ...real, is_test: undefined }), "missing is_test = real (column default false)");
  ok(!isBlockingCultiveraRow({ ...real, is_test: true }), "test upload never blocks (S18.8)");
  ok(!isBlockingCultiveraRow({ ...real, status: "published" }), "published upload does not block");
  ok(!isBlockingCultiveraRow({ ...real, status: "archived" }), "archived upload does not block");
  ok(!isBlockingCultiveraRow({ ...real, import_id: null }), "intake row does not block");
  ok(!isBlockingCultiveraRow({ ...real, import_id: "" }), "blank import id does not block");
  ok(!isBlockingCultiveraRow(null), "null row");
  ok(blockingCultivera([{ ...real, id: "t", is_test: true }, real])?.versionIds.join() === "v1", "test row skipped, real blocker found");
  ok(blockingCultivera([real, { ...real, id: "v2" }, real])?.versionIds.join() === "v1,v2", "every real blocker, distinct, in order");
  ok(blockingCultivera([{ ...real, id: 7 }]) === null && blockingCultivera([{ ...real, id: "" }]) === null, "unusable id ignored");
  ok(blockingCultivera(null) === null && blockingCultivera([]) === null, "none");
  ok(CUTOVER_BLOCKER_READ_MAX === 10, "blocker read cap");

  // Hand publish + release trigger.
  const two = { versionIds: ["v1", "v2"] };
  ok(refuseHandPublish("intake-v", two), "receiving update refused while Cultivera waits");
  ok(!refuseHandPublish("v1", two) && !refuseHandPublish("v2", two), "publishing any staged real upload is the right order");
  ok(!refuseHandPublish("x", null) && !refuseHandPublish("x", "unknown"), "no blocker / unknown -> allowed");
  ok(publishedTheBlocker("v2", two), "release after Cultivera publish");
  ok(!publishedTheBlocker("v3", two) && !publishedTheBlocker("v1", null) && !publishedTheBlocker("v1", "unknown"), "no release otherwise");

  // Held rows + release plan.
  const M1 = "AAAAAAAA-1111-4111-8111-111111111111";
  const M2 = "bbbbbbbb-2222-4222-8222-222222222222";
  const held = (m: unknown, id = "h1"): HeldRow => ({ id, import_id: null, status: "staged", origin: "intake", state: "held_for_cutover", manifest_id: m });
  ok(isHeldForCutover(held(M1)), "held row");
  ok(!isHeldForCutover({ ...held(M1), status: "archived" }), "archived is not held");
  ok(!isHeldForCutover({ ...held(M1), import_id: "imp" }), "import row is not held");
  ok(!isHeldForCutover({ ...held(M1), import_id: undefined }), "missing import_id is not provably intake");
  ok(!isHeldForCutover({ ...held(M1), state: "held_for_fact_review" }), "fact hold is not a cutover hold");
  ok(needsRebuildAtCutover({ ...held(M1), state: "held_for_fact_review" }) && needsRebuildAtCutover({ ...held(M1), state: null }), "...but any staged intake row is rebuilt at cutover");
  ok(!needsRebuildAtCutover({ ...held(M1), origin: "pos" }) && !needsRebuildAtCutover({ ...held(M1), status: "published" }) && !needsRebuildAtCutover(null), "rebuild only staged intake rows");
  ok(!isHeldForCutover({ ...held(M1), origin: "pos" }), "origin must be intake");
  ok(!isHeldForCutover(null), "null not held");
  const plan = manifestsToRelease([held(M1, "a"), held(M2, "b"), { ...held(M1.toLowerCase(), "c"), state: "held_for_fact_review" }, held("not-a-uuid", "d"), { ...held(M2, "e"), status: "published" }, held(M2, 9 as unknown as string), { ...held(M2, "f"), origin: "pos" }]);
  ok(plan.manifests.length === 2 && plan.manifests[0] === M1.toLowerCase() && plan.manifests[1] === M2 && plan.overflow === 0, "distinct, lower-cased, ordered, junk skipped");
  ok(plan.heldIds[M1.toLowerCase()].join() === "a,c" && plan.heldIds[M2].join() === "b", "held ids grouped per delivery (bad ids skipped)");
  const capped = manifestsToRelease([held(M1, "a"), held(M2, "b")], 1);
  ok(capped.manifests.length === 1 && capped.overflow === 1 && Object.keys(capped.heldIds).join() === M1.toLowerCase(), "cap reports overflow and keeps only capped ids");
  ok(manifestsToRelease(null).manifests.length === 0, "null rows");
  ok(manifestsToRelease([held(M1)], -3).manifests.length === 0 && manifestsToRelease([held(M1)], -3).overflow === 1, "negative cap = 0");
  ok(CUTOVER_RELEASE_MAX === 10 && HELD_READ_MAX === 200, "bounds");
  ok(HELD_ROW_SELECT.includes("state:summary_json->publish_outcome->>state") && !HELD_ROW_SELECT.includes("*"), "named JSON-path select");

  // Retiring the old held row.
  ok(shouldRetireHeld({ staged: true, published: false }) && shouldRetireHeld({ staged: false, reason: "no-new-items" }), "retire on waiting rebuild or nothing new");
  ok(!shouldRetireHeld({ staged: true, published: true }), "published rebuild: 0236 already archived it (no extra write)");
  ok(!shouldRetireHeld({ staged: false, reason: "exception" }) && !shouldRetireHeld(null) && !shouldRetireHeld({ staged: "true" }), "keep on failure");
  const rs = retiredSummary({ origin: "intake", k: 1 }, "v9", "T");
  ok(rs.origin === "intake" && rs.k === 1 && rs.archived_reason === "cutover_rebuilt:v9" && rs.archived_at === "T", "retired summary keeps keys");
  ok(retiredSummary(null, null, "T").archived_reason === "cutover_rebuilt:no-changes" && Object.keys(retiredSummary(undefined, null, "T")).length === 2, "null/undefined summary");
  ok((retiredSummary([1], "v", "T").summary_before_archive as unknown[])[0] === 1, "non-object summary preserved");
  const src = { a: 1 };
  retiredSummary(src, "v", "T");
  ok(Object.keys(src).length === 1, "input never mutated");
  const again = retiredSummary({ archived_reason: "superseded_by_publish:p" }, null, "T");
  ok(again.archived_reason_before === "superseded_by_publish:p" && again.archived_reason === "cutover_rebuilt:no-changes", "earlier archive reason kept");
  ok(!("archived_reason_before" in rs), "no earlier reason -> no extra key");
  ok(retireStatuses({ staged: true }).join() === "staged" && retireStatuses({ reason: "no-new-items" } as { staged?: unknown }).join() === "staged,archived", "no-changes may mark an archived leftover; a waiting rebuild only retires staged rows");

  // pendingRebuilds.
  const r = (id: string, m: string, created_at: string, state: string | null, status = "staged", reason: string | null = null): HeldRow => ({ id, import_id: null, origin: "intake", manifest_id: m, created_at, state, status, reason });
  const pend = pendingRebuilds([
    r("a1", M1, "2026-01-01T00:00:00Z", "held_for_cutover", "archived", "superseded_by_publish:x"),
    r("b1", M2, "2026-01-01T00:00:00Z", "held_for_cutover"),
    r("b2", M2, "2026-01-02T00:00:00Z", "auto_publish_attempted", "published"),
  ]);
  ok(pend.length === 1 && pend[0].manifestId === M1.toLowerCase() && pend[0].versionId === "a1" && pend[0].status === "archived", "archived-by-publish leftover is pending; rebuilt delivery is not");
  ok(pendingRebuilds([r("a1", M1, "2026-01-01T00:00:00Z", "held_for_cutover", "archived", "cutover_rebuilt:no-changes")]).length === 0, "retired no-changes row is done");
  ok(pendingRebuilds([r("a1", M1, "2026-01-01T00:00:00Z", "held_for_cutover", "published")]).length === 0, "a hand-published hold is done");
  ok(pendingRebuilds([r("a1", M1, "garbage", "held_for_cutover")]).length === 0, "unparseable time skipped");
  ok(pendingRebuilds([{ ...r("a1", M1, "2026-01-01T00:00:00Z", "held_for_cutover"), import_id: "imp" }, { ...r("a2", M2, "2026-01-01T00:00:00Z", "held_for_cutover"), origin: "pos" }, r("a3", "nope", "2026-01-01T00:00:00Z", "held_for_cutover")]).length === 0, "import / non-intake / bad manifest skipped");
  ok(pendingRebuilds([r("a1", M1, "2026-01-02T00:00:00Z", "held_for_cutover"), r("a0", M1.toLowerCase(), "2026-01-01T00:00:00Z", "auto_publish_attempted", "published")])[0]?.versionId === "a1", "newest wins across case (older publish does not clear a newer hold)");
  ok(pendingRebuilds(null).length === 0, "null rows");

  // decidePublish.
  const blk = { versionIds: ["cv"] };
  const heldT = held(M1, "h9");
  ok(JSON.stringify(decidePublish("cv", blk, null)) === '{"kind":"allow","release":true}', "publishing Cultivera -> allow + release");
  ok(decidePublish("x", blk, null).kind === "refuse" && decidePublish("h9", blk, heldT).kind === "refuse", "anything else while Cultivera waits -> refuse");
  const rb = decidePublish("h9", null, heldT);
  ok(rb.kind === "rebuild" && rb.manifestId === M1.toLowerCase(), "stale held snapshot -> rebuild its delivery");
  ok(decidePublish("h9", "unknown", heldT).kind === "rebuild", "unknown blocker still never publishes a held snapshot");
  ok(JSON.stringify(decidePublish("h9", null, held("junk", "h9"))) === '{"kind":"allow","release":false}', "held row without a usable manifest -> pre-S18 behaviour");
  ok(JSON.stringify(decidePublish("v", null, { ...heldT, state: "held_for_fact_review" })) === '{"kind":"allow","release":false}', "fact hold publishes as before");
  ok(decidePublish("v", "unknown", "unknown").kind === "allow" && decidePublish("v", null, null).kind === "allow", "unknown/none -> allow");
  ok(TARGET_SELECT === HELD_ROW_SELECT, "target and held reads share one shape");
  ok(rebuildNote({ published: true }).ok && rebuildNote({ published: true }).text.startsWith("Rebuilt this delivery's update on top of the live menu and published"), "rebuild published");
  ok(!rebuildNote({ staged: true }).ok && rebuildNote({ staged: true }).text.includes("waiting under Admin"), "rebuild staged but waiting");
  ok(!rebuildNote({ reason: "no-new-items" }).ok && rebuildNote({ reason: "no-new-items" }).text.startsWith("Nothing to rebuild"), "nothing new");
  ok(!rebuildNote(null).ok && !rebuildNote({ reason: "exception" }).ok, "failure honest");

  // One-time.
  ok(cutoverDone("2026-01-01T00:00:00Z", 1), "published Cultivera + receiving after = done");
  ok(!cutoverDone("2026-01-01T00:00:00Z", 0), "no receiving publish yet = not done (re-upload still fine)");
  ok(!cutoverDone(null, 5) && !cutoverDone("junk", 5), "no/garbage Cultivera time = not done");
  ok(!cutoverDone("2026-01-01T00:00:00Z", null), "unknown count = not done");
  ok(refuseUpload(false, true) && !refuseUpload(true, true) && !refuseUpload(false, false), "only real uploads after cutover");

  // Runbook.
  ok(CUTOVER_RUNBOOK_STEPS.length === 8, "eight steps (short by design)");
  ok(CUTOVER_RUNBOOK_STEPS[3].title === "Publish the Cultivera upload" && CUTOVER_RUNBOOK_STEPS[6].title === "Start receiving", "publish Cultivera comes before receiving");
  ok(CUTOVER_RUNBOOK_STEPS.every((st) => st.title.length <= 64 && st.detail.length <= 200), "every step short");
  ok(CUTOVER_RUNBOOK_HREF === "/admin/menu-imports/cutover" && CUTOVER_RUNBOOK_DOC === "docs/CULTIVERA_CUTOVER_RUNBOOK.md", "runbook locations");

  // Copy.
  ok(CUTOVER_HOLD_COPY.startsWith("Your one-time Cultivera menu is uploaded but not published yet."), "S18.4 copy");
  ok(CUTOVER_EVENT === "menu_publish_held_for_cutover" && CUTOVER_OUTCOME === "held_for_cutover", "S18.2 names");
  ok(releaseNote(1, 1, 0) === "Cultivera menu published. Rebuilt 1 held receiving update on top of it; 1 published automatically.", "release note singular");
  ok(releaseNote(3, 2, 2).endsWith("2 more deliveries are still held - approve any product in them to rebuild."), "release note overflow");
  ok(releaseNote(0, 0, 1).includes("1 more delivery is still held - approve any product in it"), "overflow singular");

  return { passed };
}
