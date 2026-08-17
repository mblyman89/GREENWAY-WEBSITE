/**
 * tests/compliance/admin-dead-links.test.ts
 *
 * A LINK THAT GOES NOWHERE IS A LIE THE APP TELLS THE OWNER.
 *
 * WHY THIS EXISTS
 * ---------------
 * While building slice books-04 I wrote a "Time clock" link on the new
 * /admin/books/payroll page pointing at /admin/timeclock. That route has never
 * existed. Nothing caught it -- not TypeScript (an href is just a string), not
 * ESLint, not the 5,400-test suite, not `next build`. It was found only because
 * the standing rule says "walk the file tree, verify, never assume", and I
 * checked by hand.
 *
 * Hand-checking does not scale and does not survive the next slice. So the
 * check became a test.
 *
 * Running it for the first time immediately found TWO MORE dead links that
 * predated this slice, both in SpecialsPresentationEditor.tsx:
 *   - /admin/site-content  -> retired in MIG-7 PR-B; the live preview moved to
 *                             /admin/website-sync?tab=preview
 *   - /admin/creative      -> Creative Studio actually lives at
 *                             /admin/marketing/midjourney
 * Both are fixed. This test is what keeps them fixed.
 *
 * WHY THE OWNER SHOULD CARE (plain English)
 * -----------------------------------------
 * Michael is the only person who will ever use the books pages. When he is
 * mid-task and clicks "Time punches (your evidence)" to check the timekeeping
 * behind a payroll allocation, a 404 does not just annoy him -- it interrupts
 * the substantiation habit that IRC 6001 requires him to keep. Navigation that
 * always works is part of the control environment, not decoration.
 *
 * WHAT IS AND IS NOT CHECKED
 * --------------------------
 * Checked: every LITERAL internal href in src/**\/*.tsx -- i.e. href="/...".
 * Not checked: computed hrefs (template literals, variables, expressions).
 * Those cannot be resolved without running the app, and a test that guesses at
 * them would produce false failures. This is deliberately a HIGH-CONFIDENCE,
 * ZERO-FALSE-POSITIVE check: everything it flags is genuinely broken.
 *
 * External links (http://, https://, mailto:, tel:) are out of scope -- the
 * filesystem cannot verify them and a network call in a unit test is worse
 * than the bug it would find.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const APP_DIR = resolve(__dirname, "../../src/app");
const SRC_DIR = resolve(__dirname, "../../src");

/** Recursively list every file under `dir`. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Turn an App Router file path into its URL path.
 *   src/app/admin/books/payroll/page.tsx      -> /admin/books/payroll
 *   src/app/api/health/route.ts               -> /api/health
 *   src/app/(marketing)/about/page.tsx        -> /about        (route groups strip)
 */
function fileToRoute(file: string): string {
  const rel = file.slice(APP_DIR.length).replace(/\\/g, "/");
  const withoutLeaf = rel.replace(/\/(page|route)\.tsx?$/, "");
  const withoutGroups = withoutLeaf.replace(/\/\([^)]*\)/g, "");
  return withoutGroups === "" ? "/" : withoutGroups;
}

/** Build the authoritative route table from the filesystem. */
function buildRoutes(): { statics: Set<string>; dynamics: RegExp[] } {
  const files = walk(APP_DIR).filter((f) => /\/(page|route)\.tsx?$/.test(f.replace(/\\/g, "/")));
  const statics = new Set<string>();
  const dynamics: RegExp[] = [];

  for (const file of files) {
    const route = fileToRoute(file);
    if (!route.includes("[")) {
      statics.add(route);
      continue;
    }
    // /admin/vendors/[id]        -> ^/admin/vendors/[^/]+$
    // /admin/sop/[...slug]       -> ^/admin/sop/.+$
    const pattern =
      "^" +
      route
        .split("/")
        .map((seg) => {
          if (/^\[\.\.\..+\]$/.test(seg)) return ".+";
          if (/^\[.+\]$/.test(seg)) return "[^/]+";
          return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/") +
      "$";
    dynamics.push(new RegExp(pattern));
  }
  return { statics, dynamics };
}

type HrefHit = { file: string; href: string };

/** Every literal internal href in the source tree. */
function collectLiteralHrefs(): HrefHit[] {
  const sources = walk(SRC_DIR).filter((f) => f.endsWith(".tsx"));
  const hits: HrefHit[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    // href="/..." or href='/...'. The [^"'{}]* body excludes template/expression
    // syntax, so only fully-literal internal paths are captured.
    const re = /href=["'](\/[^"'{}]*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ file: file.slice(SRC_DIR.length + 1).replace(/\\/g, "/"), href: m[1] });
    }
  }
  return hits;
}

/** Strip query/hash/trailing slash, then match against the route table. */
function routeResolves(href: string, routes: ReturnType<typeof buildRoutes>): boolean {
  const path = href.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (routes.statics.has(path)) return true;
  return routes.dynamics.some((re) => re.test(path));
}

describe("admin dead links", () => {
  const routes = buildRoutes();
  const hrefs = collectLiteralHrefs();

  // ---- self-checks: prove the test is actually looking at something --------
  // Without these, a bug that made buildRoutes() return everything or
  // collectLiteralHrefs() return nothing would make the suite pass vacuously.

  it("discovered a realistic number of routes (the scanner found src/app)", () => {
    expect(routes.statics.size).toBeGreaterThan(150);
    expect(routes.dynamics.length).toBeGreaterThan(10);
  });

  it("discovered a realistic number of literal hrefs (the scanner found src)", () => {
    expect(hrefs.length).toBeGreaterThan(100);
  });

  it("known-good routes resolve", () => {
    // If these ever stop resolving, the resolver is broken -- not the app.
    expect(routeResolves("/admin/books/payroll", routes)).toBe(true);
    expect(routeResolves("/admin/books/bills", routes)).toBe(true);
    expect(routeResolves("/admin/staffing/hours", routes)).toBe(true);
    expect(routeResolves("/admin/payroll", routes)).toBe(true);
  });

  it("known-bad routes do NOT resolve (the resolver can actually say no)", () => {
    // The literal bug this test was born from, plus the two it uncovered.
    expect(routeResolves("/admin/timeclock", routes)).toBe(false);
    expect(routeResolves("/admin/site-content", routes)).toBe(false);
    expect(routeResolves("/admin/creative", routes)).toBe(false);
    expect(routeResolves("/admin/this-route-will-never-exist", routes)).toBe(false);
  });

  it("query strings and hashes are ignored when resolving", () => {
    // /admin/website-sync?tab=preview must resolve via /admin/website-sync.
    expect(routeResolves("/admin/website-sync?tab=preview", routes)).toBe(true);
    expect(routeResolves("/admin/books/payroll#authorities", routes)).toBe(true);
  });

  it("dynamic segments resolve for arbitrary ids", () => {
    expect(routeResolves("/admin/vendors/abc-123", routes)).toBe(true);
  });

  // ---- the actual guard ----------------------------------------------------

  it("EVERY literal internal href points at a route that exists", () => {
    const broken = hrefs.filter((h) => !routeResolves(h.href, routes));

    const report = [...new Set(broken.map((b) => b.href))]
      .sort()
      .map((href) => {
        const files = [...new Set(broken.filter((b) => b.href === href).map((b) => b.file))];
        return `  ${href}\n      referenced by: ${files.join(", ")}`;
      })
      .join("\n");

    expect(
      broken.map((b) => `${b.file}: ${b.href}`),
      `Dead internal link(s). Each of these renders a clickable control that ` +
        `404s. Either create the route or re-point the link at the surface that ` +
        `owns the feature now:\n${report}`,
    ).toEqual([]);
  });
});
