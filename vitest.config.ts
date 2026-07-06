/**
 * vitest.config.ts — S-14 compliance test harness (GAP M-11).
 *
 * Scope is deliberately narrow: PURE compliance/money modules only
 * (tests/compliance/**). No DOM, no Next runtime, no database — the point is
 * that this suite runs anywhere in seconds and fails loudly when a statute-
 * encoding module drifts. E2E browser tests remain in ./e2e (Playwright).
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
    include: ["tests/compliance/**/*.test.ts"],
    // Golden-file comparisons are byte-exact; keep default isolation.
  },
});
