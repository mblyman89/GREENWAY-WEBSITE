/**
 * PERF GUARD (permanent) - owner 2026-11-05, docs/sop-program/00-OWNER-REQUEST-VERBATIM.md D186-D190:
 *   "If there is ways to pin optimization and efficiency in the test suite or code or something
 *    like that, please make it a permanent issue to address every time we add to the repo. I want
 *    optimization and efficiency to be paramount now that we are in live production."
 *
 * WHY: menu_items keeps a copy of every product for every menu version ever staged or published
 * (720,000 rows measured on 2026-11-05 for ~2,300 products). A read that is not pinned to ONE
 * version or to row ids touches every copy: it is slow, it is silently capped at PostgREST's 1,000
 * rows, and it was the single largest cost on the database server.
 *
 * RULE (scans the WHOLE repo, so every new file is held to it):
 *   every `.from("menu_items")` READ must be scoped by `menu_version_id` or by row `id`.
 *   "Newest facts per product" reads go through loadLatestMenuFacts() (latest_menu_facts RPC,
 *   one row per product from product_latest_facts) - never an ordered scan of menu_items.
 *   Writes (insert / update / delete / upsert) are not reads and are not checked here.
 *
 * A NEW EXCEPTION needs an entry in ALLOWED with the reason, plus the marker string that proves
 * the reason still holds in the code. Think twice: the answer is almost always loadLatestMenuFacts
 * or getPublishedVersion().id.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** The query chain starting at `.from("menu_items")`, up to the first top-level `;` or close. */
function chainAt(src: string, i: number): string {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0) break;
      depth--;
    } else if (c === ";" && depth === 0) break;
  }
  return src.slice(i, j);
}

export function unscopedMenuItemReads(files: { path: string; src: string }[]): string[] {
  const hits: string[] = [];
  for (const { path, src } of files) {
    let i = 0;
    while ((i = src.indexOf('.from("menu_items")', i)) >= 0) {
      const chain = chainAt(src, i);
      const isWrite = /\.(insert|update|delete|upsert)\(/.test(chain);
      const scoped = /menu_version_id/.test(chain) || /\.(eq|in)\(\s*"id"/.test(chain);
      if (!isWrite && !scoped) hits.push(`${path}:${src.slice(0, i).split("\n").length}`);
      i += chain.length || 1;
    }
  }
  return hits;
}

/** file -> [reason, marker that must still be in the file]. */
const ALLOWED: Record<string, [string, string]> = {
  "src/lib/menu/latest-menu-facts.ts": [
    "the fallback walk for a database WITHOUT latest_menu_facts (pre-0305) only",
    'if (factsFallback(dbError) !== "walk")',
  ],
  "src/lib/leafly/identity-server.ts": [
    "scoped to the published version; unscoped only when no menu was ever published (bounded)",
    "versionId = (await getPublishedVersion())?.id ?? null;",
  ],
};

describe("PERF GUARD: menu_items reads are scoped (permanent)", () => {
  const files = walk(join(ROOT, "src")).map((p) => ({
    path: p.slice(ROOT.length + 1).replace(/\\/g, "/"),
    src: readFileSync(p, "utf8"),
  }));

  it("no unscoped menu_items read outside the reviewed exceptions", () => {
    const hits = unscopedMenuItemReads(files).filter((h) => !(h.split(":")[0] in ALLOWED));
    expect(hits, `Unscoped menu_items reads (use loadLatestMenuFacts or scope by menu_version_id):\n${hits.join("\n")}`).toEqual([]);
  });

  it("each exception still holds for its stated reason", () => {
    for (const [file, [, marker]] of Object.entries(ALLOWED)) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(marker);
    }
  });

  it("the scanner itself catches the patterns it exists for", () => {
    const bad = [
      { path: "a.ts", src: 'await admin.from("menu_items").select("category").eq("source_item_id", k).order("created_at", { ascending: false }).limit(1);' },
      { path: "b.ts", src: 'await admin.from("menu_items").select("category").order("id").range(0, 999);' },
    ];
    expect(unscopedMenuItemReads(bad)).toEqual(["a.ts:1", "b.ts:1"]);
    const good = [
      { path: "c.ts", src: 'await admin.from("menu_items").select("id").eq("menu_version_id", v);' },
      { path: "d.ts", src: 'await admin.from("menu_items").select("kb_product_id").eq("id", id).maybeSingle();' },
      { path: "e.ts", src: 'await admin.from("menu_items").update({ x: 1 }).eq("source_item_id", k);' },
      { path: "f.ts", src: 'await admin.from("menu_items").select("id").in("id", ids);' },
    ];
    expect(unscopedMenuItemReads(good)).toEqual([]);
  });

  it("P4 conversions: per-product facts come from latest_menu_facts, with errors read", () => {
    const disp = readFileSync(join(ROOT, "src/lib/inventory/disposition.ts"), "utf8");
    expect(disp).toContain("await loadLatestMenuFacts(admin, [l.product_id])");
    expect(disp).toContain("The product's category could not be read");
    const pick = readFileSync(join(ROOT, "src/lib/pos/pickup-menu-facts.ts"), "utf8");
    expect(pick).toContain("await loadLatestMenuFacts(createSupabaseAdminClient(), ids)");
    const sage = readFileSync(join(ROOT, "src/lib/accounting/sage-exports.ts"), "utf8");
    expect(sage).toMatch(/listUnmappedCategories[\s\S]*?loadLatestMenuFacts\(admin\)/);
  });
});
