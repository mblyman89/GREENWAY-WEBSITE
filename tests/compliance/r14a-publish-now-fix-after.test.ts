/**
 * tests/compliance/r14a-publish-now-fix-after.test.ts
 *
 * R14a -- "publish now, fix after" (owner, Round 14, verbatim):
 *   "I can't publish the menu, the publish page wants me to fix everything
 *    first. I need to be able to publish the menu right away, then be able to
 *    go back and fix each product using all the new features."
 *
 *   1. The gate (pure): pending-only refusals are overridable with a count the
 *      human saw; integrity refusals never are; rows stay pending.
 *   2. publishVersion (behavioural): the tick is owner/admin only, the count is
 *      passed through, an unticked offered form refuses, and a publish with
 *      open reviews writes its own audit row.
 *   3. The decision mirror (behavioural, fake PostgREST): a decision reaches the
 *      live intake-origin version carrying the card, never archived history or
 *      another import; a failed live read is reported, not skipped.
 *   4. Fact decisions refresh the public menu.
 *   5. Wiring: page form, banners, service, permission, runner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateCommitGate,
  acknowledgementCovers,
  parseAcknowledgedCount,
  publishedWithOpenReviewsLine,
} from "@/lib/pos/import-commit-core";
import { buildFactReviewBuckets, type FactReviewItemInput } from "@/lib/pos/fact-review-core";
import {
  mirrorTargetVersionIds,
  publishNowAcknowledgementCopy,
  liveWithOpenReviewsCopy,
  PUBLISH_NOW_NOT_ALLOWED_COPY,
  PUBLISH_NOW_NOT_TICKED_COPY,
  PUBLISHED_WITH_OPEN_REVIEWS_AUDIT,
} from "@/lib/pos/publish-now-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Req = { method: string; url: URL; body: unknown };
const st = vi.hoisted(() => ({
  calls: [] as string[],
  role: "owner" as string,
  publishOpts: [] as unknown[],
  publishResult: { openReviewsAcknowledged: 0 } as { openReviewsAcknowledged: number },
  publishThrows: null as string | null,
  audits: [] as Array<{ action: string; entityId: string; after: unknown }>,
  reqs: [] as Req[],
  route: null as null | ((r: Req) => { status: number; body?: unknown } | null),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: st.role } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after: unknown }) => {
    st.calls.push(`audit:${a.action}`);
    st.audits.push({ action: a.action, entityId: a.entityId, after: a.after });
  },
}));
vi.mock("@/lib/pos/import-service", () => ({
  runImport: vi.fn(),
  publishMenuVersion: async (id: string, _actor: string | null, opts: unknown) => {
    st.calls.push(`publish:${id}`);
    st.publishOpts.push(opts);
    if (st.publishThrows) throw new Error(st.publishThrows);
    return st.publishResult;
  },
  findDuplicateImport: vi.fn(),
  sha256: vi.fn(),
  cleanSlateTestData: vi.fn(),
  backfillImportLots: vi.fn(),
}));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => null,
  diffVersions: vi.fn(),
  archiveSupersededStaged: async (v: { id: string }) => st.calls.push(`archive:${v.id}`),
  getImportDiagnosticsChecked: vi.fn(),
  listVersions: vi.fn(),
  getVersionItems: vi.fn(),
}));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => st.calls.push("revalidate:public") }));
vi.mock("@/lib/pos/cutover-guard", () => ({
  decideHandPublish: async () => ({ kind: "allow", release: false }),
  rebuildDelivery: vi.fn(),
  readHeldBeforeRelease: vi.fn(),
  readCultiveraBlocker: vi.fn(),
  releaseHeldAfterCutover: vi.fn(),
  readCutoverDone: async () => false,
  readCutoverStatus: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null };
    st.reqs.push(r);
    const rep = (st.route && st.route(r)) ?? { status: 200, body: [] };
    return new Response(JSON.stringify(rep.body ?? []), { status: rep.status, headers: { "content-type": "application/json" } });
  };
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }),
  };
});

beforeEach(() => {
  st.calls = [];
  st.role = "owner";
  st.publishOpts = [];
  st.publishResult = { openReviewsAcknowledged: 0 };
  st.publishThrows = null;
  st.audits = [];
  st.reqs = [];
  st.route = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// --------------------------------------------------------------------------
// 1. The gate
// --------------------------------------------------------------------------
const item = (over: Partial<FactReviewItemInput>): FactReviewItemInput => ({
  sourceItemId: "pos-x",
  name: "X",
  productName: null,
  brand: "B",
  category: "edible-solid",
  inventoryType: "Solid Edible",
  hidden: false,
  hiddenReason: null,
  thc: null,
  cbd: null,
  servingsPerPack: null,
  mgPerServing: null,
  packageThcMg: null,
  packageCbdMg: null,
  ratioLabel: null,
  netWeightGrams: null,
  netVolumeMl: null,
  lowThcLiquid: null,
  unitThcMg: null,
  otherwiseTaken: null,
  unitsPerPackage: null,
  factProvenance: {},
  ...over,
});
const pendingWorld = () =>
  buildFactReviewBuckets(
    [item({ sourceItemId: "pos-a", name: "Kellys Karamels" }), item({ sourceItemId: "pos-b", name: "Plain" })],
    [{ severity: "info", code: "cannabinoid_missing", message: "No THC.", context: { productName: "Kellys Karamels" } }],
  );

describe("R14a gate: publish over pending rows only, with the count the human saw", () => {
  it("the owner's screenshot case: pending-only refusal is overridable, and says so", () => {
    const shut = evaluateCommitGate(pendingWorld(), { observedItems: 2, recordedItemCount: 2, serverItemCount: 2 });
    expect(shut.ready).toBe(false);
    expect(shut.message.startsWith("Cannot publish: 1 fact-review row(s) still await a human decision.")).toBe(true);
    expect(shut.blockedOnlyByPending).toBe(true);
  });
  it("an acknowledged count opens it, and the row stays PENDING (nothing approved)", () => {
    const open = evaluateCommitGate(
      pendingWorld(),
      { observedItems: 2, recordedItemCount: 2, serverItemCount: 2 },
      { acknowledgedPendingCount: 1 },
    );
    expect(open.ready).toBe(true);
    expect(open.openReviewsAcknowledged).toBe(1);
    expect(open.reconciliation.pending).toBe(1);
    expect(open.reconciliation.reviewApprovedOrFixed).toBe(0);
    expect(open.message).toBe(publishedWithOpenReviewsLine(1, open.reconciliation.summaryLine));
  });
  it("a tick for fewer rows than are pending now never covers them", () => {
    expect(evaluateCommitGate(pendingWorld(), undefined, { acknowledgedPendingCount: 0 }).ready).toBe(false);
    expect(acknowledgementCovers(611, 612)).toBe(false);
    expect(acknowledgementCovers(612, 612)).toBe(true);
    expect(acknowledgementCovers(612, 600)).toBe(true);
  });
  it("integrity refusals are never overridable", () => {
    const short = evaluateCommitGate(pendingWorld(), { observedItems: 2, recordedItemCount: 4179 }, { acknowledgedPendingCount: 99 });
    expect(short.ready).toBe(false);
    expect(short.blockedOnlyByPending).toBe(false);
    const readFailed = evaluateCommitGate(
      pendingWorld(),
      { observedItems: 2, recordedItemCount: 2, reviewsReadFailed: true, observedReviews: 0 },
      { acknowledgedPendingCount: 99 },
    );
    expect(readFailed.ready).toBe(false);
    const b = pendingWorld();
    const broken = { ...b, totals: { ...b.totals, items: 50 } };
    const imb = evaluateCommitGate(broken, undefined, { acknowledgedPendingCount: 99 });
    expect(imb.ready).toBe(false);
    expect(imb.message).toContain("does not balance");
  });
  it("parses only plain digits from the form", () => {
    expect(parseAcknowledgedCount("612")).toBe(612);
    for (const bad of ["", " ", "-3", "3.0", "0x10", "1e2", "612 ", "abc"]) {
      if (bad === "612 ") {
        expect(parseAcknowledgedCount(bad)).toBe(612); // trimmed
        continue;
      }
      expect(parseAcknowledgedCount(bad)).toBeNull();
    }
  });
});

// --------------------------------------------------------------------------
// 2. publishVersion
// --------------------------------------------------------------------------
describe("R14a publishVersion: the explicit, attributed override", () => {
  const run = async (fields: Record<string, string>) => {
    const { publishVersion } = await import("@/app/admin/menu-imports/actions");
    await expect(publishVersion(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return st.calls;
  };

  it("a plain publish passes no acknowledgement (behaviour unchanged)", async () => {
    const calls = await run({ versionId: "v1", importId: "imp1" });
    expect(st.publishOpts).toEqual([{ acknowledgedPendingCount: null }]);
    expect(calls).toContain("audit:menu_version.published");
    expect(calls).not.toContain(`audit:${PUBLISHED_WITH_OPEN_REVIEWS_AUDIT}`);
    expect(calls[calls.length - 1]).toBe("redirect:/admin/menu-imports/imp1?published=1");
  });

  it("owner ticks the box: the seen count reaches the gate, and a second audit row names the open reviews", async () => {
    st.publishResult = { openReviewsAcknowledged: 612 };
    const calls = await run({ versionId: "v1", importId: "imp1", publish_now_offered: "yes", publish_now: "yes", seen_pending: "612" });
    expect(st.publishOpts).toEqual([{ acknowledgedPendingCount: 612 }]);
    expect(calls).toContain("audit:menu_version.published");
    const open = st.audits.find((a) => a.action === PUBLISHED_WITH_OPEN_REVIEWS_AUDIT);
    expect(open).toEqual({
      action: "menu_version.published_with_open_reviews",
      entityId: "v1",
      after: { importId: "imp1", openReviews: 612, seenWhenTicked: 612 },
    });
    expect(calls).toContain("revalidate:public");
    expect(calls[calls.length - 1]).toBe("redirect:/admin/menu-imports/imp1?published=1");
  });

  it("admin may tick it too", async () => {
    st.role = "admin";
    await run({ versionId: "v1", importId: "imp1", publish_now: "yes", seen_pending: "5" });
    expect(st.publishOpts).toEqual([{ acknowledgedPendingCount: 5 }]);
  });

  it("a manager is refused BEFORE anything publishes", async () => {
    st.role = "manager";
    const calls = await run({ versionId: "v1", importId: "imp1", publish_now: "yes", seen_pending: "5" });
    expect(calls.some((c) => c.startsWith("publish:"))).toBe(false);
    expect(calls[calls.length - 1]).toBe(
      "redirect:/admin/menu-imports/imp1?error=" + encodeURIComponent(PUBLISH_NOW_NOT_ALLOWED_COPY),
    );
  });

  it("the offered form submitted unticked refuses (no silent plain publish)", async () => {
    const calls = await run({ versionId: "v1", importId: "imp1", publish_now_offered: "yes", seen_pending: "5" });
    expect(calls.some((c) => c.startsWith("publish:"))).toBe(false);
    expect(calls[calls.length - 1]).toBe(
      "redirect:/admin/menu-imports/imp1?error=" + encodeURIComponent(PUBLISH_NOW_NOT_TICKED_COPY),
    );
  });

  it("a ticked box with a junk seen-count refuses", async () => {
    const calls = await run({ versionId: "v1", importId: "imp1", publish_now: "yes", seen_pending: "lots" });
    expect(calls.some((c) => c.startsWith("publish:"))).toBe(false);
    expect(calls[calls.length - 1]).toContain(encodeURIComponent(PUBLISH_NOW_NOT_TICKED_COPY));
  });

  it("the gate's own refusal (e.g. more pending now than seen) comes back verbatim, no audit", async () => {
    st.publishThrows = "Cannot publish: 700 fact-review row(s) still await a human decision.";
    const calls = await run({ versionId: "v1", importId: "imp1", publish_now: "yes", seen_pending: "612" });
    expect(calls).not.toContain("audit:menu_version.published");
    expect(calls[calls.length - 1]).toBe(
      "redirect:/admin/menu-imports/imp1?error=" + encodeURIComponent(st.publishThrows),
    );
  });
});

// --------------------------------------------------------------------------
// 3. The decision mirror
// --------------------------------------------------------------------------
describe("R14a recordFactReview: decisions reach the live menu", () => {
  const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";
  const versions = [
    { id: "v-own", import_id: "imp1", status: "archived" },
    { id: "v-intake-live", import_id: null, status: "published" },
    { id: "v-intake-staged", import_id: null, status: "staged" },
  ];
  const routeVersions = (r: Req) => {
    if (table(r) !== "menu_versions") return null;
    const importFilter = r.url.searchParams.get("import_id");
    if (importFilter === "eq.imp1") return { status: 200, body: versions.filter((v) => v.import_id === "imp1") };
    if (importFilter === "is.null") {
      expect(r.url.searchParams.get("status")).toBe("in.(published,staged)");
      return { status: 200, body: versions.filter((v) => v.import_id === null) };
    }
    return { status: 200, body: [] };
  };

  it("a reject hides the card on this import's version AND the live + staged intake versions", async () => {
    st.route = routeVersions;
    const { recordFactReview } = await import("@/lib/pos/fact-review-store");
    await recordFactReview({ importId: "imp1", sourceItemId: "pos-a", action: "reject", note: null, correctedFacts: null, reviewedBy: "u1" });
    const hide = st.reqs.find((r) => table(r) === "menu_items" && r.method === "PATCH");
    expect(hide?.body).toEqual({ hidden: true, hidden_reason: "reviewer_rejected" });
    expect(hide?.url.searchParams.get("menu_version_id")).toBe("in.(v-own,v-intake-live,v-intake-staged)");
    expect(hide?.url.searchParams.get("source_item_id")).toBe("eq.pos-a");
  });

  it("the import id is never spliced into a filter string", async () => {
    st.route = routeVersions;
    const { recordFactReview } = await import("@/lib/pos/fact-review-store");
    await recordFactReview({ importId: "imp1", sourceItemId: "pos-a", action: "approve", note: null, correctedFacts: null, reviewedBy: "u1" });
    expect(st.reqs.some((r) => r.url.searchParams.has("or"))).toBe(false);
  });

  it("a failed live-menu read is REPORTED after the decision is saved", async () => {
    st.route = (r) => {
      if (table(r) === "menu_versions" && r.url.searchParams.get("import_id") === "is.null") {
        return { status: 500, body: { message: "boom" } };
      }
      return routeVersions(r);
    };
    const { recordFactReview } = await import("@/lib/pos/fact-review-store");
    await expect(
      recordFactReview({ importId: "imp1", sourceItemId: "pos-a", action: "reject", note: null, correctedFacts: null, reviewedBy: "u1" }),
    ).rejects.toThrow(/decision was saved, but the live menu could not be read/);
    expect(st.reqs.filter((r) => table(r) === "pos_fact_reviews")).toHaveLength(1);
    expect(st.reqs.some((r) => table(r) === "menu_items")).toBe(false);
  });

  it("the pure target list: own any status + live/staged intake, never archived intake or another import", () => {
    expect(
      mirrorTargetVersionIds(
        [
          { id: "a", import_id: "imp1", status: "archived" },
          { id: "b", import_id: null, status: "archived" },
          { id: "c", import_id: "imp2", status: "published" },
          { id: "d", import_id: null, status: "published" },
        ],
        "imp1",
      ),
    ).toEqual(["a", "d"]);
  });
});

// --------------------------------------------------------------------------
// 4. Fact decisions refresh the public menu
// --------------------------------------------------------------------------
describe("R14a: every fact decision refreshes the public menu", () => {
  const actions = read("src/app/admin/menu-imports/actions.ts");
  const body = (name: string) => {
    const at = actions.indexOf(`export async function ${name}(`);
    const next = actions.indexOf("\nexport async function ", at + 10);
    return actions.slice(at, next === -1 ? undefined : next);
  };
  it.each(["resolveFactReview", "resolveFactReviewGroup"])("%s calls revalidatePublicMenuSurfaces before its success redirect", (name) => {
    const b = body(name);
    const reval = b.lastIndexOf("revalidatePublicMenuSurfaces();");
    expect(reval).toBeGreaterThan(-1);
    expect(reval).toBeLessThan(b.lastIndexOf('redirect(dest + "?saved=1");'));
  });
});

// --------------------------------------------------------------------------
// 5. Wiring
// --------------------------------------------------------------------------
describe("R14a wiring", () => {
  it("the permission is owner + admin only and listed", async () => {
    const { rolesForPermission, ALL_PERMISSIONS, PERMISSION_LABELS } = await import("@/lib/auth/roles");
    expect(rolesForPermission("menu.publish.open_reviews")).toEqual(["owner", "admin"]);
    expect(ALL_PERMISSIONS).toContain("menu.publish.open_reviews");
    expect(PERMISSION_LABELS["menu.publish.open_reviews"]).toMatch(/fix after/);
  });
  it("the service passes the seen count into the gate and records it on the reconciled row", () => {
    const svc = read("src/lib/pos/import-service.ts");
    expect(svc).toContain("{ acknowledgedPendingCount: options.acknowledgedPendingCount ?? null }");
    expect(svc).toContain("context: { ...gate.reconciliation, openReviewsAcknowledged },");
    expect(svc).toContain("return { openReviewsAcknowledged };");
    // The count the gate honoured is what the service returns (not a constant 0).
    const at = svc.indexOf("if (!gate.ready) throw new Error(gate.message);");
    expect(svc.slice(at, at + 120)).toContain("openReviewsAcknowledged = gate.openReviewsAcknowledged;");
  });
  it("the import page offers the form only when pending rows are the sole refusal, to owner/admin", () => {
    const page = read("src/app/admin/menu-imports/[id]/page.tsx");
    expect(page).toContain("gate.blockedOnlyByPending && canPublishOpenReviews && version && (");
    expect(page).toContain('can(session.profile.role, "menu.publish.open_reviews")');
    expect(page).toContain('name="publish_now_offered" value="yes"');
    expect(page).toContain('name="seen_pending" value={String(gate.reconciliation.pending)}');
    expect(page).toContain('name="publish_now" value="yes"');
    expect(page).toContain("publishNowAcknowledgementCopy(gate.reconciliation.pending)");
    expect(page).toContain('data-testid="live-open-reviews"');
  });
  it("Fact Review shows the live banner", () => {
    const page = read("src/app/admin/menu-imports/[id]/facts/page.tsx");
    expect(page).toContain('version?.status === "published" && liveWithOpenReviewsCopy(pending.length)');
  });
  it("copy says the true things", () => {
    expect(publishNowAcknowledgementCopy(612)).toContain("612 product(s)");
    expect(publishNowAcknowledgementCopy(612)).toContain("nothing guessed");
    expect(liveWithOpenReviewsCopy(0)).toBeNull();
  });
  it("both self-tests are in the pure runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runPublishNowCoreTests } from "../../src/lib/pos/publish-now-core";');
    expect(runner).toMatch(/\n\s+__runPublishNowCoreTests\(\);/);
    expect(runner).toMatch(/\n\s+__runImportCommitCoreTests\(\);/);
  });

  it("the env ledger records R14a as adding no variable", () => {
    const ledger = readFileSync(join(process.cwd(), "docs/INTAKE_PIPELINE_ENV_LEDGER.md"), "utf8");
    expect(ledger).toContain("S33 (and the Round 14 change sets R14a and R14b). Their bible");
    expect(ledger).toContain("- (R14a needs nothing set.");
    expect(ledger).toContain("No schema, no new reads of the environment, no new network calls, polls or crons.)");
  });
});
