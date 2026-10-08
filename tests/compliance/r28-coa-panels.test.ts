/**
 * tests/compliance/r28-coa-panels.test.ts
 *
 * R28 - the lot page and the KB product page: the Lab certificate panel and
 * the Product facts panel, and the two actions behind them.
 *
 *   1. rereadLotCoaAction: the permission, the code the banner shows (taken
 *      from the REAL coaRereadCode), the re-stage only after a read, the
 *      audit row, every page revalidated, the redirect back to the panel; a
 *      throw is "error" and never a crash; a failed re-stage is audited.
 *   2. resolveIntakeFactReview return_to: a lot / KB page by id gets the
 *      owner back THERE (#product-facts) - with the result - and revalidates
 *      it; anything else (another admin page, a full URL, //host, a query)
 *      falls back to Product Onboarding exactly as before.
 *   3. the panels RENDERED from the real owner certificates (item 12 read
 *      and cross-checked; item 13 held at 110 mg; item 01 partly read; an
 *      identity failure shows nothing as a fact; unread / no lab / 0252
 *      missing); the Product facts section (form posts return_to, read-only
 *      for a role without inventory.manage, the reason when no draft).
 *   4. source pins: the lot page, the KB product page and the KB list link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { r28MakeExtract } from "../../scripts/r28/coa-fixture-extract";
import { OWNER_FACTS_SIGNATURE } from "@/lib/pos/intake-fact-review-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const FXDIR = join(ROOT, "tests", "fixtures", "coa");
const stems: Record<string, string> = {};
for (const f of readdirSync(FXDIR)) {
  const m = f.match(/^(item\d\d\.(?:unpdf|layout|wcia)|transfer)\.(?:txt|json)$/);
  if (m) stems[m[1]] = readFileSync(join(FXDIR, f), "utf8");
}
const makeExtract = r28MakeExtract(stems);
const items = (JSON.parse(stems["transfer"]) as {
  inventory_transfer_items: { product_name: string; inventory_type: string; lab_result_data: { potency?: { type: string; value: number }[] } }[];
}).inventory_transfer_items;
const pot = (i: number, t: string) => items[i].lab_result_data.potency?.find((p) => p.type === t)?.value ?? null;
const stored = (i: number, t: "unpdf" | "layout" = "unpdf") => JSON.parse(JSON.stringify(makeExtract(i, t)));

const LOT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const KB = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const MAN = "cccccccc-3333-4333-8333-cccccccccccc";
const DRAFT = "dddddddd-4444-4444-8444-dddddddddddd";

type Run = { migrated: boolean; pending: number; read: number; ok: number; partial: number; failed: number; deferred: number; kbFilled: number; errors: string[]; manifestId: string | null };
const net = vi.hoisted(() => ({
  calls: [] as string[],
  run: null as null | (() => Promise<unknown>),
  stage: null as null | (() => Promise<unknown>),
  saveApplied: true,
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
  recordAudit: async (a: { action: string; entityId: string; after: unknown }) =>
    net.calls.push(`audit:${a.action}:${a.entityId}:${JSON.stringify(a.after)}`),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/coa-extract", () => ({
  extractCoaForLot: async (lotId: string, actor: string) => {
    net.calls.push(`extract:${lotId}:${actor}`);
    return net.run!();
  },
}));
vi.mock("@/lib/pos/intake-menu-staging", () => ({
  stageIntakeMenuVersionForManifest: async (m: string, actor: string) => {
    net.calls.push(`stage:${m}:${actor}`);
    return net.stage!();
  },
}));
vi.mock("@/lib/pos/fact-review-store", () => ({
  recordIntakeFactReview: async () => {
    net.calls.push("save-facts");
    return { applied: net.saveApplied };
  },
  mirrorIntakeFixToLive: async () => ({ errors: [] }),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (): Promise<Response> =>
    new Response(JSON.stringify(null), { status: 200, headers: { "content-type": "application/json" } });
  return { createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }) };
});

beforeEach(() => {
  net.calls.length = 0;
  net.run = null;
  net.stage = null;
  net.saveApplied = true;
});

const run = (r: Partial<Run>): Run => ({ migrated: true, pending: 1, read: 1, ok: 1, partial: 0, failed: 0, deferred: 0, kbFilled: 0, errors: [], manifestId: MAN, ...r });
const redirects = () => net.calls.filter((c) => c.startsWith("redirect:")).map((c) => c.slice("redirect:".length));
const audits = () => net.calls.filter((c) => c.startsWith("audit:"));

// === 1. rereadLotCoaAction ====================================================
describe("R28 rereadLotCoaAction (the lot page button)", () => {
  const press = async () => {
    const { rereadLotCoaAction } = await import("@/app/admin/inventory/actions");
    await expect(rereadLotCoaAction(LOT)).rejects.toThrow("NEXT_REDIRECT");
  };

  it("inventory.manage first; a good read re-stages the delivery, audits, revalidates and lands on the panel", async () => {
    net.run = async () => run({ kbFilled: 1 });
    net.stage = async () => ({ staged: true, published: true, withheld: 0 });
    await press();
    expect(net.calls[0]).toBe("perm:inventory.manage");
    expect(net.calls).toContain(`extract:${LOT}:u1`);
    expect(net.calls).toContain(`stage:${MAN}:u1`);
    expect(net.calls.indexOf(`stage:${MAN}:u1`)).toBeGreaterThan(net.calls.indexOf(`extract:${LOT}:u1`));
    const a = audits();
    expect(a).toHaveLength(1);
    expect(a[0].startsWith(`audit:inventory_lot.coa_reread:${LOT}:`)).toBe(true);
    const after = JSON.parse(a[0].slice(`audit:inventory_lot.coa_reread:${LOT}:`.length));
    expect(after).toMatchObject({ code: "ok", read: 1, ok: 1, kbFilled: 1, restage: { staged: true, published: true, reason: null, withheld: 0 } });
    for (const p of [`/admin/inventory/${LOT}`, "/admin/inventory/drafts", "/admin/knowledge-base/products"]) expect(net.calls).toContain(`revalidate:${p}`);
    expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=ok&restaged=1#lab-certificate`]);
  });

  it("nothing read -> NO re-stage (nothing new to build with); the cautious code wins", async () => {
    for (const [r, code] of [
      [run({ read: 0, ok: 0, pending: 0, errors: ["this lot has no lab result"] }), "nolab"],
      [run({ migrated: false, read: 0, ok: 0 }), "unmigrated"],
      [run({ read: 0, ok: 0, errors: ["fetch failed"] }), "error"],
    ] as const) {
      net.calls.length = 0;
      net.run = async () => r;
      net.stage = async () => {
        throw new Error("must not be called");
      };
      await press();
      expect(net.calls.some((c) => c.startsWith("stage:"))).toBe(false);
      expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=${code}#lab-certificate`]);
    }
  });

  it("a partial / failed read still re-stages; restaged=1 only when a version was actually staged", async () => {
    net.run = async () => run({ ok: 0, partial: 1 });
    net.stage = async () => ({ staged: false, published: false, reason: "no-changes" });
    await press();
    expect(net.calls).toContain(`stage:${MAN}:u1`);
    expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=partial#lab-certificate`]);
    net.calls.length = 0;
    net.run = async () => run({ ok: 0, failed: 1 });
    net.stage = async () => ({ staged: true, published: false, reason: "held-for-fact-review", withheld: 1 });
    await press();
    expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=failed&restaged=1#lab-certificate`]);
  });

  it("a lot with no delivery is read but never re-staged", async () => {
    net.run = async () => run({ manifestId: null });
    await press();
    expect(net.calls.some((c) => c.startsWith("stage:"))).toBe(false);
    expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=ok#lab-certificate`]);
  });

  it("a failed re-stage is audited with its message and the read still reports", async () => {
    net.run = async () => run({});
    net.stage = async () => {
      throw new Error("stage boom");
    };
    await press();
    expect(audits()[0]).toContain('"restage":{"error":"stage boom"}');
    expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=ok#lab-certificate`]);
  });

  it("the read itself throwing -> 'error', no audit claims a read, still revalidates and redirects", async () => {
    net.run = async () => {
      throw new Error("db down");
    };
    await press();
    expect(audits()).toHaveLength(0);
    expect(net.calls).toContain(`revalidate:/admin/inventory/${LOT}`);
    expect(redirects()).toEqual([`/admin/inventory/${LOT}?coa=error#lab-certificate`]);
  });
});

// === 2. resolveIntakeFactReview return_to ===================================
describe("R28 Product facts save returns to the lot / KB page", () => {
  const form = (extra: Record<string, string>) => {
    const f = new FormData();
    const base: Record<string, string> = { manifestId: MAN, draftId: DRAFT, sourceItemId: "KEY-1", flagSignature: OWNER_FACTS_SIGNATURE, action: "fix", note: "", packageThcMg: "55", servingsPerPack: "10", ...extra };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    return f;
  };
  const save = async (extra: Record<string, string>) => {
    net.stage = async () => ({ staged: true, published: true, withheld: 0 });
    const { resolveIntakeFactReview } = await import("@/app/admin/inventory/drafts/actions");
    await expect(resolveIntakeFactReview(form(extra))).rejects.toThrow("NEXT_REDIRECT");
    return redirects().at(-1)!;
  };

  it("from the lot page -> back to the lot's Product facts with the result, and the lot is revalidated", async () => {
    const to = await save({ return_to: `/admin/inventory/${LOT}` });
    expect(net.calls[0]).toBe("perm:inventory.manage");
    expect(net.calls).toContain("save-facts");
    expect(to).toBe(`/admin/inventory/${LOT}?fact=published#product-facts`);
    expect(net.calls).toContain(`revalidate:/admin/inventory/${LOT}`);
    expect(net.calls).toContain("revalidate:/admin/inventory/drafts");
  });

  it("from the KB product page -> back there (surrounding whitespace trimmed, case of the id kept)", async () => {
    const to = await save({ return_to: `  /admin/knowledge-base/products/${KB.toUpperCase()}  ` });
    expect(to).toBe(`/admin/knowledge-base/products/${KB.toUpperCase()}?fact=published#product-facts`);
  });

  it("a bad form returns to the same page with the error message", async () => {
    const { resolveIntakeFactReview } = await import("@/app/admin/inventory/drafts/actions");
    await expect(resolveIntakeFactReview(form({ return_to: `/admin/inventory/${LOT}`, packageThcMg: "-3" }))).rejects.toThrow("NEXT_REDIRECT");
    const u = new URL("http://x" + redirects().at(-1)!);
    expect(u.pathname).toBe(`/admin/inventory/${LOT}`);
    expect(u.searchParams.get("fact")).toBe("error");
    expect(u.searchParams.get("fact_msg")).toContain("not a valid number");
    expect(u.hash).toBe("#product-facts");
    expect(net.calls).not.toContain("save-facts");
  });

  it("0237 missing -> 'migration' back on the lot page", async () => {
    net.saveApplied = false;
    expect(await save({ return_to: `/admin/inventory/${LOT}` })).toBe(`/admin/inventory/${LOT}?fact=migration#product-facts`);
  });

  it("anything that is not a lot / KB page by id falls back to Product Onboarding (never an open redirect)", async () => {
    for (const bad of [
      "https://evil.example/admin/inventory/" + LOT,
      "//evil.example/x",
      `/admin/inventory/${LOT}?x=1`,
      `/admin/inventory/${LOT}/edit`,
      "/admin/settings",
      "/admin/inventory/drafts",
      "/admin/inventory/not-a-uuid",
      `/admin/knowledge-base/products/${KB}#x`,
      "",
    ]) {
      net.calls.length = 0;
      const to = await save({ return_to: bad });
      expect(to.startsWith("/admin/inventory/drafts"), `${bad} -> ${to}`).toBe(true);
      expect(net.calls.filter((c) => c.startsWith("revalidate:") && c !== "revalidate:/admin/inventory/drafts" && c !== "revalidate:/admin/publish")).toEqual([]);
    }
  });
});

// === 3. The panels, rendered ================================================
describe("R28 Lab certificate + Product facts panels (rendered from the real certificates)", () => {
  const render = async (lab: Record<string, unknown> | null, i: number, opts: { migrated?: boolean; reread?: boolean } = {}) => {
    const { LabCertificatePanel } = await import("@/components/admin/inventory/LabCertificatePanels");
    const { labCertificateView, coaFactsView } = await import("@/lib/inventory/coa-panel-core");
    const view = labCertificateView(lab as never, { migrated: opts.migrated ?? true });
    const facts = coaFactsView(lab as never, { name: items[i].product_name, inventoryType: items[i].inventory_type });
    return renderToStaticMarkup(createElement(LabCertificatePanel, { view, facts, rereadAction: opts.reread ? async () => undefined : undefined }));
  };
  const lab = (i: number, t: "unpdf" | "layout" = "unpdf") => ({ coa_extract_json: stored(i, t), total_thc_pct: pot(i, "total-thc"), total_cbd_pct: pot(i, "total-cbd"), cbd_pct: null, coa_url: "x", wcia_json_url: "y" });

  it("item 12 (bytes Sour Mandarin): read and cross-checked, every cannabinoid, terpenes, the facts it gives, not held", async () => {
    const html = await render(lab(12), 12, { reread: true });
    expect(html).toContain('id="lab-certificate"');
    expect(html).toContain('data-testid="lab-cert-read"');
    expect(html).toContain("Read and cross-checked");
    expect(html).toContain('data-testid="lab-cert-cannabinoids"');
    expect(html).toContain("Re-read lab certificate");
    expect(html).toContain("serving 4.54 g");
    expect(html).toContain('data-testid="coa-facts"');
    expect(html).not.toContain('data-testid="coa-facts-held"');
    expect(html).not.toContain('data-testid="lab-cert-identity"');
    expect(html).toMatch(/THC per package[\s\S]*?55 mg/);
    expect(html).toMatch(/Servings per pack[\s\S]*?10/);
    expect(html).toMatch(/CBD per package[\s\S]*?100 mg/);
    expect(html).toContain("all agree");
  });

  it("item 13 (110 mg package): the facts are shown AND held with the WA 100 mg reason", async () => {
    const html = await render(lab(13), 13);
    expect(html).toContain('data-testid="coa-facts-held"');
    expect(html).toContain("100 mg");
    expect(html).not.toContain("Re-read lab certificate"); // no action passed (the KB page)
  });

  it("item 01 (GGL text layer): partly read, never shown as cross-checked", async () => {
    const html = await render(lab(1), 1);
    expect(html).toContain("Partly read");
    expect(html).not.toContain("Read and cross-checked");
  });

  it("identity failure: the checks show it and NOTHING is used as a fact", async () => {
    const ex = stored(12);
    ex.identity = [{ what: "sample id", ok: false, detail: "PDF sample X is not JSON sample Y" }];
    const html = await render({ ...lab(12), coa_extract_json: ex }, 12);
    expect(html).toContain('data-testid="lab-cert-identity"');
    expect(html).toContain("Nothing from them is used");
    expect(html).not.toContain('data-testid="lab-cert-cannabinoids"');
    expect(html).not.toMatch(/THC per package[\s\S]*?55 mg/);
  });

  it("unread, no lab and 0252 missing each say why; no lab offers no re-read", async () => {
    const unread = await render({ coa_extract_json: null, coa_url: "x", wcia_json_url: null }, 12, { reread: true });
    expect(unread).toContain('data-testid="lab-cert-unread"');
    expect(unread).toContain("not been read yet");
    expect(unread).toContain("Re-read lab certificate");
    const nolink = await render({ coa_extract_json: null, coa_url: null, wcia_json_url: null }, 12);
    expect(nolink).toContain("carries no certificate link");
    const none = await render(null, 12, { reread: true });
    expect(none).toContain('data-testid="lab-cert-none"');
    expect(none).not.toContain("Re-read lab certificate");
    const unmig = await render({ coa_url: "x" }, 12, { migrated: false });
    expect(unmig).toContain("missing migration 0252");
  });

  const ctx = (o: Record<string, unknown> = {}) => ({
    draft: { id: DRAFT, manifest_id: MAN, pos_product_key: "KEY-1", status: "approved", updated_at: "2026-01-01" },
    saved: null,
    readOk: true,
    migrated: true,
    reason: null,
    ...o,
  });
  const section = async (o: Record<string, unknown>, canEdit = true) => {
    const { ProductFactsSection } = await import("@/components/admin/inventory/LabCertificatePanels");
    return renderToStaticMarkup(
      createElement(ProductFactsSection, {
        lotFacts: [{ label: "THC per package", value: "55 mg", source: "lab certificate" }],
        ctx: ctx(o) as never,
        returnTo: `/admin/knowledge-base/products/${KB}`,
        lotHref: { href: `/admin/inventory/${LOT}`, label: "LOT-1" },
        canEdit,
      }),
    );
  };

  it("the Product facts form posts return_to and the owner signature; the lot facts show where each came from", async () => {
    const html = await section({});
    expect(html).toContain('id="product-facts"');
    expect(html).toContain('data-testid="lot-fact-rows"');
    expect(html).toContain("(lab certificate)");
    expect(html).toContain(`name="return_to" value="/admin/knowledge-base/products/${KB}"`);
    expect(html).toContain(`name="flagSignature" value="${OWNER_FACTS_SIGNATURE}"`);
    expect(html).toContain(`name="draftId" value="${DRAFT}"`);
    expect(html).toContain(`href="/admin/inventory/${LOT}"`);
  });

  it("a role without inventory.manage sees the facts but no form; a reason or 0237 missing replaces the form", async () => {
    const ro = await section({}, false);
    expect(ro).toContain('data-testid="product-facts-readonly"');
    expect(ro).not.toContain("<form");
    const why = await section({ draft: null, reason: "This lot came from the Cultivera import." });
    expect(why).toContain('data-testid="product-facts-reason"');
    expect(why).toContain("Cultivera import");
    expect(why).not.toContain("<form");
    const mig = await section({ migrated: false });
    expect(mig).toContain("migration 0237");
    expect(mig).not.toContain("<form");
  });
});

// === 4. Page wiring ==========================================================
describe("R28 page wiring (source pins)", () => {
  it("the lot page renders both panels, the re-read only with a lab, and has the time budget", () => {
    const p = read("src/app/admin/inventory/[id]/page.tsx");
    expect(p).toContain("export const maxDuration = 300");
    expect(p).toContain("<LabCertificatePanel");
    expect(p).toContain("<ProductFactsSection");
    expect(p).toContain("rereadLotCoaAction");
    expect(p).toContain("coaRereadBanner(");
    expect(p).toContain("factSaveBanner(");
    expect(p).toContain("loadLotFactsContext(");
  });

  it("the KB product page: products.enrich gate, uuid or 404, lots by id/key (never by name), canEdit by inventory.manage", () => {
    const p = read("src/app/admin/knowledge-base/products/[id]/page.tsx");
    expect(p).toContain('requirePermission("products.enrich")');
    expect(p).toContain("isUuid(");
    expect(p).toContain("notFound()");
    expect(p).toContain("loadKbProductPage(");
    expect(p).toContain('can(');
    expect(p).toContain('"inventory.manage"');
    expect(p).not.toContain("rereadAction=");
    const s = read("src/lib/inventory/coa-panel-server.ts");
    expect(s).toContain('.eq("kb_product_id"');
    expect(s).not.toMatch(/ilike|display_name.*eq\(/);
  });

  it("the KB list links every product to its page", () => {
    const v = read("src/app/admin/knowledge-base/products/KbProductsViewer.tsx");
    expect(v).toContain("/admin/knowledge-base/products/${p.id}");
    expect(v).toContain('data-testid="kb-product-link"');
  });
});
