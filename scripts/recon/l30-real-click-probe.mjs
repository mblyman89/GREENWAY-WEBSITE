#!/usr/bin/env node
/**
 * scripts/recon/l30-real-click-probe.mjs — SLICE L-30.
 *
 * ===========================================================================
 * WHY THIS PROBE EXISTS: THE L-29 TEST SUITE WAS GREEN AND THE BUG WAS ALIVE
 * ===========================================================================
 * L-29 shipped 37 passing compliance tests and an 18/18 mutation sweep for a
 * fix that does not work. The owner's reply: "that did not fix the problem."
 *
 * The tests were not merely incomplete — they were *structurally incapable* of
 * failing, because of how they delivered the click. Every DOM-level probe in
 * this repo dispatches events from script:
 *
 *     form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
 *
 * A script-dispatched event runs its entire listener chain inside ONE
 * JavaScript stack frame. Per the HTML spec, the microtask checkpoint only
 * runs when the JS execution context stack becomes EMPTY ("clean up after
 * running script"). Inside a scripted dispatch the stack never empties between
 * listeners, so a `queueMicrotask()` scheduled by the FIRST listener does not
 * run until the LAST listener has finished.
 *
 * A real user click is dispatched by the browser from a task. Each listener
 * invocation is its own callback; the stack empties after each one; so a
 * MICROTASK CHECKPOINT RUNS BETWEEN LISTENERS.
 *
 * L-29's fix is built entirely on `queueMicrotask()` deciding *after* every
 * handler has had its say. That assumption is true under `dispatchEvent()` and
 * FALSE under a real click. The tests proved the fix works in the one world
 * where the bug never existed.
 *
 * This probe therefore uses a REAL Chromium and a REAL trusted click, running
 * the REAL React 19 that ships in this repo and the REAL PendingKeeper source.
 * It runs the same scenario both ways so the divergence is visible, which is
 * the whole lesson.
 *
 * Run:  node scripts/recon/l30-real-click-probe.mjs
 * Exit: 0 = probe reproduced + fix verified; 1 = probe failed to reproduce.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
// The scratch dir must live INSIDE the repo: esbuild resolves bare imports
// ("react", "react-dom/client") from the importing file's directory upward,
// so an entry point in /tmp cannot see the repo's node_modules — and the
// whole point of this probe is that it runs the REAL React.
const OUT = mkdtempSync(join(ROOT, ".l30-probe-"));
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
  return ok;
}

// ───────────────────────────────────────────────────────────────────────────
// 0. Sanity: this probe is worthless if it is not running the real React.
// ───────────────────────────────────────────────────────────────────────────
const reactVersion = JSON.parse(
  readFileSync(join(ROOT, "node_modules/react-dom/package.json"), "utf8"),
).version;
hr("L-30 — THE MICROTASK CHECKPOINT THAT ONLY EXISTS FOR REAL CLICKS");
log(`react-dom under test: ${reactVersion}   (the version the shop ships)`);

// ───────────────────────────────────────────────────────────────────────────
// 1. The page. Real React, real PendingKeeper source, real confirm-first form.
//
//    `keeperVariant` selects between:
//      "l29"  — FROZEN copy of the shipped L-29 logic (arm + queueMicrotask).
//               Frozen on purpose: a "before" model read from live source
//               stops reproducing the bug the moment the fix lands, which is
//               a fuse that blows on success (learned the hard way in L-28).
//      "live" — the ACTUAL current src/components/admin/ux/PendingKeeper.tsx.
// ───────────────────────────────────────────────────────────────────────────
const ENTRY = String.raw`
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { isServerActionForm, PENDING_BUTTON_CLASS } from "@/lib/admin/pending-core";
import { PendingKeeper as LiveKeeper } from "@/components/admin/ux/PendingKeeper";
import { LeaflyOrderActions } from "@/components/admin/orders/LeaflyOrderActions";

// FROZEN HISTORY. This is L-29's submitDidStart(), copied here verbatim and
// deliberately NOT imported from src/. L-28 taught this the hard way: a
// "before" model that reads live source stops reproducing the bug the moment
// the fix lands — a fuse that blows on success. L-30 deletes submitDidStart
// outright, so importing it would break this probe permanently and destroy
// the only executable evidence of what was actually wrong.
function submitDidStart_L29_FROZEN(s) {
  if (s.defaultPrevented) return false;
  if (!s.formConnected) return false;
  return true;
}

// The observable facts this probe collects, read back out of the browser.
const T = (window.__L30 = {
  barShown: false,
  barShownAt: null,
  gwBusyWhileDialogOpen: null,
  serverActionCalls: 0,
  dialogOpens: 0,
  microtaskRanBeforeOnSubmit: null,
  t0: Date.now(),
});

/* ──────────────────────────────────────────────────────────────────────────
 * FROZEN L-29 KEEPER — byte-for-byte the shipped logic, not a paraphrase.
 * Only the React-owned rendering is trimmed; the listener is verbatim.
 * ────────────────────────────────────────────────────────────────────────── */
function FrozenL29Keeper() {
  const [barVisible, setBarVisible] = useState(false);
  const recordRef = useRef(null);

  const clearPending = useCallback(() => {
    const rec = recordRef.current;
    if (!rec) return;
    rec.submitter?.classList.remove(PENDING_BUTTON_CLASS);
    if (rec.form) delete rec.form.dataset.gwBusy;
    recordRef.current = null;
    setBarVisible(false);
  }, []);

  const startPending = useCallback((rec) => {
    clearPending();
    recordRef.current = rec;
    if (rec.submitter) rec.submitter.classList.add(PENDING_BUTTON_CLASS);
    if (rec.form) rec.form.dataset.gwBusy = "1";
    setBarVisible(true);
    T.barShown = true;
    if (T.barShownAt === null) T.barShownAt = Date.now() - T.t0;
  }, [clearPending]);

  useEffect(() => {
    function onSubmit(e) {
      const form = e.target instanceof HTMLFormElement ? e.target : null;
      if (!form) return;
      if (!isServerActionForm(form.getAttribute("action"))) return;
      if (form.dataset.gwBusy === "1") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const submitter = e.submitter;
      const rec = {
        hrefAtStart: window.location.href,
        startedAt: Date.now(),
        kind: "form",
        submitter: submitter instanceof HTMLElement ? submitter : null,
        form,
      };
      queueMicrotask(() => {
        // Instrumentation only: did this microtask beat the form's onSubmit?
        if (T.microtaskRanBeforeOnSubmit === null) {
          T.microtaskRanBeforeOnSubmit = window.__onSubmitHasRun !== true;
        }
        if (!submitDidStart_L29_FROZEN({
          defaultPrevented: e.defaultPrevented,
          formConnected: form.isConnected,
        })) return;
        startPending(rec);
      });
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [startPending]);

  return barVisible ? <div data-testid="bar">Still working</div> : null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The confirm-first form — the exact shape of LeaflyOrderActions' ActionForm
 * as shipped in L-29 (confirmedRef + preventDefault to open the dialog).
 * ────────────────────────────────────────────────────────────────────────── */
async function serverAction(formData) {
  T.serverActionCalls += 1;
  await new Promise((r) => setTimeout(r, 50));
}

function ActionForm() {
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef(null);
  const confirmedRef = useRef(false);

  return (
    <>
      <form
        ref={formRef}
        action={serverAction}
        onSubmit={(e) => {
          window.__onSubmitHasRun = true;
          if (confirmedRef.current) {
            confirmedRef.current = false;
            return;
          }
          e.preventDefault();
          setConfirming(true);
          T.dialogOpens += 1;
        }}
      >
        <input type="hidden" name="leaflyOrderId" value="ORD-1" />
        <button type="submit" data-testid="ack">Acknowledge to Leafly</button>
      </form>
      {confirming ? (
        <div data-testid="dialog">
          <button
            type="button"
            data-testid="confirm"
            onClick={() => {
              // What the keeper believes about the form at the moment the
              // owner answers the question. "1" here means the real submit
              // is about to be swallowed.
              T.gwBusyWhileDialogOpen = formRef.current?.dataset.gwBusy ?? null;
              confirmedRef.current = true;
              setConfirming(false);
              formRef.current?.requestSubmit();
            }}
          >
            Acknowledge to Leafly
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * THE LIVE ACKNOWLEDGE CONTROL — the real shipped component, not a model.
 *
 * Imported from src/ so that if anyone ever re-introduces a confirm dialog or
 * a preventDefault() on the acknowledge path, this probe fails. The action
 * plan is shaped exactly as planLeaflyOrderActions() emits it for a fresh,
 * unacknowledged order (kind "acknowledge", irreversible true, emphasis
 * "primary") — that shape is asserted in the core's own self-tests.
 * ────────────────────────────────────────────────────────────────────────── */
function LiveActionArea() {
  return (
    <LeaflyOrderActions
      actions={[{
        kind: "acknowledge",
        status: null,
        label: "Acknowledge to Leafly",
        busyLabel: "Acknowledging…",
        hint: "hint",
        irreversible: true,
        emphasis: "primary",
      }]}
      leaflyOrderId="ORD-1"
      acknowledgeAction={serverAction}
      statusAction={serverAction}
      irreversibleWarning="Acknowledging tells Leafly we have everything we need."
      defaultCancelReasonLabel="Dispensary"
    />
  );
}

const variant = new URLSearchParams(location.search).get("keeper") || "l29";
function App() {
  return (
    <>
      {variant === "live" ? <LiveKeeper /> : <FrozenL29Keeper />}
      {variant === "live" ? <LiveActionArea /> : <ActionForm />}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__ready = true;
`;

writeFileSync(join(OUT, "entry.jsx"), ENTRY);

// The real admin tree reads process.env keys at module scope. esbuild's
// --define only rewrites the exact key given, so `process` itself must exist
// in the browser or the bundle throws on load.
writeFileSync(
  join(OUT, "process-shim.js"),
  `export const __gwProcess = { env: { NODE_ENV: "production" } };\n`,
);

// next/navigation is not available outside Next. Importing the REAL
// LeaflyOrderActions pulls in the whole @/components/admin/ux barrel, so the
// stub must cover everything that barrel reaches for.
writeFileSync(
  join(OUT, "next-navigation-stub.js"),
  [
    `export function usePathname() { return "/admin/orders"; }`,
    `export function useSearchParams() { return new URLSearchParams(); }`,
    `export function useRouter() {`,
    `  return { push(){}, replace(){}, refresh(){}, back(){}, forward(){}, prefetch(){} };`,
    `}`,
    `export function useParams() { return {}; }`,
    `export function redirect() {}`,
    `export function notFound() {}`,
    ``,
  ].join("\n"),
);

hr("STEP 1 — bundle the REAL sources with the REAL React");
try {
  execFileSync(
    join(ROOT, "node_modules/.bin/esbuild"),
    [
      join(OUT, "entry.jsx"),
      "--bundle",
      "--format=iife",
      "--jsx=automatic",
      "--loader:.jsx=jsx",
      "--define:process.env.NODE_ENV=\"production\"",
      "--define:process=__gwProcess",
      `--inject:${join(OUT, "process-shim.js")}`,
      `--alias:@=${join(ROOT, "src")}`,
      `--alias:next/navigation=${join(OUT, "next-navigation-stub.js")}`,
      `--outfile=${join(OUT, "bundle.js")}`,
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  log("  ✅ bundled: real react-dom 19, real pending-core.ts, real PendingKeeper.tsx");
} catch (err) {
  log("  ❌ bundle failed");
  log(String(err.stderr || err.stdout || err));
  process.exit(1);
}

writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>l30</title>
<body><div id="root"></div><script src="./bundle.js"></script></body>`,
);

// ───────────────────────────────────────────────────────────────────────────
// 2. Drive it in a real browser, two ways.
// ───────────────────────────────────────────────────────────────────────────
// playwright is CommonJS; under ESM the named exports land on `.default`.
const pwMod = await import(join(ROOT, "node_modules/playwright/index.js"));
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  log("  ❌ could not load playwright's chromium driver");
  process.exit(1);
}
const browser = await chromium.launch();

async function run({ keeper, how }) {
  const page = await browser.newPage();
  // Surface page errors: a silent exception here looks identical to a hang,
  // and "it hangs with no error" is the exact complaint this slice exists to
  // end. The probe must never reproduce that experience for its own reader.
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });
  await page.goto("file://" + join(OUT, `index.html?keeper=${keeper}`));
  try {
    await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  } catch {
    log(`\n  ❌ the page never finished rendering (keeper="${keeper}").`);
    for (const e of pageErrors.slice(0, 5)) log(`     ${e}`);
    if (pageErrors.length === 0) log("     (no page errors were reported)");
    await page.close();
    process.exit(1);
  }

  // The live variant renders the REAL component, whose button is identified
  // by its label rather than a test hook we control.
  const ackSelector =
    keeper === "live" ? 'button:has-text("Acknowledge to Leafly")' : '[data-testid="ack"]';

  if (how === "real-click") {
    // A trusted, browser-dispatched click — the owner's thumb.
    await page.click(ackSelector);
  } else {
    // What every DOM probe in this repo has always done instead.
    await page.evaluate(() => {
      const f = document.querySelector("form");
      f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  await page.waitForTimeout(120);
  // The live keeper renders the real `.gw-pending-bar`; the frozen model
  // renders a stand-in. Accept either so one reader works for both.
  const barSel = '[data-testid="bar"], .gw-pending-bar';
  const dlgSel = '[data-testid="dialog"], [role="dialog"]';
  const afterOpen = await page.evaluate(
    ([b, d]) => ({
      ...window.__L30,
      dialogVisible: !!document.querySelector(d),
      barVisible: !!document.querySelector(b),
    }),
    [barSel, dlgSel],
  );

  // Now the owner answers the question — IF there is one. After L-30 there is
  // not: the acknowledgement is a single click and this branch is skipped,
  // which is itself the thing being proven.
  let afterConfirm = null;
  if (afterOpen.dialogVisible) {
    await page.click('[data-testid="confirm"], [role="dialog"] button:has-text("Acknowledge to Leafly")');
  }
  await page.waitForTimeout(250);
  afterConfirm = await page.evaluate(
    ([b, d]) => ({
      ...window.__L30,
      barVisible: !!document.querySelector(b),
      dialogVisible: !!document.querySelector(d),
    }),
    [barSel, dlgSel],
  );
  await page.close();
  return { afterOpen, afterConfirm };
}

// ───────────────────────────────────────────────────────────────────────────
hr("STEP 2 — THE SAME CODE, THE SAME BUG, TWO WAYS OF CLICKING");

const scripted = await run({ keeper: "l29", how: "scripted-dispatch" });
log("\n  (a) scripted dispatchEvent() — what tests/compliance has always done:");
log(`      bar shown while dialog open ........ ${scripted.afterOpen.barVisible}`);
log(`      microtask ran BEFORE onSubmit ...... ${scripted.afterOpen.microtaskRanBeforeOnSubmit}`);
log(`      form.dataset.gwBusy at confirm ..... ${JSON.stringify(scripted.afterConfirm?.gwBusyWhileDialogOpen)}`);
log(`      server action calls ................ ${scripted.afterConfirm?.serverActionCalls}`);

const real = await run({ keeper: "l29", how: "real-click" });
log("\n  (b) REAL trusted browser click — what the owner actually does:");
log(`      bar shown while dialog open ........ ${real.afterOpen.barVisible}`);
log(`      microtask ran BEFORE onSubmit ...... ${real.afterOpen.microtaskRanBeforeOnSubmit}`);
log(`      form.dataset.gwBusy at confirm ..... ${JSON.stringify(real.afterConfirm?.gwBusyWhileDialogOpen)}`);
log(`      server action calls ................ ${real.afterConfirm?.serverActionCalls}`);

hr("STEP 3 — ASSERTIONS: the L-29 fix works only under scripted dispatch");

log("\n  Under scripted dispatch (the world the L-29 tests live in):");
check("the L-29 fix holds — no phantom bar", scripted.afterOpen.barVisible, false);
check("microtask correctly ran AFTER onSubmit", scripted.afterOpen.microtaskRanBeforeOnSubmit, false);
check("the acknowledgement is actually sent", scripted.afterConfirm?.serverActionCalls, 1);

log("\n  Under a REAL click (the world the owner lives in):");
check("PHANTOM BAR appears with the dialog open", real.afterOpen.barVisible, true);
check("the microtask ran BEFORE onSubmit could cancel", real.afterOpen.microtaskRanBeforeOnSubmit, true);
check('form is stamped gwBusy="1" while he reads', real.afterConfirm?.gwBusyWhileDialogOpen, "1");
check("THE ACKNOWLEDGEMENT IS NEVER SENT", real.afterConfirm?.serverActionCalls, 0);
check("and the bar is still spinning afterwards", real.afterConfirm?.barVisible, true);

// ───────────────────────────────────────────────────────────────────────────
hr("STEP 4 — THE LIVE SHIPPED COMPONENT, UNDER A REAL CLICK");
log("  (LeaflyOrderActions + PendingKeeper, imported from src/, not modelled)");

const live = await run({ keeper: "live", how: "real-click" });
log(`\n      a dialog appeared .................. ${live.afterOpen.dialogVisible}`);
log(`      progress bar running ............... ${live.afterConfirm?.barVisible}`);
log(`      ACKNOWLEDGEMENTS SENT .............. ${live.afterConfirm?.serverActionCalls}`);

log("\n  What the owner asked for, checked one clause at a time:");
check('"one click to acknowledge" — no dialog at all', live.afterOpen.dialogVisible, false);
check("the acknowledgement is actually SENT", live.afterConfirm?.serverActionCalls, 1);
check("exactly once — no double submit", live.afterConfirm?.serverActionCalls === 1, true);
check("the bar is running for the REAL request", live.afterConfirm?.barVisible, true);

// The bar must appear because a request is genuinely in flight — the opposite
// of the phantom. A bar with zero requests is the bug; a bar with one request
// is the feature.
const liveClean =
  live.afterOpen.dialogVisible === false &&
  (live.afterConfirm?.serverActionCalls ?? 0) === 1;

await browser.close();

hr("VERDICT");
if (failures > 0) {
  log(`❌ ${failures} assertion(s) failed.`);
  log("   Either the probe no longer reproduces the reported symptom (in which");
  log("   case it cannot be trusted to prove anything and must be fixed first),");
  log("   or the live fix has regressed. Read the section that failed.");
  process.exit(1);
}
log("✅ PROVEN BY EXECUTION, in real Chromium, with real trusted clicks:");
log("");
log("   THE BUG (frozen L-29 logic, real click):");
log("   • A real click runs a microtask checkpoint BETWEEN listeners, so");
log("     L-29's queueMicrotask settled BEFORE the form could cancel.");
log("   • The bar started, gwBusy stuck at \"1\", and the keeper's own");
log("     double-submit guard then swallowed the confirmed submit:");
log("     serverActionCalls = 0. No request was ever made — which is exactly");
log("     why the owner got a spinner and never got an error.");
log("   • The 37 green L-29 tests could not have caught it: dispatchEvent()");
log("     holds the whole chain in one stack frame and defers the microtask.");
log("");
log("   THE FIX (live source, real click):");
log("   • No dialog. One click. One request. Bar reflects a real save.");
process.exit(0);
