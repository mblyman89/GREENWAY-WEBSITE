/**
 * D239 N-10 (SOP-22 G-120): help for Blog & Newsletter and the Send Center.
 * The helper steps, the Sunday checklist strip (Forms 8.1 and 8.2 in the app),
 * the corrected concierge `blog-newsletter` topic, the new `newsletter-sunday`
 * and `culture-posts` topics, and the corrected Help Center answers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  MONDAY_BRIEF,
  PRE_PUBLISH_CHECKS,
  SUNDAY_STEPS,
  checksFor,
  __runSundayChecklistCoreTests,
} from "@/lib/cms/sunday-checklist-core";
import { CONCIERGE_KB } from "@/lib/admin/concierge-kb";
import { HELP_SECTIONS } from "@/lib/admin/help-content";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pageExists = (href: string) => {
  const path = href.split("#")[0].split("?")[0];
  return existsSync(join(ROOT, "src/app", path, "page.tsx"));
};

describe("D239 N-10 Sunday checklist core", () => {
  it("self-tests pass", () => {
    const r = __runSundayChecklistCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(33);
  });

  it("matches SOP-22 Forms 8.1 and 8.2 word for word", () => {
    const sop = read("docs/sop/SOP-22-newsletter-blog-culture-marketing.md");
    const f81 = sop.slice(sop.indexOf("### 8.1 Weekly content brief"), sop.indexOf("### 8.2 Pre-publish"));
    const f82 = sop.slice(sop.indexOf("### 8.2 Pre-publish"), sop.indexOf("## 9. Quick reference"));
    for (const it of MONDAY_BRIEF) expect(f81).toContain(`| ${it.text} |`);
    // Form 8.2 row 3 bolds "or pictures" in the SOP; compare without the bold.
    for (const it of PRE_PUBLISH_CHECKS) expect(f82.replace(/\*\*/g, "")).toContain(it.text);
    expect(MONDAY_BRIEF).toHaveLength(10);
    expect(PRE_PUBLISH_CHECKS).toHaveLength(12);
  });

  it("every link goes to a real admin page", () => {
    for (const it of [...MONDAY_BRIEF, ...PRE_PUBLISH_CHECKS, ...SUNDAY_STEPS]) {
      if (it.href) expect(pageExists(it.href), it.href).toBe(true);
    }
  });

  it("a post gets 10 checks, a newsletter all 12", () => {
    expect(checksFor("post")).toHaveLength(10);
    expect(checksFor("newsletter")).toHaveLength(12);
  });

  it("is registered in the pure self-test runner", () => {
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('assertRan("sunday-checklist-core", __runSundayChecklistCoreTests(), 33)');
  });
});

describe("D239 N-10 strip and helpers on the pages", () => {
  const strip = read("src/components/admin/blog/SundayChecklistStrip.tsx");
  const blog = read("src/app/admin/blog/page.tsx");
  const send = read("src/app/admin/newsletter/page.tsx");

  it("the strip shows the steps, Form 8.1 and Form 8.2", () => {
    expect(strip).toContain('id="sunday-checklist"');
    expect(strip).toContain('data-testid="sunday-checklist-brief"');
    expect(strip).toContain('data-testid="sunday-checklist-checks"');
    expect(strip).toContain('data-testid="sunday-checklist-steps"');
    expect(strip).not.toContain('"use client"');
  });

  it("Blog & Newsletter shows the strip, a quick link and the new steps", () => {
    expect(blog).toContain("<SundayChecklistStrip />");
    expect(blog).toContain('href="#sunday-checklist"');
    expect(blog).toContain("Insert a review adds a curated review");
    expect(blog).toContain("Culture news desk");
    expect(blog).toContain("New canvas newsletter");
    expect(blog).not.toContain("Write it yourself, or use the AI helper to draft sections.");
  });

  it("the Send Center shows the strip and the send-time step", () => {
    expect(send).toContain("<SundayChecklistStrip />");
    expect(send).toContain("sets the Sunday send time and the Friday reminder");
    expect(send).toContain("run the Sunday checklist");
  });
});

describe("D239 N-10 concierge and Help Center", () => {
  const topic = (id: string) => CONCIERGE_KB.find((t) => t.id === id);

  it("blog-newsletter is corrected and points to the new topics", () => {
    const facts = topic("blog-newsletter")!.facts.join(" ");
    expect(facts).toContain("built on the canvas and sent from Email Newsletter");
    expect(facts).toContain("Sunday checklist strip");
    expect(facts).not.toContain("with drafts, SEO help, and AI assist.");
  });

  it("adds newsletter-sunday and culture-posts topics with real routes", () => {
    const sun = topic("newsletter-sunday")!;
    const cul = topic("culture-posts")!;
    expect(sun.href).toBe("/admin/newsletter");
    expect(cul.href).toBe("/admin/blog/new#culture");
    expect(pageExists(sun.href!)).toBe(true);
    expect(pageExists(cul.href!)).toBe(true);
    expect(sun.facts.join(" ")).toContain("Approve and schedule");
    expect(sun.facts.join(" ")).toContain("WAC 314-55-155(7)");
    expect(cul.facts.join(" ")).toContain("Talk to your healthcare provider");
    expect(new Set(CONCIERGE_KB.map((k) => k.id)).size).toBe(CONCIERGE_KB.length);
    expect(read("src/app/admin/blog/new/page.tsx")).toContain('id="culture"');
  });

  it("the Help Center answer no longer says compose the email in Newsletter Send", () => {
    const t = HELP_SECTIONS.find((h) => h.id === "blog-newsletter")!;
    const all = t.items.map((i) => i.a).join(" ");
    expect(all).not.toContain("You compose (or AI-draft) the email");
    expect(all).toContain("New canvas newsletter");
    expect(t.items.some((i) => i.href === "/admin/blog/reviews")).toBe(true);
    expect(t.items.some((i) => i.href === "/admin/blog#sunday-checklist")).toBe(true);
    for (const i of t.items) if (i.href) expect(pageExists(i.href), i.href).toBe(true);
  });
});
