/**
 * vitest.config.ts — S-14 compliance test harness (GAP M-11).
 *
 * Scope is deliberately narrow: PURE compliance/money modules only
 * (tests/compliance/**). No DOM, no Next runtime, no database — the point is
 * that this suite runs anywhere in seconds and fails loudly when a statute-
 * encoding module drifts. E2E browser tests remain in ./e2e (Playwright).
 *
 * SLICE B: .tsx files are included so that components whose CONTENT is
 * compliance-relevant can be rendered with `renderToStaticMarkup` and checked
 * for the words they are required to show. That is still pure — a React
 * element in, a string out, no browser and no jsdom. It is NOT an invitation
 * to add jsdom, @testing-library, or anything that needs a `window`; those
 * belong in ./e2e, where a real browser exists to make them meaningful.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The pure modules never import "server-only", but keep a safety stub so
      // an accidental transitive import fails visibly in the test output
      // rather than crashing module resolution.
      "server-only": path.resolve(__dirname, "./tests/compliance/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/compliance/**/*.test.ts", "tests/compliance/**/*.test.tsx"],
    // Golden-file comparisons are byte-exact; keep default isolation.
  },
});
