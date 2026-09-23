#!/usr/bin/env node
/**
 * scripts/recon/l30-plain-form-regression-probe.mjs — SLICE L-30.
 *
 * A SECOND question, asked because the first answer was uncomfortable.
 *
 * L-30's main probe proved the confirm-first path is broken under a real
 * click. While reading react-dom 19.2.4 to understand why, something worse
 * showed up in the form-action event plugin (`extractEvents$1`, the "action"
 * SyntheticEvent):
 *
 *     } else
 *       "function" === typeof action &&
 *         (event.preventDefault(), ... startHostTransition(...))
 *
 * When `<form action={serverActionFn}>` submits for real, REACT ITSELF calls
 * preventDefault() — that is how it stops the browser doing a native form POST
 * and runs the server action instead. It is not a cancellation; it is the
 * mechanism of success.
 *
 * L-29 taught PendingKeeper to treat `defaultPrevented === true` as "this
 * submit never started". If React sets that flag on EVERY successful server
 * action, then L-29 did not just fail to fix the Leafly button — it silently
 * switched OFF the progress bar for every save in the entire back office.
 * That is the original H12f complaint ("I'll click it, then not know if it
 * worked") coming back through the front door.
 *
 * This probe asks that question of a plain server-action form with NO dialog
 * and NO preventDefault of our own — the shape of nearly every admin save.
 *
 * Run:  node scripts/recon/l30-plain-form-regression-probe.mjs
 * Exit: 0 = question answered; 1 = probe could not run.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = mkdtempSync(join(ROOT, ".l30-plain-"));
process.on("exit", () => {
  try { rmSync(OUT, { recursive: true, force: true }); } catch { /* best effort */ }
});

const log = (...a) => console.log(...a);
const hr = (t) => log(`\n${"═".repeat(74)}\n${t}\n${"═".repeat(74)}`);

hr("L-30 REGRESSION CHECK — DID L-29 TURN OFF THE BAR FOR EVERY ADMIN SAVE?");
log(`react-dom under test: ${JSON.parse(readFileSync(join(ROOT, "node_modules/react-dom/package.json"), "utf8")).version}`);

const ENTRY = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { PendingKeeper } from "@/components/admin/ux/PendingKeeper";

const T = (window.__L30P = { serverActionCalls: 0, reactPreventedDefault: null });

async function saveSomething(formData) {
  T.serverActionCalls += 1;
  await new Promise((r) => setTimeout(r, 400)); // a slow save, like a manifest
}

function PlainSave() {
  return (
    // The ordinary shape: a server action, no dialog, no onSubmit of our own.
    <form action={saveSomething}>
      <input type="hidden" name="x" value="1" />
      <button type="submit" data-testid="save">Save</button>
    </form>
  );
}

// Watch the native event AFTER React has had its say, to see who prevented it.
document.addEventListener(
  "submit",
  (e) => { T.reactPreventedDefault = e.defaultPrevented; },
  false, // bubble: runs after React's root-container listeners
);

createRoot(document.getElementById("root")).render(
  <>
    <PendingKeeper />
    <PlainSave />
  </>,
);
window.__ready = true;
`;

writeFileSync(join(OUT, "entry.jsx"), ENTRY);
writeFileSync(
  join(OUT, "next-navigation-stub.js"),
  `export function usePathname() { return "/admin/orders"; }\n`,
);

try {
  execFileSync(
    join(ROOT, "node_modules/.bin/esbuild"),
    [
      join(OUT, "entry.jsx"),
      "--bundle",
      "--format=iife",
      "--jsx=automatic",
      "--loader:.jsx=jsx",
      '--define:process.env.NODE_ENV="production"',
      `--alias:@=${join(ROOT, "src")}`,
      `--alias:next/navigation=${join(OUT, "next-navigation-stub.js")}`,
      `--outfile=${join(OUT, "bundle.js")}`,
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  log("  ✅ bundled the REAL PendingKeeper against the REAL react-dom");
} catch (err) {
  log("  ❌ bundle failed");
  log(String(err.stderr || err.stdout || err));
  process.exit(1);
}

writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script src="./bundle.js"></script></body>`,
);

const pwMod = await import(join(ROOT, "node_modules/playwright/index.js"));
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + join(OUT, "index.html"));
await page.waitForFunction(() => window.__ready === true);

await page.click('[data-testid="save"]');
await page.waitForTimeout(150); // save is still running (400ms)

const mid = await page.evaluate(() => ({
  ...window.__L30P,
  barVisible: !!document.querySelector(".gw-pending-bar"),
  buttonBusy: !!document.querySelector("button.gw-submit-busy"),
}));

await browser.close();

hr("RESULT — a plain server-action save, mid-flight, after a REAL click");
log(`  server action actually running ........ ${mid.serverActionCalls === 1}`);
log(`  react-dom called preventDefault() ..... ${mid.reactPreventedDefault}`);
log(`  progress bar visible .................. ${mid.barVisible}`);
log(`  pressed button shows busy ............. ${mid.buttonBusy}`);

hr("VERDICT");
if (mid.serverActionCalls !== 1) {
  log("❌ the save did not run — probe is not exercising what it claims.");
  process.exit(1);
}
if (mid.reactPreventedDefault === true && mid.barVisible === false) {
  log("❌ CONFIRMED REGRESSION, and it is worse than the Leafly button.");
  log("");
  log("   react-dom calls preventDefault() on EVERY successful server-action");
  log("   submit — that is how it takes over from the native form POST. L-29");
  log("   reads that same flag as proof the submit never started, so the bar");
  log("   is suppressed for EVERY save in the back office, not just Leafly.");
  log("");
  log("   `defaultPrevented` cannot distinguish 'cancelled to ask a question'");
  log("   from 'succeeded'. It is the wrong signal and must be abandoned, not");
  log("   re-timed. A later microtask would not have helped either.");
} else if (mid.barVisible === true) {
  log("✅ The bar still shows for ordinary saves — no regression on this path.");
  log(`   (react preventDefault=${mid.reactPreventedDefault})`);
} else {
  log("⚠️  Inconclusive — record the numbers above and investigate before fixing.");
}
process.exit(0);
