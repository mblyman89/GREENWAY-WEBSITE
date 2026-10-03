/**
 * tests/compliance/r24-s20-slug-core-brand.test.ts  (R24 follow-up: S20)
 *
 * Owner (R24, verbatim): "Please build S36 as one pr, then build the three
 * small follow ups, each as their own pr. ... Follow the standing rules and
 * never guess, never assume. Test it, test the tests."
 *
 * Two halves:
 *   A/B. F-053 shared slug-core: the two KB slug conventions live in ONE
 *        file, every former private copy delegates to it, and the rule is
 *        byte-for-byte the legacy rule (characterization / golden-master:
 *        the legacy bodies are frozen HERE as the oracle and compared over a
 *        large generated corpus, so a refactor that changes one output fails).
 *   C/D. Bible 19.19 "Next fixes": card-identity `loadPublishedEnrichmentBrands`
 *        by identity. Driven END TO END through the real withCardIdentity
 *        and the real shared S20 identity read (postgrest-js on FakePostgrest).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

vi.mock("server-only", () => ({}));
// Pass-through spy on the REAL shared identity reader: behaviour unchanged,
// but "the card path did not even call it" becomes observable.
const idSpy = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/enrichment/enrichment-identity-server", async (orig) => {
  const m = (await orig()) as typeof import("@/lib/enrichment/enrichment-identity-server");
  return {
    ...m,
    loadPublishedEnrichmentsByIdentity: (...args: Parameters<typeof m.loadPublishedEnrichmentsByIdentity>) => {
      idSpy.calls.push(args);
      return m.loadPublishedEnrichmentsByIdentity(...args);
    },
  };
});
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});

import { dashedSlug, strainSlug, __runSlugCoreTests } from "@/lib/catalog/slug-core";
import * as identityCore from "@/lib/catalog/product-identity-core";
import { slugifyDashed as batchDashed, strainSlugOf } from "@/lib/ai/kb/product-knowledge-batch-core";
import { slugifyDashedPure } from "@/lib/ai/kb/ccrs-category-match-core";
import { slugifyDashed as growflowDashed } from "@/lib/purchasing/growflow-kb-link-core";
import { slugifyDashed as cultiveraDashed } from "@/lib/purchasing/cultivera-kb-link-core";
import {
  resolveCardBrandIds,
  identityKeysNeedingBrand,
  __runCardIdentityCoreTests,
} from "@/lib/menu/card-identity-core";
import { withCardIdentity } from "@/lib/menu/card-identity";
import { ENRICHMENT_IDENTITY_ENV } from "@/lib/enrichment/enrichment-identity-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

// --- The ORACLE: the legacy bodies, frozen verbatim from main before R24. ---
const legacyDashed = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const legacySpaced = (value: string | null | undefined): string => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** The inline staging/injection form: `d.strain_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""`. */
const legacyInlineOptional = (v: string | null | undefined): string => v?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";

/** Deterministic corpus (mulberry32): punctuation, unicode, whitespace kinds, edges. */
function corpus(n: number): string[] {
  let a = 0x5eed1234;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const alphabet = [..."abcXYZ019 -_.&%#!/()'\"", "\t", "\n", "\u00a0", "\u2003", "é", "Ä", "ß", "İ", "😀", "—", "·", "\u200b"];
  const out = [
    "", " ", "  ", "-", "---", "Phat Panda", "Blue Dream 3.5g", "  Blue  Dream  ", "Sweet & Sour", "ÄÖÜ strain",
    "100% Pure!", "a__b  c", "CERES - 435011", "Girl Scout Cookies #4", "İstanbul Kush", "\u00a0Lemon\u00a0Haze\u00a0", "Blue-Dream",
  ];
  for (let i = 0; i < n; i++) {
    const len = Math.floor(rnd() * 24);
    let s = "";
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    out.push(s);
  }
  return out;
}
const CORPUS = corpus(4000);

describe("A. slug-core: one rule, byte-identical to the legacy rule (golden master)", () => {
  it("embedded self-tests pass at the exact floor", () => {
    expect(__runSlugCoreTests()).toEqual({ passed: 30, failed: 0 });
  });

  it("dashedSlug === the legacy dashed body for every corpus string (and null/undefined)", () => {
    for (const s of [...CORPUS, null, undefined]) expect(dashedSlug(s), JSON.stringify(s)).toBe(legacyDashed(s));
  });

  it("strainSlug === the legacy spaced body for every corpus string (and null/undefined)", () => {
    for (const s of [...CORPUS, null, undefined]) expect(strainSlug(s), JSON.stringify(s)).toBe(legacySpaced(s));
  });

  it("strainSlug === the inline optional-chain form the staging/injection/approve reads used", () => {
    for (const s of [...CORPUS, null, undefined]) expect(strainSlug(s), JSON.stringify(s)).toBe(legacyInlineOptional(s));
  });

  it("every exported former copy now returns exactly slug-core's answer", () => {
    for (const s of CORPUS) {
      const d = dashedSlug(s);
      expect(batchDashed(s)).toBe(d);
      expect(slugifyDashedPure(s)).toBe(d);
      expect(growflowDashed(s)).toBe(d);
      expect(cultiveraDashed(s)).toBe(d);
      expect(identityCore.dashedSlug(s)).toBe(d);
      expect(identityCore.strainSlug(s)).toBe(strainSlug(s));
      expect(strainSlugOf(s)).toBe(strainSlug(s) || null);
    }
  });

  it("the two conventions are NOT unified (spaced vs dashed for the same words)", () => {
    expect(strainSlug("Blue  Dream")).toBe("blue dream");
    expect(dashedSlug("Blue  Dream")).toBe("blue-dream");
    expect(strainSlug("Blue Dream 3.5g")).toBe("blue dream 3.5g");
    expect(dashedSlug("Blue Dream 3.5g")).toBe("blue-dream-3-5g");
  });
});

describe("B. slug-core: every KB slug site delegates (no private copy of the rule is left)", () => {
  const DASH_BODY = /\.replace\(\/\[\^a-z0-9\]\+\/g, "-"\)\s*\.replace\(\/\^-\+\|-\+\$\/g, ""\)/;
  const SPACED_BODY = 'toLowerCase().replace(/\\s+/g, " ")';
  const DELEGATES: Record<string, string[]> = {
    "src/lib/ai/kb/writeback.ts": ["return dashedSlug(value);", "return sharedStrainSlug(value);"],
    "src/lib/ai/kb/intake.ts": ["return dashedSlug(value);"],
    "src/lib/ai/kb/retrieval.ts": ["return dashedSlug(value);"],
    "src/lib/kb/enrich-from-discovery.ts": ["return dashedSlug(value);"],
    // R25 B (pin updated on purpose): store.ts's private slugifyName wrapper is
    // gone; the dashed KB forms (brand / category / FAQ) now resolve through
    // planKbSlug in kb-slug-input-core, which itself delegates to slug-core's
    // dashedSlug (pinned in the kb-slug-input-core entry below).
    "src/lib/ai/kb/store.ts": ["return planKbSlug({ typed: t, fallbackName, existingExact });", "const slug = strainSlug(input.slug?.trim() || name);"],
    "src/lib/catalog/kb-slug-input-core.ts": ["const slug = dashedSlug(typed);", "const slug = dashedSlug(input.fallbackName);"],
    "src/lib/ai/kb/product-knowledge-batch-core.ts": ["return dashedSlug(value);", "const slug = sharedStrainSlug(strainName);"],
    "src/lib/ai/kb/ccrs-category-match-core.ts": ["return dashedSlug(value);"],
    "src/lib/purchasing/growflow-kb-link-core.ts": ["return dashedSlug(value);"],
    "src/lib/purchasing/cultivera-kb-link-core.ts": ["return dashedSlug(value);"],
    "src/lib/inventory/catalog-drafts.ts": [".map((d) => strainSlug(d.strain_name))", "const slug = strainSlug(d.strain_name);", "const slug = strainSlug(name);"],
    "src/lib/pos/draft-injection.ts": [".map((d) => strainSlug(d.strain_name))", "const slug = strainSlug(d.strain_name);"],
    "src/lib/pos/intake-menu-staging.ts": [".map((d) => strainSlug(d.strain_name))", "const slug = strainSlug(d.strain_name);"],
    "src/lib/ai/kb/product-lookup.ts": ["const slug = strainSlug(query.strainName);"],
  };
  for (const [file, needles] of Object.entries(DELEGATES)) {
    it(`${file} delegates to slug-core and keeps no private copy`, () => {
      const src = read(file);
      expect(src).toMatch(/from "@\/lib\/catalog\/slug-core";/);
      for (const n of needles) expect(src, n).toContain(n);
      expect(src).not.toMatch(DASH_BODY);
      // kb_strains slug sites: the spaced rule is no longer written inline.
      if (!file.endsWith("cultivera-kb-link-core.ts")) expect(src).not.toContain(SPACED_BODY);
    });
  }

  it("slug-core is the only home of the dashed KB rule among the KB/catalog modules", () => {
    expect(read("src/lib/catalog/slug-core.ts")).toMatch(DASH_BODY);
    expect(read("src/lib/catalog/product-identity-core.ts")).not.toMatch(DASH_BODY);
    expect(read("src/lib/catalog/product-identity-core.ts")).toContain("export { dashedSlug, strainSlug };");
  });

  it("slug-core is pure (no imports) and registered at its exact floor", () => {
    expect(read("src/lib/catalog/slug-core.ts")).not.toMatch(/^import /m);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("slug-core", __runSlugCoreTests(), 30);');
  });
});

// ---------------------------------------------------------------------------
const ID = "grow-op-farms|flower|blue-dream";
const BRAND_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const BRAND_OWN = "aaaaaaaa-0000-4000-8000-0000000000b0";
const prevEnv = process.env[ENRICHMENT_IDENTITY_ENV];

function enrichment(over: Row & { pos_product_key: string }): Row {
  return { id: `e-${over.pos_product_key}`, status: "published", updated_at: "2026-01-01T00:00:00Z", identity_key: null, brand_id: null, ...over };
}
function pre0234(req: FakeRequest): { status: number; body: unknown } | void {
  const sel = req.url.searchParams.get("select") ?? "";
  if (req.table === "product_enrichments" && (sel.includes("identity_key") || req.url.searchParams.has("identity_key"))) {
    return { status: 400, body: { code: "42703", details: null, hint: null, message: "column product_enrichments.identity_key does not exist" } };
  }
}
const identityReads = () =>
  st.db.log.filter((r) => r.table === "product_enrichments" && (r.url.searchParams.get("identity_key") ?? "").startsWith("in."));
const card = (id: string, identityKey: string | null | undefined, brand = "Row Brand") => ({ id, brand, vendor: undefined, name: id, identityKey });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.rows("brands").push(
    { id: BRAND_A, display_name: "Grow Op Farms" },
    { id: BRAND_OWN, display_name: "Own Brand" },
  );
  delete process.env[ENRICHMENT_IDENTITY_ENV];
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env[ENRICHMENT_IDENTITY_ENV];
  else process.env[ENRICHMENT_IDENTITY_ENV] = prevEnv;
  vi.restoreAllMocks();
});

describe("C. card-identity-core: the brand ladder (pure)", () => {
  it("embedded self-tests pass at the exact floor (34), now with a real count", () => {
    expect(__runCardIdentityCoreTests()).toEqual({ passed: 34, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("card-identity-core", __runCardIdentityCoreTests(), 34);');
  });
  it("own > identity > nothing; never itself; unknown never matches", () => {
    const surv = new Map([[ID, { pos_product_key: "CARD-A", brand_id: BRAND_A }]]);
    const r = resolveCardBrandIds(
      [{ id: "LOT-7", identityKey: ID }, { id: "LOT-8", identityKey: ID }, { id: "CARD-A", identityKey: ID }, { id: "LOT-9", identityKey: "" }],
      new Map([["LOT-8", BRAND_OWN]]),
      surv,
    );
    expect(Object.fromEntries(r)).toEqual({
      "LOT-7": { brandId: BRAND_A, via: "identity" },
      "LOT-8": { brandId: BRAND_OWN, via: "own" },
    });
    expect(identityKeysNeedingBrand([{ id: "LOT-8", identityKey: ID }], new Map([["LOT-8", BRAND_OWN]]))).toEqual([]);
  });
});

describe("D. withCardIdentity: the brand label follows the product (end to end)", () => {
  it("every card has its own brand link -> the shared identity reader is never called", async () => {
    idSpy.calls.length = 0;
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "LOT-7", identity_key: ID, brand_id: BRAND_OWN }),
      enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }),
    );
    await withCardIdentity([card("LOT-7", ID), card("CARD-A", ID)]);
    expect(idSpy.calls).toHaveLength(0);
    // control: a card that needs it DOES call it, once, with exactly its identity
    await withCardIdentity([card("LOT-9", ID)]);
    expect(idSpy.calls).toHaveLength(1);
    expect(idSpy.calls[0][0]).toEqual([ID]);
    expect(idSpy.calls[0][1]).toBe("brand_id");
  });

  it("a restock lot card with no own brand link shows its product's published brand", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }));
    const [lot, live] = await withCardIdentity([card("LOT-7", ID), card("CARD-A", ID)]);
    expect(lot.brand).toBe("Grow Op Farms");
    expect(live.brand).toBe("Grow Op Farms"); // its own row, read by key as before
  });

  it("the card's OWN brand link wins over its product's (Q-03)", async () => {
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }),
      enrichment({ pos_product_key: "LOT-7", identity_key: ID, brand_id: BRAND_OWN, updated_at: "2025-01-01T00:00:00Z" }),
    );
    const [lot] = await withCardIdentity([card("LOT-7", ID)]);
    expect(lot.brand).toBe("Own Brand");
    // It had its own link, so it never asked the identity read.
    expect(identityReads()).toHaveLength(0);
  });

  it("a DRAFT enrichment is never borrowed", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A, status: "draft" }));
    const [lot] = await withCardIdentity([card("LOT-7", ID)]);
    expect(lot.brand).toBe("Row Brand");
  });

  it("a survivor with no brand link lends nothing (the row's brand stays)", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: null }));
    const [lot] = await withCardIdentity([card("LOT-7", ID)]);
    expect(lot.brand).toBe("Row Brand");
  });

  it("survivorship: the NEWEST published row's brand is shown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "OLD", identity_key: ID, brand_id: BRAND_OWN, updated_at: "2026-01-01T00:00:00Z" }),
      enrichment({ pos_product_key: "NEW", identity_key: ID, brand_id: BRAND_A, updated_at: "2026-03-01T00:00:00Z" }),
    );
    const [lot] = await withCardIdentity([card("LOT-7", ID)]);
    expect(lot.brand).toBe("Grow Op Farms");
  });

  it("no identity on the card -> no identity read, row brand kept", async () => {
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }));
    const [a, b] = await withCardIdentity([card("LOT-7", undefined), card("LOT-8", "  ")]);
    expect(a.brand).toBe("Row Brand");
    expect(b.brand).toBe("Row Brand");
    expect(identityReads()).toHaveLength(0);
  });

  it("ONE identity read for many cards, asking only the identities that need it, published-only on the wire", async () => {
    st.db.rows("product_enrichments").push(
      enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }),
      enrichment({ pos_product_key: "CARD-B", identity_key: "x|y|z", brand_id: BRAND_OWN }),
    );
    await withCardIdentity([card("LOT-1", ID), card("LOT-2", ID), card("CARD-B", "x|y|z")]);
    const reads = identityReads();
    expect(reads).toHaveLength(1);
    const asked = reads[0].url.searchParams.get("identity_key") ?? "";
    expect(asked).toContain(ID);
    expect(asked).not.toContain("x|y|z"); // CARD-B has its own link
    expect(reads[0].url.searchParams.get("status")).toBe("eq.published");
    expect((reads[0].url.searchParams.get("select") ?? "").split(",").map((c) => c.trim())).toContain("brand_id");
  });

  it("flag OFF: exactly pre-S20 (own key only, no identity request)", async () => {
    process.env[ENRICHMENT_IDENTITY_ENV] = "off";
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }));
    const [lot, live] = await withCardIdentity([card("LOT-7", ID), card("CARD-A", ID)]);
    expect(lot.brand).toBe("Row Brand");
    expect(live.brand).toBe("Grow Op Farms");
    expect(identityReads()).toHaveLength(0);
  });

  it("pre-0234 database: own-key labels still work, no throw, no error log", async () => {
    st.db.before = pre0234;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }));
    const [lot, live] = await withCardIdentity([card("LOT-7", ID), card("CARD-A", ID)]);
    expect(lot.brand).toBe("Row Brand");
    expect(live.brand).toBe("Grow Op Farms");
    expect(err).not.toHaveBeenCalled();
  });

  it("an identity read error never costs the own-key labels", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    st.db.before = (req) =>
      req.table === "product_enrichments" && req.url.searchParams.has("identity_key") ? { status: 500, body: { code: "XX000", message: "boom" } } : undefined;
    st.db.rows("product_enrichments").push(enrichment({ pos_product_key: "CARD-A", identity_key: ID, brand_id: BRAND_A }));
    const [lot, live] = await withCardIdentity([card("LOT-7", ID), card("CARD-A", ID)]);
    expect(lot.brand).toBe("Row Brand");
    expect(live.brand).toBe("Grow Op Farms");
  });

  it("source pins: the shared S20 read with a named column, the existing paging pins intact", () => {
    const src = read("src/lib/menu/card-identity.ts");
    expect(src).toContain('loadPublishedEnrichmentsByIdentity<BrandSurvivor>(needIdentity, "brand_id", admin)');
    expect(src).toContain("resolveCardBrandIds(items, ownBrandIdByKey, survivors)");
    expect(src).toContain("loadPublishedEnrichmentBrands(items)");
    expect(src).not.toMatch(/from\("product_enrichments"\)[\s\S]{0,80}identity_key/);
  });
});
