import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER/CLIENT BOUNDARY GUARD
 *
 * The inventory page went down in production with "An error occurred in the
 * Server Components render". Cause, reproduced against React's own flight
 * serialiser rather than guessed:
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * `InventoryFilterPanel` is a Server Component. `FacetCombobox` is a Client
 * Component ("use client"). The panel passed `hrefFor={(value) => ...}` — a
 * function — across that boundary. It type-checks, it lints, it builds, and
 * it passes every string-matching test, because the failure only exists when
 * the server actually serialises the tree for the browser.
 *
 * That is why the whole Slice 14 suite was green while the page was down.
 * These tests close that class of gap: they assert on the BOUNDARY, not on
 * the markup.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ROOT = process.cwd();
const COMPONENT_DIRS = [
  join(ROOT, "src/components/admin/inventory"),
  join(ROOT, "src/components/admin"),
];

const read = (p: string) => readFileSync(p, "utf8");

/** Every .tsx file under a directory, non-recursive plus one level down. */
function tsxFilesIn(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && e.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const isClientComponent = (src: string) =>
  src.trimStart().startsWith('"use client"') || src.trimStart().startsWith("'use client'");

/**
 * Strip comments before scanning. Prose that DESCRIBES the old defect (for
 * example the note explaining why `hrefFor={(value) => ...}` was removed) must
 * not be reported as the defect itself.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Find JSX props whose value is an inline arrow/function expression, e.g.
 *   hrefFor={(value) => ...}   onPick={function () {}}
 * Event handlers (on*) are excluded: those are only ever written inside client
 * components, and this check is applied to server components only.
 */
function functionValuedProps(src: string): string[] {
  const found: string[] = [];
  // prop={(args) => ...   or   prop={function ...   or   prop={someFn.bind
  const re = /(\w+)=\{\s*(?:\([^)]*\)\s*=>|function\b|async\s*\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
  const code = stripComments(src);
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1]!;
    if (!/^on[A-Z]/.test(name)) found.push(name);
  }
  return found;
}

describe("the inventory filter panel respects the RSC boundary", () => {
  const PANEL = join(ROOT, "src/components/admin/inventory/InventoryFilterPanel.tsx");
  const COMBO = join(ROOT, "src/components/admin/inventory/FacetCombobox.tsx");

  it("the panel is a Server Component and the combobox is a Client Component", () => {
    // If this ever flips, the reasoning below no longer applies and the guard
    // must be revisited deliberately rather than silently passing.
    expect(isClientComponent(read(PANEL))).toBe(false);
    expect(isClientComponent(read(COMBO))).toBe(true);
  });

  it("passes NO function props from the server panel into a client component", () => {
    // This is the exact defect that took the page down.
    const offenders = functionValuedProps(read(PANEL));
    expect(offenders).toEqual([]);
  });

  it("does not declare a function-typed prop on the client combobox", () => {
    const combo = read(COMBO);
    // A function in the prop TYPE is an open invitation for a server parent to
    // pass one. Links must arrive as precomputed strings.
    expect(combo).not.toMatch(/hrefFor\s*:\s*\(/);
    expect(combo).not.toMatch(/^\s*\w+\s*:\s*\([^)]*\)\s*=>\s*string;/m);
  });

  it("gives the combobox its links as serialisable data", () => {
    const combo = read(COMBO);
    // Each option carries its own href, computed on the server, and the row
    // renders from that data rather than from a callback prop.
    expect(combo).toMatch(/href=\{\s*[a-zA-Z_$][\w$]*\.href\b/);
    // The pill/keyboard paths resolve through a local lookup over `options`,
    // never through a function handed in by the server parent.
    expect(combo).toMatch(/const hrefOf = useMemo\(/);
  });
});

describe("no server component anywhere hands a function to the client", () => {
  it("scans admin components for the same class of defect", () => {
    const offenders: string[] = [];
    for (const dir of COMPONENT_DIRS) {
      for (const file of tsxFilesIn(dir)) {
        const src = read(file);
        if (isClientComponent(src)) continue; // client→client is fine
        const props = functionValuedProps(src);
        if (props.length > 0) offenders.push(`${file.replace(ROOT + "/", "")}: ${props.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
