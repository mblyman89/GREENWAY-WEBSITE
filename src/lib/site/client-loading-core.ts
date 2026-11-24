/**
 * src/lib/site/client-loading-core.ts — USAGE-8a (2026-11-25)
 *
 * WHY: a SERVER `loading.tsx` is rendered into the RSC payload of every page
 * beneath it (the `"loading":[...]` slot of the segment), so its whole
 * skeleton tree was re-sent in every HTML response and stored in every ISR
 * write. Measured on a live product page: 4,648 bytes (row 16) plus a 3,295
 * byte copy in the segment seed (row 6). Marking the file `"use client"`
 * turns that tree into a one-line client reference; the skeleton markup moves
 * to the (cached, immutable) JS chunk.
 *
 * SAFE: the loading files read no data and use no hooks, so they render the
 * same on the server and the client.
 */

/** The route-level loading files that must stay client components. */
export const CLIENT_LOADING_FILES: readonly string[] = [
  "src/app/(site)/loading.tsx",
  "src/app/(site)/menu/loading.tsx",
];

/** True when the source's first statement is the "use client" directive. */
export function hasUseClientDirective(source: string): boolean {
  const body = source.replace(/^\uFEFF/, "").replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^\s*["']use client["'];?/.test(body);
}

export function __runClientLoadingTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`client-loading-core FAIL: ${name}`);
    }
  };
  ok(hasUseClientDirective('"use client";\nexport default 1'), "double quotes");
  ok(hasUseClientDirective("'use client'\nx"), "single quotes, no semicolon");
  ok(hasUseClientDirective('// note\n"use client";'), "after a line comment");
  ok(hasUseClientDirective('/* doc */\n"use client";'), "after a block comment");
  ok(!hasUseClientDirective("export default function L() {}"), "server file");
  ok(!hasUseClientDirective('import x from "y";\n"use client";'), "directive after an import does not count");
  ok(CLIENT_LOADING_FILES.length === 2, "two loading files");
  ok(CLIENT_LOADING_FILES.every((f) => f.endsWith("/loading.tsx")), "all are loading files");
  if (failed > 0) throw new Error(`client-loading-core: ${failed} failed`);
  return { passed, failed };
}
