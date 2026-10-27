/**
 * R40 — domain go-live readiness. The owner's ask: "correct any code so all I
 * have to do is point Vercel at GreenwayMarijuana.com", with www AND the bare
 * domain public. These tests pin the decisions that make that true.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  APEX_HOST,
  CANONICAL_ORIGIN,
  INTERNAL_REDIRECT_TARGETS,
  LEGACY_WORDPRESS_REDIRECTS,
  PRIMARY_HOST,
  __runSiteDomainCoreTests,
  buildSiteRedirects,
  publicSiteOrigin,
} from "@/lib/site/site-domain-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("site-domain-core self-tests", () => {
  it("all pass", () => {
    const r = __runSiteDomainCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });
});

describe("one canonical host", () => {
  it("www is primary, bare domain is the alias", () => {
    expect(PRIMARY_HOST).toBe("www.greenwaymarijuana.com");
    expect(APEX_HOST).toBe("greenwaymarijuana.com");
    expect(CANONICAL_ORIGIN).toBe("https://www.greenwaymarijuana.com");
  });

  it("business.ts website agrees with the canonical origin (SEO canonical/OG come from it)", () => {
    expect(read("src/content/business.ts")).toContain(`website: "${CANONICAL_ORIGIN}"`);
  });

  it("the ACH ops canonical agrees", () => {
    expect(read("src/lib/payments/ach-ops-ui-core.ts")).toContain(`CANONICAL_SITE = "${CANONICAL_ORIGIN}"`);
  });

  it("no source file falls back to the bare https://greenwaymarijuana.com address any more", () => {
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      if (f.endsWith("site-domain-core.ts")) continue;
      // self-test bodies inside *-core.ts legitimately feed the bare URL in as INPUT
      const code = strip(readFileSync(f, "utf8"));
      if (/\?\?\s*["']https:\/\/greenwaymarijuana\.com["']/.test(code)) offenders.push(f.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });

  it("the four former offenders now use publicSiteOrigin", () => {
    for (const p of [
      "src/lib/notifications/compliance-reminders.ts",
      "src/app/admin/plaid/actions.ts",
      "src/components/admin/orders/AnnouncerPanel.tsx",
      "src/lib/notifications/push.ts",
    ]) {
      expect(strip(read(p)), p).toContain("publicSiteOrigin(process.env)");
    }
  });

  it("robots and sitemap use the constant", () => {
    expect(strip(read("src/app/robots.ts"))).toContain("const baseUrl = CANONICAL_ORIGIN;");
    expect(strip(read("src/app/sitemap.ts"))).toContain("const baseUrl = CANONICAL_ORIGIN;");
  });

  it("publicSiteOrigin upgrades a bare-domain env value so emailed links skip the redirect", () => {
    expect(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://greenwaymarijuana.com" })).toBe(CANONICAL_ORIGIN);
    expect(publicSiteOrigin({ NEXT_PUBLIC_SITE_URL: "https://greenwaywebsite1.vercel.app" })).toBe(
      "https://greenwaywebsite1.vercel.app",
    );
  });
});

describe("redirects installed by next.config.ts", () => {
  const cfg = strip(read("next.config.ts"));

  it("next.config wires buildSiteRedirects", () => {
    expect(cfg).toContain('import { buildSiteRedirects } from "./src/lib/site/site-domain-core";');
    expect(cfg).toMatch(/async redirects\(\)\s*\{\s*return buildSiteRedirects\(\);/);
  });

  it("site-domain-core has no imports (next.config loads it at build time, before path aliases)", () => {
    expect(strip(read("src/lib/site/site-domain-core.ts"))).not.toMatch(/^\s*import\s/m);
  });

  it("the bare-domain rule cannot loop: www never matches it", () => {
    const apex = buildSiteRedirects()[0];
    const re = new RegExp(`^${apex.has![0].value}$`);
    expect(re.test("greenwaymarijuana.com")).toBe(true);
    expect(re.test("www.greenwaymarijuana.com")).toBe(false);
    expect(re.test("greenwaywebsite1.vercel.app")).toBe(false);
    expect(apex.destination.startsWith(CANONICAL_ORIGIN)).toBe(true);
  });

  it("every internal legacy target is a real page in src/app", () => {
    for (const t of INTERNAL_REDIRECT_TARGETS) {
      // PERF-S2: public pages live in the (site) route group; /admin does not.
      const page = t === "/" ? "src/app/(site)/page.tsx" : `src/app/(site)${t}/page.tsx`;
      const bare = `src/app${t}/page.tsx`;
      expect(existsSync(join(ROOT, page)) || existsSync(join(ROOT, bare)), `${t} -> ${page}`).toBe(true);
    }
  });

  it("no legacy source shadows a real page (that would hide the page)", () => {
    for (const r of LEGACY_WORDPRESS_REDIRECTS) {
      expect(existsSync(join(ROOT, `src/app${r.source}/page.tsx`)) || existsSync(join(ROOT, `src/app/(site)${r.source}/page.tsx`)), r.source).toBe(false);
    }
  });

  it("covers every page of the old WordPress sitemap that has no same-named page here", () => {
    // From https://greenwaymarijuana.com/page-sitemap.xml (read 2026-10-11):
    const oldPages = ["facebook", "insta", "contact-us", "specials", "menu", "faq", "partners", "about-us"];
    const sources = new Set(LEGACY_WORDPRESS_REDIRECTS.map((r) => r.source));
    for (const p of oldPages) {
      const exists = existsSync(join(ROOT, `src/app/${p}/page.tsx`)) || existsSync(join(ROOT, `src/app/(site)/${p}/page.tsx`));
      expect(exists || sources.has(`/${p}`), `/${p}/ would 404 after go-live`).toBe(true);
    }
  });

  it("the go-live guide exists and names the records to keep and remove", () => {
    const doc = read("docs/DOMAIN_GO_LIVE.md");
    for (const s of [
      "wp.wpenginepowered.com",
      "35.215.120.45",
      "Google Workspace",
      "resend._domainkey",
      "_dmarc",
      "NEXT_PUBLIC_SITE_URL",
      "https://www.greenwaymarijuana.com",
      "Supabase",
      "passkey",
      "Plaid",
    ]) {
      expect(doc, s).toContain(s);
    }
  });
});
