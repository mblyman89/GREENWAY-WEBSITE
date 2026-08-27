/**
 * Second gate for `ledger-category-map-core.ts`.
 *
 * The module's own self-tests prove it is internally consistent. This file
 * proves it agrees with the REST of the system, which the module cannot do
 * itself because it is a zero-import leaf:
 *
 *   1. its 21 slots equal `coa-core.INVENTORY_CATEGORIES`
 *   2. its 21 slots equal `cutover-inventory-core.CUTOVER_CATEGORY_SLOTS`
 *   3. its accounts exist in migration 0173's real seed text
 *   4. it diverges from the WEBSITE map in exactly the four decided places
 *   5. it covers every category in Michael's real export
 *
 * Guard 4 is the point of the slice. Michael decided, verbatim: "the ledger
 * should use its own accounts and not the website map." A divergence that is
 * merely commented rots. A divergence pinned by a test that names each of the
 * four cannot.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  LEDGER_CATEGORY_MAP,
  LEDGER_CATEGORY_SLOTS,
  LEDGER_ONLY_OVERRIDES,
  MEASURED_CATEGORY_COUNT,
  UNSTOCKED_MAPPED_CATEGORIES,
  __runLedgerCategoryMapCoreTests,
  ledgerAccountForSlug,
  ledgerMapTargetAccounts,
  resolveLedgerCategory,
  resolveLedgerCategoryIn,
  resolveLedgerLotCategory,
} from "../../src/lib/accounting/ledger-category-map-core";
import { INVENTORY_CATEGORIES } from "../../src/lib/accounting/coa-core";
import { CUTOVER_CATEGORY_SLOTS } from "../../src/lib/accounting/cutover-inventory-core";

const REPO = path.resolve(__dirname, "..", "..");
const MODULE_PATH = path.join(REPO, "src", "lib", "accounting", "ledger-category-map-core.ts");
const WEBSITE_MAP_PATH = path.join(REPO, "src", "lib", "pos", "transform.ts");
const MIGRATION_PATH = path.join(REPO, "supabase", "migrations", "0173_chart_of_accounts.sql");

/** Remove block and line comments so a dependency guard cannot be fooled by
 *  prose that legitimately mentions the thing it forbids depending on. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Parse `CATEGORY_MAP` out of the website transform SOURCE, so the guard
 *  cannot drift from the code the way a retyped copy would. */
function parseWebsiteCategoryMap(): Record<string, string> {
  const src = fs.readFileSync(WEBSITE_MAP_PATH, "utf8");
  const start = src.indexOf("const CATEGORY_MAP");
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  const close = src.indexOf("\n};", open);
  expect(close).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  const out: Record<string, string> = {};
  const re = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2];
  return out;
}

describe("ledger-category-map-core: the module's own self-tests", () => {
  it("passes its embedded self-test suite", () => {
    expect(() => __runLedgerCategoryMapCoreTests()).not.toThrow();
  });
});

describe("ledger-category-map-core: parity with the chart of accounts", () => {
  it("holds exactly the same 21 slugs and slots as coa-core.INVENTORY_CATEGORIES", () => {
    const mine = LEDGER_CATEGORY_SLOTS.map((r) => `${r.slug}:${r.slot}`);
    const coa = INVENTORY_CATEGORIES.map((c) => `${c.slug}:${c.slot}`);
    expect(mine).toEqual(coa);
  });

  it("holds exactly the same slots as cutover-inventory-core, the other restated copy", () => {
    const mine = LEDGER_CATEGORY_SLOTS.map((r) => `${r.slug}:${r.slot}`);
    const cut = CUTOVER_CATEGORY_SLOTS.map((r) => `${r.slug}:${r.slot}`);
    expect(mine).toEqual(cut);
  });

  it("computes the same account for every slug that cutover-inventory-core does", () => {
    for (const row of LEDGER_CATEGORY_SLOTS) {
      const code = ledgerAccountForSlug(row.slug);
      expect(code).toBe("2" + String(row.slot).padStart(4, "0"));
    }
  });

  it("every account it can emit is really seeded by migration 0173", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
    const targets = ledgerMapTargetAccounts();
    expect(targets.length).toBeGreaterThan(0);
    for (const code of targets) {
      expect(sql.includes(`'${code}'`)).toBe(true);
    }
  });

  it("never emits the 20890 quarantine account or the 20000 control account", () => {
    const targets = ledgerMapTargetAccounts();
    expect(targets).not.toContain("20890");
    expect(targets).not.toContain("20000");
  });
});

describe("ledger-category-map-core: the decided divergence from the website map", () => {
  it("does not import the website map (it is a zero-import leaf)", () => {
    const src = fs.readFileSync(MODULE_PATH, "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/^\s*export\s+\{[^}]*\}\s+from\s/m);
    // The header NAMES the website map in prose on purpose, so the guard must
    // target a real dependency, not a mention.
    expect(src).not.toMatch(/from\s+["'][^"']*pos\/transform/);
    // The header NAMES the website map in prose on purpose, so the dependency
    // guards run against CODE ONLY, with comments stripped.
    const code = stripComments(src);
    expect(code).not.toContain("transform");
    expect(code).not.toMatch(/(?:^|[^A-Z_])CATEGORY_MAP\b/m);
    expect(code).not.toContain("require");
  });

  it("diverges from the website map in EXACTLY the four decided places", () => {
    const website = parseWebsiteCategoryMap();
    const declared = new Map(LEDGER_ONLY_OVERRIDES.map((o) => [o.category, o]));

    const actual: string[] = [];
    for (const cat of Object.keys(LEDGER_CATEGORY_MAP)) {
      const w = website[cat];
      if (w === undefined) continue; // covered by its own test below
      if (w !== LEDGER_CATEGORY_MAP[cat]) actual.push(cat);
    }

    expect(actual.sort()).toEqual(Array.from(declared.keys()).sort());
  });

  it("each declared override records the website slug the website map really has", () => {
    const website = parseWebsiteCategoryMap();
    for (const o of LEDGER_ONLY_OVERRIDES) {
      expect(website[o.category]).toBe(o.websiteSlug);
      expect(LEDGER_CATEGORY_MAP[o.category]).toBe(o.ledgerSlug);
    }
  });

  it("routes the four overrides to the dedicated accounts D-50 measured", () => {
    const expected: Record<string, string> = {
      RSO: "20150",
      Tincture: "20180",
      "Infused Blunt": "20100",
      Blunt: "20070",
    };
    for (const [cat, code] of Object.entries(expected)) {
      const r = resolveLedgerCategory(cat);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.accountCode).toBe(code);
    }
  });

  it("the four overrides carry the $6,900.07 D-50 measured", () => {
    const sum = LEDGER_ONLY_OVERRIDES.reduce((a, o) => a + o.valueCents, 0);
    expect(sum).toBe(690007);
    expect(LEDGER_ONLY_OVERRIDES.reduce((a, o) => a + o.rows, 0)).toBe(147);
  });

  it("agrees with the website map everywhere it is NOT an override", () => {
    const website = parseWebsiteCategoryMap();
    const overridden = new Set(LEDGER_ONLY_OVERRIDES.map((o) => o.category));
    let compared = 0;
    for (const cat of Object.keys(LEDGER_CATEGORY_MAP)) {
      if (overridden.has(cat)) continue;
      const w = website[cat];
      if (w === undefined) continue;
      expect(LEDGER_CATEGORY_MAP[cat]).toBe(w);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(40);
  });

  it("covers every category the website map covers, so the books cannot be blinder than the menu", () => {
    const website = parseWebsiteCategoryMap();
    const missing = Object.keys(website).filter(
      (k) => !Object.prototype.hasOwnProperty.call(LEDGER_CATEGORY_MAP, k),
    );
    expect(missing).toEqual([]);
  });
});

describe("ledger-category-map-core: measured coverage and honest counts", () => {
  it("states the measured count and the one mapped-but-unstocked category", () => {
    expect(MEASURED_CATEGORY_COUNT).toBe(52);
    expect(UNSTOCKED_MAPPED_CATEGORIES).toEqual(["Trim"]);
    expect(Object.keys(LEDGER_CATEGORY_MAP).length).toBe(53);
  });

  it("the unstocked category is a real chart category with a real account", () => {
    for (const cat of UNSTOCKED_MAPPED_CATEGORIES) {
      const r = resolveLedgerCategory(cat);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.accountCode).toBe("20040");
    }
  });

  it("emits 16 distinct inventory accounts, all in block 2", () => {
    const targets = ledgerMapTargetAccounts();
    expect(targets.length).toBe(16);
    for (const c of targets) expect(c).toMatch(/^2\d{4}$/);
  });

  it("the five chart categories the export never stocked are absent from the map, not silently aliased", () => {
    // preroll-pack, infused-preroll-pack, accessories, paraphernalia, merch have
    // no Cultivera category in the measured export. They must NOT appear as map
    // values, or something is being routed there without evidence.
    const values = new Set(Object.values(LEDGER_CATEGORY_MAP));
    for (const slug of [
      "preroll-pack",
      "infused-preroll-pack",
      "accessories",
      "paraphernalia",
      "merch",
    ]) {
      expect(values.has(slug)).toBe(false);
      // but the account still exists, so a future category can be mapped to it
      expect(ledgerAccountForSlug(slug)).not.toBeNull();
    }
  });
});

describe("ledger-category-map-core: refusals are reachable, not decoration", () => {
  it("CATEGORY_MISSING for null, undefined, empty and whitespace", () => {
    for (const bad of [null, undefined, "", "   ", "\t\n "]) {
      const r = resolveLedgerCategory(bad as string | null | undefined);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("CATEGORY_MISSING");
    }
  });

  it("CATEGORY_UNKNOWN names the offending category instead of routing it anywhere", () => {
    const r = resolveLedgerCategory("Reclaim Slurry");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CATEGORY_UNKNOWN");
      expect(r.message).toContain("Reclaim Slurry");
    }
  });

  it("a prototype key cannot be smuggled in as a category", () => {
    for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const r = resolveLedgerCategory(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("CATEGORY_UNKNOWN");
    }
  });

  it("case and whitespace drift resolves, and reports whether it folded", () => {
    const exact = resolveLedgerCategory("Flower");
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.foldedCase).toBe(false);

    for (const v of ["flower", "FLOWER", "  fLoWeR  "]) {
      const r = resolveLedgerCategory(v);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.accountCode).toBe("20010");
        expect(r.matchedKey).toBe("Flower");
        expect(r.foldedCase).toBe(true);
      }
    }
  });

  it("collapses interior whitespace runs, including non-breaking spaces", () => {
    const r = resolveLedgerCategory("Infused\u00a0 Pre-roll");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accountCode).toBe("20080");
  });

  it("no two map keys collide under case folding with disagreeing slugs", () => {
    const byLower = new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(LEDGER_CATEGORY_MAP)) {
      const lk = k.toLowerCase();
      if (!byLower.has(lk)) byLower.set(lk, new Set());
      byLower.get(lk)!.add(v);
    }
    for (const [lk, slugs] of byLower) {
      expect(slugs.size, `case-folding "${lk}" is ambiguous`).toBe(1);
    }
  });
});

describe("ledger-category-map-core: Category wins over InventoryType", () => {
  it("refuses when only InventoryType is available, and says why", () => {
    const r = resolveLedgerLotCategory({
      category: null,
      inventoryType: "Concentrate for Inhalation",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INVENTORY_TYPE_IS_NOT_A_KEY");
      // The message must TEACH, not just refuse. Michael is a visual learner and
      // the whole point of naming the two accounts is that he can see which one
      // the shortcut would have hit. A mutation that strips these survived once.
      expect(r.message).toContain("20140");
      expect(r.message).toContain("20080");
      expect(r.message).toContain("532");
      expect(r.message).toContain("617");
      expect(r.message).toContain("InventoryType is not a routing key");
      expect(r.message).toContain("Concentrate for Inhalation");
    }
  });

  it("the real infused-preroll trap: a misleading InventoryType does not move the account", () => {
    const r = resolveLedgerLotCategory({
      category: "Infused Pre-roll",
      inventoryType: "Concentrate for Inhalation",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.accountCode).toBe("20080");
      expect(r.accountCode).not.toBe("20140");
    }
  });

  it("Infused Blunt beats its InventoryType and lands in its own account", () => {
    const r = resolveLedgerLotCategory({
      category: "Infused Blunt",
      inventoryType: "Concentrate for Inhalation",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accountCode).toBe("20100");
  });

  it("Usable Marijuana as an InventoryType never rescues an unknown category", () => {
    const r = resolveLedgerLotCategory({
      category: "Space Waffles",
      inventoryType: "Usable Marijuana",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CATEGORY_UNKNOWN");
  });

  it("a present InventoryType changes NOTHING about a successful Category result", () => {
    // M18 survived a campaign by preferring the InventoryType result whenever it
    // also resolved. So compare the full object against the Category-only path
    // for every category in the map, under a deliberately misleading type.
    for (const cat of Object.keys(LEDGER_CATEGORY_MAP)) {
      const bare = resolveLedgerLotCategory({ category: cat });
      for (const misleading of ["Flower", "Concentrate for Inhalation", "Usable Marijuana", "Edible"]) {
        const withType = resolveLedgerLotCategory({ category: cat, inventoryType: misleading });
        expect(withType, `${cat} + ${misleading} must equal the Category-only result`).toEqual(bare);
      }
    }
  });

  it("an absent InventoryType changes nothing", () => {
    const a = resolveLedgerLotCategory({ category: "Blunt" });
    const b = resolveLedgerLotCategory({ category: "Blunt", inventoryType: null });
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.accountCode).toBe("20070");
  });
});

describe("ledger-category-map-core: the future-proofing guards, reached with hostile maps", () => {
  it("CATEGORY_AMBIGUOUS fires when two keys case-fold onto disagreeing slugs", () => {
    const r = resolveLedgerCategoryIn({ RSO: "rso", rso: "concentrate" }, "RsO");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CATEGORY_AMBIGUOUS");
      expect(r.message).toContain("rso");
      expect(r.message).toContain("concentrate");
    }
  });

  it("an ambiguous fold is NOT resolved by picking the first hit", () => {
    const r = resolveLedgerCategoryIn({ Blunt: "blunt", BLUNT: "preroll" }, "blunt");
    expect(r.ok).toBe(false);
  });

  it("SLUG_HAS_NO_ACCOUNT fires when a category points at a slug with no account", () => {
    const r = resolveLedgerCategoryIn({ Ghost: "not-a-real-slug" }, "Ghost");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("SLUG_HAS_NO_ACCOUNT");
      expect(r.message).toContain("not-a-real-slug");
    }
  });

  it("the shipped map itself can reach NEITHER guard, which is why they are parameterised", () => {
    for (const cat of Object.keys(LEDGER_CATEGORY_MAP)) {
      const r = resolveLedgerCategory(cat);
      expect(r.ok).toBe(true);
    }
  });

  it("a case-fold with agreeing slugs reports the FIRST matching key, deterministically", () => {
    // M15b survived by taking hits[hits.length - 1]. When two keys fold together
    // and agree on the slug there is no ambiguity to refuse, but matchedKey is
    // evidence Michael's report prints, so it must be stable and it must be the
    // first declared key, not the last.
    const r = resolveLedgerCategoryIn({ RSO: "rso", rso: "rso" }, "RsO");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matchedKey).toBe("RSO");
      expect(r.accountCode).toBe("20150");
      expect(r.foldedCase).toBe(true);
    }
  });

  it("the shipped wrapper passes the shipped map EXACTLY, adding nothing", () => {
    // M29c survived by injecting an extra key into the map the wrapper passes.
    // Nothing outside the declared 53 keys may resolve through the public door.
    const declared = new Set(Object.keys(LEDGER_CATEGORY_MAP).map((k) => k.toLowerCase()));
    for (const intruder of ["Ghost", "nope", "not-a-real-slug", "Space Waffles"]) {
      expect(declared.has(intruder.toLowerCase())).toBe(false);
      const r = resolveLedgerCategory(intruder);
      expect(r.ok, `${intruder} must not resolve through the shipped door`).toBe(false);
      if (!r.ok) expect(r.code).toBe("CATEGORY_UNKNOWN");
    }
  });

  it("the set of categories that resolve through the public door is exactly the declared map", () => {
    const resolvable: string[] = [];
    for (const cat of Object.keys(LEDGER_CATEGORY_MAP)) {
      if (resolveLedgerCategory(cat).ok) resolvable.push(cat);
    }
    expect(resolvable.sort()).toEqual(Object.keys(LEDGER_CATEGORY_MAP).sort());
  });

  it("both entry points behave identically on the shipped map", () => {
    for (const cat of Object.keys(LEDGER_CATEGORY_MAP)) {
      expect(resolveLedgerCategoryIn(LEDGER_CATEGORY_MAP, cat)).toEqual(resolveLedgerCategory(cat));
    }
    for (const junk of ["", "   ", "Space Waffles", "__proto__"]) {
      expect(resolveLedgerCategoryIn(LEDGER_CATEGORY_MAP, junk)).toEqual(resolveLedgerCategory(junk));
    }
  });
});

describe("ledger-category-map-core: source-level drift guards", () => {
  it("records Michael's verbatim decision in the header", () => {
    const src = fs.readFileSync(MODULE_PATH, "utf8");
    expect(src).toContain("the ledger should use its own accounts and not the website map");
  });

  it("contains no rounding, no clock, no randomness, no I/O", () => {
    const src = fs.readFileSync(MODULE_PATH, "utf8");
    for (const forbidden of [
      "Math.round",
      "Math.floor",
      "Math.ceil",
      "Math.random",
      "Date.now",
      "new Date",
      "toFixed",
      "parseFloat",
      "require(",
      "process.env",
    ]) {
      expect(src, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("declares no fallback account anywhere in the source", () => {
    const src = fs.readFileSync(MODULE_PATH, "utf8");
    // The website map has a fallback by design. The ledger must not.
    expect(src).not.toMatch(/fallback\s*[:=]/);
  });

  it("every declared refusal code is emitted by some path in the source", () => {
    const src = fs.readFileSync(MODULE_PATH, "utf8");
    const codes = [
      "CATEGORY_MISSING",
      "CATEGORY_UNKNOWN",
      "CATEGORY_AMBIGUOUS",
      "INVENTORY_TYPE_IS_NOT_A_KEY",
      "SLUG_HAS_NO_ACCOUNT",
    ];
    for (const code of codes) {
      const emits = new RegExp(`code:\\s*"${code}"`).test(src);
      expect(emits, `${code} must be emitted, not merely declared (rule 43)`).toBe(true);
    }
  });

  it("is registered in the pure self-test gate", () => {
    const gate = fs.readFileSync(
      path.join(REPO, "scripts", "compliance", "run-pure-selftests.ts"),
      "utf8",
    );
    expect(gate).toContain("__runLedgerCategoryMapCoreTests");
    expect(gate).toContain("ledger-category-map-core");
  });
});
