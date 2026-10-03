/**
 * tests/compliance/s10-fact-attach-policy.test.ts  (S10)
 *
 * The per-field consequence bands, the shadow ring, and the wiring:
 *   - bible S10.5 tests, word for word (≥90 attach · 89 suggest · strain 95
 *     vs KB → prefill · human present → ignore);
 *   - bible §5.5 bands (descriptive 70 floor, classifying chip, compliance
 *     never from the web) and D-02;
 *   - §13.2 contract: FIELD_POLICY covers every lookup field and the auto bar
 *     is 90 everywhere;
 *   - the owner can read FIELD_POLICY as a table in the file header (S10.6);
 *   - the ring parse (default shadow, junk → shadow, off-words → 0) and
 *     "act needs the S07 writer";
 *   - the receipt sentence is the bible's copy, byte for byte;
 *   - the shadow wiring writes NOTHING: no insert/update/upsert in the new
 *     server module, the action only adds counts to the audit it already
 *     wrote, and the footer read is bounded, uses a named JSON path, and hits
 *     the 0231 index;
 *   - the panel renders the preview heading in shadow mode.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

import {
  ATTACH_AUTO_MIN_CONFIDENCE,
  ATTACH_POLICY_CLASSES,
  ATTACH_POLICY_DEFAULT_RING,
  ATTACH_POLICY_RING_ENV,
  ATTACH_WRITER_SHIPPED,
  DESCRIPTIVE_SUGGEST_MIN_CONFIDENCE,
  FIELD_POLICY,
  SHADOW_MAX_ROWS,
  SHADOW_WINDOW_DAYS,
  __runFactAttachPolicyCoreTests,
  attachPolicyMode,
  countDecisions,
  decide,
  decideLookupFacts,
  isEmptyFactValue,
  parseAttachPolicyRing,
  policyAuditPayload,
  ATTACH_DECISIONS,
  policyConfidence,
  policyFor,
  receiptSentence,
  shadowFooterCopy,
  summarizeShadowAudit,
  type PolicyIncoming,
} from "@/lib/catalog/fact-attach-policy-core";
import { LOOKUP_FIELD_KEYS, LOOKUP_FACT_AUTO_MIN_CONFIDENCE, normalizeLookup } from "@/lib/inventory/lookup-facts-core";
import { LOOKUP_AUTO_MIN_CONFIDENCE } from "@/lib/inventory/product-lookup-core";
import { HOUSE_TYPE_MIN_AUTO_CONFIDENCE } from "@/lib/inventory/house-type-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const g = (value: unknown, confidence: number | null): PolicyIncoming => ({ source: "gemini", value, confidence });

describe("S10 bible tests (S10.5)", () => {
  it("≥90 descriptive → attach; 89 → suggest", () => {
    for (const f of ["description", "short_description", "effects", "aroma", "flavor", "terpenes", "lineage", "brand_description"]) {
      expect(decide(f, g(f === "effects" ? ["calm"] : "x", 90)).decision, f).toBe("attach");
      expect(decide(f, g(f === "effects" ? ["calm"] : "x", 89)).decision, f).toBe("suggest");
    }
  });

  it("strain_type 95 but KB says different → prefill (contradiction overrides score)", () => {
    const v = decide("strain_type", g("hybrid", 95), { kbValue: "indica" });
    expect(v.decision).toBe("prefill");
    expect(v.conflict).toEqual({ source: "strain library", value: "indica" });
    expect(v.reason).toContain("A contradiction beats any score");
    // Even 100 does not beat a contradiction.
    expect(decide("strain_type", g("hybrid", 100), { kbValue: "indica" }).decision).toBe("prefill");
    // The manifest disagreeing counts too.
    expect(decide("strain_type", g("hybrid", 100), { manifestValue: "sativa" }).conflict?.source).toBe("manifest");
  });

  it("human value present → ignore regardless", () => {
    for (const f of Object.keys(FIELD_POLICY)) {
      expect(decide(f, g("x", 100), { humanValue: "mine" }).decision, f).toBe("ignore");
    }
    // Falsy-but-real human values still win (false / 0 are answers).
    expect(decide("otherwise_taken", g(true, 100), { humanValue: false }).decision).toBe("ignore");
    expect(decide("unit_thc_mg", g(5, 100), { humanValue: 0 }).decision).toBe("ignore");
  });
});

describe("§5.5 bands + D-02", () => {
  it("descriptive: ≥90 attach · 70–89 suggest · <70 discard; no rounding", () => {
    expect(decide("description", g("x", 100)).decision).toBe("attach");
    expect(decide("description", g("x", 89.99)).decision).toBe("suggest");
    expect(decide("description", g("x", 70)).decision).toBe("suggest");
    expect(decide("description", g("x", 69.99)).decision).toBe("ignore");
    expect(decide("description", g("x", 0)).decision).toBe("ignore");
  });

  it("a field with no confidence of its own is never auto (S06 rule)", () => {
    for (const f of Object.keys(FIELD_POLICY)) expect(decide(f, g("x", null)).decision, f).not.toBe("attach");
  });

  it("classifying: attach shows a chip; below 90 is a pre-fill", () => {
    const s = decide("size", g({ amount: 3.5, uom: "g" }, 92));
    expect(s.decision).toBe("attach");
    expect(s.chip).toBe(true);
    expect(decide("size", g({ amount: 3.5, uom: "g" }, 89)).decision).toBe("prefill");
    expect(decide("description", g("x", 99)).chip).toBe(false);
  });

  it("compliance-bearing facts NEVER attach from a web lookup, at any score", () => {
    for (const f of ["cannabinoids", "thc_pct", "cbd_pct", "total_thc_pct", "total_cannabinoids_pct", "servings"]) {
      for (const src of ["gemini", "kb_draft", "kb_published", "manifest", "cultivera"] as const) {
        expect(decide(f, { source: src, value: 22, confidence: 100 }).decision, `${f}/${src}`).not.toBe("attach");
      }
      expect(decide(f, { source: "coa", value: 22, confidence: null }).decision).toBe("attach");
      expect(decide(f, g(22, 100)).reason).toContain("never from a web lookup");
    }
  });

  it("0218 compliance answers: only a person", () => {
    for (const f of ["otherwise_taken", "units_per_package", "low_thc_liquid", "unit_thc_mg"]) {
      for (const src of ["gemini", "coa", "manifest", "kb_published"] as const) {
        expect(decide(f, { source: src, value: true, confidence: 100 }).decision).toBe("ignore");
      }
      expect(decide(f, { source: "human", value: true, confidence: null }).decision).toBe("attach");
    }
  });

  it("images and the existing gates are suggestions, never attached", () => {
    for (const f of ["images", "strain_name", "producer", "ingredients", "allergens", "awards", "category", "website_category", "house_type"]) {
      expect(decide(f, g("x", 100)).decision, f).toBe("suggest");
    }
  });

  it("survivorship: remembered pre-fills, record sources attach where allowed, kb_draft is banded", () => {
    expect(decide("description", { source: "remembered", value: "x", confidence: 100 }).decision).toBe("prefill");
    expect(decide("description", { source: "kb_published", value: "x", confidence: null }).decision).toBe("attach");
    expect(decide("description", { source: "manifest", value: "x", confidence: null }).decision).toBe("attach");
    expect(decide("description", { source: "kb_draft", value: "x", confidence: 95 }).decision).toBe("attach");
    expect(decide("description", { source: "kb_draft", value: "x", confidence: null }).decision).toBe("suggest");
    expect(decide("strain_type", { source: "manifest", value: "sativa", confidence: null }).decision).toBe("attach");
    expect(decide("strain_type", { source: "manifest", value: "sativa", confidence: null }, { kbValue: "indica" }).decision).toBe("prefill");
  });

  it("corroboration needs agreement AND ≥90", () => {
    expect(decide("strain_type", g("indica-hybrid", 90), { kbValue: "Indica Hybrid" }).decision).toBe("attach");
    expect(decide("strain_type", g("hybrid", 89.9), { kbValue: "hybrid" }).decision).toBe("prefill");
    expect(decide("strain_type", g("hybrid", 99)).decision).toBe("prefill");
    expect(decide("strain_type", g("hybrid", 99)).reason).toContain("nothing we hold confirms it");
    expect(decide("strain_type", g("hybrid", 95), { kbValue: "hybrid" }).reason).toBe("95% and the strain library agrees.");
    expect(decide("strain_type", g("hybrid", 95), { manifestValue: "hybrid" }).reason).toBe("95% and the manifest agrees.");
  });

  it("junk is never promoted", () => {
    expect(policyConfidence("95")).toBeNull();
    expect(policyConfidence(-1)).toBeNull();
    expect(policyConfidence(100.01)).toBeNull();
    expect(policyConfidence(Infinity)).toBeNull();
    expect(policyConfidence(0)).toBe(0);
    expect(isEmptyFactValue({ thc_pct: null, cbd_pct: null })).toBe(true);
    expect(isEmptyFactValue({ count: 0 })).toBe(false);
    expect(isEmptyFactValue(0)).toBe(false);
    expect(isEmptyFactValue(false)).toBe(false);
    expect(decide("nope", g("x", 100)).policy).toBeNull();
    expect(decide("constructor", g("x", 100)).decision).toBe("ignore");
  });
});

describe("§13.2 contract + acceptance", () => {
  it("FIELD_POLICY has an entry for every lookup field; every class is known", () => {
    for (const k of LOOKUP_FIELD_KEYS) expect(policyFor(k), k).not.toBeNull();
    for (const [k, c] of Object.entries(FIELD_POLICY)) expect(ATTACH_POLICY_CLASSES, k).toContain(c);
    expect(Object.isFrozen(FIELD_POLICY)).toBe(true);
  });

  it("the S10.2 table, exactly", () => {
    const expected: Record<string, string> = {
      description: "auto", short_description: "auto", effects: "auto", aroma: "auto", flavor: "auto",
      terpenes: "auto", lineage: "auto", brand_description: "auto", images: "review",
      strain_type: "corroborate", website_category: "existing_gate", house_type: "existing_gate",
      cannabinoids: "coa_only",
    };
    for (const [k, v] of Object.entries(expected)) expect(FIELD_POLICY[k], k).toBe(v);
  });

  it("the auto bar is the ONE house 90 (F-026), and the descriptive floor is §5.5's 70", () => {
    expect(ATTACH_AUTO_MIN_CONFIDENCE).toBe(90);
    expect(ATTACH_AUTO_MIN_CONFIDENCE).toBe(LOOKUP_FACT_AUTO_MIN_CONFIDENCE);
    expect(ATTACH_AUTO_MIN_CONFIDENCE).toBe(LOOKUP_AUTO_MIN_CONFIDENCE);
    expect(ATTACH_AUTO_MIN_CONFIDENCE).toBe(HOUSE_TYPE_MIN_AUTO_CONFIDENCE);
    expect(DESCRIPTIVE_SUGGEST_MIN_CONFIDENCE).toBe(70);
    // No field attaches from a banded source below 90.
    for (const f of Object.keys(FIELD_POLICY)) {
      expect(decide(f, g(f === "strain_type" ? "hybrid" : "x", 89.99), { kbValue: "hybrid" }).decision, f).not.toBe("attach");
    }
  });

  it("the owner can read FIELD_POLICY as a table in the file header, one row per field", () => {
    const src = read("src/lib/catalog/fact-attach-policy-core.ts");
    const header = src.slice(0, src.indexOf("*/"));
    expect(header).toContain("FIELD_POLICY — read this table, it is the policy");
    for (const [k, c] of Object.entries(FIELD_POLICY)) {
      expect(header, `header row for ${k}`).toMatch(new RegExp(`\\n \\*  ${k}\\s+${c}\\b`));
    }
    expect(header).toContain("human > COA/manifest > KB published > web lookup ≥90 > web lookup <90");
    expect(header).toContain("DEVIATION NOTE");
  });
});

describe("ring", () => {
  it("default shadow; off-words → 0; junk → shadow; act needs the writer", () => {
    expect(ATTACH_POLICY_RING_ENV).toBe("ATTACH_POLICY_RING");
    expect(ATTACH_POLICY_DEFAULT_RING).toBe(1);
    expect(parseAttachPolicyRing(undefined)).toBe(1);
    expect(parseAttachPolicyRing(null)).toBe(1);
    expect(parseAttachPolicyRing("  ")).toBe(1);
    for (const w of ["0", "off", "OFF", " false ", "no", "disabled"]) expect(parseAttachPolicyRing(w), w).toBe(0);
    for (const w of ["1", "2", "3"]) expect(parseAttachPolicyRing(w)).toBe(Number(w));
    for (const w of ["on", "4", "-1", "2.5", "two", "ring2"]) expect(parseAttachPolicyRing(w), w).toBe(1);
    expect(attachPolicyMode(0)).toBe("off");
    expect(attachPolicyMode(1, true)).toBe("shadow");
    // S07 shipped the writer: rings 2/3 act by default; false still means shadow.
    expect(attachPolicyMode(2)).toBe("act");
    expect(attachPolicyMode(3)).toBe("act");
    expect(attachPolicyMode(2, false)).toBe("shadow");
    expect(attachPolicyMode(3, false)).toBe("shadow");
    expect(attachPolicyMode(2, true)).toBe("act");
    expect(attachPolicyMode(3, true)).toBe("act");
    expect(ATTACH_WRITER_SHIPPED).toBe(true);
  });
});

describe("receipt + footer copy", () => {
  it("act mode is the bible's sentence, byte for byte (S10.4)", () => {
    const s = receiptSentence([decide("description", g("x", 94)), decide("strain_type", g("hybrid", 88))], "act", { strain_type: "hybrid" });
    expect(s).toBe("We found a description at 94% \u2014 attached. Strain type came back 88%, so we pre-filled Hybrid for you to confirm.");
  });

  it("shadow mode says nothing was saved and uses would-verbs", () => {
    const s = receiptSentence([decide("description", g("x", 94)), decide("strain_type", g("hybrid", 88))], "shadow", { strain_type: "hybrid" });
    expect(s).toBe("Preview only \u2014 nothing was saved. We found a description at 94% \u2014 would attach. Strain type came back 88%, so we would pre-fill Hybrid for you to confirm.");
  });

  it("names a contradiction, lists several attaches, counts suggestions; off → empty", () => {
    const s = receiptSentence(
      [decide("description", g("x", 94)), decide("effects", g(["calm"], 91)), decide("strain_type", g("hybrid", 97), { kbValue: "indica" }), decide("images", g(["u"], 99)), decide("awards", g(["a"], 99))],
      "act",
      { strain_type: "hybrid" },
    );
    expect(s).toBe(
      "We found a description at 94% and effects at 91% \u2014 attached. Strain type came back 97%, but the strain library says Indica, so we pre-filled Hybrid for you to confirm. 2 more are suggestions for you to review.",
    );
    expect(receiptSentence([decide("images", g(["u"], 99))], "act")).toBe("1 more is a suggestion for you to review.");
    expect(receiptSentence([decide("description", g("x", 94))], "off")).toBe("");
    expect(receiptSentence([], "act")).toBe("");
    // S07: the lookup preview in act says what Save WILL do - never "attached".
    const pre = receiptSentence([decide("description", g("x", 94)), decide("strain_type", g("hybrid", 88))], "act", { strain_type: "hybrid" }, { onSave: true });
    expect(pre).toBe("Nothing is saved yet. We found a description at 94% \u2014 these attach when you press Save selected. Strain type came back 88%, so Hybrid needs you to confirm it.");
    expect(pre).not.toContain("\u2014 attached");
    expect(receiptSentence([decide("description", g("x", 10))], "act")).toBe("");
  });

  it("footer: shadow wording, ring-2-before-S07 honesty, null ≠ zero, off → empty", () => {
    const sum = summarizeShadowAudit([
      { policy: { attach: 3, prefill: 1, suggest: 2, ignore: 0, fields: { description: "attach", effects: "attach" } } },
      { policy: { attach: 1, prefill: 0, suggest: 0, ignore: 4, fields: { description: "attach" } } },
    ]);
    expect(shadowFooterCopy(sum, 1)).toBe(
      "Auto-attach preview (last 7 days, 2 lookups): would attach 4 \u00b7 pre-fill 1 \u00b7 suggest 2 \u00b7 left alone 4. Most often: description (2), vibe / effects (1). Nothing is auto-attached: Save selected keeps everything for your review. Set ATTACH_POLICY_RING=2 to let 90%+ facts attach on save.",
    );
    expect(shadowFooterCopy(sum, 2, false)).toContain("ATTACH_POLICY_RING=2 is set, but the single write door is switched off in code (ATTACH_WRITER_SHIPPED)");
    // S07: the counts are LOOKUPS, so even in act they never say "attached".
    expect(shadowFooterCopy(sum, 2)).toBe(
      "Auto-attach (last 7 days, 2 lookups): ready to attach on save 4 \u00b7 pre-fill 1 \u00b7 suggest 2 \u00b7 left alone 4. Most often: description (2), vibe / effects (1). Facts attach only when someone presses Save selected; each save shows exactly what landed.",
    );
    expect(shadowFooterCopy(sum, 2)).not.toMatch(/\battached \d/);
    expect(shadowFooterCopy(null, 1)).toBe("Auto-attach preview (last 7 days): counts are unavailable right now.");
    expect(shadowFooterCopy(summarizeShadowAudit([]), 1)).toContain("no lookups yet");
    expect(shadowFooterCopy(sum, 0)).toBe("");
    expect(shadowFooterCopy(summarizeShadowAudit([{ policy: { attach: 1, prefill: 0, suggest: 0, ignore: 0, fields: {} } }]), 1)).toContain("1 lookup)");
  });

  it("summary: top fields ordered by count then name, capped; junk skipped", () => {
    const s = summarizeShadowAudit(
      [
        { policy: { attach: 1, fields: { b: "attach", a: "attach", c: "suggest" } } },
        { policy: { attach: 1, fields: { b: "attach", d: "attach" } } },
        { policy: "nope" },
        { policy: { attach: "5", fields: [] } },
      ],
      2,
    );
    expect(s.lookups).toBe(3);
    expect(s.counts.attach).toBe(2);
    expect(s.topAttach).toEqual([{ field: "b", n: 2 }, { field: "a", n: 1 }]);
    // Ties break by field name, whatever order the rows arrived in.
    expect(summarizeShadowAudit([{ policy: { fields: { zeta: "attach" } } }, { policy: { fields: { alpha: "attach" } } }]).topAttach).toEqual([
      { field: "alpha", n: 1 },
      { field: "zeta", n: 1 },
    ]);
    expect(summarizeShadowAudit(null).lookups).toBe(0);
    expect(summarizeShadowAudit(undefined, -1).topAttach).toEqual([]);
  });
});

describe("decideLookupFacts over a real S06 normalized lookup", () => {
  // RawLookupV2: fields are TOP-LEVEL keys (lookup-facts-core §3).
  const facts = normalizeLookup({
    schema: "lookup.v2",
    found: true,
    overall_confidence: 80,
    description: { value: "A bright citrus sativa.", confidence: 94 },
    short_description: { value: "Bright citrus.", confidence: 72 },
    strain_type: { value: "hybrid", confidence: 88 },
    aroma: { value: ["citrus"], confidence: 50 },
    cannabinoids: { value: { thc_pct: 25 }, confidence: 99 },
    images: { value: ["https://example.com/a.jpg"], confidence: 99 },
  });

  it("decides only fields with a value; counts and audit carry no values", () => {
    const v = decideLookupFacts(facts, { kbStrainType: null, manifestStrainType: null });
    const by = Object.fromEntries(v.map((x) => [x.field, x.decision]));
    expect(by).toEqual({
      strain_type: "prefill",
      description: "attach",
      short_description: "suggest",
      aroma: "ignore",
      cannabinoids: "suggest",
      images: "suggest",
    });
    expect(countDecisions(v)).toEqual({ attach: 1, prefill: 1, suggest: 3, ignore: 1 });
    const audit = policyAuditPayload(1, v);
    expect(audit).toMatchObject({ ring: 1, mode: "shadow", attach: 1, prefill: 1, suggest: 3, ignore: 1 });
    // field -> decision ONLY: every value is a bare decision word.
    expect(audit.fields).toEqual(by);
    expect(Object.values(audit.fields).every((d) => (ATTACH_DECISIONS as readonly string[]).includes(d))).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("citrus");
    expect(JSON.stringify(audit)).not.toContain("example.com");
  });

  it("a person's pick and the strain library flow through", () => {
    expect(decideLookupFacts(facts, { human: { strain_type: "sativa" } }).find((x) => x.field === "strain_type")?.decision).toBe("ignore");
    const agreed = normalizeLookup({ found: true, strain_type: { value: "hybrid", confidence: 96 } });
    expect(decideLookupFacts(agreed, { kbStrainType: "hybrid" })[0]).toMatchObject({ field: "strain_type", decision: "attach", chip: true });
    expect(decideLookupFacts(agreed, { manifestStrainType: "indica" })[0]).toMatchObject({ decision: "prefill" });
  });
});

describe("shadow wiring writes nothing", () => {
  const server = read("src/lib/catalog/fact-attach-policy-server.ts");
  const action = read("src/app/admin/inventory/drafts/ai-lookup-actions.ts");
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const drafts = read("src/lib/inventory/catalog-drafts.ts");

  it("the server module has no writes, one bounded, indexed, named-path read", () => {
    expect(server).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(server).toContain('.select("policy:after_json->policy")');
    expect(server).not.toContain('select("*")');
    expect(server).toContain('.eq("action", LOOKUP_AUDIT_ACTION)');
    expect(server).toContain('.gte("created_at", since)');
    expect(server).toContain('.order("created_at", { ascending: false })');
    expect(server).toContain(".limit(SHADOW_MAX_ROWS)");
    expect(server).toContain('LOOKUP_AUDIT_ACTION = "catalog_draft.ai_lookup"');
    expect(SHADOW_MAX_ROWS).toBe(1000);
    expect(SHADOW_WINDOW_DAYS).toBe(7);
    // The (action, created_at desc) index the read relies on exists.
    expect(read("supabase/migrations/0231_leafly_certification_proof.sql")).toMatch(
      /create index if not exists idx_audit_logs_action_created\s+on public\.audit_logs \(action, created_at desc\)/,
    );
  });

  it("the action logs counts on the audit it already wrote (no new write, no new query)", () => {
    // Same three audit calls as before S10 (lookup, KB draft, enrichment draft)
    // in the lookup + Save paths. R23 added attachWaitingFactAction after them,
    // which writes exactly one audit of its own (the person's attach).
    const waitingAt = action.indexOf("export async function attachWaitingFactAction");
    expect(waitingAt).toBeGreaterThan(0);
    expect(action.slice(0, waitingAt).match(/recordAudit\(/g)?.length).toBe(3);
    expect(action.slice(waitingAt).match(/recordAudit\(/g)?.length).toBe(1);
    expect(action.slice(waitingAt)).toContain('action: "catalog_draft.waiting_fact_attach"');
    expect(action).toContain('action: "catalog_draft.ai_lookup"');
    expect(action).toContain("policy: policyAudit,");
    expect(action).toContain("if (ring !== 0 && outcome.facts)");
    expect(action).not.toMatch(/createSupabaseAdminClient|from\("kb_strains"\)|from\("inventory_lots"\)/);
    // S07 (Round 17): the LOOKUP still writes nothing. The single write door
    // runs only inside the Save selected action, behind ATTACH_FACTS_V2.
    const lookupFn = action.slice(action.indexOf("export async function productLookupAction"), action.indexOf("export async function saveLookupToKbAction"));
    expect(lookupFn.length).toBeGreaterThan(500);
    expect(lookupFn).not.toContain("attachProductFacts");
    const saveFn = action.slice(action.indexOf("export async function saveLookupToKbAction"));
    expect(saveFn).toMatch(/if \(attachFactsV2Enabled\(\)\) \{[\s\S]*?await attachProductFacts\(/);
    // The approver's pick is a PERSON's value: it must reach the policy.
    expect(action).toContain('const humanStrainType = str(formData, "human_strain_type") || null;');
    expect(action).toContain("human: humanStrainType ? { strain_type: humanStrainType } : {},");
    expect(action).toContain('const kbStrainType = str(formData, "kb_strain_type") || null;');
    expect(action).toContain('const manifestStrainType = str(formData, "manifest_strain_type") || null;');
  });

  it("the panel sends the pick + both corroborators and renders the receipt", () => {
    const panel = read("src/app/admin/inventory/drafts/AiLookupPanel.tsx");
    expect(panel).toContain('if (kbStrainType) fd.set("kb_strain_type", kbStrainType);');
    expect(panel).toContain('if (manifestStrainType) fd.set("manifest_strain_type", manifestStrainType);');
    expect(panel).toContain("document.getElementById(strainSelectId)");
    expect(panel).toContain('if (pick) fd.set("human_strain_type", pick);');
    expect(panel).toMatch(/data\.policy && data\.policy\.verdicts\.length > 0 && \(\s*<PolicyReceipt policy=\{data\.policy\} \/>/);
    // The strain select's empty option is "Keep auto" (value ""), so an untouched
    // select sends NO human pick - never a false "person decided".
    expect(page).toMatch(/id=\{`strain-type-\$\{d\.id\}`\}\s+name="strain_type"\s+defaultValue=""/);
  });

  it("the page reads strain evidence from the SAME two reads, and skips the footer read at ring 0", () => {
    expect(page).toContain("loadStrainTypeSignals(drafts)");
    expect(page).toContain("attachRing === 0 ? Promise.resolve(null) : loadShadowSummary()");
    expect(page).toContain('data-testid="attach-policy-shadow-footer"');
    expect(page).not.toContain("loadStrainTypeSuggestions(");
    expect(page).toContain("kbStrainType={strainEvidence.get(d.id)?.kb ?? null}");
    expect(page).toContain("manifestStrainType={strainEvidence.get(d.id)?.manifest ?? null}");
    // loadStrainTypeSignals still does exactly one kb_strains + one inventory_lots read.
    const fn = drafts.slice(drafts.indexOf("export async function loadStrainTypeSignals"), drafts.indexOf("export async function approveDraftWithPrice"));
    expect(fn.match(/from\("kb_strains"\)/g)?.length).toBe(1);
    expect(fn.match(/from\("inventory_lots"\)/g)?.length).toBe(1);
    expect(fn).toContain("evidence.set(d.id, { kb, manifest })");
  });
});

describe("panel receipt renders", () => {
  it("shadow heading + per-field reasons; act heading says it attaches on Save selected", async () => {
    const { PolicyReceipt } = await import("@/app/admin/inventory/drafts/AiLookupPanel");
    const base = {
      ring: 1 as const,
      receipt: "Preview only \u2014 nothing was saved. We found a description at 94% \u2014 would attach.",
      verdicts: [
        { field: "description", decision: "attach" as const, reason: "94% confident.", chip: false },
        { field: "strain_type", decision: "prefill" as const, reason: "Only 88%, so it's pre-filled for you to confirm.", chip: false },
      ],
    };
    const html = renderToStaticMarkup(createElement(PolicyReceipt, { policy: { ...base, mode: "shadow" } }));
    expect(html).toContain("Auto-attach preview (nothing saved)");
    expect(html).toContain("Description");
    expect(html).toContain("Auto-attach");
    expect(html).toContain("Pre-fill to confirm");
    expect(html).toContain("94% confident.");
    expect(html).toContain('data-testid="attach-policy-receipt"');
    const act = renderToStaticMarkup(createElement(PolicyReceipt, { policy: { ...base, ring: 2, mode: "act" } }));
    // Act mode is still a PREVIEW until Save selected is pressed (S07 writes on save only).
    expect(act).toContain("Auto-attach on Save selected (nothing saved yet)");
    expect(act).not.toContain("Auto-attach preview (nothing saved)");
  });
});

describe("pure self-tests", () => {
  it("embedded tests pass and are registered in the runner", () => {
    const r = __runFactAttachPolicyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(100);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(
      /assertRan\("fact-attach-policy-core", __runFactAttachPolicyCoreTests\(\), 100\)/,
    );
  });
});
