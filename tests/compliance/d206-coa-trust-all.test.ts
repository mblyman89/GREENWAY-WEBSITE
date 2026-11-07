/**
 * tests/compliance/d206-coa-trust-all.test.ts   (D206)
 *
 * Owner: "we need all coa's regardless if we like them or not to be read AND
 * trusted ... it should run on the server in the background, I will push the
 * button before bed and hopefully when I wake up it will be finished reading
 * all of them and accepting them regardless of how it feels about them."
 *
 * Covers the pure core (any-layout reader + trust policy + job state), the
 * overnight tick against the in-memory PostgREST (lease, compare-and-set,
 * cursor, stop, done), and the wiring (cron, vercel.json, page, actions).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const state = {
  db: null as unknown as FakePostgrest,
  svc: true,
  audits: [] as { action: string }[],
  redirects: [] as string[],
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    state.redirects.push(u);
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => ({ userId: "u1", email: "owner@x.com", profile: { role: "owner" }, perm: p }),
  getStaffSession: async () => null,
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: { action: string }) => void state.audits.push(e) }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) };
});
vi.mock("@/lib/supabase/env", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    get isSupabaseServiceConfigured() {
      return state.svc;
    },
  };
});

const root = path.resolve(__dirname, "../..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function seedLabs(n: number, status: (i: number) => string | null = (i) => (i % 3 === 0 ? "ok" : i % 3 === 1 ? "failed" : null)) {
  const rows = state.db.rows("lab_results");
  for (let i = 1; i <= n; i++) {
    rows.push({ id: id(i), coa_url: i === 5 ? null : `https://lab.example/${i}.pdf`, wcia_json_url: null, coa_storage_path: null, coa_extract_status: status(i) });
  }
}

const settings = () => state.db.rows("site_settings");
const runOf = () => settings().find((r) => r.key === "coa_trust_all_run")?.value_json as Record<string, unknown> | undefined;

beforeEach(() => {
  state.db = new FakePostgrest();
  state.db.uniques.push({ table: "site_settings", columns: ["key"], name: "site_settings_pkey" });
  state.svc = true;
  state.audits = [];
  state.redirects = [];
});

describe("D206 pure core", () => {
  it("self-tests pass (any layout, trust policy, job state)", async () => {
    const { __runCoaTrustAllCoreTests } = await import("@/lib/inventory/coa-trust-all-core");
    const r = __runCoaTrustAllCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(38);
  });

  it("the owner's example: the Cherry OG block, never another product's numbers", async () => {
    const { readAnyLayout } = await import("@/lib/inventory/coa-trust-all-core");
    const text =
      "QA Results Strain Lab Sample ID# Parent ID# Child ID# Additional Details Cherry OG MEDICINE CREEK ANALYTICS GF41918900060579 GF41918900060537 GF41918905566981 MED Strain Lab THC THCA THCMax CBD CBDA CBDMax 5.33 29.83 31.49 0 0 0 Sample ID# Parent ID# Moisture Drunken Hashplant MEDICINE CREEK ANALYTICS GF41918900062116 GF41918900062104 GF41918905566990 THC THCA THCMax CBD CBDA CBDMax 6.3 24.27 27.58 .85 0 .85";
    expect(readAnyLayout(text, ["GF41918900060579"])?.doc.summary.totalThcPct).toBe(31.49);
    expect(readAnyLayout(text, ["GF41918900062116"])?.doc.summary.totalThcPct).toBe(27.58);
    expect(readAnyLayout(text, ["GF00000000000001"])?.doc.potency).toHaveLength(0);
  });

  it("a stored read survives a dead link and is trusted", async () => {
    const { chooseTrusted, trustMarkOf } = await import("@/lib/inventory/coa-trust-all-core");
    const dead = { version: 1, jsonUrl: null, coaUrl: "https://x/c.pdf", json: null, jsonError: null, pdf: null, pdfError: "the lab answered HTTP 404", identity: [], agreement: [], status: "failed", summary: "COA PDF not read.", extractedAt: "2026-11-08T00:00:00Z" };
    const stored = { ...dead, json: { cannabinoids: [{ key: "thca", pct: 20 }], terpenes: [], totals: {} }, pdfError: null, status: "partial", summary: "partial", extractedAt: "2026-10-01T00:00:00Z" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = chooseTrusted(dead as any, stored as any, "2026-11-08T00:00:00Z");
    expect(out.status).toBe("ok");
    expect(trustMarkOf(out)?.originalStatus).toBe("partial");
  });
});

describe("D206 overnight job (site_settings lease + compare-and-set)", () => {
  it("start counts the target, refuses a second start, audits", async () => {
    seedLabs(9);
    const { startTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    const r = await startTrustAll("u1");
    expect(r).toEqual({ ok: true, target: 6 });
    expect(runOf()?.status).toBe("running");
    expect(state.audits.map((a) => a.action)).toContain("coa.trust_all_started");
    const again = await startTrustAll("u1");
    expect(again.ok).toBe(false);
  });

  it("an idle tick reads one row and writes nothing", async () => {
    const { tickTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    const r = await tickTrustAll({ reader: async () => ({ ok: 0, partial: 0, failed: 0, read: 0, errors: [] }) });
    expect(r.skipped).toBe("idle");
    expect(state.db.log.filter((q) => q.method !== "GET")).toHaveLength(0);
    expect(state.db.log).toHaveLength(1);
  });

  it("a tick reads only the rows that need it, moves the cursor, and finishes the run", async () => {
    seedLabs(9);
    const { startTrustAll, tickTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    await startTrustAll("u1");
    const seen: string[] = [];
    const r = await tickTrustAll({
      reader: async (ids) => {
        seen.push(...ids);
        return { ok: ids.length, partial: 0, failed: 0, read: ids.length, errors: [] };
      },
    });
    expect(r.ok).toBe(true);
    expect(r.done).toBe(true);
    // 6 need a read (ids 1,2,4,5,7,8); id 5 has no link, so 5 go to the reader.
    expect(seen).toEqual([id(1), id(2), id(4), id(7), id(8)]);
    const run = runOf()!;
    expect(run.status).toBe("done");
    expect(run.leaseToken).toBe("free");
    expect(run.totals).toMatchObject({ read: 5, trusted: 5, nothingToRead: 1, errors: 0 });
    expect(state.audits.map((a) => a.action)).toContain("coa.trust_all_done");
  });

  it("a live lease held by another tick is respected", async () => {
    seedLabs(3);
    const { startTrustAll, tickTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    await startTrustAll("u1");
    const s = settings().find((r) => r.key === "coa_trust_all_run")!;
    s.value_json = { ...(s.value_json as object), leaseToken: "other", leaseUntil: new Date(Date.now() + 60_000).toISOString() };
    let called = 0;
    const r = await tickTrustAll({ reader: async () => ((called += 1), { ok: 0, partial: 0, failed: 0, read: 0, errors: [] }) });
    expect(r.skipped).toBe("leased");
    expect(called).toBe(0);
  });

  it("Stop while a tick is reading: the tick's next save loses the compare-and-set and writes nothing", async () => {
    seedLabs(30, () => "failed");
    const { startTrustAll, stopTrustAll, tickTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    await startTrustAll("u1");
    const r = await tickTrustAll({
      reader: async (ids) => {
        await stopTrustAll("u1");
        return { ok: ids.length, partial: 0, failed: 0, read: ids.length, errors: [] };
      },
    });
    expect(r.skipped).toBe("lost_lease");
    const run = runOf()!;
    expect(run.status).toBe("stopped");
    expect((run.totals as { read: number }).read).toBe(0);
    expect(state.audits.map((a) => a.action)).toContain("coa.trust_all_stopped");
  });

  it("out of time: the cursor is saved, the lease freed, and the next tick carries on", async () => {
    seedLabs(20, () => "partial");
    const { startTrustAll, tickTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    await startTrustAll("u1");
    let clock = 1_000_000;
    const reader = async (ids: string[]) => {
      clock += 60_000;
      return { ok: ids.length, partial: 0, failed: 0, read: ids.length, errors: [] };
    };
    const first = await tickTrustAll({ reader, now: () => clock, tickMs: 200_000 });
    expect(first.done).toBe(false);
    const mid = runOf()!;
    expect(mid.leaseToken).toBe("free");
    expect(mid.cursor).toBeTruthy();
    const handledFirst = first.handled;
    expect(handledFirst).toBeGreaterThan(0);
    expect(handledFirst).toBeLessThan(20);
    let total = handledFirst;
    for (let k = 0; k < 10 && runOf()!.status === "running"; k++) {
      const t = await tickTrustAll({ reader, now: () => clock, tickMs: 200_000 });
      total += t.handled;
    }
    expect(runOf()!.status).toBe("done");
    expect(total).toBe(20);
    expect((runOf()!.totals as { trusted: number; nothingToRead: number }).trusted).toBe(19); // id 5 has no link
    expect((runOf()!.totals as { nothingToRead: number }).nothingToRead).toBe(1);
  });

  it("a reader that throws counts errors and keeps going", async () => {
    seedLabs(4, () => null);
    const { startTrustAll, tickTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
    await startTrustAll("u1");
    const r = await tickTrustAll({ reader: async () => Promise.reject(new Error("LlamaParse down")) });
    expect(r.done).toBe(true);
    const run = runOf()!;
    expect((run.totals as { errors: number }).errors).toBe(4);
    expect((run.recentErrors as string[])[0]).toContain("LlamaParse down");
  });
});

describe("D206 actions", () => {
  it("Start and Stop redirect back to the card", async () => {
    seedLabs(3);
    const { startTrustAllAction, stopTrustAllAction } = await import("@/app/admin/inventory/fix-later/actions");
    await expect(startTrustAllAction()).rejects.toThrow(/REDIRECT/);
    expect(state.redirects[0]).toMatch(/tr=ok.*#coa-trust-all$/);
    await expect(stopTrustAllAction()).rejects.toThrow(/REDIRECT/);
    expect(state.redirects[1]).toMatch(/tr=ok.*#coa-trust-all$/);
  });
});

describe("D206 wiring", () => {
  it("cron route + vercel.json (unique schedule, maxDuration 300)", () => {
    const route = src("src/app/api/cron/coa-trust-all/route.ts");
    expect(route).toContain("tickTrustAll()");
    expect(route).toContain("export const maxDuration = 300;");
    expect(route).toContain("shouldRefuseWhenSecretMissing");
    const v = JSON.parse(src("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const mine = v.crons.find((c) => c.path === "/api/cron/coa-trust-all");
    expect(mine?.schedule).toBe("1-59/5 * * * *");
    expect(v.crons.filter((c) => c.schedule === mine?.schedule)).toHaveLength(1);
  });

  it("the Fix-later page shows the card, the button, Stop and the progress line", () => {
    const page = src("src/app/admin/inventory/fix-later/page.tsx");
    expect(page).toContain('data-testid="coa-trust-all"');
    expect(page).toContain("Re-read every COA and trust it");
    expect(page).toContain("startTrustAllAction");
    expect(page).toContain("stopTrustAllAction");
    expect(page).toContain("readTrustPanel()");
  });

  it("the lot page re-read button and the overnight job both trust", () => {
    const ex = src("src/lib/inventory/coa-extract.ts");
    expect(ex).toMatch(/export async function trustReadLabs[\s\S]*trust: true/);
    expect(ex).toContain("chooseTrusted(");
    expect(ex).toContain("bestAnyLayout(");
  });
});
