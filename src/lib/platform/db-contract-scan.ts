/**
 * src/lib/platform/db-contract-scan.ts  (G-71a, owner message 12)
 *
 * Node-only helper (fs). Used by scripts/platform/build-db-contract.ts and by
 * the CI test. NEVER imported by app code.
 *
 * Reads every .ts/.tsx under src/ and collects the database objects the code
 * names:
 *   - tables / views:  `.from("name")`, plus string constants whose name ends
 *     in TABLE (e.g. `const STATE_TABLE = "syndication_state"`), which is how
 *     several stores name their table once;
 *   - functions:       `.rpc("name")`, plus string constants whose name ends
 *     in RPC.
 * Storage buckets (`.storage.from("media")`) and Array/Buffer.from are not
 * database objects and are skipped. A `.from(variable)` the scanner cannot
 * resolve is fine: the variable's value is a constant this scan already reads,
 * or a table name chosen from a list that is itself a literal elsewhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { normalizeContract, type DbContract } from "./db-contract-core";

/** The scanner itself is not app code. */
const SKIP_FILES = new Set(["db-contract-scan.ts", "db-contract-core.ts", "db-contract.ts"]);

const IDENT = "[a-z_][a-z0-9_]*";

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !SKIP_FILES.has(name) && !name.endsWith(".generated.ts") && !name.endsWith(".d.ts")) out.push(p);
  }
}

/** Removes block and line comments (keeps strings intact well enough for this scan). */
export function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Pure over one file's text, exported for the test. */
export function scanSourceText(raw: string): { tables: string[]; functions: string[] } {
  const text = stripComments(raw);
  const tables = new Set<string>();
  const functions = new Set<string>();
  const fromRe = new RegExp(`([A-Za-z_$][\\w$]*)?(\\s*\\??\\.\\s*)from\\(\\s*(["'\`])(${IDENT})\\3\\s*[,)]`, "g");
  for (const m of text.matchAll(fromRe)) {
    const before = m[1] ?? "";
    if (before === "storage" || before === "Array" || before === "Buffer" || before === "Object") continue;
    tables.add(m[4]);
  }
  const rpcRe = new RegExp(`\\.\\s*rpc\\(\\s*(["'\`])(${IDENT})\\1`, "g");
  for (const m of text.matchAll(rpcRe)) functions.add(m[2]);
  const constRe = new RegExp(`\\bconst\\s+([A-Z][A-Z0-9_]*)\\s*(?::\\s*string\\s*)?=\\s*(["'\`])(${IDENT})\\2`, "g");
  for (const m of text.matchAll(constRe)) {
    const name = m[1];
    if (/(^|_)TABLE$/.test(name)) tables.add(m[3]);
    else if (/(^|_)RPC$/.test(name)) functions.add(m[3]);
  }
  return { tables: [...tables], functions: [...functions] };
}

export function collectDbContract(root: string): DbContract {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  const tables: string[] = [];
  const functions: string[] = [];
  for (const f of files.sort()) {
    const r = scanSourceText(readFileSync(f, "utf8"));
    tables.push(...r.tables);
    functions.push(...r.functions);
  }
  return normalizeContract({ tables, functions });
}

export function renderDbContract(c: DbContract): string {
  // JSON, not .ts, on purpose: many guard tests walk src/**/*.ts(x) asking
  // "who names table X"; a names-only list must not trip them.
  return `${JSON.stringify({ generatedBy: "scripts/platform/build-db-contract.ts (G-71a). Do not edit by hand.", tables: c.tables, functions: c.functions }, null, 2)}\n`;
}
