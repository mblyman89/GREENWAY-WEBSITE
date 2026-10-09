/**
 * tests/compliance/s32-merge-review.test.ts  (bible S32, owner decision D-R2-4)
 *
 * The match review: "matches 2+ live cards" becomes a choice the owner makes
 * once and the planner remembers. Proven five ways:
 *   1. the pure cores' embedded self-tests (pinned counts, registered);
 *   2. the REAL server actions, driven with mocked stores: every refusal
 *      saves nothing, the migration-missing path says so, a save writes the
 *      row + audit + timeline and then re-stages, and the banner code
 *      follows what the re-stage actually did (never over-claims);
 *   3. the page reads identity, posts both actions, gates on inventory.manage
 *      and links a duplicate to the product page's real Visibility control;
 *   4. staging loads saved choices ONLY for flagged identities and re-plans;
 *   5. migration 0239 + rollback + registrations (schema list, factory reset
 *      KEEP, migrations doc, timeline labels).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { __runMergeReviewCoreTests, MERGE_REVIEW_COPY, type MergeWarning } from "@/lib/pos/merge-review-core";
import { __runIntakeMasteringCoreTests } from "@/lib/pos/intake-mastering-core";
import { isKnownEventType, labelForEvent } from "@/lib/inventory/manifest-event-labels-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(l))
    .join("\n");

// ---------------------------------------------------------------------------
// Mocks for the real server actions
// ---------------------------------------------------------------------------
const st = vi.hoisted(() => ({
  calls: [] as string[],
  events: [] as { id: string; type: string; note: string | null; actor: string | null }[],
  audits: [] as { action: string; entityId?: string | null; after?: unknown }[],
  saved: [] as unknown[],
  review: null as unknown,
  save: { ok: true, migrated: true } as { ok: boolean; migrated: boolean; error?: string },
  forget: { ok: true, migrated: true, deleted: true } as { ok: boolean; migrated: boolean; deleted: boolean; error?: string },
  stage: { staged: true, published: true, versionId: "v2" } as { staged: boolean; published: boolean; versionId: string | null; reason?: string },
  stageCalls: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u-owner", email: "o@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (e: { action: string; entityId?: string | null; after?: unknown }) => {
    st.audits.push(e);
  },
}));
vi.mock("@/lib/inventory/intake-store", () => ({
  logManifestEvent: async (manifestId: string, type: string, note: string | null, actor: string | null) => {
    st.events.push({ id: manifestId, type, note, actor });
  },
  stageManifest: vi.fn(),
  rejectManifest: vi.fn(),
  setLotDisposition: vi.fn(),
  finalizeManifestDispositions: vi.fn(),
  gatherSampleCapNotice: vi.fn(),
  setManifestInvoiceOverride: vi.fn(),
}));
vi.mock("@/lib/pos/merge-review-server", () => ({
  loadMatchReview: async () => st.review,
}));
vi.mock("@/lib/pos/merge-decision-store", () => ({
  saveMergeDecision: async (v: unknown) => {
    st.saved.push(v);
    return st.save;
  },
  forgetMergeDecision: async () => st.forget,
}));
vi.mock("@/lib/pos/intake-menu-staging", () => ({
  stageIntakeMenuVersionForManifest: async () => {
    st.stageCalls += 1;
    return st.stage;
  },
}));
vi.mock("@/lib/compliance/sample-cap-notify", () => ({ sendSampleCapVendorNotice: vi.fn() }));
vi.mock("@/lib/inventory/transfer-fetch", () => ({ fetchTransferJson: vi.fn() }));
vi.mock("@/lib/inventory/pdf-extract", () => ({ parsePdfManifest: vi.fn() }));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => ({ makeCapturingRecovery: vi.fn() }));
vi.mock("@/lib/inbound-email/llamaparse-status-server", () => ({ recordManifestParseStatus: vi.fn() }));

const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const ID = "fairwinds-llc|flower|blue-dream";
const WARNING: MergeWarning = {
  identity: ID,
  liveCardKeys: ["C1", "C2"],
  lots: ["LOT-9"],
  ownCardKey: "LOT-9",
  staleDecision: false,
  message: "matches 2 live cards",
};
const okReview = (warning: MergeWarning | null = WARNING) => ({
  ok: true,
  versionId: "v1",
  versionStatus: "published",
  warning,
  decided: null,
  cards: [],
  ownCard: null,
  liveKeys: new Set<string>(),
});

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
const JOIN = { manifestId: M, identity: ID, decision: "join", target: "C1", candidates: '["C1","C2"]' };

async function save(o: Record<string, string>): Promise<URL> {
  const { saveMergeDecisionAction } = await import("@/app/admin/inventory/intake/actions");
  await expect(saveMergeDecisionAction(fd(o))).rejects.toThrow("NEXT_REDIRECT");
  const last = st.calls.filter((c) => c.startsWith("redirect:")).at(-1)!.slice("redirect:".length);
  return new URL(last, "http://x");
}
async function forget(o: Record<string, string>): Promise<URL> {
  const { forgetMergeDecisionAction } = await import("@/app/admin/inventory/intake/actions");
  await expect(forgetMergeDecisionAction(fd(o))).rejects.toThrow("NEXT_REDIRECT");
  const last = st.calls.filter((c) => c.startsWith("redirect:")).at(-1)!.slice("redirect:".length);
  return new URL(last, "http://x");
}

beforeEach(() => {
  st.calls = [];
  st.events = [];
  st.audits = [];
  st.saved = [];
  st.review = okReview();
  st.save = { ok: true, migrated: true };
  st.forget = { ok: true, migrated: true, deleted: true };
  st.stage = { staged: true, published: true, versionId: "v2" };
  st.stageCalls = 0;
});

// ---------------------------------------------------------------------------
describe("1. pure cores", () => {
  it("merge-review-core self-tests pass (pinned 60) and are registered with that floor", () => {
    expect(__runMergeReviewCoreTests()).toEqual({ passed: 60, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runMergeReviewCoreTests } from "../../src/lib/pos/merge-review-core";');
    expect(runner).toContain("const r = __runMergeReviewCoreTests(); if (r.failed > 0 || r.passed < 60)");
  });
  it("intake-mastering-core self-tests (S32 block included) pass with zero failures", () => {
    // Throws on the first failure; returns the count when all pass.
    expect(__runIntakeMasteringCoreTests().passed).toBe(218); // R29: +6 (lot-bundle minors x4, cannabinoid upper-case x2); R35 #6: +6 (effects/aroma rollup)
  });
  it("the core is pure (no React, next/*, supabase, env, fetch)", () => {
    const src = read("src/lib/pos/merge-review-core.ts");
    expect(src).not.toMatch(/from "react"|from "next\/|supabase|process\.env|fetch\(/);
  });
  it("bible S32.4 copy, word for word", () => {
    expect(MERGE_REVIEW_COPY.heading).toBe("This product looks like more than one card on your menu");
    expect(MERGE_REVIEW_COPY.lead).toBe(
      "We didn't guess. Compare them side by side and tell us where it belongs. We'll remember your choice for every future delivery of this product \u2014 you can undo it any time.",
    );
    expect(MERGE_REVIEW_COPY.join).toBe("Join this card");
    expect(MERGE_REVIEW_COPY.separate).toBe("Keep separate");
    expect(MERGE_REVIEW_COPY.forget).toBe("Forget my choice");
    expect(MERGE_REVIEW_COPY.stale).toBe(
      "Your earlier choice no longer fits \u2014 the cards on your menu changed. Please choose again.",
    );
  });
});

// ---------------------------------------------------------------------------
describe("2. saveMergeDecisionAction (the real action)", () => {
  it("a valid join: permission, row, audit, timeline, re-stage, then 'join'", async () => {
    const u = await save(JOIN);
    expect(st.calls[0]).toBe("perm:inventory.manage");
    expect(st.saved).toEqual([
      {
        manifestId: M,
        identity: ID,
        decision: "join",
        targetCardKey: "C1",
        candidateCardKeys: ["C1", "C2"],
        ownCardKey: "LOT-9",
        note: null,
      },
    ]);
    expect(st.audits.map((a) => a.action)).toEqual(["intake_merge_decision.join"]);
    expect(st.audits[0].entityId).toBe(ID);
    expect(st.events).toEqual([{ id: M, type: "merge_decision_saved", note: `${ID} \u2192 join C1`, actor: "u-owner" }]);
    expect(st.stageCalls).toBe(1);
    expect(u.pathname).toBe(`/admin/inventory/intake/${M}/match`);
    expect(u.searchParams.get("identity")).toBe(ID);
    expect(u.searchParams.get("merge")).toBe("join");
    expect(st.calls).toContain("revalidate:/admin/publish");
  });

  it("keep separate saves with no target and says 'separate'", async () => {
    const u = await save({ ...JOIN, decision: "separate" });
    expect((st.saved[0] as { targetCardKey: unknown }).targetCardKey).toBeNull();
    expect(st.events[0].note).toBe(`${ID} \u2192 separate`);
    expect(u.searchParams.get("merge")).toBe("separate");
  });

  it("the banner follows what the re-stage did (held / live / rebuild) - never over-claims", async () => {
    st.stage = { staged: true, published: false, versionId: "v2", reason: "held-for-fact-review" };
    expect((await save(JOIN)).searchParams.get("merge")).toBe("held");
    st.stage = { staged: false, published: false, versionId: null, reason: "no-new-items" };
    expect((await save(JOIN)).searchParams.get("merge")).toBe("live");
    st.stage = { staged: false, published: false, versionId: null, reason: "exception" };
    expect((await save(JOIN)).searchParams.get("merge")).toBe("rebuild");
  });

  it("refuses a target the page did not show - nothing saved, no audit, no re-stage", async () => {
    const u = await save({ ...JOIN, target: "ELSEWHERE" });
    expect(u.searchParams.get("merge")).toBe("error");
    expect(u.searchParams.get("merge_msg")).toBe("Pick one of the cards shown to join.");
    expect(st.saved).toEqual([]);
    expect(st.audits).toEqual([]);
    expect(st.events).toEqual([]);
    expect(st.stageCalls).toBe(0);
  });

  it("refuses the product's own card as a join target", async () => {
    st.review = okReview({ ...WARNING, liveCardKeys: ["C1", "LOT-9"] });
    const u = await save({ ...JOIN, target: "LOT-9", candidates: '["C1","LOT-9"]' });
    expect(u.searchParams.get("merge")).toBe("error");
    expect(st.saved).toEqual([]);
  });

  it("refuses when the cards changed while the page was open", async () => {
    st.review = okReview({ ...WARNING, liveCardKeys: ["C1", "C2", "C3"] });
    const u = await save(JOIN);
    expect(u.searchParams.get("merge_msg")).toContain("changed while this page was open");
    expect(st.saved).toEqual([]);
  });

  it("refuses when the warning is gone, or the update can't be read", async () => {
    st.review = okReview(null);
    expect((await save(JOIN)).searchParams.get("merge_msg")).toBe(MERGE_REVIEW_COPY.notFound);
    st.review = { ...okReview(), ok: false };
    expect((await save(JOIN)).searchParams.get("merge_msg")).toContain("could not be read");
    expect(st.saved).toEqual([]);
    expect(st.stageCalls).toBe(0);
  });

  it("before 0239: 'migration', no audit, no timeline, no re-stage", async () => {
    st.save = { ok: false, migrated: false };
    const u = await save(JOIN);
    expect(u.searchParams.get("merge")).toBe("migration");
    expect(st.audits).toEqual([]);
    expect(st.events).toEqual([]);
    expect(st.stageCalls).toBe(0);
  });

  it("a write error is shown, not swallowed", async () => {
    st.save = { ok: false, migrated: true, error: "permission denied" };
    const u = await save(JOIN);
    expect(u.searchParams.get("merge")).toBe("error");
    expect(u.searchParams.get("merge_msg")).toBe("permission denied");
    expect(st.stageCalls).toBe(0);
  });

  it("a malformed form never reaches the store", async () => {
    const u = await save({ ...JOIN, decision: "merge" });
    expect(u.searchParams.get("merge")).toBe("error");
    expect(st.saved).toEqual([]);
    await save({ ...JOIN, manifestId: "not-a-uuid" });
    expect(st.calls.at(-1)).toBe("redirect:/admin/inventory/intake?error=save");
  });

  it("carries a safe back link and drops an unsafe one", async () => {
    expect((await save({ ...JOIN, back: "/admin/publish" })).searchParams.get("back")).toBe("/admin/publish");
    expect((await save({ ...JOIN, back: "https://evil.example" })).searchParams.get("back")).toBeNull();
  });
});

describe("2b. forgetMergeDecisionAction (the real action)", () => {
  it("deletes, audits, logs and says 'forgotten'", async () => {
    const u = await forget({ manifestId: M, identity: ID });
    expect(u.searchParams.get("merge")).toBe("forgotten");
    expect(st.audits.map((a) => a.action)).toEqual(["intake_merge_decision.forget"]);
    expect(st.events.map((e) => e.type)).toEqual(["merge_decision_forgotten"]);
  });
  it("nothing to forget: no audit, no timeline noise", async () => {
    st.forget = { ok: true, migrated: true, deleted: false };
    await forget({ manifestId: M, identity: ID });
    expect(st.audits).toEqual([]);
    expect(st.events).toEqual([]);
  });
  it("before 0239: 'migration'", async () => {
    st.forget = { ok: false, migrated: false, deleted: false };
    expect((await forget({ manifestId: M, identity: ID })).searchParams.get("merge")).toBe("migration");
  });
  it("refuses a bad identity", async () => {
    await forget({ manifestId: M, identity: "nope" });
    expect(st.calls.at(-1)).toBe("redirect:/admin/inventory/intake?error=save");
  });
});

// ---------------------------------------------------------------------------
describe("3. the match page", () => {
  const PAGE = "src/app/admin/inventory/intake/[id]/match/page.tsx";
  it("exists, is gated, reads identity and posts both actions", () => {
    expect(existsSync(join(ROOT, PAGE))).toBe(true);
    const src = code(PAGE);
    expect(src).toContain('await requirePermission("inventory.manage")');
    expect(src).toContain("sp.identity");
    expect(src).toContain("action={saveMergeDecisionAction}");
    expect(src).toContain("action={forgetMergeDecisionAction}");
    expect(src).toContain("MERGE_REVIEW_COPY.stale");
    expect(src).toContain("MERGE_REVIEW_COPY.notFound");
    expect(src).toContain("MERGE_REVIEW_COPY.migration");
  });
  it("one Join form per candidate, carrying exactly the keys it showed", () => {
    const src = code(PAGE);
    expect(src).toContain('{hidden("join", c.cardKey)}');
    expect(src).toContain('{hidden("separate")}');
    expect(src).toContain('name="candidates" value={candidatesJson}');
  });
  it("'Hide this card' opens the product page's real Visibility control", () => {
    expect(code(PAGE)).toContain("productVisibilityHref(c.cardKey)");
    expect(read("src/app/admin/products/[key]/page.tsx")).toContain('id="visibility"');
  });
});

// ---------------------------------------------------------------------------
describe("4. staging reads saved choices only when needed", () => {
  const src = code("src/lib/pos/intake-menu-staging.ts");
  it("loads choices for flagged identities and re-plans with them", () => {
    expect(src).toContain("mergeAmbiguousIdentities(firstPlan.diagnostics)");
    expect(src).toContain("ambiguousIdentities.length > 0 ? await loadMergeDecisions(ambiguousIdentities)");
    expect(src).toMatch(/mergeDecisions\.size > 0\s*\?\s*buildIntakeStagedVersionPlan\(\{[^}]*\bmergeDecisions,\s*\}\)\s*:\s*firstPlan;/);
    // and the staging core hands them to the planner
    expect(code("src/lib/pos/intake-menu-staging-core.ts")).toContain("mergeDecisions: inputs.mergeDecisions");
  });
  it("the store reads no environment and never throws past its callers", () => {
    const store = read("src/lib/pos/merge-decision-store.ts");
    expect(store).not.toMatch(/process\.env/);
    expect(store).toContain("return new Map()");
  });
});

// ---------------------------------------------------------------------------
describe("5. migration 0239 and registrations", () => {
  const mig = read("supabase/migrations/0239_intake_merge_decisions.sql");
  it("the table, its checks, RLS on", () => {
    expect(mig).toContain("create table if not exists public.intake_merge_decisions");
    expect(mig).toMatch(/decision text not null check \(decision in \('join', ?'separate'\)\)/);
    expect(mig).toContain("intake_merge_decisions_target_matches_decision");
    expect(mig).toContain("intake_merge_decisions_two_or_more_candidates");
    expect(mig).toContain("enable row level security");
  });
  it("rollback drops only this table", () => {
    const rb = read("supabase/rollbacks/0239_intake_merge_decisions.rollback.sql");
    expect(rb).toContain("drop table if exists public.intake_merge_decisions;");
  });
  it("registered: schema list, factory-reset KEEP, migrations doc, timeline labels", () => {
    expect(read("src/lib/admin/schema-tables.ts")).toContain('"intake_merge_decisions"');
    expect(read("src/lib/accounting/factory-reset-core.ts")).toContain("intake_merge_decisions");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("S32 \u2014 0239");
    for (const t of ["merge_decision_saved", "merge_decision_forgotten"]) {
      expect(isKnownEventType(t), t).toBe(true);
      expect(labelForEvent(t).problem).toBe(false);
    }
  });
});
