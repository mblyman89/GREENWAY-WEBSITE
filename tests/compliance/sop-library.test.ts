/**
 * tests/compliance/sop-library.test.ts — SOP Library (owner request after SOP-08)
 *
 * Pins: every docs/sop/SOP-*.md parses into the library with a catalog entry,
 * a title, a version and a §4 procedures section; in-document anchors resolve;
 * the markdown parser never emits raw HTML; the page is in the Employee menu
 * and readable by every back-office sign-in (timeclock.use); the docs are
 * traced into the server bundle.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlocks, parseInline, slugify, type Block, type Inline } from "@/lib/sop-library/markdown-core";
import { SOP_CATALOG, resolveSopLink, sopSlugFromFile } from "@/lib/sop-library/catalog-core";

const REPO = process.cwd();
const DIR = join(REPO, "docs", "sop");
const FILES = readdirSync(DIR).filter((f) => sopSlugFromFile(f));

function walk(bs: Block[], fn: (b: Block) => void) {
  for (const b of bs) {
    fn(b);
    if (b.t === "quote") walk(b.c, fn);
    if (b.t === "list") b.items.forEach((it) => walk(it, fn));
  }
}

describe("SOP Library — documents", () => {
  it("finds every SOP file and every file has a catalog entry", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(9);
    for (const f of FILES) expect(SOP_CATALOG.some((m) => m.file === f), f).toBe(true);
    for (const m of SOP_CATALOG) expect(FILES, m.file).toContain(m.file);
  });

  it.each(FILES)("%s parses: H1 title, version row, a procedures section, anchors resolve", (f) => {
    const blocks = parseBlocks(readFileSync(join(DIR, f), "utf8"));
    const ids = new Set<string>();
    const links: string[] = [];
    const inl = (ns: Inline[]) => ns.forEach((n) => { if (n.t === "link") links.push(n.href); if ("c" in n) inl(n.c); });
    walk(blocks, (b) => {
      if (b.t === "heading") { ids.add(b.id); inl(b.c); }
      if (b.t === "paragraph") inl(b.c);
      if (b.t === "table") [b.head, ...b.rows].forEach((r) => r.forEach(inl));
    });
    expect(blocks.find((b) => b.t === "heading" && b.level === 1)).toBeTruthy();
    expect(blocks.find((b) => b.t === "table")).toBeTruthy();
    expect([...ids].some((id) => id.startsWith("4-procedures"))).toBe(true);
    for (const l of links) {
      const r = resolveSopLink(l);
      if (r?.kind === "anchor") expect(ids.has(l.slice(1)), l).toBe(true);
    }
  });
});

describe("SOP Library — parser", () => {
  it("never produces HTML: <name> placeholders stay text", () => {
    expect(parseInline("Type <name> **now**")).toEqual([
      { t: "text", v: "Type <name> " },
      { t: "strong", c: [{ t: "text", v: "now" }] },
    ]);
  });
  it("keeps underscores in identifiers (no _italic_)", () => {
    expect(parseInline("staff_id and clock_pin")).toEqual([{ t: "text", v: "staff_id and clock_pin" }]);
  });
  it("splits tables but not pipes inside code spans", () => {
    const [t] = parseBlocks("| a | b |\n|---|---|\n| `x|y` | z |");
    expect(t.t).toBe("table");
    if (t.t === "table") expect(t.rows[0]).toHaveLength(2);
  });
  it("slugs match the SOP program anchor rule", () => {
    expect(slugify("4.2 Where everything lives")).toBe("42-where-everything-lives");
    expect(slugify("Appendix B: Not built yet (interim procedures)")).toBe("appendix-b-not-built-yet-interim-procedures");
  });
  it("links: repo paths are not links; SOP files map into the library", () => {
    expect(resolveSopLink("src/lib/x.ts")).toBeNull();
    expect(resolveSopLink("../sop/SOP-02-master-till-safe.md#41-x")?.href).toBe("/admin/staffing/sop-library/sop-02#41-x");
  });
});

describe("SOP Library — wiring", () => {
  const nav = readFileSync(join(REPO, "src", "components", "admin", "admin-nav-data.ts"), "utf8");
  it("is in the Employee menu for every sign-in that can use the time clock", () => {
    expect(nav).toMatch(/label: "SOP Library", href: "\/admin\/staffing\/sop-library", permission: "timeclock\.use",[^\n]*group: "Employee"/);
  });
  it("both pages guard with the same permission as the nav", () => {
    for (const p of ["page.tsx", join("[slug]", "page.tsx")]) {
      const src = readFileSync(join(REPO, "src", "app", "admin", "staffing", "sop-library", p), "utf8");
      expect(src).toContain('requirePermission("timeclock.use")');
      expect(src).not.toContain("dangerouslySetInnerHTML");
    }
  });
  it("docs/sop is traced into the server bundle", () => {
    const cfg = readFileSync(join(REPO, "next.config.ts"), "utf8");
    expect(cfg).toContain('"/admin/staffing/sop-library/[slug]": ["./docs/sop/*.md"]');
  });
});
