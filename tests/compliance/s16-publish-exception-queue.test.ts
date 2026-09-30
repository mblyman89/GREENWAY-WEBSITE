/**
 * tests/compliance/s16-publish-exception-queue.test.ts
 *
 * S16 - Publish page as an exception queue with plain-English verdicts
 * (bible S16, F-056, F-062, F-063; section 6.6).
 *
 *   1. queue core: why an update waits (recorded outcome only), one action
 *      per reason, superseded rows apart, recent automatic publishes.
 *   2. verdict copy for every shape (bible S16.5 "copy tests for each
 *      verdict shape"), leading with what stays and what is added.
 *   3. S16.6 acceptance: no 'REMOVE' in caps / 'replaces the WHOLE menu'
 *      on any publish surface; exactly one primary action per waiting row.
 *   4. F-063: the publishVersion removal gate is unchanged - exercised for
 *      real with its collaborators mocked (refuses without the tick, only
 *      the message changed; publishes with it).
 *   5. no new data source; help collapsed; bible 6.6 empty-copy parity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPublishVerdict,
  nameList,
  PUBLISH_HELP_STEPS,
  PUBLISH_SEMANTICS_COPY,
  PUBLISH_SWAP_NOTE,
  REMOVED_NAMES_MAX,
  removalConfirmCopy,
  removalListTitle,
  removalRefusedCopy,
  __runPublishGuardTests,
} from "@/lib/pos/publish-guard-core";
import {
  primaryAction,
  QUEUE_ACTION_LABEL,
  QUEUE_EMPTY_COPY,
  QUEUE_REASON_TAG,
  queueReason,
  RECENT_AUTO_MAX,
  recentAutoPublished,
  splitQueue,
  __runPublishQueueTests,
  type QueueReason,
} from "@/lib/pos/publish-queue-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PUBLISH_PAGE = "src/app/admin/publish/page.tsx";
const VERSION_PAGE = "src/app/admin/menu-imports/version/[versionId]/page.tsx";
const IMPORT_PAGE = "src/app/admin/menu-imports/[id]/page.tsx";
const ACTIONS = "src/app/admin/menu-imports/actions.ts";
const IMPORTS_LIST = "src/app/admin/menu-imports/page.tsx";

const outcome = (state: string, extra: Record<string, unknown> = {}) => ({
  publish_outcome: { state, at: "2026-01-01T00:00:00Z", ...extra },
});

// === 1. Queue core ============================================================
describe("S16 queue core", () => {
  it("self-tests pass with an exact count (a deleted check turns this red)", () => {
    // S18 added five cutover checks (22 -> 27).
    expect(__runPublishQueueTests().passed).toBe(32);
  });
  it("the reason comes only from the recorded outcome", () => {
    expect(queueReason({ import_id: null, summary_json: outcome("held_for_fact_review", { held_count: 1 }) })).toBe("fact_review");
    expect(queueReason({ import_id: null, summary_json: outcome("auto_publish_failed", { error: "rpc" }) })).toBe("publish_failed");
    expect(queueReason({ import_id: null, summary_json: outcome("auto_publish_attempted") })).toBe("publish_failed");
    expect(queueReason({ import_id: null, summary_json: {} })).toBe("needs_publish");
    expect(queueReason({ import_id: null, summary_json: null })).toBe("needs_publish");
    expect(queueReason({ import_id: null, summary_json: outcome("nonsense") })).toBe("needs_publish");
    expect(queueReason({ import_id: "imp-1", summary_json: outcome("auto_publish_failed") })).toBe("pos_upload");
    expect(queueReason({ import_id: "", summary_json: null })).toBe("pos_upload");
  });
  it("labels and tags are exact, one per reason", () => {
    expect(QUEUE_ACTION_LABEL).toEqual({
      fact_review: "Check the flagged facts \u2192",
      publish_failed: "Try publishing again \u2192",
      needs_publish: "Review & publish \u2192",
      pos_upload: "Review this upload \u2192",
      cutover: "Open the Cultivera cutover step \u2192",
    });
    expect(QUEUE_REASON_TAG).toEqual({
      fact_review: "Fact check",
      publish_failed: "Publish didn't finish",
      needs_publish: "Needs a Publish click",
      pos_upload: "POS upload",
      cutover: "Waiting for Cultivera",
    });
    const reasons: QueueReason[] = ["fact_review", "publish_failed", "needs_publish", "pos_upload"];
    for (const r of reasons) {
      expect(primaryAction(r, `/review/${r}`)).toEqual({ label: QUEUE_ACTION_LABEL[r], href: `/review/${r}` });
    }
  });
  it("superseded rows are split off, order kept, unknown stays waiting", () => {
    const q = splitQueue([
      { id: 1, freshness: "superseded" },
      { id: 2, freshness: "would_remove" },
      { id: 3, freshness: "latest" },
      { id: 4, freshness: "superseded" },
      { id: 5, freshness: "unknown" },
      { id: 6, freshness: "complete" },
    ]);
    expect(q.waiting.map((r) => r.id)).toEqual([2, 3, 5, 6]);
    expect(q.superseded.map((r) => r.id)).toEqual([1, 4]);
  });
  it("recent automatic publishes: real ones only, newest first, cap 10", () => {
    expect(RECENT_AUTO_MAX).toBe(10);
    const row = (id: string, published_at: string | null, state: string | null, import_id: string | null = null) => ({
      id,
      import_id,
      published_at,
      summary_json: state ? outcome(state) : null,
    });
    const got = recentAutoPublished([
      row("a", "2026-03-01T00:00:00Z", "auto_publish_attempted"),
      row("b", "2026-03-03T00:00:00Z", "auto_publish_attempted"),
      row("held-then-hand", "2026-03-04T00:00:00Z", "held_for_fact_review"),
      row("still-staged", null, "auto_publish_attempted"),
      row("pos", "2026-03-05T00:00:00Z", "auto_publish_attempted", "imp"),
      row("nan", "not a date", "auto_publish_attempted"),
      row("no-outcome", "2026-03-06T00:00:00Z", null),
    ]);
    expect(got.map((r) => r.id)).toEqual(["b", "a"]);
    const many = Array.from({ length: 12 }, (_, i) => row(`x${10 + i}`, `2026-04-${String(10 + i)}T00:00:00Z`, "auto_publish_attempted"));
    const capped = recentAutoPublished(many);
    expect(capped).toHaveLength(10);
    expect(capped[0].id).toBe("x21");
    expect(capped[9].id).toBe("x12");
    expect(recentAutoPublished(many, 3).map((r) => r.id)).toEqual(["x21", "x20", "x19"]);
    expect(recentAutoPublished(many, -1)).toEqual([]);
  });
  it("the empty-queue sentence is the Menu Imports one, verbatim (bible 6.6, F-075)", () => {
    expect(QUEUE_EMPTY_COPY).toBe("Nothing waiting \u2014 every menu update from receiving has published automatically.");
  });
});

// === 2. Verdict copy, every shape (bible S16.4 / S16.5) ======================
describe("S16 verdict copy for each shape", () => {
  it("publish-guard self-tests pass with an exact count", () => {
    expect(__runPublishGuardTests().passed).toBe(114); // S26 +19 issue-link checks; S30 +1; R13a +3 linked codes
  });
  it("first menu: safe, nothing comes off", () => {
    const v = buildPublishVerdict({ added: 4, removed: 0, priceChanged: 0, unchanged: 0, hasLiveMenu: false });
    expect(v.level).toBe("safe");
    expect(v.requiresRemovalConfirm).toBe(false);
    expect(v.headline).toBe("Safe to publish \u2014 this becomes your first live menu.");
    expect(v.detail).toBe("There is no live menu yet, so nothing comes off. Publishing puts 4 products on your public menu.");
  });
  it("adds only: leads with adds, keeps all (bible 'Adds 3 products, keeps all 412')", () => {
    const v = buildPublishVerdict({ added: 3, removed: 0, priceChanged: 0, unchanged: 412, hasLiveMenu: true });
    expect(v.level).toBe("safe");
    expect(v.headline).toBe("Safe to publish \u2014 nothing comes off.");
    expect(v.detail).toBe("Adds 3 products. Keeps all 412 products that are live now.");
  });
  it("adds and prices; prices only; nothing; singular forms", () => {
    expect(buildPublishVerdict({ added: 1, removed: 0, priceChanged: 2, unchanged: 5, hasLiveMenu: true }).detail).toBe(
      "Adds 1 product and updates 2 prices. Keeps all 7 products that are live now.",
    );
    expect(buildPublishVerdict({ added: 0, removed: 0, priceChanged: 1, unchanged: 0, hasLiveMenu: true }).detail).toBe(
      "Updates 1 price. Keeps all 1 product that is live now.",
    );
    expect(buildPublishVerdict({ added: 0, removed: 0, priceChanged: 0, unchanged: 9, hasLiveMenu: true }).detail).toBe(
      "No product changes. Keeps all 9 products exactly as they are.",
    );
  });
  it("never says 'Adds 0'", () => {
    const v = buildPublishVerdict({ added: 0, removed: 0, priceChanged: 3, unchanged: 1, hasLiveMenu: true });
    expect(v.detail).not.toContain("Adds 0");
  });
  it("older update: danger, says WHY and the alternative, names what comes off", () => {
    const v = buildPublishVerdict({
      added: 0,
      removed: 2,
      priceChanged: 0,
      unchanged: 3,
      hasLiveMenu: true,
      stagedCreatedAt: "2026-02-01T00:00:00Z",
      publishedCreatedAt: "2026-02-02T00:00:00Z",
      removedNames: ["Blue Dream 3.5g", "  Gelato Pre-roll "],
    });
    expect(v.level).toBe("danger");
    expect(v.requiresRemovalConfirm).toBe(true);
    expect(v.headline).toBe("This update is older than your live menu, so it doesn't include 2 products that are live now.");
    expect(v.detail).toBe(
      "Publishing it would take them off the menu: Blue Dream 3.5g and Gelato Pre-roll. You rarely want this: the live menu is newer. If a newer update is waiting, publish that one instead.",
    );
  });
  it("older update, one product, no names: grammar holds and no empty list", () => {
    const v = buildPublishVerdict({
      added: 0,
      removed: 1,
      priceChanged: 0,
      unchanged: 3,
      hasLiveMenu: true,
      stagedCreatedAt: "2026-02-01T00:00:00Z",
      publishedCreatedAt: "2026-02-02T00:00:00Z",
    });
    expect(v.headline).toBe("This update is older than your live menu, so it doesn't include 1 product that is live now.");
    expect(v.requiresRemovalConfirm).toBe(true);
    expect(v.detail.startsWith("Publishing it would take them off the menu. ")).toBe(true);
  });
  it("newer update that takes some off: caution, keeps/adds first (bible 'Publishing keeps 412 products and adds 3')", () => {
    const v = buildPublishVerdict({
      added: 3,
      removed: 2,
      priceChanged: 0,
      unchanged: 412,
      hasLiveMenu: true,
      stagedCreatedAt: "2026-02-03T00:00:00Z",
      publishedCreatedAt: "2026-02-02T00:00:00Z",
      removedNames: ["A", "B"],
    });
    expect(v.level).toBe("caution");
    expect(v.headline).toBe("Publishing keeps 412 products and adds 3.");
    expect(v.detail).toBe("2 products would come off the menu: A and B. Continue only if that's intended (sold out or discontinued).");
  });
  it("caution with prices: three parts joined once", () => {
    const v = buildPublishVerdict({ added: 1, removed: 1, priceChanged: 2, unchanged: 4, hasLiveMenu: true, removedNames: ["Z"] });
    expect(v.headline).toBe("Publishing keeps 6 products, adds 1 and updates 2 prices.");
    expect(v.detail).toBe("1 product would come off the menu: Z. Continue only if that's intended (sold out or discontinued).");
  });
  it("unparseable live timestamp never claims 'older' either", () => {
    const v = buildPublishVerdict({
      added: 0,
      removed: 1,
      priceChanged: 0,
      unchanged: 1,
      hasLiveMenu: true,
      stagedCreatedAt: "2026-02-01T00:00:00Z",
      publishedCreatedAt: "not a time",
    });
    expect(v.level).toBe("caution");
  });
  it("unparseable timestamps never claim 'older' (caution, not danger)", () => {
    const v = buildPublishVerdict({
      added: 0,
      removed: 1,
      priceChanged: 0,
      unchanged: 1,
      hasLiveMenu: true,
      stagedCreatedAt: "garbage",
      publishedCreatedAt: "2026-02-02T00:00:00Z",
    });
    expect(v.level).toBe("caution");
  });
  it("name list: five max, then 'and N more'; blanks dropped; never invents", () => {
    expect(REMOVED_NAMES_MAX).toBe(5);
    expect(nameList(["a", "b", "c", "d", "e", "f", "g"], 7)).toBe("a, b, c, d, e and 2 more");
    expect(nameList(["a", "b"], 9)).toBe("a, b and 7 more");
    expect(nameList(["a", " ", ""], 1)).toBe("a");
    expect(nameList([], 3)).toBeNull();
    expect(nameList(null, 3)).toBeNull();
    expect(nameList(["a", "b", "c"], 0)).toBe("a, b and c");
  });
  it("removal list, checkbox and refusal copy are exact and calm", () => {
    expect(removalListTitle(3)).toBe("Would come off the live menu (3)");
    expect(removalConfirmCopy(1)).toBe("I understand 1 product will come off the live menu (listed above), and that's what I want.");
    expect(removalConfirmCopy(4)).toBe("I understand 4 products will come off the live menu (listed above), and that's what I want.");
    expect(removalRefusedCopy(2)).toBe(
      "Not published yet: 2 products would come off the live menu. Tick the box if that's what you want. Otherwise nothing changes and the live menu stays as it is.",
    );
    expect(PUBLISH_SWAP_NOTE).toBe(
      "Publishing makes this update your live menu and refreshes the public site. The menu it replaces is archived, not deleted.",
    );
  });
});

// === 3. S16.6 acceptance ======================================================
describe("S16.6 acceptance: no shouting on any publish surface", () => {
  const SHOUT = /REMOVE|replaces the WHOLE|REPLACES the whole|NEWEST draft/;
  it.each([PUBLISH_PAGE, VERSION_PAGE, IMPORT_PAGE, ACTIONS])("%s has no 'REMOVE' in caps or 'replaces the WHOLE menu'", (f) => {
    expect(read(f)).not.toMatch(SHOUT);
    expect(read(f)).not.toMatch(/replaces the whole/i);
  });
  it("every string the guard core can produce is calm (all verdict shapes + copy)", () => {
    const verdicts = [
      buildPublishVerdict({ added: 1, removed: 0, priceChanged: 0, unchanged: 1, hasLiveMenu: false }),
      buildPublishVerdict({ added: 1, removed: 0, priceChanged: 1, unchanged: 1, hasLiveMenu: true }),
      buildPublishVerdict({ added: 1, removed: 2, priceChanged: 1, unchanged: 1, hasLiveMenu: true, removedNames: ["x"] }),
      buildPublishVerdict({
        added: 0,
        removed: 2,
        priceChanged: 0,
        unchanged: 1,
        hasLiveMenu: true,
        stagedCreatedAt: "2026-01-01T00:00:00Z",
        publishedCreatedAt: "2026-01-02T00:00:00Z",
      }),
    ];
    const all = [
      PUBLISH_SEMANTICS_COPY,
      PUBLISH_SWAP_NOTE,
      ...PUBLISH_HELP_STEPS,
      removalListTitle(2),
      removalConfirmCopy(2),
      removalRefusedCopy(2),
      ...verdicts.flatMap((v) => [v.headline, v.detail]),
      ...Object.values(QUEUE_ACTION_LABEL),
      ...Object.values(QUEUE_REASON_TAG),
      QUEUE_EMPTY_COPY,
    ].join("\n");
    expect(all).not.toMatch(/REMOVE|WHOLE|REPLACES|NEWEST|OLDER|snapshot/);
    expect(all).not.toMatch(/replaces the whole/i);
  });
  it("the bible S16.4 semantics line is exact", () => {
    expect(PUBLISH_SEMANTICS_COPY).toBe(
      "Products you approve go live by themselves. This page lists the few updates that need a human first.",
    );
  });
});

describe("S16.6 acceptance: exactly one primary action per waiting row", () => {
  const page = read(PUBLISH_PAGE);
  const start = page.indexOf("{queue.waiting.map(");
  const end = page.indexOf("{overflow > 0 &&", start);
  const rowBlock = page.slice(start, end);

  it("the waiting map exists and is bounded", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });
  it("one Button per row, rendering the reason's action", () => {
    expect((rowBlock.match(/<Button\b/g) ?? []).length).toBe(1);
    expect(rowBlock).toContain("const action = primaryAction(reason, reviewHref, factHref);");
    expect(rowBlock).toContain("<Button href={action.href}");
    expect(rowBlock).toContain("{action.label}");
    expect(rowBlock).toContain("{QUEUE_REASON_TAG[reason]}");
  });
  it("a user who cannot publish sees who can, not a dead button", () => {
    expect(rowBlock).toMatch(/\{canPublish \? \(\s*<Button/);
    expect(rowBlock).toContain("A manager or admin publishes this.");
  });
  it("superseded rows and recent publishes carry no button", () => {
    const supStart = page.indexOf("{queue.superseded.length > 0 &&");
    const recStart = page.indexOf(">Recently published automatically</h2>");
    const recEnd = page.indexOf("Where the other pieces live", recStart);
    expect(supStart).toBeGreaterThan(-1);
    expect(recStart).toBeGreaterThan(supStart);
    expect(recEnd).toBeGreaterThan(recStart);
    const sup = page.slice(supStart, recStart);
    expect(sup).toContain("queue.superseded.map(");
    expect(sup).not.toMatch(/<Button\b/);
    const rec = page.slice(recStart, recEnd);
    expect(rec).toContain("recent.map(");
    expect(rec).not.toMatch(/<Button\b|<form\b/);
  });
  it("the old second publish button at the top of the section is gone", () => {
    expect(page).not.toContain("Review &amp; publish the latest draft");
    expect(page).not.toContain("Menu drafts waiting for review");
  });
  it("each row's reason is computed from the row (pure, no I/O)", () => {
    expect(page).toContain("reason: queueReason(v)");
    expect(page).toContain("const queue = splitQueue(");
    expect(page).toContain("const recent = recentAutoPublished(allVersions);");
  });
});

describe("S16.9 'grep for the OLD string': the printable Publish SOP sheet", () => {
  it("renders the new semantics line and no snapshot theory", async () => {
    const { SOP_DOCS } = await import("@/lib/catalog/sop-core");
    const sop = SOP_DOCS.find((d) => d.slug === "publish");
    expect(sop).toBeDefined();
    expect(sop!.purpose).toBe(PUBLISH_SEMANTICS_COPY);
    const text = [sop!.purpose, sop!.doneWhen, ...sop!.before, ...sop!.steps, ...sop!.ifStuck].join("\n");
    expect(text).not.toMatch(/REPLACES|REMOVE|WHOLE|snapshot|always publish the newest/i);
    expect(text).toContain("Waiting for you");
    expect(text).toContain("tick a box");
  });
  it("no source string anywhere under src still says the old publish lines", () => {
    const files = [
      "src/lib/catalog/sop-core.ts",
      PUBLISH_PAGE,
      VERSION_PAGE,
      IMPORT_PAGE,
      ACTIONS,
      IMPORTS_LIST,
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toContain("Publishing REPLACES the whole live menu");
      expect(src, f).not.toContain("the menu is a snapshot, so always publish the newest draft");
      expect(src, f).not.toContain("will <strong>REMOVE");
    }
  });
});

// === 4. No new data source; help collapsed; parity ============================
describe("S16 page shape", () => {
  const page = read(PUBLISH_PAGE);
  it("same three loaders, no new query", () => {
    expect(page).toMatch(
      /const \[published, intakeStaged, allVersions\] = await Promise\.all\(\[\s*getPublishedVersion\(\),\s*listIntakeStagedVersions\(\),\s*listVersions\(\),\s*\]\);/,
    );
    expect((page.match(/Promise\.all\(/g) ?? []).length).toBe(1);
    expect(page).not.toMatch(/createSupabase|\.from\(|\.rpc\(/);
  });
  it("sections in order: Waiting for you, Recently published automatically, help collapsed", () => {
    const a = page.indexOf(">Waiting for you</h2>");
    const b = page.indexOf(">Recently published automatically</h2>");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(page).toContain('title="How publishing works"');
    expect(page).toContain("steps={[...PUBLISH_HELP_STEPS]}");
    expect(page).not.toContain("defaultOpen");
    expect(page).toContain("{PUBLISH_SEMANTICS_COPY}");
  });
  it("the stat card counts only real waiting rows", () => {
    expect(page).toContain('label="Waiting for you"');
    expect(page).toContain('value={`${queue.waiting.length}${overflow > 0 ? "+" : ""}`}');
  });
  it("no literal unicode escapes leaked into JSX text", () => {
    const jsxText = page.replace(/"[^"\n]*"|`[^`]*`/g, "");
    expect(jsxText).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
  it("both pages render the SAME empty-queue sentence (bible 6.6)", () => {
    expect(page).toContain("{QUEUE_EMPTY_COPY}");
    const list = read(IMPORTS_LIST);
    expect(list).toContain("{QUEUE_EMPTY_COPY}");
    expect(list).not.toContain("every menu update from receiving has published automatically.");
  });
  it("help steps are six, exact, and describe only what the code does", () => {
    expect(PUBLISH_HELP_STEPS).toHaveLength(6);
    expect(PUBLISH_HELP_STEPS[0]).toContain("goes live on the website and the register by itself");
    expect(PUBLISH_HELP_STEPS[3]).toContain("archived automatically");
    expect(PUBLISH_HELP_STEPS[4]).toContain("tick a box");
  });
  it("both review pages use the shared copy and pass the removed names", () => {
    for (const f of [VERSION_PAGE, IMPORT_PAGE]) {
      const p = read(f);
      expect(p).toContain("{removalListTitle(diff.removed.length)}");
      expect(p).toContain("{PUBLISH_SWAP_NOTE}");
      expect(p).toContain("{removalConfirmCopy(verdict.removedCount)}");
      expect(p).toContain("removedNames: diff.removed.map((r) => r.name),");
      expect(p).toContain('name="confirm_removals" value="yes"');
    }
    expect(page).toContain("removedNames: d.diff.removed.map((r) => r.name),");
  });
  it("the queue self-tests are registered in the pure runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runPublishQueueTests } from "../../src/lib/pos/publish-queue-core";');
    expect(runner).toMatch(/\n\s+__runPublishQueueTests\(\);/);
  });
});

// === 5. F-063: the removal gate is unchanged (behavioural) ====================
const gate = vi.hoisted(() => ({
  published: null as null | { id: string },
  removed: [] as Array<{ name: string }>,
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => gate.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    gate.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    gate.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (a: { action: string }) => gate.calls.push(`audit:${a.action}`) }));
vi.mock("@/lib/pos/import-service", () => ({
  runImport: vi.fn(),
  publishMenuVersion: async (id: string) => gate.calls.push(`publish:${id}`),
  findDuplicateImport: vi.fn(),
  sha256: vi.fn(),
  cleanSlateTestData: vi.fn(),
  backfillImportLots: vi.fn(),
}));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => gate.published,
  diffVersions: async (a: string, b: string) => {
    gate.calls.push(`diff:${a}:${b}`);
    return { added: [], removed: gate.removed, priceChanged: [], unchangedCount: 0 };
  },
  archiveSupersededStaged: async (v: { id: string }) => gate.calls.push(`archive:${v.id}`),
  getImportDiagnosticsChecked: vi.fn(),
  listVersions: vi.fn(),
  getVersionItems: vi.fn(),
}));
vi.mock("@/lib/pos/fact-review-store", () => ({ recordFactReview: vi.fn(), listFactReviews: vi.fn(), factReviewsToResolutions: vi.fn() }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => gate.calls.push("revalidate:public") }));

describe("F-063: publishVersion's removal gate is unchanged (only its words)", () => {
  beforeEach(() => {
    gate.published = { id: "live" };
    gate.removed = [];
    gate.calls = [];
  });
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const run = async (fields: Record<string, string>) => {
    const { publishVersion } = await import("@/app/admin/menu-imports/actions");
    await expect(publishVersion(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return gate.calls;
  };

  it("refuses without the tick when products would come off - nothing published, calm message", async () => {
    gate.removed = [{ name: "A" }, { name: "B" }];
    const calls = await run({ versionId: "v2", from: "publish-draft" });
    expect(calls).toContain("perm:menu.publish");
    expect(calls).toContain("diff:v2:live");
    expect(calls.some((c) => c.startsWith("publish:"))).toBe(false);
    expect(calls.some((c) => c.startsWith("archive:"))).toBe(false);
    expect(calls[calls.length - 1]).toBe(
      "redirect:/admin/publish?error=" + encodeURIComponent(removalRefusedCopy(2)),
    );
  });
  it("a tick other than 'yes' is not a tick", async () => {
    gate.removed = [{ name: "A" }];
    const calls = await run({ versionId: "v2", from: "publish-draft", confirm_removals: "on" });
    expect(calls.some((c) => c.startsWith("publish:"))).toBe(false);
    expect(calls[calls.length - 1]).toContain(encodeURIComponent(removalRefusedCopy(1)));
  });
  it("publishes with the tick, then archives, revalidates and returns", async () => {
    gate.removed = [{ name: "A" }];
    const calls = await run({ versionId: "v2", from: "publish-draft", confirm_removals: "yes" });
    const i = calls.indexOf("publish:v2");
    expect(i).toBeGreaterThan(-1);
    expect(calls.indexOf("audit:menu_version.published")).toBeGreaterThan(i);
    expect(calls.indexOf("archive:v2")).toBeGreaterThan(i);
    expect(calls).toContain("revalidate:/admin/publish");
    expect(calls).toContain("revalidate:public");
    expect(calls[calls.length - 1]).toBe("redirect:/admin/publish?published=1");
  });
  it("nothing comes off: no tick needed", async () => {
    const calls = await run({ versionId: "v2", from: "publish-draft" });
    expect(calls).toContain("publish:v2");
  });
  it("no live menu: no diff read, publishes", async () => {
    gate.published = null;
    const calls = await run({ versionId: "v2", importId: "imp9" });
    expect(calls.some((c) => c.startsWith("diff:"))).toBe(false);
    expect(calls).toContain("publish:v2");
    expect(calls[calls.length - 1]).toBe("redirect:/admin/menu-imports/imp9?published=1");
  });
  it("re-publishing the live version itself: no diff read", async () => {
    gate.removed = [{ name: "A" }];
    const calls = await run({ versionId: "live", from: "publish" });
    expect(calls.some((c) => c.startsWith("diff:"))).toBe(false);
    expect(calls).toContain("publish:live");
  });
});
