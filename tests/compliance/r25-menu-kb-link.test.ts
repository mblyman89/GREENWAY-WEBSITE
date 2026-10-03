/**
 * tests/compliance/r25-menu-kb-link.test.ts  (R25 C)
 *
 * Owner (R25, verbatim): "Please work on the product menu item linked to its
 * knowledge base."
 *
 * menu_items.kb_product_id (0234) existed but no writer ever set it. Proven
 * here through the REAL menu-kb-link-server over the REAL postgrest-js client
 * against FakePostgrest:
 *   A. pure core floor (self-tests + the decisive rules re-asserted);
 *   B. insertMenuItemsWithKbLink: a linked card carries the id, an unlinked
 *      card carries NO kb_product_id key; a pre-0234 table is retried without
 *      the link (and only then); any other error is returned, never retried;
 *   C. planMenuKbLinksForCards: lot evidence (own key, then -onboarded variant
 *      lots), refused lots ignored, conflicts never stamped, prior links kept
 *      without a lot read, a failed lot read = no new links;
 *   D. runMenuKbLinkBackfill: fill-only, conflict skipped, other versions
 *      untouched, racing writer not overwritten, partial read / missing column
 *      / variant or lot read failure refuse with nothing written;
 *   E. wiring pins: the 3 writers, the owner action (permission + audit), the
 *      Products page button, the product page badge.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import { PostgrestClient } from "@supabase/postgrest-js";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  version: { id: "V1" } as { id: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => st.version }));

const server = await import("@/lib/catalog/menu-kb-link-server");
const core = await import("@/lib/catalog/menu-kb-link-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const KB1 = "11111111-1111-4111-8111-111111111111";
const KB2 = "22222222-2222-4222-8222-222222222222";
const KB3 = "33333333-3333-4333-8333-333333333333";

type Admin = Parameters<typeof server.insertMenuItemsWithKbLink>[0];
const client = () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Admin;

function lot(id: string, key: string, kb: string | null, over: Row = {}): Row {
  return { id, pos_product_key: key, kb_product_id: kb, status: "active", disposition: "accepted", ...over };
}
const PGRST204 = { code: "PGRST204", details: null, hint: null, message: "Could not find the 'kb_product_id' column of 'menu_items' in the schema cache" };

beforeEach(() => {
  st.db = new FakePostgrest();
  st.version = { id: "V1" };
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("A. pure core floor", () => {
  it("embedded self-tests all pass (39)", () => {
    const r = core.__runMenuKbLinkCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(39);
  });
  it("cleanKbProductId only accepts a uuid", () => {
    expect(core.cleanKbProductId(`  ${KB1.toUpperCase()} `)).toBe(KB1);
    expect(core.cleanKbProductId("not-a-uuid")).toBeNull();
    // Anchored both ends: junk before or after a uuid is not a uuid.
    expect(core.cleanKbProductId(`x${KB1}`)).toBeNull();
    expect(core.cleanKbProductId(`${KB1}x`)).toBeNull();
    expect(core.cleanKbProductId(42)).toBeNull();
    expect(core.cleanKbProductId("")).toBeNull();
  });
  it("first key with a promotable linked lot decides; refused lots never count; two ids = conflict", () => {
    const idx = core.indexLinkLots([
      lot("L1", "A", KB1),
      lot("L2", "B", KB2, { disposition: "rejected_at_dock" }),
      lot("L3", "C", KB2),
      lot("L4", "C", KB3),
      lot("L5", "D", KB2, { status: "destroyed" }),
    ] as never);
    expect(core.resolveCardKbLink(["A", "C"], idx)).toMatchObject({ kbProductId: KB1, reason: "linked", basisKey: "A", otherKbIds: 2 });
    expect(core.resolveCardKbLink(["B", "D"], idx)).toMatchObject({ kbProductId: null, reason: "no_linked_lot" });
    expect(core.resolveCardKbLink(["C"], idx)).toMatchObject({ kbProductId: null, reason: "conflict", basisKey: "C" });
    expect(core.resolveCardKbLink(["B", "A"], idx)).toMatchObject({ kbProductId: KB1, basisKey: "A" });
  });
  it("planMenuKbLink is fill-only: a prior link beats the lot evidence", () => {
    const lotSays = { kbProductId: KB2, reason: "linked" as const, basisKey: "A", otherKbIds: 0 };
    expect(core.planMenuKbLink(KB1, lotSays)).toEqual({ kbProductId: KB1, via: "prior" });
    expect(core.planMenuKbLink(null, lotSays)).toEqual({ kbProductId: KB2, via: "lot" });
    expect(core.planMenuKbLink("junk", { ...lotSays, reason: "conflict", kbProductId: null })).toEqual({ kbProductId: null, via: "none" });
  });
  it("withMenuKbLink adds the key only when there is a link (never an undefined/null key)", () => {
    const links = new Map([["S1", KB1]]);
    expect(core.withMenuKbLink({ a: 1 }, links, "S1")).toEqual({ a: 1, kb_product_id: KB1 });
    const none = core.withMenuKbLink({ a: 1 }, links, "S2");
    expect(none).toEqual({ a: 1 });
    expect(Object.prototype.hasOwnProperty.call(none, "kb_product_id")).toBe(false);
  });
  it("lot keys: own key + each -onboarded variant's lot, deduped", () => {
    expect(core.lotKeysForCards([
      { source_item_id: "P1", variantIds: ["LOTA-onboarded", "P1-1g", "LOTA-onboarded"] },
      { source_item_id: "LOTB", variantIds: ["LOTB-onboarded"] },
    ])).toEqual(["P1", "LOTA", "LOTB"]);
  });
  it("the backfill message names every bucket honestly", () => {
    expect(core.menuKbBackfillMessage({ stamped: 1, alreadyLinked: 2, noLink: 3, conflicts: 0, failed: 0 })).toBe(
      "Linked 1 menu card to their knowledge-base product; 2 already linked; 3 with no linked lot yet.",
    );
    const m = core.menuKbBackfillMessage({ stamped: 0, alreadyLinked: 0, noLink: 0, conflicts: 2, failed: 4 });
    expect(m).toContain("Linked 0 menu cards");
    expect(m).toContain("2 left unlinked because their lots point at different KB products");
    expect(m).toContain("4 could not be saved");
  });
});

describe("B. insertMenuItemsWithKbLink", () => {
  it("stamps the link on linked rows and leaves no key on the others", async () => {
    const r = await server.insertMenuItemsWithKbLink(client(), [
      { source_item_id: "S1", name: "One" },
      { source_item_id: "S2", name: "Two" },
    ], new Map([["S1", KB1]]));
    expect(r.error).toBeNull();
    expect(r.retriedWithoutLink).toBe(false);
    expect(r.data?.map((d) => d.source_item_id)).toEqual(["S1", "S2"]);
    const posts = st.db.log.filter((q) => q.method === "POST");
    expect(posts).toHaveLength(1);
    const body = posts[0].body as Row[];
    expect(body[0].kb_product_id).toBe(KB1);
    expect("kb_product_id" in body[1]).toBe(false);
    expect(st.db.rows("menu_items").map((x) => x.kb_product_id ?? null)).toEqual([KB1, null]);
  });

  it("pre-0234 (PGRST204 naming kb_product_id) retries ONCE without the link", async () => {
    st.db.before = (req) => {
      if (req.method === "POST" && (req.body as Row[]).some((x) => "kb_product_id" in x)) return { status: 400, body: PGRST204 };
    };
    const r = await server.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1", name: "One" }], new Map([["S1", KB1]]));
    expect(r.error).toBeNull();
    expect(r.retriedWithoutLink).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(2);
    expect(st.db.rows("menu_items")).toHaveLength(1);
    expect("kb_product_id" in st.db.rows("menu_items")[0]).toBe(false);
  });

  it("42703 'column ... does not exist' naming kb_product_id also retries", async () => {
    st.db.before = (req) => {
      if (req.method === "POST" && (req.body as Row[]).some((x) => "kb_product_id" in x))
        return { status: 400, body: { code: "42703", message: 'column "kb_product_id" of relation "menu_items" does not exist' } };
    };
    const r = await server.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1" }], new Map([["S1", KB1]]));
    expect(r.retriedWithoutLink).toBe(true);
    expect(r.error).toBeNull();
  });

  it("any other error is returned unchanged and never retried", async () => {
    st.db.before = (req) => (req.method === "POST" ? { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint" } } : undefined);
    const r = await server.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1" }], new Map([["S1", KB1]]));
    expect(r.error?.code).toBe("23505");
    expect(r.data).toBeNull();
    expect(r.retriedWithoutLink).toBe(false);
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(1);
  });

  it("a missing-column error on a batch with NO link is not retried (nothing to strip)", async () => {
    st.db.before = (req) => (req.method === "POST" ? { status: 400, body: PGRST204 } : undefined);
    const r = await server.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1" }], new Map());
    expect(r.retriedWithoutLink).toBe(false);
    expect(r.error?.code).toBe("PGRST204");
    expect(st.db.log.filter((q) => q.method === "POST")).toHaveLength(1);
  });

  it("a missing-column error naming ANOTHER column is not retried", async () => {
    st.db.before = (req) =>
      req.method === "POST" ? { status: 400, body: { code: "PGRST204", message: "Could not find the 'wobble' column of 'menu_items' in the schema cache" } } : undefined;
    const r = await server.insertMenuItemsWithKbLink(client(), [{ source_item_id: "S1" }], new Map([["S1", KB1]]));
    expect(r.retriedWithoutLink).toBe(false);
    expect(r.error?.code).toBe("PGRST204");
  });
});

describe("C. planMenuKbLinksForCards", () => {
  it("links from the card's own key, then an -onboarded variant lot; conflicts and refused lots never stamp", async () => {
    st.db.rows("inventory_lots").push(
      lot("L1", "P1", KB1),
      lot("L2", "LOTX", KB2),
      lot("L3", "P3", KB1),
      lot("L4", "P3", KB3),
      lot("L5", "P4", KB2, { disposition: "rejected_at_dock" }),
      lot("L6", "P5", null),
    );
    const plan = await server.planMenuKbLinksForCards(client(), [
      { source_item_id: "P1", variantIds: [] },
      { source_item_id: "P2", variantIds: ["LOTX-onboarded"] },
      { source_item_id: "P3", variantIds: [] },
      { source_item_id: "P4", variantIds: [] },
      { source_item_id: "P5", variantIds: [] },
    ]);
    expect(plan.lotReadFailed).toBe(false);
    expect([...plan.links.entries()]).toEqual([["P1", KB1], ["P2", KB2]]);
    expect(plan.summary).toEqual({ linked: 2, kept: 0, noLink: 2, conflicts: 1 });
  });

  it("a prior link is kept and does not even need a lot read", async () => {
    const plan = await server.planMenuKbLinksForCards(client(), [{ source_item_id: "P1", variantIds: [], prior: KB3 }]);
    expect([...plan.links.entries()]).toEqual([["P1", KB3]]);
    expect(plan.summary.kept).toBe(1);
    expect(st.db.log.filter((q) => q.table === "inventory_lots")).toHaveLength(0);
  });

  it("a failed lot read = no new links (priors survive), flagged", async () => {
    st.db.rows("inventory_lots").push(lot("L1", "P1", KB1));
    st.db.before = (req) => (req.table === "inventory_lots" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const plan = await server.planMenuKbLinksForCards(client(), [
      { source_item_id: "P1", variantIds: [] },
      { source_item_id: "P9", variantIds: [], prior: KB2 },
    ]);
    expect(plan.lotReadFailed).toBe(true);
    expect([...plan.links.entries()]).toEqual([["P9", KB2]]);
  });

  it("loadLinkLots reads only the asked keys and returns [] for none", async () => {
    st.db.rows("inventory_lots").push(lot("L1", "P1", KB1), lot("L2", "OTHER", KB2));
    expect(await server.loadLinkLots(client(), [])).toEqual([]);
    const got = await server.loadLinkLots(client(), ["P1"]);
    expect(got?.map((l) => l.id)).toEqual(["L1"]);
  });

  it("the writer log line reports the counts and a failed lot read", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    server.logMenuKbLinkPlan("t", { links: new Map(), summary: { linked: 1, kept: 2, noLink: 3, conflicts: 4 }, lotReadFailed: true });
    expect(String(spy.mock.calls.at(-1)?.[0])).toBe(
      "[t] menu kb link: linked 1, kept 2, no link 3, conflicts 4 (lot read failed: no new links this batch)",
    );
  });
});

describe("D. runMenuKbLinkBackfill", () => {
  function seedMenu() {
    st.db.rows("menu_items").push(
      { id: "M1", menu_version_id: "V1", source_item_id: "P1", kb_product_id: null },
      { id: "M2", menu_version_id: "V1", source_item_id: "P2", kb_product_id: KB3 },
      { id: "M3", menu_version_id: "V1", source_item_id: "P3", kb_product_id: null },
      { id: "M4", menu_version_id: "V1", source_item_id: "P4", kb_product_id: null },
      { id: "M5", menu_version_id: "V1", source_item_id: "P5", kb_product_id: null },
      { id: "M6", menu_version_id: "V0", source_item_id: "P1", kb_product_id: null },
    );
    st.db.rows("menu_variants").push(
      { id: "VA1", menu_item_id: "M5", source_variant_id: "LOTZ-onboarded" },
    );
    st.db.rows("inventory_lots").push(
      lot("L1", "P1", KB1),
      lot("L2", "P2", KB1),
      lot("L3", "P3", KB1),
      lot("L4", "P3", KB2),
      lot("L6", "LOTZ", KB2),
    );
  }

  it("fills blanks only, skips conflicts, never touches another version", async () => {
    seedMenu();
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r).toMatchObject({ ok: true, stamped: 2, alreadyLinked: 1, noLink: 1, conflicts: 1, failed: 0 });
    const by = Object.fromEntries(st.db.rows("menu_items").map((x) => [x.id, x.kb_product_id]));
    expect(by).toEqual({ M1: KB1, M2: KB3, M3: null, M4: null, M5: KB2, M6: null });
    if (r.ok) expect(r.message).toContain("Linked 2 menu cards");
  });

  it("is idempotent: a second run stamps nothing", async () => {
    seedMenu();
    await server.runMenuKbLinkBackfill(client());
    const before = st.db.log.length;
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r).toMatchObject({ ok: true, stamped: 0, alreadyLinked: 3 });
    expect(st.db.log.slice(before).filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("a racing writer's link is not overwritten (conditional is-null update)", async () => {
    seedMenu();
    st.db.before = (req) => {
      if (req.method === "PATCH") {
        const m1 = st.db.rows("menu_items").find((x) => x.id === "M1")!;
        m1.kb_product_id = KB3; // someone linked it first
      }
    };
    const r = await server.runMenuKbLinkBackfill(client());
    expect(st.db.rows("menu_items").find((x) => x.id === "M1")!.kb_product_id).toBe(KB3);
    expect(r).toMatchObject({ ok: true, failed: 0 });
    if (r.ok) expect(r.stamped).toBe(1); // only M5
  });

  it("a failed update chunk is counted as failed, not stamped", async () => {
    seedMenu();
    st.db.before = (req) => (req.method === "PATCH" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r).toMatchObject({ ok: true, stamped: 0, failed: 2 });
  });

  it("no published menu refuses", async () => {
    st.version = null;
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("No published menu");
  });

  it("pre-0234 (missing column on the menu read) refuses with the migration named, nothing written", async () => {
    seedMenu();
    st.db.before = (req) =>
      req.table === "menu_items" && req.method === "GET"
        ? { status: 400, body: { code: "42703", message: "column menu_items.kb_product_id does not exist" } }
        : undefined;
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("migration 0234");
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("a partial menu read refuses, nothing written", async () => {
    seedMenu();
    st.db.before = (req) =>
      req.table === "menu_items" && req.method === "GET" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined;
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Could not read the whole live menu");
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("a variant read failure refuses, nothing written", async () => {
    seedMenu();
    st.db.before = (req) => (req.table === "menu_variants" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r).toEqual({ ok: false, error: "Could not read the menu sizes. Nothing was changed; try again." });
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("a lot read failure refuses, nothing written", async () => {
    seedMenu();
    st.db.before = (req) => (req.table === "inventory_lots" ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined);
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r).toEqual({ ok: false, error: "Could not read the inventory lots. Nothing was changed; try again." });
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(0);
  });

  it("reads the menu in complete pages (more than one page of cards)", async () => {
    for (let i = 0; i < 1003; i++) {
      const n = String(i).padStart(5, "0");
      st.db.rows("menu_items").push({ id: `M${n}`, menu_version_id: "V1", source_item_id: `P${n}`, kb_product_id: null });
      st.db.rows("inventory_lots").push(lot(`L${n}`, `P${n}`, KB1));
    }
    const r = await server.runMenuKbLinkBackfill(client());
    expect(r).toMatchObject({ ok: true, stamped: 1003, failed: 0 });
    expect(st.db.rows("menu_items").every((x) => x.kb_product_id === KB1)).toBe(true);
    // 1003 ids in update chunks of 200 = 6 PATCHes.
    expect(st.db.log.filter((q) => q.method === "PATCH")).toHaveLength(6);
  });
});

describe("E. wiring pins", () => {
  const writers = ["src/lib/pos/intake-menu-staging.ts", "src/lib/pos/draft-injection.ts", "src/lib/pos/import-service.ts"];
  it.each(writers)("%s inserts menu_items only through insertMenuItemsWithKbLink", (f) => {
    const src = read(f);
    expect(src).toContain("planMenuKbLinksForCards(");
    expect(src).toContain("insertMenuItemsWithKbLink(admin, rows, kbPlan.links)");
    expect(src).not.toMatch(/from\("menu_items"\)\s*\.insert\(/);
  });
  it("the staging restage keeps the live cards' links (priorKbLinks)", () => {
    const src = read("src/lib/pos/intake-menu-staging.ts");
    expect(src).toContain("priorKbLinks = carry.priorKbLinks;");
    expect(src).toContain("prior: priorKbLinks.get(it.source_item_id) ?? null,");
  });
  it("the owner action is permission-gated and audited", () => {
    const src = read("src/app/admin/products/actions.ts");
    const body = src.slice(src.indexOf("export async function linkMenuCardsToKbAction"));
    const fn = body.slice(0, body.indexOf("\n}\n") + 3);
    expect(fn).toMatch(/^export async function linkMenuCardsToKbAction\(\): Promise<void> \{\n  const session = await requirePermission\("products\.enrich"\);/);
    expect(fn).toContain("runMenuKbLinkBackfill()");
    expect(fn).toContain("action: MENU_KB_LINK_BACKFILL_AUDIT_ACTION");
    expect(fn.indexOf("requirePermission")).toBeLessThan(fn.indexOf("runMenuKbLinkBackfill"));
    expect(core.MENU_KB_LINK_BACKFILL_AUDIT_ACTION).toBe("menu_items.kb_link_backfill");
  });
  it("the Products page has the button; the product page shows the badge", () => {
    const list = read("src/app/admin/products/page.tsx");
    expect(list).toContain("action={linkMenuCardsToKbAction}");
    expect(list).toContain('data-testid="link-menu-cards-kb"');
    expect(list).toContain("Link menu cards to the KB");
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain('data-testid="menu-card-kb-badge"');
    expect(page).toContain("Menu card linked: {center.menuCardKb.displayName}");
    const cc = read("src/lib/enrichment/command-center.ts");
    expect(cc).toContain('.select("kb_product_id")');
    expect(cc).toContain("menuCardKb: menuCardKbRow");
  });
  it("the pure runner registers the core with its exact count", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("menu-kb-link-core", __runMenuKbLinkCoreTests(), 39);');
  });
  it("the link column exists in migration 0234 (no new migration needed)", () => {
    const f = readdirSync(path.join(ROOT, "supabase/migrations")).find((n: string) => n.startsWith("0234"));
    expect(f).toBeTruthy();
    expect(read(`supabase/migrations/${f}`)).toMatch(/menu_items[\s\S]*kb_product_id/);
  });
});
