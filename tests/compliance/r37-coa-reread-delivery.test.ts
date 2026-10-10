/**
 * R37 S4 - "Re-read lab certificates (LlamaParse)" at the top of Product
 * Onboarding (owner: "add a button that allows me to rerun llama parse on
 * the onboarding page to re read the COA's. I want this button at the top of
 * the page with the ai look up section").
 *
 * Pins the REAL rereadDeliveryCoasAction with its I/O mocked: permission,
 * forced LlamaParse read of the delivery, attach, restage, event, audit,
 * redirect params; a bad id or a throw is a banner, never a crash. And the
 * page renders the button inside the batch-lookup section.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAN = "cccccccc-3333-4333-8333-cccccccccccc";
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const net = vi.hoisted(() => ({
  calls: [] as string[],
  audits: [] as { action: string; entityId: string; after: Record<string, unknown> }[],
  events: [] as { type: string; note: string | null }[],
  run: { migrated: true, pending: 2, deferred: 0, read: 2, ok: 1, partial: 1, failed: 0, kbFilled: 0, errors: [] as string[] },
  labs: 2,
  throwRead: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => net.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    net.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    net.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after: Record<string, unknown> }) => {
    net.audits.push(a);
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/coa-extract", () => ({
  rereadCoasForManifest: async (id: string, actor: string, opts: { budgetMs?: number }) => {
    net.calls.push(`reread:${id}:${actor}:${opts.budgetMs}`);
    if (net.throwRead) throw new Error("boom");
    return { run: { ...net.run }, labs: net.labs };
  },
}));
vi.mock("@/lib/catalog/lab-facts-attach", () => ({
  attachLabFactsToManifestDrafts: async (id: string) => {
    net.calls.push(`attach:${id}`);
    return { drafts: 2, attached: 2, facts: 5, kept: 1, strainsUpdated: 0, unmigrated: false, errors: [] };
  },
}));
vi.mock("@/lib/inventory/intake-store", () => ({
  logManifestEvent: async (_id: string, type: string, note: string | null) => {
    net.events.push({ type, note });
  },
}));
vi.mock("@/lib/pos/intake-menu-staging", () => ({
  stageIntakeMenuVersionForManifest: async (id: string) => {
    net.calls.push(`restage:${id}`);
    return { staged: true, published: true, withheld: 0 };
  },
}));
vi.mock("@/lib/site/public-surfaces", () => ({ revalidatePublicMenuSurfaces: () => net.calls.push("public-surfaces") }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (): Promise<Response> => new Response(JSON.stringify(null), { status: 200, headers: { "content-type": "application/json" } });
  return { createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }) };
});

beforeEach(() => {
  net.calls.length = 0;
  net.audits.length = 0;
  net.events.length = 0;
  net.run = { migrated: true, pending: 2, deferred: 0, read: 2, ok: 1, partial: 1, failed: 0, kbFilled: 0, errors: [] };
  net.labs = 2;
  net.throwRead = false;
});

const press = async (id: string) => {
  const f = new FormData();
  f.set("return_manifest", MAN);
  const { rereadDeliveryCoasAction } = await import("@/app/admin/inventory/drafts/actions");
  await expect(rereadDeliveryCoasAction(id, f)).rejects.toThrow("NEXT_REDIRECT");
  const r = net.calls.filter((c) => c.startsWith("redirect:")).at(-1)!.slice("redirect:".length);
  return new URL("http://x" + r);
};

describe("R37 S4 rereadDeliveryCoasAction", () => {
  it("reads, attaches, restages, logs, audits, and redirects with the counts to the AI section", async () => {
    const u = await press(MAN);
    expect(net.calls[0]).toBe("perm:inventory.manage");
    expect(net.calls).toContain(`reread:${MAN}:u1:200000`);
    expect(net.calls).toContain(`attach:${MAN}`);
    expect(net.calls).toContain(`restage:${MAN}`);
    expect(net.events.some((e) => e.type === "coa_reread_all" && e.note?.includes("2 of 2"))).toBe(true);
    expect(net.audits).toHaveLength(1);
    expect(net.audits[0].action).toBe("intake_manifest.coa_reread_all");
    expect(net.audits[0].entityId).toBe(MAN);
    expect(net.audits[0].after.code).toBe("partial");
    expect(u.searchParams.get("manifest")).toBe(MAN);
    expect(u.searchParams.get("coa_all")).toBe("partial");
    expect(u.searchParams.get("coa_facts")).toBe("5");
    expect(u.searchParams.get("restaged")).toBe("1");
    expect(u.hash).toBe("#batch-lookup");
  });

  it("nothing read -> no attach, no restage, an error banner (never a fake success)", async () => {
    net.run = { ...net.run, read: 0, ok: 0, partial: 0 };
    const u = await press(MAN);
    expect(net.calls.some((c) => c.startsWith("attach:"))).toBe(false);
    expect(net.calls.some((c) => c.startsWith("restage:"))).toBe(false);
    expect(u.searchParams.get("coa_all")).toBe("error");
  });

  it("no labs on the delivery -> none", async () => {
    net.labs = 0;
    net.run = { ...net.run, read: 0, ok: 0, partial: 0, pending: 0 };
    expect((await press(MAN)).searchParams.get("coa_all")).toBe("none");
  });

  it("a throw is a banner, not a crash; a bad id reads nothing", async () => {
    net.throwRead = true;
    expect((await press(MAN)).searchParams.get("coa_all")).toBe("error");
    net.throwRead = false;
    net.calls.length = 0;
    const u = await press("not-a-uuid");
    expect(u.searchParams.get("coa_all")).toBe("error");
    expect(net.calls.some((c) => c.startsWith("reread:"))).toBe(false);
  });
});

describe("R37 S4 the page", () => {
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  it("renders the button inside the AI batch-lookup section, bound to the delivery", () => {
    const sec = page.slice(page.indexOf('id="batch-lookup"'), page.indexOf("{pinned && ("));
    expect(sec).toContain("rereadDeliveryCoasAction.bind(null, focus.manifestId)");
    expect(sec).toContain('data-testid="coa-reread-all-button"');
    expect(sec).toContain("{DELIVERY_COA_BUTTON}");
    expect(sec).toContain("deliveryCoaHelp(isLlamaParseConfigured())");
  });
  it("shows the outcome banner from the redirect", () => {
    expect(page).toContain("deliveryCoaBanner(sp as Record<string, unknown>)");
    expect(page).toContain('data-testid="coa-reread-all-result"');
  });
  it("the reader is forced and always asks LlamaParse, from drafts AND lots", () => {
    const src = read("src/lib/inventory/coa-extract.ts");
    const fn = src.slice(src.indexOf("export async function rereadCoasForManifest"));
    expect(fn).toContain('.from("catalog_product_drafts")');
    expect(fn).toContain('.from("inventory_lots")');
    expect(fn).toContain("force: true, actorId, alwaysLlama: true");
    expect(fn).not.toMatch(/\.limit\(\s*\d{4,}/);
  });
});
