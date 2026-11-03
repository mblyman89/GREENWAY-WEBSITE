/**
 * src/lib/pos/register-fingerprint-core.ts  (D142 / D143 — "am I on the newest
 * register app?")
 *
 * Owner, 2026-11-03: "I thought I had done that by downloading the current
 * repo to my desktop and then using Xcode to rebuild them. Can you add into
 * this slices work a way for me to see or validate in some way I am on the
 * latest version for my iPad registers? So I don't rebuild them thinking it
 * worked when I really missed a step somewhere and didn't actually update the
 * registers."
 *
 * WHY THE OLD VERSION STAMP COULD NEVER ANSWER THAT
 * The packaged app's version came from REGISTER_BUILD_VERSION or Vercel's
 * VERCEL_GIT_COMMIT_SHA. A build on the owner's Mac has neither, so every iPad
 * build was stamped "dev" — and isBuildStale() deliberately treats "dev" as
 * never stale. The lock screen therefore showed "v dev" forever and could not
 * tell a fresh build from a three-week-old one. Production confirmed it: zero
 * of the 80 sales after the D133 deploy carried promoDayKey, i.e. both iPads
 * were still running the pre-D133 bundle after the owner's rebuild.
 *
 * THE FIX: A SOURCE FINGERPRINT, NOT A GIT ID
 * Both builds hash the SAME list of files — every file the iPad app is
 * actually made of (the register's whole import graph from RegisterShell.tsx,
 * its CSS, the native Swift/plist/Capacitor config) — in the same order, with
 * line endings normalised. The server computes it at deploy time (Vercel, in
 * next.config.ts); the iPad computes it at build time (Vite, in
 * register-app/vite.config.ts). Equal fingerprints mean "this iPad was built
 * from exactly the code the live server is running". No git needed, so a
 * downloaded ZIP works, and a missed step (skipped `npm run
 * register:build:ios`, built from an old folder, forgot `cap sync`) shows up
 * as a mismatch on the lock screen in bold.
 *
 * This module is PURE (no fs, no crypto): it parses import specifiers, defines
 * the extra-file list, combines per-file digests, and decides the lock-screen
 * verdict. The node-side walker lives in scripts/pos/register-fingerprint.ts.
 */

/** Files outside the JS import graph that still change what the iPad app does. */
export const FINGERPRINT_EXTRA_FILES: readonly string[] = [
  "register-app/index.html",
  "register-app/src/main.tsx",
  "register-app/src/register.css",
  "src/app/pos-tokens.css",
  "capacitor.config.ts",
  "src/lib/pos/capacitor-config-core.ts",
  "ios/App/App/Info.plist",
  "ios/App/App/AppDelegate.swift",
  "ios/App/App/SceneDelegate.swift",
  "ios/App/App/GreenwayBridgeViewController.swift",
  "ios/App/App/StarPrinterPlugin.swift",
  "ios/App/App/SocketScannerPlugin.swift",
];

/** The graph entry (the one register component both builds compile). */
export const FINGERPRINT_ENTRY = "src/app/(site)/pos/RegisterShell.tsx";

/** Short form shown on screens (first 10 hex chars). */
export const FINGERPRINT_SHORT_LEN = 10;

/** Pull every static/dynamic import + re-export specifier out of a source file. */
export function extractImportSpecs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[^;]*?from\s*["']([^"']+)["']/gm)) out.push(m[1]!);
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]!);
  for (const m of src.matchAll(/^\s*export\s+(?:type\s+)?[^;]*?from\s*["']([^"']+)["']/gm)) out.push(m[1]!);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

/** Only project-local specifiers are followed (packages are pinned by package-lock). */
export function isLocalSpec(spec: string): boolean {
  return spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../");
}

/** CRLF/CR -> LF so a Windows checkout or a ZIP download hashes identically. */
export function normalizeSource(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Repo-relative, forward-slash path (stable across macOS / Linux / Windows). */
export function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Combine per-file digests into ONE manifest string (sorted by path) that the
 * caller hashes. Each line is "path\tdigest". Missing files are recorded as
 * "path\tmissing" so a deleted file changes the fingerprint too.
 */
export function fingerprintManifest(parts: ReadonlyArray<{ path: string; digest: string | null }>): string {
  const lines = parts
    .map((p) => `${normalizeRelPath(p.path)}\t${p.digest ?? "missing"}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `greenway-register-fingerprint-v1\n${lines.join("\n")}\n`;
}

/** Accept only a plausible fingerprint (hex, 10–64 chars); anything else is "unknown". */
export function sanitizeFingerprint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return /^[0-9a-f]{10,64}$/.test(v) ? v : null;
}

export function shortFingerprint(fp: string | null | undefined): string {
  const v = sanitizeFingerprint(fp);
  return v ? v.slice(0, FINGERPRINT_SHORT_LEN) : "unknown";
}

// ---------------------------------------------------------------------------
// Lock-screen verdict
// ---------------------------------------------------------------------------

export type RegisterVersionState =
  /** App fingerprint equals the live server's: bold green "newest version". */
  | "current"
  /** Fingerprints differ: bold red "NOT the newest version — rebuild". */
  | "outdated"
  /** Not answered yet / offline / server not reporting: neutral "checking". */
  | "checking"
  /** The app was built without a fingerprint (cannot be verified). */
  | "unverifiable";

export type RegisterVersionVerdict = {
  state: RegisterVersionState;
  /** The bold headline. */
  headline: string;
  /** One supporting line. */
  detail: string;
};

/**
 * What the lock screen says about this app's version. Pure.
 *
 * `lastConfirmedAt` is the last time (ms) the server confirmed a match; while
 * offline we keep saying "newest as of <time>" rather than going quiet, so the
 * owner is never left guessing during an outage.
 */
export function registerVersionVerdict(input: {
  appFingerprint: string | null | undefined;
  serverFingerprint: string | null | undefined;
  online: boolean;
  lastConfirmedAt?: number | null;
  nowMs?: number;
  formatTime?: (ms: number) => string;
}): RegisterVersionVerdict {
  const app = sanitizeFingerprint(input.appFingerprint);
  const server = sanitizeFingerprint(input.serverFingerprint);
  const fmt = input.formatTime ?? ((ms: number) => new Date(ms).toISOString());
  if (!app) {
    return {
      state: "unverifiable",
      headline: "THIS APP CANNOT VERIFY ITS VERSION",
      detail:
        "It was built without a version fingerprint. Rebuild with: npm run register:build:ios (see Back office → Register Activity → iPad setup).",
    };
  }
  if (!server) {
    if (input.lastConfirmedAt) {
      return {
        state: "current",
        headline: "NEWEST VERSION — ALL GOOD",
        detail: `Last confirmed with the server at ${fmt(input.lastConfirmedAt)}. ${input.online ? "Re-checking…" : "Offline right now; sales still save on this iPad."} App ${app.slice(0, FINGERPRINT_SHORT_LEN)}.`,
      };
    }
    return {
      state: "checking",
      headline: input.online ? "Checking app version…" : "Offline: version check waits for the internet",
      detail: `App ${app.slice(0, FINGERPRINT_SHORT_LEN)}. Sales still save on this iPad while offline.`,
    };
  }
  if (app === server) {
    return {
      state: "current",
      headline: "NEWEST VERSION — ALL GOOD",
      detail: `This iPad runs exactly the register the live server runs (app ${app.slice(0, FINGERPRINT_SHORT_LEN)}).`,
    };
  }
  return {
    state: "outdated",
    headline: "NOT THE NEWEST VERSION — REBUILD THIS IPAD",
    detail: `This iPad has app ${app.slice(0, FINGERPRINT_SHORT_LEN)}; the live server has ${server.slice(0, FINGERPRINT_SHORT_LEN)}. Sales still work. Rebuild steps: Back office → Register Activity → iPad setup.`,
  };
}

// ---------------------------------------------------------------------------
// Remembered confirmation (registered storage key gw-pos-version-check)
// ---------------------------------------------------------------------------

export const VERSION_CHECK_KEY = "gw-pos-version-check";

export function serializeVersionCheck(fingerprint: string, atMs: number): string {
  return JSON.stringify({ v: 1, fingerprint, at: atMs });
}

/**
 * The remembered confirmation time, ONLY if it was for this exact app
 * fingerprint (a rebuilt app never inherits the old build's green).
 */
export function parseVersionCheck(raw: string | null | undefined, appFingerprint: string | null | undefined): number | null {
  const app = sanitizeFingerprint(appFingerprint);
  if (!raw || !app) return null;
  try {
    const o = JSON.parse(raw) as { fingerprint?: unknown; at?: unknown };
    if (sanitizeFingerprint(o.fingerprint) !== app) return null;
    return typeof o.at === "number" && Number.isFinite(o.at) && o.at > 0 ? o.at : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Embedded self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runRegisterFingerprintTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`register-fingerprint-core FAIL: ${label}`);
    }
  };
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  ok(extractImportSpecs('import { x } from "@/lib/a";\nimport type { Y } from "./b";').join() === "@/lib/a,./b", "static + type imports");
  ok(extractImportSpecs('export { z } from "../c";').join() === "../c", "re-export");
  ok(extractImportSpecs('import "./side.css";').join() === "./side.css", "side-effect import");
  ok(extractImportSpecs("const m = await im" + 'port("@/lib/d");').join() === "@/lib/d", "dynamic import"); // split so the fingerprint scanner does not follow this fixture
  ok(isLocalSpec("@/lib/x") && isLocalSpec("./x") && isLocalSpec("../x") && !isLocalSpec("react"), "local spec rule");
  ok(normalizeSource("a\r\nb\rc\n") === "a\nb\nc\n", "line endings normalised");
  ok(normalizeRelPath("src\\app\\x.ts") === "src/app/x.ts" && normalizeRelPath("./a") === "a", "paths normalised");
  const m1 = fingerprintManifest([{ path: "b", digest: "2" }, { path: "a", digest: "1" }]);
  const m2 = fingerprintManifest([{ path: "a", digest: "1" }, { path: "b", digest: "2" }]);
  ok(m1 === m2, "manifest is order-independent");
  ok(fingerprintManifest([{ path: "a", digest: null }]).includes("a\tmissing"), "missing file recorded");
  ok(fingerprintManifest([{ path: "a", digest: "1" }]) !== fingerprintManifest([{ path: "a", digest: "2" }]), "content change changes manifest");
  ok(sanitizeFingerprint("dev") === null && sanitizeFingerprint(A) === A && sanitizeFingerprint(" ABCDEF0123 ") === "abcdef0123", "sanitize");
  ok(shortFingerprint(A) === "aaaaaaaaaa" && shortFingerprint(null) === "unknown", "short form");

  ok(registerVersionVerdict({ appFingerprint: A, serverFingerprint: A, online: true }).state === "current", "match = current");
  const out = registerVersionVerdict({ appFingerprint: A, serverFingerprint: B, online: true });
  ok(out.state === "outdated" && /REBUILD/.test(out.headline), "mismatch = outdated, says rebuild");
  ok(registerVersionVerdict({ appFingerprint: null, serverFingerprint: A, online: true }).state === "unverifiable", "no app fp = unverifiable");
  ok(registerVersionVerdict({ appFingerprint: "dev", serverFingerprint: A, online: true }).state === "unverifiable", "'dev' never reads as current");
  ok(registerVersionVerdict({ appFingerprint: A, serverFingerprint: null, online: false }).state === "checking", "offline, never confirmed = checking");
  const remembered = registerVersionVerdict({ appFingerprint: A, serverFingerprint: null, online: false, lastConfirmedAt: 1, formatTime: () => "9:00 AM" });
  ok(remembered.state === "current" && remembered.detail.includes("9:00 AM"), "offline after a confirmation keeps the green verdict with the time");
  ok(!/undefined|null/.test(out.detail), "no jargon leaks");
  ok(parseVersionCheck(serializeVersionCheck(A, 5), A) === 5, "remembered confirmation round-trips");
  ok(parseVersionCheck(serializeVersionCheck(A, 5), B) === null, "a different build never inherits the green");
  ok(parseVersionCheck("{bad", A) === null && parseVersionCheck(null, A) === null, "junk storage ignored");
  return { passed, failed };
}
