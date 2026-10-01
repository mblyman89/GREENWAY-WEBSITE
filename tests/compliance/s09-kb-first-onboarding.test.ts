/**
 * SLICE S09 -- KB-first at onboarding: recall before you ask Gemini.
 *
 * Bible S09.5 tests, proven end to end with a mocked provider (no network):
 *   1. recall returns null for '' identity (pure core + server recall).
 *   2. Gemini is NOT called when memory is complete (mock provider asserts
 *      zero calls) - and the answer still goes through the compliance gate.
 *   3. Partial memory: the prompt carries the "already on file" block, placed
 *      between the S06 user prompt and the shape hint.
 *   4. Nothing covered / flag off / refresh: the prompt is BYTE-IDENTICAL to
 *      S06 (same string the S06 suite pins).
 *   5. "Refresh from web" always calls Gemini, even with a complete memory.
 *   6. KB_FIRST_ONBOARDING=off: recall is not even attempted.
 *   7. The audit carries field names + flags only (never values).
 *   8. Wiring: panel sends refresh=1 and shows the notice; the page renders
 *      the chip from ONE batched recall in the existing Promise.all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("server-only", () => ({}));

const ws = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reply: {} as Record<string, unknown>,
}));
vi.mock("@/lib/ai/provider", () => ({
  isAiConfigured: true,
  aiWebSearchModelId: "gemini-test",
  AiLookupError: class AiLookupError extends Error {
    friendly = "x";
  },
  generateWebSearch: vi.fn(async (opts: Record<string, unknown>) => {
    ws.calls.push(opts);
    return ws.reply;
  }),
}));

const act = vi.hoisted(() => ({
  audits: [] as Array<Record<string, unknown>>,
  banned: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "owner@example.com" }),
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: Record<string, unknown>) => {
    act.audits.push(a);
  },
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => act.banned }));
vi.mock("@/lib/ai/kb/store", () => ({ upsertKbStrain: async () => ({}) }));
vi.mock("@/lib/ai/suggestions", () => ({ listSuggestions: async () => [], persistSuggestion: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The recall itself is mocked here (its server side has its own suite:
// s09-fact-memory-server.test.ts). `recall.calls` proves when it is asked.
const recall = vi.hoisted(() => ({
  calls: [] as string[],
  memory: null as unknown,
}));
vi.mock("@/lib/catalog/fact-memory", () => ({
  recallForDraft: async (id: string) => {
    recall.calls.push(id);
    return recall.memory;
  },
}));

import { lookupProduct } from "@/lib/inventory/product-lookup-ai";
import { buildLookupUserPromptV2, LOOKUP_V2_SHAPE_HINT } from "@/lib/inventory/lookup-facts-core";
import { productLookupAction } from "@/app/admin/inventory/drafts/ai-lookup-actions";
import {
  MEMORY_MODEL_LABEL,
  alreadyKnownPromptBlock,
  buildProductMemory,
  __runFactMemoryCoreTests,
  type ProductMemory,
} from "@/lib/catalog/fact-memory-core";
import type { ProductKnowledge } from "@/lib/ai/kb/product-lookup";
import { KnownProductChip } from "@/components/admin/catalog/KnownProductChip";

const read = (p: string) => readFileSync(p, "utf8");
const KEY = "acme farms|flower|blue dream";
const U1 = { query: "Blue Dream", productName: "Blue Dream 3.5g", vendorOrBrand: "Acme Farms" };

const know = (over: Partial<ProductKnowledge> = {}): ProductKnowledge => ({
  source: "kb-exact",
  displayName: "Blue Dream",
  description: "A bright, berry-forward flower.",
  shortDescription: "Berry and pine.",
  aromaNotes: ["berry", "pine"],
  flavorNotes: ["sweet"],
  terpenes: [],
  effects: ["relaxed"],
  imageMediaIds: [],
  primaryMediaId: null,
  imageHint: "substitute",
  needsOnline: false,
  ...over,
});
const complete = (): ProductMemory => buildProductMemory({ identityKey: KEY, knowledge: know() })!;
const partial = (): ProductMemory =>
  buildProductMemory({ identityKey: KEY, knowledge: know({ shortDescription: null, flavorNotes: [] }) })!;
const draftOnly = (): ProductMemory => buildProductMemory({ identityKey: KEY, knowledge: know({ source: "kb-draft" }) })!;

function v2Reply() {
  const f = (value: unknown, confidence: unknown) => ({ value, confidence, sources: [] });
  return {
    text: JSON.stringify({
      schema: "lookup.v2",
      found: true,
      overall_confidence: 90,
      description: f("Sweet berry aroma.", 92),
      short_description: f("Berry-bright.", 91),
      strain_type: f("hybrid", 80),
    }),
    sources: ["https://example.com/bd"],
    model: "gemini-test",
    usedWebSearch: true,
    citations: [],
    searchSuggestions: [],
  };
}

const fd = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};
const BASE = { draft_id: "d1", query: "Blue Dream", product_name: "Blue Dream 3.5g", vendor_or_brand: "Acme Farms", pos_product_key: "pk1" };

beforeEach(() => {
  ws.calls.length = 0;
  ws.reply = v2Reply();
  act.audits.length = 0;
  act.banned = [];
  recall.calls.length = 0;
  recall.memory = null;
  delete process.env.KB_FIRST_ONBOARDING;
  delete process.env.LOOKUP_SCHEMA_V2;
  delete process.env.ATTACH_POLICY_RING;
});

describe("S09 pure core", () => {
  it("embedded self-tests pass (floor registered in the runner)", () => {
    const r = __runFactMemoryCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(109);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("fact-memory-core", __runFactMemoryCoreTests(), 109);');
  });

  it("recall returns null for '' identity (bible S09.5)", () => {
    expect(buildProductMemory({ identityKey: "", knowledge: know() })).toBeNull();
    expect(buildProductMemory({ identityKey: "  ", knowledge: know(), lastSeen: { at: "2026-03-12T00:00:00Z", from: "x", kind: "onboarded" } })).toBeNull();
  });

  it("only owner-approved KB counts; drafts are shown but never covered (Rule 3.1)", () => {
    expect(complete().complete).toBe(true);
    expect(draftOnly().covered).toEqual([]);
    expect(draftOnly().facts).toHaveLength(5);
    expect(alreadyKnownPromptBlock(draftOnly())).toBe("");
  });
});

describe("S09 lookupProduct alreadyKnown", () => {
  it("absent / '' -> prompt byte-identical to S06", async () => {
    await lookupProduct({ ...U1 });
    await lookupProduct({ ...U1, alreadyKnown: "" });
    const s06 = `${buildLookupUserPromptV2(U1)}${LOOKUP_V2_SHAPE_HINT}`;
    expect(ws.calls).toHaveLength(2);
    expect(ws.calls[0].user).toBe(s06);
    expect(ws.calls[1].user).toBe(s06);
  });

  it("a block sits between the user prompt and the shape hint", async () => {
    const block = alreadyKnownPromptBlock(partial());
    expect(block.startsWith("\n\nAlready on file for this product")).toBe(true);
    await lookupProduct({ ...U1, alreadyKnown: block });
    expect(ws.calls[0].user).toBe(`${buildLookupUserPromptV2(U1)}${block}${LOOKUP_V2_SHAPE_HINT}`);
  });

  it("flag LOOKUP_SCHEMA_V2=off ignores the block (v1 prompt untouched)", async () => {
    process.env.LOOKUP_SCHEMA_V2 = "off";
    await lookupProduct({ ...U1, alreadyKnown: alreadyKnownPromptBlock(partial()) });
    expect(String(ws.calls[0].user)).not.toContain("Already on file");
  });
});

describe("S09 productLookupAction", () => {
  it("complete memory -> ZERO Gemini calls; answer from memory, compliance-gated, audited without values", async () => {
    recall.memory = complete();
    const res = await productLookupAction(fd(BASE));
    expect(ws.calls).toHaveLength(0);
    expect(recall.calls).toEqual(["d1"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schema).toBe("memory");
    expect(res.usedWebSearch).toBe(false);
    expect(res.model).toBe(MEMORY_MODEL_LABEL);
    expect(res.description).toBe("A bright, berry-forward flower.");
    expect(res.shortDescription).toBe("Berry and pine.");
    expect(res.aromaNotes).toEqual(["berry", "pine"]);
    expect(res.effects).toEqual(["relaxed"]);
    // Memory never decides strain type, so it can never autofill the select.
    expect(res.strainType).toBe("unknown");
    expect(res.autofillStrainType).toBe(false);
    expect(res.facts).toBeNull();
    expect(res.policy).toBeNull();
    expect(res.sources).toEqual([]);
    expect(res.memory?.skipped).toBe(true);
    expect(res.memory?.notice).toContain("no web lookup was made");
    const audit = act.audits.find((a) => a.action === "catalog_draft.ai_lookup")!;
    const after = audit.after as Record<string, unknown>;
    expect(after.memory).toEqual({ known: true, covered: ["description", "short_description", "effects", "aroma", "flavor"], missing: [], skippedGemini: true, refresh: false });
    expect(after.usedWebSearch).toBe(false);
    expect(JSON.stringify(audit)).not.toContain("berry");
  });

  it("the memory answer goes through TODAY's banned list (an approved record is re-linted)", async () => {
    recall.memory = buildProductMemory({
      identityKey: KEY,
      knowledge: know({ effects: ["relaxed", "cures anxiety"] }),
    });
    const res = await productLookupAction(fd(BASE));
    expect(ws.calls).toHaveLength(0);
    if (!res.ok) throw new Error(res.error);
    expect(res.effects).toEqual(["relaxed"]);
    expect(res.rejectedEffects.map((r) => r.effect)).toEqual(["cures anxiety"]);
  });

  it("partial memory -> Gemini called once with the already-known block", async () => {
    recall.memory = partial();
    const res = await productLookupAction(fd(BASE));
    expect(ws.calls).toHaveLength(1);
    const block = alreadyKnownPromptBlock(partial());
    expect(block).toContain('- description: "A bright, berry-forward flower."');
    expect(block).toContain("Focus on: short_description, flavor.");
    expect(ws.calls[0].user).toBe(`${buildLookupUserPromptV2(U1)}${block}${LOOKUP_V2_SHAPE_HINT}`);
    if (!res.ok) throw new Error(res.error);
    expect(res.schema).toBe("v2");
    expect(res.memory).toEqual({ skipped: false, refresh: false, covered: ["description", "effects", "aroma"], missing: ["short_description", "flavor"], notice: "" });
  });

  it("nothing covered (KB draft only) -> prompt byte-identical to S06", async () => {
    recall.memory = draftOnly();
    await productLookupAction(fd(BASE));
    expect(ws.calls).toHaveLength(1);
    expect(ws.calls[0].user).toBe(`${buildLookupUserPromptV2(U1)}${LOOKUP_V2_SHAPE_HINT}`);
  });

  it("no memory -> prompt byte-identical; memory null; audit says not known", async () => {
    const res = await productLookupAction(fd(BASE));
    expect(ws.calls[0].user).toBe(`${buildLookupUserPromptV2(U1)}${LOOKUP_V2_SHAPE_HINT}`);
    if (!res.ok) throw new Error(res.error);
    expect(res.memory).toBeNull();
    const after = act.audits[0].after as Record<string, unknown>;
    expect((after.memory as Record<string, unknown>).known).toBe(false);
  });

  it("Refresh from web -> Gemini called even with a complete memory, and the prompt has NO block", async () => {
    recall.memory = complete();
    const res = await productLookupAction(fd({ ...BASE, refresh: "1" }));
    expect(ws.calls).toHaveLength(1);
    expect(ws.calls[0].user).toBe(`${buildLookupUserPromptV2(U1)}${LOOKUP_V2_SHAPE_HINT}`);
    if (!res.ok) throw new Error(res.error);
    expect(res.memory?.skipped).toBe(false);
    expect(res.memory?.refresh).toBe(true);
    expect((act.audits[0].after as Record<string, unknown>).memory).toMatchObject({ skippedGemini: false, refresh: true });
  });

  it("refresh must be exactly '1' (anything else is not a refresh)", async () => {
    recall.memory = complete();
    await productLookupAction(fd({ ...BASE, refresh: "yes" }));
    expect(ws.calls).toHaveLength(0);
  });

  for (const off of ["off", "0", "false", "no", "disabled", " OFF "]) {
    it(`KB_FIRST_ONBOARDING=${JSON.stringify(off)} -> recall never asked, Gemini called, prompt byte-identical, no memory audit`, async () => {
      process.env.KB_FIRST_ONBOARDING = off;
      recall.memory = complete();
      const res = await productLookupAction(fd(BASE));
      expect(recall.calls).toEqual([]);
      expect(ws.calls).toHaveLength(1);
      expect(ws.calls[0].user).toBe(`${buildLookupUserPromptV2(U1)}${LOOKUP_V2_SHAPE_HINT}`);
      if (!res.ok) throw new Error(res.error);
      expect(res.memory).toBeNull();
      expect((act.audits[0].after as Record<string, unknown>).memory).toBeUndefined();
    });
  }

  it("no draft id -> recall never asked (identity comes from the draft row, never client text)", async () => {
    recall.memory = complete();
    await productLookupAction(fd({ ...BASE, draft_id: "" }));
    expect(recall.calls).toEqual([]);
    expect(ws.calls).toHaveLength(1);
  });
});

describe("S09 wiring", () => {
  const action = read("src/app/admin/inventory/drafts/ai-lookup-actions.ts");
  const panel = read("src/app/admin/inventory/drafts/AiLookupPanel.tsx");
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const server = read("src/lib/catalog/fact-memory.ts");

  it("the action recalls by draft id behind the flag and skips only via shouldSkipGemini", () => {
    expect(action).toContain("const kbFirst = kbFirstOnboardingEnabled(process.env[KB_FIRST_ONBOARDING_ENV]);");
    expect(action).toContain("const memory = kbFirst && draftId ? await recallForDraft(draftId) : null;");
    expect(action).toContain("const skipGemini = shouldSkipGemini({ enabled: kbFirst, refresh, memory });");
    expect(action).toContain('const refresh = str(formData, "refresh") === "1";');
    expect(action).toContain('alreadyKnown: refresh ? "" : alreadyKnownPromptBlock(memory),');
    expect(action).toContain("result: postProcessLookup(memoryRawLookup(memory), banned),");
  });

  it("the panel sends refresh=1 and renders the memory notice with a Refresh from web button", () => {
    expect(panel).toContain('if (refresh) fd.set("refresh", "1");');
    expect(panel).toContain("onClick={() => run(undefined, true)}");
    expect(panel).toContain('data-testid="lookup-memory-notice"');
    expect(panel).toContain("Refresh from web");
  });

  it("the page recalls ONCE per render, review tab only, inside the existing Promise.all, reusing approved history", () => {
    expect(page.match(/recallProductMemories\(/g)).toHaveLength(1);
    expect(page).toContain('kbFirst && view === "draft"');
    expect(page).toContain("          priorClassifications,\n        )");
    expect(page).toContain("<KnownProductChip memory={productMemories.get(d.id)!} now={now} />");
    expect(page).not.toMatch(/recallForDraft/);
  });

  it("the server recall reads history only through the core's constant, a named select, and tolerates a missing 0235", () => {
    expect(server).toMatch(/^import "server-only";/m);
    expect(server).toContain(".from(PROVENANCE_TABLE)");
    expect(server).toContain(".select(RECALL_PROVENANCE_SELECT)");
    expect(server).toContain("isMissingAttachedFactsError(firstError)");
    expect(server).not.toMatch(/product_fact_provenance|attached_facts/);
    expect(server).not.toMatch(/select\("\*"\)\s*\.in\("identity_key"/);
    // No writes from recall.
    expect(server).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("the chip renders title, detail and the per-fact list; never says auto-attach", () => {
    const html = renderToStaticMarkup(createElement(KnownProductChip, { memory: partial(), now: new Date("2026-05-01T12:00:00Z") }));
    expect(html).toContain('data-testid="known-product"');
    expect(html).toContain("Known product.");
    expect(html).toContain("3 of 5 facts are on file");
    expect(html).toContain('data-testid="known-product-facts"');
    expect(html).toContain("counted");
    expect(html).not.toMatch(/auto-attach/i);
  });
});
