/**
 * SLICE S06 -- structured, per-field, cited AI lookup.
 *
 * Bible S06 acceptance, proven end to end with a mocked provider (no network):
 *   1. Bands: 89 -> review, 90 -> auto, missing -> unknown; no field is
 *      auto-eligible without its OWN confidence.
 *   2. Prose no longer carries THC/terpenes (F-022): v2 prompt drops the
 *      "fold into prose" / "pack the description" asks; numbers live in fields.
 *   3. Rollback: LOOKUP_SCHEMA_V2=off sends the pre-S06 prompt + shape +
 *      maxTokens BYTE-IDENTICAL (sha256 fingerprints captured from main
 *      ed41fb57 before any S06 edit).
 *   4. A v1-shaped reply with the flag ON still works (v1 fallback).
 *   5. Grounded citations map to the right field; Google Search Suggestions
 *      are surfaced (Google grounding terms) and never persisted/audited.
 *   6. Compliance: a medical claim in any v2 text field is WITHHELD; medical
 *      effects are rejected -- before anything reaches the worksheet.
 *   7. F-018: staged suggestions carry each field's own confidence; the legacy
 *      rule is unchanged when none is sent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
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

// Server-action collaborators (only used by the action tests).
const act = vi.hoisted(() => ({
  audits: [] as Array<Record<string, unknown>>,
  suggestions: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "owner@example.com" }),
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: Record<string, unknown>) => {
    act.audits.push(a);
  },
}));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => [] }));
vi.mock("@/lib/ai/kb/store", () => ({ upsertKbStrain: async () => ({}) }));
vi.mock("@/lib/ai/suggestions", () => ({
  listSuggestions: async () => [],
  persistSuggestion: async (s: Record<string, unknown>) => {
    act.suggestions.push(s);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { lookupProduct } from "@/lib/inventory/product-lookup-ai";
import {
  PRODUCT_LOOKUP_SYSTEM,
  buildLookupUserPrompt,
  gateLookupFacts,
  GATED_TEXT_FIELDS,
} from "@/lib/inventory/product-lookup-core";
import {
  LOOKUP_FIELD_KEYS,
  LOOKUP_V2_MAX_TOKENS,
  PRODUCT_LOOKUP_SYSTEM_V2,
  buildLookupUserPromptV2,
  confidenceBand,
  isAutoEligible,
  normalizeLookup,
  mapCitationsToFields,
  __runLookupFactsCoreTests,
} from "@/lib/inventory/lookup-facts-core";
import { __runGroundingCoreTests, extractCitations, extractSearchSuggestions } from "@/lib/ai/grounding-core";
import { productLookupAction, saveLookupToKbAction } from "@/app/admin/inventory/drafts/ai-lookup-actions";
import { enrichmentLookupAction, enrichmentSaveLookupAction } from "@/app/admin/products/ai-lookup-actions";
import { GoogleSearchSuggestions, LookupFactsView } from "@/components/admin/LookupFactsView";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const read = (p: string) => readFileSync(p, "utf8");

// Pre-S06 fingerprints, captured on main ed41fb57 BEFORE any edit.
const FP = {
  sys: "443bdc442b55d9a7103b8d9ce6b317228a5560b903ced2ed2012c54fed1fccfc",
  sysLen: 5203,
  u1: "7672b56b8dec6a42818296020c4c18b6a6b79b1767d3e976bb149d71908393f7",
  u2: "aca9a77eb7a7a5e66c9e1266bbb4b2997dae7bbdb412e72f9eab207ef07cd6a5",
  shape: "8ae8f47d1bed177588e495254ed4a5276fe267e16daf0a08a3cc510e0fdad1cb",
};
const U1 = { query: "Blue Dream", productName: "Blue Dream 3.5g", vendorOrBrand: "Acme Farms" };

const f = (value: unknown, confidence: unknown, sources: string[] = []) => ({ value, confidence, sources });

/** A realistic v2 Gemini reply (JSON text + grounding metadata). */
function v2Reply() {
  const obj = {
    schema: "lookup.v2",
    found: true,
    overall_confidence: 94,
    strain_name: f("Blue Dream", 97, ["https://www.leafly.com/strains/blue-dream"]),
    strain_type: f("sativa-hybrid", 89, ["https://www.leafly.com/strains/blue-dream"]),
    lineage: f("Blueberry x Haze", 95),
    category: f("flower", 98),
    producer: f("Acme Farms", 90, ["https://acmefarms.example/blue-dream"]),
    description: f("Sweet berry aroma with a bright, easygoing daytime character.", 92),
    short_description: f("Berry-bright and easygoing.", 70),
    effects: f(["uplifted", "creative", "reduces inflammation"], 80),
    terpenes: f([{ name: "myrcene", pct: 0.6 }, { name: "pinene", pct: 0.3 }], 91),
    cannabinoids: f({ thc_pct: 24.1, cbd_pct: 0.1 }, 93),
    size: f({ amount: 3.5, uom: "g" }, 99),
    images: f(["https://acmefarms.example/img/bd.jpg"], 88),
    summary: f(null, 0),
  };
  const text = JSON.stringify(obj);
  return {
    text,
    sources: ["https://www.leafly.com/strains/blue-dream", "https://acmefarms.example/blue-dream"],
    model: "gemini-test",
    usedWebSearch: true,
    citations: [
      { url: "https://lineage.example/bd", citedText: "Blueberry x Haze" },
      { url: "https://record.example/overview" },
    ],
    searchSuggestions: ['<div class="container"><a class="chip" href="https://www.google.com/search?q=blue+dream">blue dream</a></div>'],
  };
}

beforeEach(() => {
  ws.calls.length = 0;
  act.audits.length = 0;
  act.suggestions.length = 0;
  delete process.env.LOOKUP_SCHEMA_V2;
  delete process.env.ATTACH_FACTS_V2;
});

describe("S06 pure cores", () => {
  it("embedded self-tests pass (floors registered in the runner)", () => {
    expect(__runGroundingCoreTests().passed).toBeGreaterThanOrEqual(18);
    expect(__runLookupFactsCoreTests().passed).toBeGreaterThanOrEqual(115);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(/assertRan\("grounding-core", __runGroundingCoreTests\(\), 17\)/);
    expect(runner).toMatch(/assertRan\("lookup-facts-core", __runLookupFactsCoreTests\(\), 113\)/);
  });

  it("bands: 89 -> review, 90 -> auto, missing -> unknown (spec test 1)", () => {
    expect(confidenceBand(89)).toBe("review");
    expect(confidenceBand(90)).toBe("auto");
    expect(confidenceBand(null)).toBe("unknown");
    const facts = normalizeLookup({ lineage: "Blueberry x Haze", strain_type: f("indica", 90), overall_confidence: 100 });
    expect(facts.fields.lineage.band).toBe("unknown");
    expect(isAutoEligible(facts.fields.lineage)).toBe(false);
    expect(isAutoEligible(facts.fields.strain_type)).toBe(true);
  });

  it("found must be literally true (a string \"true\" or 1 is an honest miss)", () => {
    expect(normalizeLookup({ found: true, strain_type: f("indica", 95) }).found).toBe(true);
    expect(normalizeLookup({ found: "true", strain_type: f("indica", 95) }).found).toBe(false);
    expect(normalizeLookup({ found: 1, strain_type: f("indica", 95) }).found).toBe(false);
  });

  it("a cited span that is partly outside every field is record-level, never attributed", () => {
    const reply = '{"lineage":{"value":null,"confidence":0,"sources":[]},"description":{"value":"Its lineage is unknown","confidence":90,"sources":[]}}';
    const m = mapCitationsToFields(reply, [{ url: "https://g.example/p", citedText: "lineage" }]);
    expect(m.byField.description).toBeUndefined();
    expect(m.record).toEqual(["https://g.example/p"]);
  });

  it("v2 prompt keeps numbers out of the prose (spec test 3, F-022)", () => {
    expect(PRODUCT_LOOKUP_SYSTEM).toMatch(/Fold these\s+extra facts/); // v1 untouched (rollback)
    expect(PRODUCT_LOOKUP_SYSTEM_V2).not.toMatch(/Fold these\s+extra facts/i);
    expect(PRODUCT_LOOKUP_SYSTEM_V2).not.toMatch(/\bfold\b/i);
    expect(PRODUCT_LOOKUP_SYSTEM_V2).toContain("KEEP FACTS OUT OF THE PROSE");
    expect(buildLookupUserPrompt(U1)).toMatch(/Pack the description/);
    expect(buildLookupUserPromptV2(U1)).not.toMatch(/Pack the description/);
  });
});

describe("S06 lookupProduct (mocked provider)", () => {
  it("v2 ON (default): v2 prompt + shape + 4000-token cap; facts, citations, suggestions surfaced", async () => {
    ws.reply = v2Reply();
    const out = await lookupProduct({ ...U1 });
    expect(ws.calls).toHaveLength(1);
    const call = ws.calls[0];
    expect(call.system).toBe(PRODUCT_LOOKUP_SYSTEM_V2);
    expect(String(call.user).startsWith(buildLookupUserPromptV2(U1))).toBe(true);
    expect(String(call.user)).toContain('"schema": "lookup.v2"');
    expect(call.maxTokens).toBe(LOOKUP_V2_MAX_TOKENS);
    expect((call.context as Record<string, unknown>).feature).toBe("inventory.product_lookup");

    expect(out.schema).toBe("v2");
    const facts = out.facts!;
    expect(facts.fields.strain_type.band).toBe("review"); // 89
    expect(facts.fields.producer.band).toBe("auto"); // 90
    expect(facts.fields.summary.band).toBe("unknown"); // null + 0
    expect(facts.fields.cannabinoids.value?.thc_pct).toBe(24.1);
    expect(facts.fields.terpenes.value?.map((t) => t.name)).toEqual(["myrcene", "pinene"]);
    // Grounded citation mapped by cited span; span-less one is record-level.
    expect(facts.fields.lineage.cited).toEqual(["https://lineage.example/bd"]);
    expect(facts.recordCitations).toEqual(["https://record.example/overview"]);
    // Declared per-field sources carried.
    expect(facts.fields.producer.sources).toEqual(["https://acmefarms.example/blue-dream"]);
    // ToS: suggestions passed through verbatim.
    expect(out.searchSuggestions).toEqual(v2Reply().searchSuggestions);
    expect(out.citations).toHaveLength(2);

    // v1 result is still produced for every existing consumer.
    expect(out.result.strainType).toBe("sativa-hybrid");
    expect(out.result.strainTypeConfidence).toBe(89);
    expect(out.result.autofillStrainType).toBe(false); // 89 < 90: no autofill
    expect(out.result.size).toBe("3.5g");
    expect(out.result.description).toBe("Sweet berry aroma with a bright, easygoing daytime character.");
    expect(out.result.description).not.toMatch(/THC|%|myrcene/);
  });

  it("compliance gate: medical effect rejected before the worksheet (v2)", async () => {
    ws.reply = v2Reply();
    const out = await lookupProduct({ ...U1 });
    expect(out.facts!.fields.effects.value).toEqual(["uplifted", "creative"]);
    expect(out.facts!.rejectedEffects.map((r) => r.effect)).toContain("reduces inflammation");
    expect(out.result.effects).not.toContain("reduces inflammation");
  });

  it("compliance gate: a medical claim in ANY v2 text field is withheld (value null, band unknown)", () => {
    const claim = "This strain cures anxiety and treats chronic pain.";
    // Pinned independently: iterating only over the constant would let a shrunk list pass.
    expect([...GATED_TEXT_FIELDS].sort()).toEqual(
      ["brand_description", "description", "lineage", "producer", "short_description", "strain_name", "summary"],
    );
    for (const k of GATED_TEXT_FIELDS) {
      const facts = normalizeLookup({ [k]: f(claim, 95) });
      expect(facts.fields[k].band, k).toBe("auto");
      const gated = gateLookupFacts(facts);
      expect(gated.fields[k].value, k).toBeNull();
      expect(gated.fields[k].band, k).toBe("unknown");
      expect(gated.fields[k].withheld, k).toBe("compliance");
      expect(gated.counts.auto, k).toBe(0);
      // never mutates the input
      expect(facts.fields[k].value, k).toBe(claim);
    }
    // clean copy passes untouched
    const clean = gateLookupFacts(normalizeLookup({ description: f("Sweet berry nose.", 95) }));
    expect(clean.fields.description.value).toBe("Sweet berry nose.");
    expect(clean.fields.description.withheld).toBeUndefined();
  });

  it("compliance gate: term lists drop only blocked terms; all-blocked withholds", () => {
    const g = gateLookupFacts(
      normalizeLookup({
        aroma: f(["berry", "cures insomnia"], 95),
        awards: f(["treats pain award"], 95),
        terpenes: f([{ name: "myrcene", pct: 1 }, { name: "heals arthritis", pct: 1 }], 95),
      }),
    );
    expect(g.fields.aroma.value).toEqual(["berry"]);
    expect(g.fields.aroma.band).toBe("auto");
    expect(g.fields.awards.value).toBeNull();
    expect(g.fields.awards.withheld).toBe("compliance");
    expect(g.fields.terpenes.value?.map((t) => t.name)).toEqual(["myrcene"]);
  });

  it("v1-shaped reply with the flag ON still works (fallback, never dies)", async () => {
    ws.reply = {
      text: JSON.stringify({ strain_type: "indica", strain_type_confidence: 0.95, found: true, summary: "Earthy and calm.", size: "1g" }),
      sources: [],
      model: "gemini-test",
      usedWebSearch: true,
    };
    const out = await lookupProduct({ ...U1 });
    expect(out.schema).toBe("v1");
    expect(out.facts).toBeNull();
    expect(out.result.strainType).toBe("indica");
    expect(out.result.autofillStrainType).toBe(true);
    expect(out.citations).toEqual([]);
    expect(out.searchSuggestions).toEqual([]);
  });

  it("unparseable reply: honest v1 miss, no throw", async () => {
    ws.reply = { text: "Sorry, I could not find that.", sources: [], model: "gemini-test", usedWebSearch: false };
    const out = await lookupProduct({ query: "Zzz" });
    expect(out.schema).toBe("v1");
    expect(out.result.found).toBe(false);
    expect(out.result.hasAnyFindings).toBe(false);
  });

  for (const off of ["off", "0", "false", "no", "disabled", " OFF "]) {
    it(`ROLLBACK: LOOKUP_SCHEMA_V2=${JSON.stringify(off)} -> pre-S06 request, byte-identical`, async () => {
      process.env.LOOKUP_SCHEMA_V2 = off;
      ws.reply = v2Reply(); // even a v2-looking reply is NOT parsed as v2 when off
      const out = await lookupProduct({ ...U1 });
      const call = ws.calls[0];
      expect(sha(String(call.system))).toBe(FP.sys);
      expect(String(call.system).length).toBe(FP.sysLen);
      const u1 = buildLookupUserPrompt(U1);
      expect(sha(u1)).toBe(FP.u1);
      const user = String(call.user);
      expect(user.startsWith(u1)).toBe(true);
      expect(sha(user.slice(u1.length))).toBe(FP.shape);
      expect(call.maxTokens).toBe(2000);
      expect(out.schema).toBe("v1");
      expect(out.facts).toBeNull();
    });
  }

  it("ROLLBACK fingerprint for a bare query too (U2)", async () => {
    process.env.LOOKUP_SCHEMA_V2 = "off";
    ws.reply = { text: "{}", sources: [], model: "m", usedWebSearch: true };
    await lookupProduct({ query: "Gummies" });
    const u2 = buildLookupUserPrompt({ query: "Gummies" });
    expect(sha(u2)).toBe(FP.u2);
    expect(sha(String(ws.calls[0].user).slice(u2.length))).toBe(FP.shape);
  });
});

describe("S06 server actions", () => {
  const fd = (o: Record<string, string>) => {
    const d = new FormData();
    for (const [k, v] of Object.entries(o)) d.set(k, v);
    return d;
  };

  it("onboarding action passes facts + suggestions through; audit stores counts only (never suggestion HTML)", async () => {
    ws.reply = v2Reply();
    const res = await productLookupAction(
      fd({ draft_id: "d1", query: "Blue Dream", product_name: "Blue Dream 3.5g", vendor_or_brand: "Acme Farms", pos_product_key: "pk1" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schema).toBe("v2");
    expect(res.facts?.fields.lineage.value).toBe("Blueberry x Haze");
    expect(res.searchSuggestions).toHaveLength(1);
    expect(res.draft.fieldConfidence).toEqual({ description: 92, short_description: 70, images: 88 });
    const audit = act.audits.find((a) => a.action === "catalog_draft.ai_lookup")!;
    const after = audit.after as Record<string, unknown>;
    expect(after.schema).toBe("v2");
    expect(after.bands).toEqual(res.facts?.counts);
    expect(JSON.stringify(audit)).not.toContain("chip");
    expect(JSON.stringify(audit)).not.toContain("google.com/search");
  });

  it("enrichment action passes facts + suggestions through; audit never stores suggestion HTML", async () => {
    ws.reply = v2Reply();
    const res = await enrichmentLookupAction(fd({ key: "pk1", product_key: "pk1", query: "Blue Dream", product_name: "Blue Dream" }));
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.facts?.fields.size.value).toEqual({ amount: 3.5, uom: "g" });
    expect(res.searchSuggestions).toHaveLength(1);
    expect(JSON.stringify(act.audits)).not.toContain("google.com/search");
  });

  const basePayload = {
    name: "Blue Dream",
    strainType: "unknown",
    strainTypeConfidence: 0,
    summary: "",
    effects: [],
    aromaNotes: [],
    flavorNotes: [],
    lineage: "",
    sources: [],
    posProductKey: "pk1",
    description: "Sweet berry aroma.",
    shortDescription: "Berry-bright.",
    category: "",
    potencyRatio: "",
    size: "",
    imageCandidates: ["https://acmefarms.example/img/bd.jpg"],
  };
  const confOf = (field: string) => act.suggestions.find((s) => s.field_key === field)?.confidence;
  // S07 (Round 17): the F-018 guards below pin the LEGACY save path, which
  // ATTACH_FACTS_V2=off keeps unchanged. The S07 path is covered (with its own
  // confidence rules) by tests/compliance/s07-attach-product-facts.test.ts.
  const legacy = () => {
    process.env.ATTACH_FACTS_V2 = "off";
  };

  it("F-018 onboarding save: each suggestion carries its OWN field confidence", async () => {
    legacy();
    const r = await saveLookupToKbAction(
      fd({ draft_id: "d1", payload: JSON.stringify({ ...basePayload, fieldConfidence: { description: 92, short_description: 70, images: 88 } }) }),
    );
    expect(r.ok).toBe(true);
    expect(confOf("description")).toBe(0.92);
    expect(confOf("short_description")).toBe(0.7);
    const imgKey = act.suggestions.find((s) => s.field_key !== "description" && s.field_key !== "short_description")!;
    expect(imgKey.confidence).toBe(0.88);
  });

  it("F-018 legacy rule unchanged without fieldConfidence (strain conf, else 0.75); junk values fall back", async () => {
    legacy();
    await saveLookupToKbAction(fd({ draft_id: "d1", payload: JSON.stringify(basePayload) }));
    expect(confOf("description")).toBe(0.75);
    act.suggestions.length = 0;
    await saveLookupToKbAction(
      fd({
        draft_id: "d1",
        payload: JSON.stringify({ ...basePayload, strainType: "indica", strainTypeConfidence: 80, fieldConfidence: { description: "high", short_description: 150 } }),
      }),
    );
    expect(confOf("description")).toBe(0.8);
    expect(confOf("short_description")).toBe(0.8);
  });

  it("F-018 enrichment save: own confidence, legacy fallback", async () => {
    legacy();
    const r = await enrichmentSaveLookupAction(
      fd({ key: "pk1", product_key: "pk1", payload: JSON.stringify({ ...basePayload, fieldConfidence: { description: 96 } }) }),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(confOf("description")).toBe(0.96);
    expect(confOf("short_description")).toBe(0.75);
  });
});

describe("S06 provider + UI wiring", () => {
  it("provider attaches citations (Gemini + OpenAI) and suggestions (Gemini) on success paths only", () => {
    const src = read("src/lib/ai/provider.ts");
    expect(src).toMatch(/import \{ extractCitations, extractSearchSuggestions, type WebCitation \} from "\.\/grounding-core"/);
    expect(src.match(/citations: extractCitations\(payload\)/g)).toHaveLength(2);
    expect(src.match(/searchSuggestions: extractSearchSuggestions\(payload\)/g)).toHaveLength(1);
    // fallbacks untouched
    expect(src).toContain("return { text: g.content, sources: [], model, usedWebSearch: false };");
    expect(src).toContain("return { text: content, sources: [], model, usedWebSearch: false };");
    // no new AI_* env read (S00 .env.example derivation stays green)
    expect(src).not.toMatch(/LOOKUP_SCHEMA_V2/);
  });

  it("grounding extractors read the documented Interactions shape", () => {
    const payload = {
      steps: [
        { type: "google_search_result", result: [{ search_suggestions: "<div>chips</div>" }] },
        {
          type: "model_output",
          content: [{ type: "text", text: "abcdef", annotations: [{ type: "url_citation", url: "https://x.example/", start_index: 1, end_index: 4 }] }],
        },
      ],
    };
    expect(extractCitations(payload)[0].citedText).toBe("bcd");
    expect(extractSearchSuggestions(payload)).toEqual(["<div>chips</div>"]);
  });

  it("LookupFactsView renders every field with its band + %, withheld and cited", () => {
    const facts = gateLookupFacts(
      normalizeLookup(
        { lineage: f("Blueberry x Haze", 95), strain_type: f("indica", 89), description: f("It cures pain.", 99) },
        { text: '{"lineage":{"value":"Blueberry x Haze"}}', citations: [{ url: "https://c.example/l", citedText: "Blueberry x Haze" }] },
      ),
    );
    const html = renderToStaticMarkup(createElement(LookupFactsView, { facts }));
    for (const k of LOOKUP_FIELD_KEYS) expect(html).toContain(`data-field="${k}"`);
    expect(html).toContain('data-field="lineage" data-band="auto"');
    expect(html).toContain("Auto 95%");
    expect(html).toContain("Review 89%");
    expect(html).toContain("Withheld (compliance)");
    expect(html).not.toContain("cures pain");
    expect(html).toContain("cited: c.example");
  });

  it("Search Suggestions: sandboxed iframe, NO allow-scripts / allow-same-origin, links open new tab; empty renders nothing", () => {
    const html = renderToStaticMarkup(createElement(GoogleSearchSuggestions, { html: ['<a href="https://www.google.com/search?q=x">x</a>'] }));
    expect(html).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
    expect(html).not.toContain("allow-scripts");
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain("&lt;base target=&quot;_blank&quot;&gt;");
    expect(renderToStaticMarkup(createElement(GoogleSearchSuggestions, { html: [] }))).toBe("");
  });

  it("both panels render the suggestions + facts view and send kept field confidence", () => {
    for (const p of ["src/app/admin/inventory/drafts/AiLookupPanel.tsx", "src/app/admin/products/[key]/EnrichmentAiLookupPanel.tsx"]) {
      const src = read(p);
      expect(src, p).toContain("<GoogleSearchSuggestions html={data.searchSuggestions} />");
      expect(src, p).toContain("{data.facts && <LookupFactsView facts={data.facts} />}");
      expect(src, p).toContain("fieldConfidence: keptFieldConfidence(");
    }
  });

  it("suggestions are never persisted: not in any save payload type or DB write", () => {
    for (const p of ["src/app/admin/inventory/drafts/ai-lookup-actions.ts", "src/app/admin/products/ai-lookup-actions.ts"]) {
      const src = read(p);
      const saveFn = src.slice(src.indexOf("export async function", src.indexOf("SaveLookupResult") > 0 ? src.indexOf("SaveLookupResult") : src.indexOf("EnrichmentSaveResult")));
      expect(saveFn, p).not.toContain("searchSuggestions");
    }
  });

  it(".env.example documents the LOOKUP_SCHEMA_V2 rollback switch", () => {
    expect(read(".env.example")).toMatch(/# LOOKUP_SCHEMA_V2=on/);
  });
});
