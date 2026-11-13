/**
 * D241 — two owner switches for the register (pure core).
 *
 * Owner (2026-11-12): "I want to add a toggle setting in register activity
 * that lets me turn off or disable use of the web browser registers. I only
 * want them on if the iPads have failed in some way. I also want a toggle for
 * dual approval on cash swaps with the master so I can turn it off if needed."
 *
 *  1. webRegistersAllowed — may a register be UNLOCKED in a web browser
 *     (https://…/pos), or only in the iPad app ("Greenway Point of
 *     Transaction")? OFF = browser registers refuse to unlock (server-side in
 *     /api/pos/unlock, and on the lock screen for the offline unlock). Queued
 *     sales still sync, and clock in / out still works, so turning it off
 *     never loses a sale or strands a punch.
 *  2. swapApprovalRequired — does a change swap with the master till need a
 *     manager / lead PIN (the second person)? OFF = the cashier's own PIN is
 *     enough; the swap is still recorded with the bills both ways and audited
 *     as "approval not required".
 *
 * One site_settings JSON row (no migration, same pattern as B41 scanning).
 * Missing or garbage values keep TODAY's behaviour (browser registers allowed,
 * swap approval required): only a literal `false` turns a switch off, so a
 * failed read can never lock the store out or silently drop the second PIN.
 *
 * HOW THE SERVER TELLS THE IPAD APP FROM A BROWSER (verified, not guessed):
 * the iPad app serves its files from capacitor://localhost and calls the API
 * cross-origin (src/lib/pos/cors-core.ts NATIVE_POS_ORIGINS; capacitor.config
 * keeps the documented default scheme). A cross-origin fetch always carries an
 * Origin header, so every iPad-app request says Origin: capacitor://localhost.
 * The browser register is served by the site itself: its POSTs carry the
 * site's own origin. So "native" = the Origin is one of NATIVE_POS_ORIGINS;
 * anything else (the site origin, or no Origin at all) is a browser.
 * This is a store policy switch, not a defence against an attacker: a request
 * still needs a provisioned device key and an employee PIN.
 *
 * Pure: no I/O, no React. Self-tested below (run-pure-selftests) and in vitest.
 */

import { NATIVE_POS_ORIGINS, normalizeOrigin } from "./cors-core";

export type RegisterSwitches = {
  /** true = browser (web) registers may unlock. false = iPad app only. */
  webRegistersAllowed: boolean;
  /** true = a change swap needs a manager / lead PIN. false = cashier PIN only. */
  swapApprovalRequired: boolean;
};

export const DEFAULT_REGISTER_SWITCHES: RegisterSwitches = {
  webRegistersAllowed: true,
  swapApprovalRequired: true,
};

/** Normalize an untrusted value (site_settings JSON, cached bundle, form). */
export function normalizeRegisterSwitches(raw: unknown): RegisterSwitches {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_REGISTER_SWITCHES };
  }
  const r = raw as Record<string, unknown>;
  return {
    webRegistersAllowed: r.webRegistersAllowed !== false,
    swapApprovalRequired: r.swapApprovalRequired !== false,
  };
}

/** Which kind of register sent this request, read from its Origin header. */
export type RegisterClient = "ipad_app" | "web_browser";

export function registerClientFromOrigin(origin: string | null | undefined): RegisterClient {
  const o = normalizeOrigin(origin);
  return o !== "" && NATIVE_POS_ORIGINS.includes(o) ? "ipad_app" : "web_browser";
}

/** The plain-English refusal a browser register shows when the switch is off. */
export const WEB_REGISTERS_OFF_MESSAGE =
  "Browser registers are turned off. Use the iPad app (Greenway Point of Transaction). " +
  "If the iPads are down, the owner can turn browser registers on in Register Activity → Register switches.";

/**
 * The one unlock gate. Allowed unless the switch is off AND the request came
 * from a browser. Clock in / out and sale sync never call this.
 */
export function webRegisterUnlockGate(
  switches: RegisterSwitches | undefined,
  client: RegisterClient,
): { ok: true } | { ok: false; error: string } {
  const s = switches ?? DEFAULT_REGISTER_SWITCHES;
  if (client === "web_browser" && s.webRegistersAllowed === false) {
    return { ok: false, error: WEB_REGISTERS_OFF_MESSAGE };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────── self-tests ──
export function __runRegisterSwitchesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  ✗ register-switches: ${name}`);
    }
  };

  const d = normalizeRegisterSwitches(undefined);
  ok(d.webRegistersAllowed === true && d.swapApprovalRequired === true, "unset keeps today's behaviour");
  ok(normalizeRegisterSwitches(null).webRegistersAllowed === true, "null keeps browsers allowed");
  ok(normalizeRegisterSwitches([]).swapApprovalRequired === true, "array is garbage → approval required");
  ok(normalizeRegisterSwitches("off").webRegistersAllowed === true, "a string is garbage");
  ok(normalizeRegisterSwitches({ webRegistersAllowed: false }).webRegistersAllowed === false, "literal false turns browsers off");
  ok(normalizeRegisterSwitches({ webRegistersAllowed: false }).swapApprovalRequired === true, "the other switch stays on");
  ok(normalizeRegisterSwitches({ swapApprovalRequired: false }).swapApprovalRequired === false, "literal false turns approval off");
  ok(normalizeRegisterSwitches({ swapApprovalRequired: "false" }).swapApprovalRequired === true, "the string 'false' does not turn approval off");
  ok(normalizeRegisterSwitches({ webRegistersAllowed: 0 }).webRegistersAllowed === true, "0 does not turn browsers off");

  ok(registerClientFromOrigin("capacitor://localhost") === "ipad_app", "iOS app origin is the iPad app");
  ok(registerClientFromOrigin("Capacitor://LOCALHOST/") === "ipad_app", "normalized origin still matches");
  ok(registerClientFromOrigin("https://localhost") === "ipad_app", "Android app origin is native");
  ok(registerClientFromOrigin("https://greenwaymarijuana.com") === "web_browser", "the site origin is a browser");
  ok(registerClientFromOrigin(null) === "web_browser", "no Origin is a browser");
  ok(registerClientFromOrigin("") === "web_browser", "empty Origin is a browser");
  ok(registerClientFromOrigin("capacitor://localhost.evil.com") === "web_browser", "look-alike is not native");
  ok(registerClientFromOrigin("https://localhost:3000") === "web_browser", "a dev server port is not the app");

  const off = { webRegistersAllowed: false, swapApprovalRequired: true };
  ok(webRegisterUnlockGate(off, "web_browser").ok === false, "off refuses a browser unlock");
  ok(webRegisterUnlockGate(off, "ipad_app").ok === true, "off still lets the iPad app unlock");
  ok(webRegisterUnlockGate(DEFAULT_REGISTER_SWITCHES, "web_browser").ok === true, "on lets a browser unlock");
  ok(webRegisterUnlockGate(undefined, "web_browser").ok === true, "missing settings (old bundle) never lock out");
  const refused = webRegisterUnlockGate(off, "web_browser");
  ok(!refused.ok && refused.error === WEB_REGISTERS_OFF_MESSAGE, "the refusal says what to do");

  return { passed, failed };
}
