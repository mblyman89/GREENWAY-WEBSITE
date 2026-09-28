/**
 * tests/compliance/s18-cutover-actions.test.ts
 *
 * S18 - the server actions around the cutover guard, behavioural (the guard
 * module is mocked here; its queries are tested for real in
 * s18-cutover-guard.test.ts):
 *
 *   1. publishVersion: refuse / rebuild are decided BEFORE the removal gate
 *      and never publish; the Cultivera publish reads the waiting updates
 *      BEFORE publishing and rebuilds them AFTER; "still blocked" is told
 *      plainly; the pre-S18 path is unchanged.
 *   2. uploadAndStageImport: a second REAL upload after cutover is refused
 *      (bible 7.4); a Test-mode rehearsal is still allowed.
 *   3. rebuildCutoverDeliveryAction: never trusts the form - the pair must be
 *      on the freshly read pending list; refused while Cultivera waits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CUTOVER_PUBLISH_REFUSED_COPY,
  CUTOVER_REUPLOAD_REFUSED_COPY,
  CUTOVER_STILL_BLOCKED_COPY,
  rebuildNote,
} from "@/lib/inventory/cutover-guard-core";

const M1 = "aaaaaaaa-1111-4111-8111-111111111111";

type Decision = { kind: "allow"; release: boolean } | { kind: "refuse" } | { kind: "rebuild"; manifestId: string };
type Outcome = { staged: boolean; published: boolean; versionId: string | null; reason?: string };
type Plan = { manifests: string[]; heldIds: Record<string, string[]>; overflow: number };

const st = vi.hoisted(() => ({
  calls: [] as string[],
  decision: { kind: "allow", release: false } as unknown,
  outcome: { staged: false, published: false, versionId: null } as unknown,
  plan: { manifests: [], heldIds: {}, overflow: 0 } as unknown,
  blocker: null as unknown,
  done: false,
  status: { enabled: true, blocking: null, done: false, pending: [] } as unknown,
  removed: [] as Array<{ name: string }>,
  audits: [] as Array<{ action: string; entityId: string; after: unknown }>,
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
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after: unknown }) => {
    st.calls.push(`audit:${a.action}`);
    st.audits.push({ action: a.action, entityId: a.entityId, after: a.after });
  },
}));
vi.mock("@/lib/pos/import-service", () => ({
  runImport: async (a: { isTest: boolean }) => {
    st.calls.push(`runImport:${a.isTest}`);
    return {
      import: { id: "imp1" },
      version: { item_count: 1, variant_count: 1, vendor_count: 1 },
      transform: { diagnosticCounts: { errors: 0, warnings: 0 } },
    };
  },
  publishMenuVersion: async (id: string) => st.calls.push(`publish:${id}`),
  findDuplicateImport: async () => null,
  sha256: () => "h",
  cleanSlateTestData: vi.fn(),
  backfillImportLots: vi.fn(),
}));
vi.mock("@/lib/pos/menu-version", () => ({
  getPublishedVersion: async () => {
    st.calls.push("getPublished");
    return { id: "live" };
  },
  diffVersions: async (a: string, b: string) => {
    st.calls.push(`diff:${a}:${b}`);
    return { added: [], removed: st.removed, priceChanged: [], unchangedCount: 0 };
  },
  archiveSupersededStaged: async (v: { id: string }) => st.calls.push(`archive:${v.id}`),
  getImportDiagnosticsChecked: vi.fn(),
  listVersions: vi.fn(),
  getVersionItems: vi.fn(),
}));
vi.mock("@/lib/pos/fact-review-store", () => ({ recordFactReview: vi.fn(), listFactReviews: vi.fn(), factReviewsToResolutions: vi.fn() }));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => st.calls.push("revalidate:public") }));
vi.mock("@/lib/pos/cutover-guard", () => ({
  decideHandPublish: async (id: string) => {
    st.calls.push(`decide:${id}`);
    return st.decision;
  },
  rebuildDelivery: async (m: string, ids: string[], actor: string | null) => {
    st.calls.push(`rebuild:${m}:${ids.join(",")}:${actor}`);
    return st.outcome;
  },
  readHeldBeforeRelease: async () => {
    st.calls.push("readHeld");
    return st.plan;
  },
  readCultiveraBlocker: async () => {
    st.calls.push("readBlocker");
    return st.blocker;
  },
  releaseHeldAfterCutover: async (plan: Plan, actor: string | null, email: string | null, cv: string) => {
    st.calls.push(`release:${plan.manifests.join(",")}:${actor}:${email}:${cv}`);
    return "RELEASED-NOTE";
  },
  readCutoverDone: async () => {
    st.calls.push("readDone");
    return st.done;
  },
  readCutoverStatus: async () => {
    st.calls.push("readStatus");
    return st.status;
  },
}));

beforeEach(() => {
  st.calls = [];
  st.decision = { kind: "allow", release: false } satisfies Decision;
  st.outcome = { staged: false, published: false, versionId: null } satisfies Outcome;
  st.plan = { manifests: [], heldIds: {}, overflow: 0 } satisfies Plan;
  st.blocker = null;
  st.done = false;
  st.status = { enabled: true, blocking: null, done: false, pending: [] };
  st.removed = [];
  st.audits = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const last = () => st.calls[st.calls.length - 1];
const has = (prefix: string) => st.calls.some((c) => c.startsWith(prefix));

async function publish(fields: Record<string, string>) {
  const { publishVersion } = await import("@/app/admin/menu-imports/actions");
  await expect(publishVersion(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return st.calls;
}

// === 1. publishVersion =========================================================
describe("S18 publishVersion", () => {
  it("refuse: a real Cultivera upload waits and this is not it - nothing read, published or archived", async () => {
    st.decision = { kind: "refuse" };
    st.removed = [{ name: "A" }];
    await publish({ versionId: "v2", from: "publish" });
    expect(st.calls.slice(0, 2)).toEqual(["perm:menu.publish", "decide:v2"]);
    expect(has("getPublished")).toBe(false); // decided BEFORE the removal gate
    expect(has("publish:")).toBe(false);
    expect(has("archive:")).toBe(false);
    expect(has("rebuild:")).toBe(false);
    expect(last()).toBe("redirect:/admin/publish?error=" + encodeURIComponent(CUTOVER_PUBLISH_REFUSED_COPY));
  });
  it("rebuild (published): the stale held snapshot is never published; its delivery is rebuilt; green banner", async () => {
    st.decision = { kind: "rebuild", manifestId: M1 };
    st.outcome = { staged: true, published: true, versionId: "v9" };
    st.removed = [{ name: "every Cultivera product" }];
    await publish({ versionId: "h1", from: "publish-draft" });
    expect(st.calls).toContain(`rebuild:${M1}:h1:u1`);
    expect(has("getPublished")).toBe(false); // the gate would ask to take Cultivera off
    expect(has("publish:")).toBe(false);
    expect(has("archive:")).toBe(false);
    expect(st.calls).toContain("revalidate:/admin/menu-imports");
    expect(st.calls).toContain("revalidate:/admin/publish");
    expect(last()).toBe(
      "redirect:/admin/publish?published=1&notice=" + encodeURIComponent(rebuildNote({ staged: true, published: true }).text),
    );
  });
  it("rebuild (waiting / nothing new / failed): no green 'published' flag, the plain notice instead", async () => {
    st.decision = { kind: "rebuild", manifestId: M1 };
    for (const o of [
      { staged: true, published: false, versionId: "v9" },
      { staged: false, published: false, versionId: null, reason: "no-new-items" },
      { staged: false, published: false, versionId: null, reason: "exception" },
    ]) {
      st.calls = [];
      st.outcome = o;
      await publish({ versionId: "h1", importId: "", from: "" });
      expect(last()).toBe("redirect:/admin/menu-imports?notice=" + encodeURIComponent(rebuildNote(o).text));
      expect(last()).not.toContain("published=1");
    }
  });
  it("release: reads the waiting updates BEFORE the publish, rebuilds them AFTER the archive, tells the owner", async () => {
    st.decision = { kind: "allow", release: true };
    st.plan = { manifests: [M1], heldIds: { [M1]: ["h1"] }, overflow: 0 };
    await publish({ versionId: "c1", importId: "imp1" });
    const i = (s: string) => st.calls.indexOf(s);
    expect(i("readHeld")).toBeGreaterThan(i("decide:c1"));
    expect(i("readHeld")).toBeLessThan(i("publish:c1"));
    expect(i("archive:c1")).toBeGreaterThan(i("publish:c1"));
    expect(i("readBlocker")).toBeGreaterThan(i("archive:c1"));
    expect(i(`release:${M1}:u1:m@x:c1`)).toBeGreaterThan(i("readBlocker"));
    expect(last()).toBe("redirect:/admin/menu-imports/imp1?published=1&notice=" + encodeURIComponent("RELEASED-NOTE"));
  });
  it("release with only overflow still runs (the note reports what is left)", async () => {
    st.decision = { kind: "allow", release: true };
    st.plan = { manifests: [], heldIds: {}, overflow: 3 };
    await publish({ versionId: "c1", importId: "imp1" });
    expect(has("release:")).toBe(true);
  });
  it("release while ANOTHER real upload still waits: nothing rebuilt, the plain 'still blocked' notice", async () => {
    st.decision = { kind: "allow", release: true };
    st.plan = { manifests: [M1], heldIds: { [M1]: ["h1"] }, overflow: 0 };
    st.blocker = { versionIds: ["c2"] };
    await publish({ versionId: "c1", importId: "imp1" });
    expect(st.calls).toContain("publish:c1");
    expect(has("release:")).toBe(false);
    expect(last()).toBe("redirect:/admin/menu-imports/imp1?published=1&notice=" + encodeURIComponent(CUTOVER_STILL_BLOCKED_COPY));
  });
  it("release when the blocker re-read fails ('unknown'): fail-open, rebuilds run", async () => {
    st.decision = { kind: "allow", release: true };
    st.plan = { manifests: [M1], heldIds: { [M1]: ["h1"] }, overflow: 0 };
    st.blocker = "unknown";
    await publish({ versionId: "c1", importId: "imp1" });
    expect(has("release:")).toBe(true);
  });
  it("release with nothing waiting: no extra read, no notice", async () => {
    st.decision = { kind: "allow", release: true };
    await publish({ versionId: "c1", importId: "imp1" });
    expect(st.calls).toContain("readHeld");
    expect(has("readBlocker")).toBe(false);
    expect(last()).toBe("redirect:/admin/menu-imports/imp1?published=1");
  });
  it("plain allow: exactly the pre-S18 path (no held read, gate runs, publish, archive)", async () => {
    await publish({ versionId: "v2", from: "publish" });
    expect(has("readHeld")).toBe(false);
    expect(has("readBlocker")).toBe(false);
    expect(st.calls).toContain("diff:v2:live");
    expect(st.calls.indexOf("publish:v2")).toBeGreaterThan(st.calls.indexOf("diff:v2:live"));
    expect(st.calls).toContain("archive:v2");
    expect(last()).toBe("redirect:/admin/publish?published=1");
  });
  it("plain allow still hits the removal gate (S18 did not weaken SLICE 76)", async () => {
    st.removed = [{ name: "A" }];
    await publish({ versionId: "v2", from: "publish" });
    expect(has("publish:")).toBe(false);
    expect(last()).toContain("/admin/publish?error=");
  });
});

// === 2. uploadAndStageImport ===================================================
describe("S18 one-time upload guard (bible 7.4)", () => {
  const xlsx = (name: string) => new File([new Uint8Array([1, 2, 3])], name);
  async function upload(testMode: boolean) {
    const { uploadAndStageImport } = await import("@/app/admin/menu-imports/actions");
    const f: Record<string, string | File> = { products: xlsx("PRODUCTS.xlsx"), inventories: xlsx("INVENTORIES.xlsx") };
    if (testMode) f.test_mode = "on";
    await expect(uploadAndStageImport(form(f))).rejects.toThrow("NEXT_REDIRECT");
  }
  it("after cutover, a REAL upload is refused with the plain reason; nothing imported", async () => {
    st.done = true;
    await upload(false);
    expect(st.calls).toContain("readDone");
    expect(has("runImport:")).toBe(false);
    expect(last()).toBe("redirect:/admin/menu-imports?error=" + encodeURIComponent(CUTOVER_REUPLOAD_REFUSED_COPY));
  });
  it("after cutover, a Test-mode rehearsal is still allowed", async () => {
    st.done = true;
    await upload(true);
    expect(st.calls).toContain("runImport:true");
    expect(last()).toBe("redirect:/admin/menu-imports/imp1?staged=1");
  });
  it("before cutover (or on any failed read, which reports not-done), a real upload goes through", async () => {
    st.done = false;
    await upload(false);
    expect(st.calls).toContain("runImport:false");
    expect(last()).toBe("redirect:/admin/menu-imports/imp1?staged=1");
  });
});

// === 3. rebuildCutoverDeliveryAction ===========================================
describe("S18 Rebuild button (never trusts the form)", () => {
  async function rebuild(fields: Record<string, string>) {
    const { rebuildCutoverDeliveryAction } = await import("@/app/admin/menu-imports/actions");
    await expect(rebuildCutoverDeliveryAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  }
  const dest = "/admin/menu-imports/cutover";
  it("requires menu.publish", async () => {
    await rebuild({ manifestId: M1, versionId: "h1" });
    expect(st.calls[0]).toBe("perm:menu.publish");
  });
  it("refused while a real Cultivera upload is staged (it would only be held again)", async () => {
    st.status = { enabled: true, blocking: { versionIds: ["c1"] }, done: false, pending: [{ manifestId: M1, versionId: "h1", status: "staged" }] };
    await rebuild({ manifestId: M1, versionId: "h1" });
    expect(has("rebuild:")).toBe(false);
    expect(last()).toBe(`redirect:${dest}?error=` + encodeURIComponent(CUTOVER_PUBLISH_REFUSED_COPY));
  });
  it("a pair that is not on the pending list is refused (forged or stale form)", async () => {
    st.status = { enabled: true, blocking: null, done: true, pending: [{ manifestId: M1, versionId: "h1", status: "staged" }] };
    for (const f of [{ manifestId: M1, versionId: "other" }, { manifestId: "bbbbbbbb-2222-4222-8222-222222222222", versionId: "h1" }, {}]) {
      st.calls = [];
      await rebuild(f as Record<string, string>);
      expect(has("rebuild:")).toBe(false);
      expect(last()).toBe(`redirect:${dest}?error=` + encodeURIComponent("That delivery is no longer waiting. The list below is up to date."));
    }
  });
  it("listed pair (case-insensitive manifest): rebuilds, audits, revalidates, plain notice", async () => {
    st.status = { enabled: true, blocking: "unknown", done: true, pending: [{ manifestId: M1, versionId: "h1", status: "archived" }] };
    st.outcome = { staged: true, published: true, versionId: "v9" };
    await rebuild({ manifestId: M1.toUpperCase(), versionId: "h1" });
    expect(st.calls).toContain(`rebuild:${M1}:h1:u1`);
    expect(st.audits).toEqual([
      {
        action: "menu_version.cutover_rebuilt",
        entityId: M1,
        after: { heldVersionId: "h1", staged: true, published: true, newVersionId: "v9" },
      },
    ]);
    for (const p of [dest, "/admin/publish", "/admin/menu-imports"]) expect(st.calls).toContain(`revalidate:${p}`);
    expect(last()).toBe(`redirect:${dest}?notice=` + encodeURIComponent(rebuildNote(st.outcome as Outcome).text));
  });
});
