/**
 * tests/compliance/r50-a1-card-alias.test.tsx  (R50 A1)
 *
 * "Yes, same product - always join this card": the owner's one-click accept
 * of an S4 suggestion, remembered as a permanent decision (0270).
 *
 *   1. store (real postgrest-js against FakePostgrest): load / save / forget,
 *      a missing table = no aliases + migrated:false, any failed read = an
 *      EMPTY map (never a partial alias set).
 *   2. actions (behavioural): inventory.manage, the posted card is re-checked
 *      against what the server re-computes (never trusted), audit + manifest
 *      event only on a real save / delete, closed-set result codes.
 *   3. controls render: accept buttons only for a "New card" row with a
 *      suggestion; Forget only for a row joined BY an alias.
 *   4. wiring pins: staging and preview read aliases only for unmatched rows;
 *      the migration is additive, KEEP, RLS-on-no-policy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  svc: true,
  calls: [] as string[],
  audits: [] as Array<{ action: string; entityId: unknown; after: unknown }>,
  events: [] as Array<{ manifestId: string; kind: string; note: string }>,
  evidence: null as unknown,
  evidenceThrows: false,
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
    return { userId: "bbbbbbbb-0000-4000-8000-000000000001", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: unknown; after: unknown }) => {
    st.audits.push({ action: a.action, entityId: a.entityId, after: a.after });
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) };
});
vi.mock("@/lib/supabase/env", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    get isSupabaseServiceConfigured() {
      return st.svc;
    },
  };
});
vi.mock("@/lib/pos/card-alias-server", () => ({
  loadAcceptEvidence: async () => {
    st.calls.push("evidence");
    if (st.evidenceThrows) throw new Error("boom");
    return st.evidence;
  },
}));
vi.mock("@/lib/inventory/intake-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    logManifestEvent: async (manifestId: string, kind: string, note: string) => {
      st.events.push({ manifestId, kind, note });
    },
  };
});

const store = await import("@/lib/pos/card-alias-store");
const core = await import("@/lib/pos/card-alias-core");
const { CardAliasControls } = await import("@/components/admin/catalog/CardAliasControls");

const T = "intake_card_aliases";
const ID = "acme farms|flower|train wreck";
const M = "aaaaaaaa-0000-4000-8000-000000000001";
const D = "cccccccc-0000-4000-8000-000000000001";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.rows(T);
  st.svc = true;
  st.calls = [];
  st.audits = [];
  st.events = [];
  st.evidence = null;
  st.evidenceThrows = false;
});

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
function redirected(): string {
  return st.calls.find((c) => c.startsWith("redirect:")) ?? "";
}

describe("1. store", () => {
  it("save then load returns the alias; saving again replaces it (one row per identity)", async () => {
    expect((await store.saveCardAlias({ identity: ID, cardKey: "K1", cardName: "Trainwreck" }, null)).ok).toBe(true);
    expect((await store.saveCardAlias({ identity: ID, cardKey: "K2", cardName: "Train Wreck" }, null)).ok).toBe(true);
    expect(st.db.rows(T)).toHaveLength(1);
    expect(st.db.rows(T)[0]).toMatchObject({ identity: ID, card_key: "K2", card_name: "Train Wreck" });
    const m = await store.loadCardAliases([ID, "other|flower|x"]);
    expect([...m.entries()]).toEqual([[ID, "K2"]]);
  });
  it("load with no identities makes no request", async () => {
    expect((await store.loadCardAliases([" ", ""])).size).toBe(0);
    expect(st.db.log).toHaveLength(0);
  });
  it("a missing table reads as no aliases and a save says migrated:false (no error text)", async () => {
    st.db.missing.add(T);
    expect((await store.loadCardAliases([ID])).size).toBe(0);
    expect(await store.saveCardAlias({ identity: ID, cardKey: "K1", cardName: null }, null)).toEqual({ ok: false, migrated: false, error: undefined });
    const f = await store.forgetCardAlias(ID);
    expect(f).toMatchObject({ ok: false, migrated: false, deleted: false });
  });
  it("any failed read is an EMPTY map (never a partial set)", async () => {
    st.db.rows(T).push({ identity: ID, card_key: "K1" });
    st.db.before = (req) => (req.method === "GET" ? { status: 500, body: { code: "57014", message: "timeout" } } : undefined);
    expect((await store.loadCardAliases([ID])).size).toBe(0);
  });
  it("a LATER chunk failing still discards the aliases already read (never a partial set)", async () => {
    st.db.rows(T).push({ identity: ID, card_key: "K1" });
    const ids = [ID, ...Array.from({ length: 250 }, (_, i) => `v${i}|flower|x`)];
    let gets = 0;
    st.db.before = (req) => {
      if (req.method !== "GET") return undefined;
      gets += 1;
      return gets >= 2 ? { status: 500, body: { code: "57014", message: "timeout" } } : undefined;
    };
    expect((await store.loadCardAliases(ids)).size).toBe(0);
    expect(gets).toBeGreaterThanOrEqual(2);
    st.db.before = null;
    expect((await store.loadCardAliases(ids)).get(ID)).toBe("K1");
  });
  it("not configured: no aliases, and a save is a reported failure", async () => {
    st.svc = false;
    expect((await store.loadCardAliases([ID])).size).toBe(0);
    expect((await store.saveCardAlias({ identity: ID, cardKey: "K1", cardName: null }, null)).ok).toBe(false);
  });
  it("forget says whether a row was deleted and which card it named", async () => {
    st.db.rows(T).push({ identity: ID, card_key: "K9" });
    expect(await store.forgetCardAlias(ID)).toMatchObject({ ok: true, deleted: true, cardKey: "K9" });
    expect(st.db.rows(T)).toHaveLength(0);
    expect(await store.forgetCardAlias(ID)).toMatchObject({ ok: true, deleted: false, cardKey: null });
  });
});

describe("2. actions", () => {
  const good = { verdictKind: "new", identity: ID, suggested: [{ cardKey: "K1", cardName: "Trainwreck" }, { cardKey: "K2", cardName: "Train-Wreck" }] };

  it("accept: requires inventory.manage, saves the re-checked card, audits, logs the event, redirects saved", async () => {
    st.evidence = good;
    const { acceptCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(acceptCardAliasAction(fd({ draftId: D, manifestId: M, cardKey: "K2" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.calls[0]).toBe("perm:inventory.manage");
    expect(st.db.rows(T)[0]).toMatchObject({ identity: ID, card_key: "K2", card_name: "Train-Wreck", decided_by: "bbbbbbbb-0000-4000-8000-000000000001" });
    expect(st.audits).toEqual([{ action: "intake_card_alias.accept", entityId: ID, after: { manifestId: M, draftId: D, cardKey: "K2", cardName: "Train-Wreck" } }]);
    expect(st.events.map((e) => e.kind)).toEqual(["card_alias_saved"]);
    expect(redirected()).toContain("alias=saved");
    expect(redirected()).toContain(`manifest=${M}`);
    expect(redirected()).not.toContain("alias_msg");
  });
  it("accept: a card that is NOT suggested now is refused - nothing saved, no audit", async () => {
    st.evidence = good;
    const { acceptCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(acceptCardAliasAction(fd({ draftId: D, manifestId: M, cardKey: "K-EVIL" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.rows(T)).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
    expect(st.events).toHaveLength(0);
    expect(redirected()).toContain("alias=error");
    expect(decodeURIComponent(redirected().replace(/\+/g, " "))).toContain("no longer suggested");
  });
  it("accept: a row that already joins (or matches 2+) is refused", async () => {
    st.evidence = { ...good, verdictKind: "joins" };
    const { acceptCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(acceptCardAliasAction(fd({ draftId: D, manifestId: M, cardKey: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.rows(T)).toHaveLength(0);
    expect(redirected()).toContain("alias=error");
  });
  it("accept: unreadable preview (null) or a throw saves nothing", async () => {
    const { acceptCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    st.evidence = null;
    await expect(acceptCardAliasAction(fd({ draftId: D, manifestId: M, cardKey: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected()).toContain("alias=error");
    st.calls = [];
    st.evidenceThrows = true;
    await expect(acceptCardAliasAction(fd({ draftId: D, manifestId: M, cardKey: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected()).toContain("alias=error");
    expect(st.db.rows(T)).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
  });
  it("accept: a bad form never reads evidence", async () => {
    const { acceptCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(acceptCardAliasAction(fd({ draftId: "nope", manifestId: M, cardKey: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.calls).not.toContain("evidence");
    expect(redirected()).toContain("alias=error");
  });
  it("accept: table missing -> alias=migration, no audit", async () => {
    st.evidence = good;
    st.db.missing.add(T);
    const { acceptCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(acceptCardAliasAction(fd({ draftId: D, manifestId: M, cardKey: "K1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected()).toContain("alias=migration");
    expect(st.audits).toHaveLength(0);
  });
  it("forget: deletes, audits and logs once; forgetting again is quiet (no audit)", async () => {
    st.db.rows(T).push({ identity: ID, card_key: "K1" });
    const { forgetCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(forgetCardAliasAction(fd({ identity: ID, manifestId: M, draftId: D }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.calls[0]).toBe("perm:inventory.manage");
    expect(st.db.rows(T)).toHaveLength(0);
    expect(st.audits).toEqual([{ action: "intake_card_alias.forget", entityId: ID, after: { manifestId: M, cardKey: "K1" } }]);
    expect(st.events.map((e) => e.kind)).toEqual(["card_alias_forgotten"]);
    expect(redirected()).toContain("alias=forgotten");
    st.calls = [];
    await expect(forgetCardAliasAction(fd({ identity: ID, manifestId: M, draftId: D }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected()).toContain("alias=forgotten");
    expect(st.audits).toHaveLength(1);
  });
  it("forget: a malformed identity is refused before any write", async () => {
    const { forgetCardAliasAction } = await import("@/app/admin/inventory/drafts/actions");
    await expect(forgetCardAliasAction(fd({ identity: "not-an-identity", manifestId: M }))).rejects.toThrow("NEXT_REDIRECT");
    expect(st.db.log).toHaveLength(0);
    expect(redirected()).toContain("alias=error");
  });
});

describe("3. controls render", () => {
  const noop = async () => {};
  const card = (k: string, n: string) => ({ cardKey: k, cardName: n, score: 0.95, how: "reordered" as const, vendorLink: "same" as never, sizeMatch: null, evidence: [] });
  const suggestion = { best: card("K1", "Trainwreck"), others: [card("K2", "Train-Wreck")] };
  const html = (p: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(CardAliasControls, { draftId: D, manifestId: M, acceptAction: noop, forgetAction: noop, identity: ID, suggestion: null, verdict: null, ...p } as never));

  it("New card + suggestion: one accept form per suggested card, best first", () => {
    const h = html({ verdict: { kind: "new" }, suggestion });
    expect(h).toContain('data-testid="card-alias-accept"');
    expect((h.match(/<form/g) ?? []).length).toBe(2);
    expect(h).toContain('name="cardKey" value="K1"');
    expect(h).toContain('name="cardKey" value="K2"');
    expect(h.indexOf("K1")).toBeLessThan(h.indexOf("K2"));
    expect(h).toContain("Yes, same product");
    expect(h).toContain("Yes, it is &#x27;Train-Wreck&#x27;");
    expect(h).toContain(`name="manifestId" value="${M}"`);
  });
  it("no suggestion, no manifest, or a joins row WITHOUT alias renders nothing", () => {
    expect(html({ verdict: { kind: "new" } })).toBe("");
    expect(html({ verdict: { kind: "new" }, suggestion, manifestId: null })).toBe("");
    expect(html({ verdict: { kind: "joins", byAlias: false }, suggestion })).toBe("");
    expect(html({ verdict: { kind: "ambiguous" }, suggestion })).toBe("");
  });
  it("joins BY alias: a Forget form carrying the identity", () => {
    const h = html({ verdict: { kind: "joins", byAlias: true } });
    expect(h).toContain('data-testid="card-alias-forget"');
    expect(h).toContain(core.FORGET_BUTTON_LABEL);
    expect(h).toContain(`name="identity" value="${ID}"`);
    expect(html({ verdict: { kind: "joins", byAlias: true }, identity: null })).toBe("");
  });
});

describe("3b. chip copy", () => {
  it("a joins-by-alias verdict says so (copy + detail); without byAlias the S19 copy is unchanged", async () => {
    const { restockChipCopy, restockChipDetail } = await import("@/lib/inventory/vendor-identity-core");
    const base = { kind: "joins" as const, cardKey: "cv-1", cardName: "Trainwreck", fromCultivera: true, matchedBy: "name" as const, vendorRecordDiffers: false };
    expect(restockChipCopy({ ...base, byAlias: true })).toBe("Restock \u2192 joins live card 'Trainwreck' (you said it is this product)");
    expect(restockChipCopy(base)).toBe("Restock \u2192 joins live card 'Trainwreck' (from Cultivera import)");
    expect(restockChipDetail({ ...base, byAlias: true })).toContain("because you said this product is that card");
    expect(restockChipDetail({ ...base, byAlias: true })).toContain("Forget");
    expect(restockChipDetail(base)).not.toContain("you said");
  });
});

describe("4. wiring pins", () => {
  it("self-tests pass with an exact count", () => {
    expect(core.__runCardAliasCoreTests()).toEqual({ passed: 44, failed: 0 });
  });
  it("staging reads aliases only for unmatched rows and never in refresh mode", () => {
    const src = read("src/lib/pos/intake-menu-staging.ts");
    expect(src).toContain("const unmatchedIdentities = refreshMode ? [] : firstPlan.unmatchedIdentities;");
    expect(src).toContain("unmatchedIdentities.length > 0 ? loadCardAliases(unmatchedIdentities) : Promise.resolve(new Map<string, string>())");
  });
  it("the preview re-runs with aliases only for 'new' groups", () => {
    const src = read("src/lib/inventory/restock-preview-server.ts");
    expect(src).toContain("loadCardAliases");
    expect(src).toMatch(/kind === "new"/);
  });
  it("the page renders the controls and the banner from the closed set", () => {
    const src = read("src/app/admin/inventory/drafts/page.tsx");
    expect(src).toContain("<CardAliasControls");
    expect(src).toContain("acceptAction={acceptCardAliasAction}");
    expect(src).toContain("forgetAction={forgetCardAliasAction}");
    expect(src).toContain("aliasResultCode(");
  });
  it("migration 0270: additive, RLS on with no policy, constraints, rollback exists", () => {
    const sql = read("supabase/migrations/0270_intake_card_aliases.sql");
    expect(sql).toContain("create table if not exists public.intake_card_aliases");
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("intake_card_aliases_identity_three_parts");
    expect(sql).toContain("on delete set null");
    expect(sql).not.toMatch(/references public\.menu_/);
    expect(read("supabase/rollbacks/0270_intake_card_aliases.rollback.sql")).toMatch(/drop table if exists public\.intake_card_aliases/);
  });
  it("factory reset KEEPs the table", () => {
    const src = read("src/lib/accounting/factory-reset-core.ts");
    expect(src).toMatch(/"intake_card_aliases"/);
  });
});
