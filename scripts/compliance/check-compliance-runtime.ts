/**
 * scripts/compliance/check-compliance-runtime.ts
 *
 * Runtime smoke test that src/lib/ai/compliance.ts loads the shared JSON
 * pattern fixture and behaves: blocks medical claims, passes clean sensory
 * copy, warns (without blocking) on hype, and blocks owner banned phrases.
 *
 * Run: npx tsx scripts/compliance/check-compliance-runtime.ts
 *
 * Note: "server-only" is aliased by the Next.js compiler and isn't a real
 * installed package here, so we stub its resolution for this Node-only run.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Module from "node:module";

const realResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return __filename; // harmless self-reference stub
  return realResolve.call(this, request, ...rest);
};

async function main() {
  const { checkCompliance, COMPLIANCE_PATTERNS_VERSION } = await import("../../src/lib/ai/compliance");

  const bad = checkCompliance("This strain treats anxiety and relieves pain.");
  if (bad.ok || bad.blockingFlags.length === 0) throw new Error("should block medical claim");

  const good = checkCompliance("A craft hybrid with bright citrus aroma and a smooth, earthy finish.");
  if (!good.ok) throw new Error("clean copy should pass: " + good.flags.join(","));

  const warn = checkCompliance("Top-shelf flower with premium quality buds.");
  if (!warn.ok || warn.flags.length === 0) throw new Error("hype should warn but not block");

  const banned = checkCompliance("Our gas is unbeatable.", [
    { phrase: "unbeatable", severity: "block", reason: null },
  ]);
  if (banned.ok) throw new Error("owner banned phrase should block");

  const dosing = checkCompliance("Start with 1 gummy, 10 mg per serving.");
  if (dosing.ok) throw new Error("dosing advice should block");

  const minors = checkCompliance("Tastes like candy — kids love the look!");
  if (minors.ok) throw new Error("appeal-to-minors should block");

  console.log(`TS compliance runtime OK — patterns v${COMPLIANCE_PATTERNS_VERSION}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
