/**
 * D237 N-6 (SOP-22 G-116; F-22-13, F-22-14 S1): the culture news desk and the
 * health-topic guard.
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations" — Q-22-1 (a) cited news only, no product links, the "talk
 * to your provider" line, no claims; Q-22-6 (a) web search on demand only;
 * Q-22-7 culture posts on the existing CULTURE card.
 * WAC 314-55-155(2)(a)(vii): no curative or therapeutic claims.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runCultureDeskCoreTests,
  PROVIDER_LINE,
  guardCultureText,
  parseFoundNews,
  withGuardLines,
} from "@/lib/cms/culture-desk-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D237 N-6 culture news desk + health guard", () => {
  it("pure core self-tests all pass", () => {
    const r = __runCultureDeskCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(44);
  });

  it("therapeutic wording is blocked outright, even with a source", () => {
    const g = guardCultureText(`New research says cannabis relieves anxiety. https://example.org/study ${PROVIDER_LINE}`, { requireSource: true });
    expect(g.blocking.join(" ")).toMatch(/Therapeutic wording/);
  });

  it("a health post needs a source, the provider line, and no product or deal links", () => {
    const bad = guardCultureText("A study of patients. Shop now https://greenwaymarijuana.com/menu", { requireSource: true });
    expect(bad.health).toBe(true);
    const all = bad.blocking.join(" ");
    expect(all).toMatch(/cited source/);
    expect(all).toMatch(/healthcare provider/);
    expect(all).toMatch(/may not link to products/);
    const body = withGuardLines(["A study of patients was published."], ["https://example.org/study"], true);
    expect(guardCultureText(body.join("\n"), { requireSource: true }).blocking).toEqual([]);
  });

  it("Find news keeps only items whose link the live search actually cited", () => {
    const items = parseFoundNews(
      { items: [{ title: "Real", url: "https://example.org/a" }, { title: "Invented", url: "https://example.org/b" }] },
      ["https://example.org/a"],
      "web",
    );
    expect(items.map((i) => i.title)).toEqual(["Real"]);
    expect(parseFoundNews({ items: [{ title: "x", url: "https://example.org/a" }] }, [], "web")).toEqual([]);
  });

  it("Find news is on demand and stores nothing found; drafts are CULTURE and audited", () => {
    const act = read("src/app/admin/blog/actions.ts");
    expect(act).toContain('action: "blog.culture.find_news"');
    expect(act).toContain("// Counts only: no found text, links or suggestion HTML are stored.");
    expect(act).toContain('category: "CULTURE"');
    expect(act).toContain("...c.guard.blocking");
    const srv = read("src/lib/cms/culture-desk-server.ts");
    expect(srv).toContain('import "server-only"');
    expect(srv).toContain("generateWebSearch(");
    expect(srv).not.toMatch(/\.insert\(|\.upsert\(/);
    expect(srv).not.toMatch(/\.limit\(\s*\d{4,}/);
    const ui = read("src/components/admin/blog/CultureNewsDesk.tsx");
    expect(ui).toContain("findNewsAction(tab, topic)");
    expect(ui).not.toMatch(/useEffect\([^)]*findNewsAction/);
  });

  it("a CULTURE post that fails the guard is not published (Publish now or a schedule)", () => {
    const act = read("src/app/admin/blog/actions.ts");
    expect(act).toContain("const g = cultureGuardForPost(post);");
    expect(act).toContain('action: "blog.culture_guard_refused"');
    const sched = read("src/lib/cms/content-schedule-server.ts");
    expect(sched).toContain("const refused = await cultureGuardRefusal(id);");
    const editor = read("src/app/admin/blog/[id]/page.tsx");
    expect(editor).toContain('data-testid="culture-guard"');
    expect(read("src/app/admin/blog/new/page.tsx")).toContain("<CultureNewsDesk aiEnabled={isAiConfigured} />");
  });
});
