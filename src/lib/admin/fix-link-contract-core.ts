/**
 * S31 — the fix-link contract, as pure functions (bible S31, F-103/F-114/F-115/F-118).
 *
 * Owner (Round 12): "make sure that the products from the Cultivera upload
 * specifically can reach the fix pages." A fix link is only real when:
 *
 *   1. its path resolves to a page file that exists (same precedence Next.js
 *      uses: static segment beats a dynamic one beats a catch-all);
 *   2. every query key it sends is declared in that page's `searchParams`
 *      type literal (a key the page does not declare is silently ignored,
 *      which shows the owner an unfiltered list while claiming a filter);
 *   3. for an item-level link, the anchor it jumps to is rendered on the page.
 *
 * This module holds the parsing and matching, with no I/O, so it can be
 * proven on its own (embedded self-tests, pure runner). The compliance test
 * `tests/compliance/pipeline-fix-links-connected.test.ts` feeds it the real
 * filesystem and every generator's real output.
 *
 * It also finds "coloured blocks" in a page source (a tinted border + tinted
 * fill in the danger or gold tone) together with the condition that renders
 * each one, so the test can hold the pages to "no standing banner without an
 * issue row": every tinted block must be a gated RESULT/hint that the test
 * lists by name, and a new one fails CI until it is justified or moved into
 * the Issues tab.
 */

export type ParsedHref = {
  path: string;
  query: readonly (readonly [string, string])[];
  anchor: string | null;
};

/** Split an internal href into path, ordered query pairs and anchor. Never throws. */
export function parseHref(href: string): ParsedHref {
  const raw = typeof href === "string" ? href : "";
  const hashAt = raw.indexOf("#");
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const anchor = hashAt >= 0 && raw.slice(hashAt + 1) ? raw.slice(hashAt + 1) : null;
  const qAt = beforeHash.indexOf("?");
  const rawPath = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
  const path = rawPath.replace(/\/+$/, "") || "/";
  const qs = qAt >= 0 ? beforeHash.slice(qAt + 1) : "";
  const query: [string, string][] = [];
  for (const [k, v] of new URLSearchParams(qs)) query.push([k, v]);
  return { path, query, anchor };
}

/** `page` renders UI (searchParams are checked); `route` is a handler (reads request.url itself). */
export type RouteEntry = {
  route: string;
  file: string;
  kind: "page" | "route";
  pattern: RegExp;
  staticSegments: number;
  catchAll: boolean;
};

/** src/app/admin/x/[id]/page.tsx (or route.ts) -> /admin/x/[id] (route groups stripped). */
export function pageFileToRoute(file: string): string | null {
  const norm = file.replace(/\\/g, "/");
  const m = /^(?:.*\/)?src\/app(\/.*)?\/(?:page|route)\.tsx?$/.exec(norm);
  if (!m) return null;
  const route = (m[1] ?? "").replace(/\/\([^)]*\)/g, "");
  return route === "" ? "/" : route;
}

/** Build a route table from page.tsx and route.ts files (repo-relative paths). */
export function buildRouteTable(pageFiles: readonly string[]): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const file of pageFiles) {
    const route = pageFileToRoute(file);
    if (!route) continue;
    const segs = route.split("/").filter(Boolean);
    let staticSegments = 0;
    let catchAll = false;
    const body = segs
      .map((seg) => {
        if (/^\[\[?\.\.\..+\]\]?$/.test(seg)) {
          catchAll = true;
          return ".+";
        }
        if (/^\[.+\]$/.test(seg)) return "[^/]+";
        staticSegments++;
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    const kind: RouteEntry["kind"] = /\/route\.tsx?$/.test(file.replace(/\\/g, "/")) ? "route" : "page";
    out.push({ route, file, kind, pattern: new RegExp(`^/${body}$`.replace(/^\/\/?$/, "^/$")), staticSegments, catchAll });
  }
  return out;
}

/**
 * The page file that serves `path`, or null. Precedence mirrors the App
 * Router: an exact static route wins; otherwise the match with the most
 * static segments, and a catch-all only when nothing else matches.
 */
export function resolveRoute(path: string, table: readonly RouteEntry[]): RouteEntry | null {
  const p = path.replace(/\/+$/, "") || "/";
  const hits = table.filter((r) => r.pattern.test(p));
  if (hits.length === 0) return null;
  hits.sort((a, b) => Number(a.catchAll) - Number(b.catchAll) || b.staticSegments - a.staticSegments);
  return hits[0];
}

export type SearchParamDecl =
  | { kind: "literal"; keys: ReadonlySet<string> }
  | { kind: "record" }
  | { kind: "none" };

/**
 * The keys a page declares in `searchParams: Promise<{ ... }>` (also the
 * optional `searchParams?:` form). `Record<string, …>` accepts any key and is
 * reported as such. Nested object types are not expected in these literals;
 * braces are balanced so a comment containing `}` inside `/** *\/` is safe.
 */
export function searchParamDecl(pageSource: string): SearchParamDecl {
  const src = typeof pageSource === "string" ? pageSource : "";
  const rec = /searchParams\??\s*:\s*Promise<\s*Record</.exec(src);
  let lit: { index: number; 0: string } | null = /searchParams\??\s*:\s*Promise<\s*\{/.exec(src);
  if (!lit) {
    // `searchParams: Promise<Params>` with `type Params = {` / `interface Params {` in the same file.
    const alias = /searchParams\??\s*:\s*Promise<\s*([A-Z][A-Za-z0-9_]*)\s*>/.exec(src);
    if (alias) {
      if (new RegExp(`type\\s+${alias[1]}\\s*=\\s*Record<`).test(src)) return { kind: "record" };
      const def = new RegExp(`(?:type\\s+${alias[1]}\\s*=\\s*\\{|interface\\s+${alias[1]}\\s*\\{)`).exec(src);
      if (def) lit = def;
    }
  }
  if (!lit) return rec ? { kind: "record" } : { kind: "none" };
  // Strip comments FIRST (a JSDoc line may contain braces), then balance.
  const rest = src
    .slice(lit.index + lit[0].length)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  let depth = 1;
  let i = 0;
  for (; i < rest.length && depth > 0; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}") depth--;
  }
  const body = rest.slice(0, depth === 0 ? i - 1 : i);
  const keys = new Set<string>();
  for (const m of body.matchAll(/(?:^|[;{,\s])([A-Za-z_$][\w$]*)\??\s*:/g)) keys.add(m[1]);
  return { kind: "literal", keys };
}

/** Literal `id="x"` anchors in a source file. */
export function literalAnchorIds(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of (source ?? "").matchAll(/\bid=["']([^"'{}]+)["']/g)) out.add(m[1]);
  return out;
}

export type HrefProblem =
  | { kind: "no_page"; href: string }
  | { kind: "undeclared_key"; href: string; file: string; key: string }
  | { kind: "no_search_params"; href: string; file: string; key: string };

/**
 * Check one href against the route table and page sources. `readPage` maps a
 * page file to its source (the test passes the filesystem). Anchors are
 * checked by the caller, because several are computed by helper functions
 * (draftRowAnchorId, typeRowAnchorId) that a literal scan cannot see.
 */
export function checkHref(
  href: string,
  table: readonly RouteEntry[],
  readPage: (file: string) => string,
): { route: RouteEntry | null; parsed: ParsedHref; problems: HrefProblem[] } {
  const parsed = parseHref(href);
  const route = resolveRoute(parsed.path, table);
  if (!route) return { route, parsed, problems: [{ kind: "no_page", href }] };
  const problems: HrefProblem[] = [];
  if (parsed.query.length > 0 && route.kind === "page") {
    const decl = searchParamDecl(readPage(route.file));
    for (const [key] of parsed.query) {
      if (decl.kind === "record") continue;
      if (decl.kind === "none") problems.push({ kind: "no_search_params", href, file: route.file, key });
      else if (!decl.keys.has(key)) problems.push({ kind: "undeclared_key", href, file: route.file, key });
    }
  }
  return { route, parsed, problems };
}

export type ColouredBlock = { line: number; tone: "danger" | "gold"; gate: string | null };

const BLOCK_RE = /border-\[var\(--admin-(danger|gold)\)\]\/\d+\s+bg-\[var\(--admin-(?:danger|gold)(?:-soft)?\)\]/;

/**
 * Every tinted block (tinted border AND tinted fill on one className) with the
 * condition that renders it. Walking up at most 8 lines from the block:
 *   - a tone-table entry on the block's own line (`danger: "border-..."`) -> `map:danger`;
 *   - `{cond && (` at the end of a line -> `cond`;
 *   - `if (cond) {` -> `if cond`;
 *   - a bare line followed by a line starting with `?` (a ternary) -> that line.
 * The walk STOPS (gate null) at another tinted block or at a `)}` line that
 * closes an earlier conditional, so a block never borrows a gate that does
 * not wrap it. `gate: null` therefore means "rendered unconditionally".
 */
export function colouredBlocks(source: string): ColouredBlock[] {
  const lines = (source ?? "").split("\n");
  const out: ColouredBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = BLOCK_RE.exec(lines[i]);
    if (!m) continue;
    let gate: string | null = null;
    const mapEntry = /^\s*([A-Za-z_]\w*)\s*:\s*["'`]/.exec(lines[i]);
    if (mapEntry) gate = `map:${mapEntry[1]}`;
    for (let j = i; gate === null && j >= Math.max(0, i - 8); j--) {
      const l = lines[j];
      if (j < i && (BLOCK_RE.test(l) || /^\s*\)\}\s*$/.test(l))) break;
      const and = /\{\s*(.+?)\s*&&\s*\(\s*$/.exec(l);
      if (and) {
        gate = and[1];
        break;
      }
      const iff = /^\s*if\s*\((.+)\)\s*\{?\s*$/.exec(l);
      if (iff) {
        gate = `if ${iff[1]}`;
        break;
      }
      const next = lines[j + 1] ?? "";
      if (j < i && /^\s*\?\s/.test(next) && /\S/.test(l) && !/[({,]\s*$/.test(l)) {
        gate = l.trim();
        break;
      }
    }
    out.push({ line: i + 1, tone: m[1] as "danger" | "gold", gate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (pure runner + tests/compliance)
// ---------------------------------------------------------------------------

export function __runFixLinkContractCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      throw new Error(`fix-link-contract-core: ${msg}`);
    }
  };

  // parseHref
  const a = parseHref("/admin/inventory/drafts?status=approved&draft=x#draft-x");
  ok(a.path === "/admin/inventory/drafts", "path");
  ok(a.query.length === 2 && a.query[0][0] === "status" && a.query[0][1] === "approved", "query order + value");
  ok(a.query[1][0] === "draft", "second key");
  ok(a.anchor === "draft-x", "anchor");
  const b = parseHref("/admin/inventory/L1#coa");
  ok(b.query.length === 0 && b.anchor === "coa", "anchor without query");
  ok(parseHref("/admin/products/").path === "/admin/products", "trailing slash stripped");
  ok(parseHref("/").path === "/", "root stays root");
  ok(parseHref("/x#").anchor === null, "empty anchor is null");
  ok(parseHref("/admin/products?q=fam%20x").query[0][1] === "fam x", "value decoded");
  ok(parseHref(undefined as unknown as string).path === "/", "junk never throws");

  // pageFileToRoute
  ok(pageFileToRoute("src/app/admin/inventory/[id]/page.tsx") === "/admin/inventory/[id]", "dynamic route");
  ok(pageFileToRoute("src/app/(marketing)/about/page.tsx") === "/about", "group stripped");
  ok(pageFileToRoute("src/app/page.tsx") === "/", "root page");
  ok(pageFileToRoute("src/app/api/x/route.ts") === "/api/x", "route handler maps too");
  ok(pageFileToRoute("src/app/admin/x/layout.tsx") === null, "layout is not a route");
  ok(pageFileToRoute("/abs/repo/src/app/admin/page.tsx") === "/admin", "absolute prefix tolerated");

  // resolveRoute precedence
  const table = buildRouteTable([
    "src/app/admin/inventory/page.tsx",
    "src/app/admin/inventory/[id]/page.tsx",
    "src/app/admin/inventory/drafts/page.tsx",
    "src/app/admin/inventory/intake/[id]/page.tsx",
    "src/app/admin/sop/[...slug]/page.tsx",
    "src/app/admin/sop/index/page.tsx",
  ]);
  ok(resolveRoute("/admin/inventory/drafts", table)?.file === "src/app/admin/inventory/drafts/page.tsx", "static beats [id]");
  ok(resolveRoute("/admin/inventory/abc", table)?.route === "/admin/inventory/[id]", "dynamic lot");
  ok(resolveRoute("/admin/inventory/intake/abc", table)?.route === "/admin/inventory/intake/[id]", "nested dynamic");
  ok(resolveRoute("/admin/inventory", table)?.route === "/admin/inventory", "list page");
  // Next.js truth: with no intake list page, /admin/inventory/intake IS served
  // by [id] (id = "intake"). That is why the compliance test resolves against
  // the REAL route table, where intake/page.tsx exists and wins.
  ok(resolveRoute("/admin/inventory/intake", table)?.route === "/admin/inventory/[id]", "no static page -> dynamic sibling serves it (Next.js)");
  const withIntake = buildRouteTable([...table.map((r) => r.file), "src/app/admin/inventory/intake/page.tsx"]);
  ok(resolveRoute("/admin/inventory/intake", withIntake)?.route === "/admin/inventory/intake", "static intake list wins once it exists");
  ok(resolveRoute("/admin/sop/a/b", table)?.route === "/admin/sop/[...slug]", "catch-all");
  ok(resolveRoute("/admin/sop/index", table)?.route === "/admin/sop/index", "static beats catch-all");
  ok(resolveRoute("/admin/nope", table) === null, "unknown -> null");
  ok(resolveRoute("/admin/inventory/", table)?.route === "/admin/inventory", "trailing slash resolves");

  // searchParamDecl
  const lit = searchParamDecl(
    "export default async function P({ searchParams }: { searchParams: Promise<{\n  q?: string;\n  /** a } comment { */\n  status?: string; // trailing\n  page?: string }>; }) {}",
  );
  ok(lit.kind === "literal", "literal form");
  ok(lit.kind === "literal" && lit.keys.has("q") && lit.keys.has("status") && lit.keys.has("page"), "keys read");
  ok(lit.kind === "literal" && lit.keys.size === 3, "comment words are not keys");
  const one = searchParamDecl("searchParams: Promise<{ saved?: string; error?: string }>;");
  ok(one.kind === "literal" && one.keys.has("saved") && one.keys.has("error") && one.keys.size === 2, "one-line literal");
  const opt = searchParamDecl("searchParams?: Promise<{ q?: string }>;");
  ok(opt.kind === "literal" && opt.keys.has("q"), "optional searchParams form");
  ok(searchParamDecl("searchParams?: Promise<Record<string, string | undefined>>;").kind === "record", "record form");
  ok(searchParamDecl("export default function P() {}").kind === "none", "no searchParams");
  const al = searchParamDecl("type Params = {\n  q?: string;\n  page?: string;\n};\nfunction P({ searchParams }: { searchParams: Promise<Params> }) {}");
  ok(al.kind === "literal" && al.keys.has("q") && al.keys.has("page") && al.keys.size === 2, "type alias resolved");
  const ifc = searchParamDecl("interface SP { tab?: string }\nfunction P({ searchParams }: { searchParams: Promise<SP> }) {}");
  ok(ifc.kind === "literal" && ifc.keys.has("tab"), "interface alias resolved");
  ok(searchParamDecl("type SP = Record<string, string | undefined>;\nfunction P({ searchParams }: { searchParams: Promise<SP> }) {}").kind === "record", "alias to Record -> record");
  ok(searchParamDecl("function P({ searchParams }: { searchParams: Promise<Missing> }) {}").kind === "none", "unresolved alias -> none (reported, never assumed)");
  const req = searchParamDecl("searchParams: Promise<{ status: string; q?: string }>;");
  ok(req.kind === "literal" && req.keys.has("status"), "required key form");

  // literalAnchorIds
  const ids = literalAnchorIds('<div id="coa" /><div id=\'adjust\' /><div id={x} />');
  ok(ids.has("coa") && ids.has("adjust") && ids.size === 2, "literal anchors only");

  // checkHref
  const pages: Record<string, string> = {
    "src/app/admin/inventory/drafts/page.tsx": "searchParams: Promise<{ status?: string; draft?: string }>;",
    "src/app/admin/inventory/page.tsx": "export default function P() {}",
    "src/app/admin/inventory/[id]/page.tsx": "searchParams: Promise<Record<string, string>>;",
  };
  const rd = (f: string) => pages[f] ?? "";
  ok(checkHref("/admin/inventory/drafts?status=approved&draft=d#draft-d", table, rd).problems.length === 0, "clean href");
  const miss = checkHref("/admin/inventory/drafts?status=approved&manifest=m", table, rd).problems;
  ok(miss.length === 1 && miss[0].kind === "undeclared_key" && (miss[0] as { key: string }).key === "manifest", "undeclared key caught");
  const none = checkHref("/admin/inventory?status=x", table, rd).problems;
  ok(none.length === 1 && none[0].kind === "no_search_params", "page with no searchParams caught");
  ok(checkHref("/admin/inventory/L1?anything=1", table, rd).problems.length === 0, "record accepts any key");
  ok(checkHref("/admin/ghost", table, rd).problems[0]?.kind === "no_page", "missing page caught");
  ok(checkHref("/admin/inventory", table, rd).problems.length === 0, "no query, no key check");
  const withRoute = buildRouteTable([...table.map((r) => r.file), "src/app/admin/inventory/intake/page.tsx", "src/app/admin/inventory/intake/export/route.ts"]);
  const exp = checkHref("/admin/inventory/intake/export?format=csv", withRoute, rd);
  ok(exp.route?.kind === "route" && exp.route.route === "/admin/inventory/intake/export", "static route handler beats intake/[id]");
  ok(exp.problems.length === 0, "a route handler's query is not checked against a page type");
  ok(withRoute.find((r) => r.file.endsWith("drafts/page.tsx"))?.kind === "page", "page kind");

  // colouredBlocks
  const src = [
    "const STYLE = {",
    '  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-x",',
    "};",
    "{sp.error && (",
    '  <div className="rounded border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10">',
    "if (!isConfigured) {",
    "  return (",
    '    <div className="border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5">',
    '<div className="border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10">',
    '<span className="text-[var(--admin-danger)]">not a block</span>',
    "{error === \"x\" && (",
    "  <div",
    '    className="border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10"',
    '<p className="border-[var(--admin-danger)]/30 bg-[var(--admin-surface)]">surface fill is not tinted</p>',
    "  tone === \"danger\"",
    '    ? "border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10"',
  ].join("\n");
  const blocks = colouredBlocks(src);
  ok(blocks.length === 6, `six tinted blocks (got ${blocks.length})`);
  ok(blocks[0].gate === "map:danger" && blocks[0].tone === "danger" && blocks[0].line === 2, "map entry");
  ok(blocks[1].gate === "sp.error", "&& gate");
  ok(blocks[2].gate === "if !isConfigured" && blocks[2].tone === "gold", "if gate, gold-soft fill");
  ok(blocks[3].gate === null && blocks[3].line === 9, "an unconditional block never borrows the gate of the block above it");
  ok(blocks[4].gate === 'error === "x"' && blocks[4].line === 13, "gate two lines up");
  ok(blocks[5].gate === 'tone === "danger"', "ternary test on the line above");
  const far = ["{a && (", "", "", "", "", "", "", "", "", "", '<div className="border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10" />'].join("\n");
  ok(colouredBlocks(far)[0].gate === null, "a gate more than 8 lines up is not borrowed");
  ok(colouredBlocks("").length === 0, "empty source");
  const closed = ["{a && (", "  <p>x</p>", ")}", '<div className="border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]" />'].join("\n");
  ok(colouredBlocks(closed)[0].gate === null, "a conditional closed by )} does not wrap the block after it");
  const wrapped = ["{a && (", '  <div className="border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]" />'].join("\n");
  ok(colouredBlocks(wrapped)[0].gate === "a", "direct wrap");

  return { passed, failed };
}
