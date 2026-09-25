/**
 * scripts/recon/l39-status-hang-probe.mjs — SLICE L-39.
 *
 * The owner: "for our own online orders, when I press the button to advance
 * to the next step, it works, but the progress bar continues to spin until
 * the 5 min cap is hit and the button remains un-pressable until the spinner
 * gets reset."
 *
 * HYPOTHESIS UNDER TEST (proven here by execution, not by reading code):
 *
 *   setOrderStatusAction ends with revalidatePath() and NO redirect. The page
 *   re-renders IN PLACE: the URL does not change, and React reconciles the
 *   status <form>/<button> onto the SAME DOM nodes (only the label changes,
 *   "Mark Preparing" → "Mark Ready"). PendingKeeper clears only when the URL
 *   changes, the pressed button leaves the document, the button disables
 *   itself, or the 5-minute FORM ceiling passes. None of the first three
 *   happens, so the bar spins for five minutes — and the form stays stamped
 *   `data-gw-busy="1"`, so the keeper's own double-submit guard swallows the
 *   next press. Exactly the report: "it works" (the first request landed),
 *   "spins until the 5 min cap", "un-pressable until the spinner resets".
 *
 * The probe bundles the REAL PendingKeeper.tsx + pending-core.ts + the REAL
 * status button component with the REAL react-dom this repo ships, and
 * drives them with trusted clicks in real Chromium (the L-30 lesson: scripted
 * dispatchEvent() has different timing from a real click).
 *
 *   BEFORE — a plain submit <Button> (what [id]/page.tsx shipped):
 *            bar still up after the action finished, gwBusy stuck, second
 *            press never reaches the action.
 *   AFTER  — the live SaveButton (useFormStatus; disables itself while
 *            its own form is pending): the keeper steps aside, the button
 *            shows its own spinner for exactly the request, and the second
 *            press is sent.
 *
 * Run: node scripts/recon/l39-status-hang-probe.mjs   (exit 0 = proven)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
// Inside the repo so esbuild resolves the real node_modules (see L-30).
const OUT = mkdtempSync(join(ROOT, ".l39-probe-"));
process.on("exit", () => {
  try { rmSync(OUT, { recursive: true, force: true }); } catch { /* best effort */ }
});

const log = (...a) => console.log(...a);
const hr = (t) => log(`\n${"═".repeat(74)}\n${t}\n${"═".repeat(74)}`);
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) log(`       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const ENTRY = String.raw`
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PendingKeeper } from "@/components/admin/ux/PendingKeeper";
import { Button } from "@/components/admin/ui/Button";
import { SaveButton } from "@/components/admin/orders/SaveButton";

const STEPS = ["Acknowledged", "Preparing", "Ready", "Completed"];
const T = (window.__L39 = { calls: 0 });
const variant = new URLSearchParams(location.search).get("variant");

function OrderPage() {
  // Stands in for the server re-render that revalidatePath() triggers: the
  // action finishes, the SAME tree comes back with the next label. No
  // navigation, exactly like the real detail page.
  const [step, setStep] = useState(0);
  async function action() {
    T.calls += 1;
    await new Promise((r) => setTimeout(r, 300));
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  const label = "Mark " + STEPS[step];
  return (
    <form action={action}>
      <input type="hidden" name="id" value="o1" />
      {variant === "before" ? (
        <Button type="submit" variant="confirm">{label}</Button>
      ) : (
        <SaveButton label={label} busyLabel="Saving…" variant="confirm" size="md" />
      )}
    </form>
  );
}

createRoot(document.getElementById("root")).render(
  <>
    <PendingKeeper />
    <OrderPage />
  </>,
);
window.__ready = true;
`;

writeFileSync(join(OUT, "entry.jsx"), ENTRY);
writeFileSync(join(OUT, "process-shim.js"), `export const __gwProcess = { env: { NODE_ENV: "production" } };\n`);
writeFileSync(
  join(OUT, "next-navigation-stub.js"),
  [
    `export function usePathname() { return "/admin/orders/o1"; }`,
    `export function useSearchParams() { return new URLSearchParams(); }`,
    `export function useRouter() { return { push(){}, replace(){}, refresh(){}, back(){}, forward(){}, prefetch(){} }; }`,
    `export function useParams() { return {}; }`,
    `export function redirect() {}`,
    `export function notFound() {}`,
    ``,
  ].join("\n"),
);

hr("STEP 1 — bundle the REAL keeper + button with the REAL React");
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
      "--define:process=__gwProcess",
      `--inject:${join(OUT, "process-shim.js")}`,
      `--alias:@=${join(ROOT, "src")}`,
      `--alias:next/navigation=${join(OUT, "next-navigation-stub.js")}`,
      `--outfile=${join(OUT, "bundle.js")}`,
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  log("  ✅ bundled");
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
// L39_CHROMIUM lets a sandbox whose cached browser build differs from the
// installed playwright point at the Chromium it does have.
const browser = await chromium.launch(
  process.env.L39_CHROMIUM ? { executablePath: process.env.L39_CHROMIUM } : {},
);

async function run(variant) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + join(OUT, `index.html?variant=${variant}`));
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  const read = () =>
    page.evaluate(() => ({
      calls: window.__L39.calls,
      bar: !!document.querySelector(".gw-pending-bar"),
      busy: document.querySelector("form")?.dataset.gwBusy ?? null,
      label: document.querySelector("form button")?.textContent ?? "",
      disabled: document.querySelector("form button")?.disabled ?? null,
    }));

  await page.click("form button"); // trusted click #1
  await page.waitForTimeout(80);
  const during = await read();
  await page.waitForTimeout(1500); // the action finished ~300ms in
  const after = await read();
  await page.click("form button", { force: true }); // trusted click #2
  await page.waitForTimeout(1500);
  const second = await read();
  await page.close();
  if (errors.length) log("  page errors:", errors.slice(0, 3));
  return { during, after, second };
}

hr("STEP 2 — BEFORE: plain submit Button (as shipped in L-38)");
const before = await run("before");
log(`  after 1.5s: label="${before.after.label}" bar=${before.after.bar} gwBusy=${before.after.busy}`);
log(`  second press → action calls = ${before.second.calls}`);
check("the first press DID reach the action (\"it works\")", before.after.calls, 1);
check("the label moved on (the page re-rendered in place)", before.after.label, "Mark Preparing");
check("…but the progress bar is STILL spinning", before.after.bar, true);
check('…and the form is still stamped gwBusy="1"', before.after.busy, "1");
check("the second press is SWALLOWED (un-pressable)", before.second.calls, 1);

hr("STEP 3 — AFTER: live SaveButton");
const after = await run("after");
log(`  during: disabled=${after.during.disabled} label="${after.during.label}"`);
log(`  after 1.5s: label="${after.after.label}" bar=${after.after.bar} gwBusy=${after.after.busy}`);
log(`  second press → action calls = ${after.second.calls}`);
check("while saving, the button disables itself and says so", after.during.disabled, true);
check("while saving, the busy label shows", after.during.label.includes("Saving"), true);
check("the first press reached the action", after.after.calls, 1);
check("no bar left spinning after the save", after.after.bar, false);
check("no stuck gwBusy stamp", after.after.busy, null);
check("the button is pressable again", after.after.disabled, false);
check("the SECOND press is sent", after.second.calls, 2);
check("and the order moved on again", after.second.label, "Mark Ready");

await browser.close();
hr("VERDICT");
if (failures > 0) {
  log(`❌ ${failures} assertion(s) failed.`);
  process.exit(1);
}
log("✅ PROVEN in real Chromium with trusted clicks: the in-place re-render");
log("   left the keeper busy (bar + gwBusy) and swallowed the next press; the");
log("   self-managing SaveButton clears exactly when the request ends.");
process.exit(0);
