/**
 * pos/capacitor-config-core — the ONE authoritative policy for the packaged
 * register app's native configuration ("Greenway Point of Transaction").
 *
 * WHY THIS EXISTS
 * `capacitor.config.ts` is a tiny file, and that is exactly what makes it
 * dangerous. It is short enough that anyone can "just tweak it", it has no
 * types beyond `CapacitorConfig` (nearly every field is optional), and NOTHING
 * in a normal build fails if it is wrong. A bad value here does not break the
 * compile, does not break the tests, and does not break the App Store upload.
 * It breaks the till, on the floor, with a customer waiting.
 *
 * Three specific disasters this module exists to prevent:
 *
 *  1. AN UNCHANGEABLE MISTAKE. Apple: "After you upload a build to App Store
 *     Connect, you can't change the bundle ID or delete the associated explicit
 *     App ID in your developer account."  (CFBundleIdentifier, developer.apple
 *     .com/documentation/bundleresources/information-property-list/cfbundleidentifier)
 *     A typo in `appId` is permanent. It cannot be fixed later, and the wrong
 *     identifier cannot be reclaimed. So the identifier is validated here,
 *     against BOTH rule sets, before it is ever uploaded.
 *
 *  2. A SILENTLY UNREACHABLE SERVER. The web view serves the bundle from a
 *     LOCAL origin and calls our API cross-origin. `/api/pos/*` answers with a
 *     strict allowlist (pos/cors-core). The origin the app presents is derived
 *     from `server.iosScheme` / `server.androidScheme` / `server.hostname`. If
 *     anyone edits one of those three fields, the app's origin stops matching
 *     the allowlist and EVERY register call is blocked by the web view — with
 *     a CORS message a budtender cannot act on. The two files must agree, so
 *     this module derives the origins and the tests prove they agree.
 *
 *  3. A DEBUGGABLE / REDIRECTABLE TILL. `server.url` points the app at an
 *     arbitrary web server (it exists for live-reload). `cleartext` allows
 *     unencrypted HTTP. `webContentsDebuggingEnabled` leaves the web view
 *     inspectable in a RELEASE build. Any one of those, shipped by accident,
 *     turns a point-of-sale terminal that handles cash, customer records and
 *     traceability data into an open door. Capacitor's own docs mark each of
 *     them "**This is not intended for use in production.**" They are therefore
 *     banned outright in the committed config, not left to reviewer memory.
 *
 * WHERE THE RULES COME FROM (all verified in this repo, none guessed)
 *  - Apple charset: bundle IDs "must contain only alphanumeric characters
 *    (A–Z, a–z, and 0–9), hyphens (-), and periods (.)" and "are
 *    case-insensitive". Note: NO underscores.
 *  - Capacitor CLI charset: node_modules/@capacitor/cli/dist/common.js,
 *    checkAppId() → /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/ — Java package form,
 *    at least two segments, each segment starts with a letter, `\w` means
 *    letters/digits/UNDERSCORE. Note: NO hyphens.
 *  - Capacitor colour parsing: node_modules/@capacitor/ios/Capacitor/Capacitor/
 *    UIColor.swift, color(fromHex:) → strips "#", then accepts ONLY a 6-digit
 *    or 8-digit hex string; anything else returns nil and the colour is
 *    silently ignored.
 *  - Default schemes: capacitorjs.com/docs/config (v8) — `server.iosScheme`
 *    defaults to "capacitor", `server.androidScheme` defaults to "https",
 *    `server.hostname` defaults to "localhost".
 *
 * THE UNDERSCORE TRAP (the reason this validator is stricter than either tool)
 * The two charsets above are DIFFERENT, and neither tool checks the other's
 * rule. `com.greenway.point_of_sale` passes Capacitor's `cap init` validation
 * and then violates Apple's documented bundle-ID charset. `com.greenway-mj.app`
 * satisfies Apple and is rejected by Capacitor. Only the INTERSECTION is safe
 * on both, so that is what `validateAppId` enforces: letters and digits and
 * periods, at least two segments, every segment beginning with a letter.
 *
 * PURE MODULE: no next/*, no fs, no env reads, no import-time side effects.
 * Every function is a function of its arguments (repo rule 5), so every branch
 * below is testable — and is tested, here and in vitest.
 */

import {
  CAPACITOR_ANDROID_ORIGIN,
  CAPACITOR_IOS_ORIGIN,
  NATIVE_POS_ORIGINS,
} from "./cors-core";

/* -------------------------------------------------------------------------
 * The decisions themselves. These constants ARE the specification; the real
 * capacitor.config.ts is checked against them by tests/compliance.
 * ---------------------------------------------------------------------- */

/**
 * The permanent identity of the iPad app.
 *
 * Chosen and confirmed by the owner. Reverse-DNS of the business's own domain
 * (greenwaymarijuana.com), with a final segment naming the product so the
 * business can publish other apps later under the same prefix without ever
 * touching this one.
 *
 * This value is effectively WRITE-ONCE — see the Apple citation in the header.
 * Changing it after the first upload means a brand-new app record, a brand-new
 * App Store listing, and a reinstall on every till.
 */
export const REGISTER_APP_ID = "com.greenwaymarijuana.register";

/** Home-screen / App Store name, per the owner's choice in Phase 0. */
export const REGISTER_APP_NAME = "Greenway Point of Transaction";

/**
 * Folder holding the built web bundle, relative to the repo root (where
 * capacitor.config.ts lives). This is the Vite `build.outDir` from
 * register-app/vite.config.ts; the two must stay in step or `npx cap sync`
 * copies an empty/absent folder into the app and the register launches blank.
 */
export const REGISTER_WEB_DIR = "register-app/dist";

/**
 * Launch background colour, 8-digit #RRGGBBAA as Capacitor's own hex parser
 * requires.
 *
 * #060807 is `--pos-canvas` from src/app/pos-tokens.css — the register's DARK
 * canvas. Dark is deliberate: RegisterShell initialises `useState<PosTheme>
 * ("dark")` and only switches to light after localStorage is read, so dark is
 * what the very first frame paints. Matching the web view's background to that
 * first frame removes the white flash that would otherwise strobe on every
 * launch. On a till that is opened and closed all day, in a dim room, that
 * flash is not cosmetic — it is the difference between a device that feels
 * like an appliance and one that feels like a web page in a box.
 */
export const REGISTER_BACKGROUND_COLOR = "#060807ff";

/* -------------------------------------------------------------------------
 * Shapes. Deliberately `unknown`-typed: this validator's whole job is to be
 * fed a real, possibly-wrong config and survive it, so it must not assume the
 * TypeScript types were honoured.
 * ---------------------------------------------------------------------- */

export type CapacitorServerLike = {
  hostname?: unknown;
  iosScheme?: unknown;
  androidScheme?: unknown;
  url?: unknown;
  cleartext?: unknown;
  allowNavigation?: unknown;
  errorPath?: unknown;
  appStartPath?: unknown;
};

export type CapacitorPlatformLike = {
  allowMixedContent?: unknown;
  webContentsDebuggingEnabled?: unknown;
  loggingBehavior?: unknown;
  backgroundColor?: unknown;
  path?: unknown;
  scheme?: unknown;
  contentInset?: unknown;
  limitsNavigationsToAppBoundDomains?: unknown;
};

export type CapacitorConfigLike = {
  appId?: unknown;
  appName?: unknown;
  webDir?: unknown;
  backgroundColor?: unknown;
  loggingBehavior?: unknown;
  zoomEnabled?: unknown;
  server?: unknown;
  ios?: unknown;
  android?: unknown;
};

/** A single problem, with a stable code for tests and plain English for humans. */
export type ConfigProblem = { code: string; message: string };

/* -------------------------------------------------------------------------
 * Field validators
 * ---------------------------------------------------------------------- */

/**
 * Apple's documented bundle-ID charset: alphanumerics, hyphens, periods only.
 * Used to explain WHY a value is rejected, not as the final gate.
 */
const APPLE_BUNDLE_ID_CHARSET = /^[A-Za-z0-9.-]+$/;

/**
 * Capacitor's own gate, copied verbatim from
 * node_modules/@capacitor/cli/dist/common.js checkAppId(). `\w` includes the
 * underscore, which is why this alone is not sufficient.
 */
const CAPACITOR_APP_ID_RE = /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/;

/**
 * The INTERSECTION rule — what we actually require. Letters/digits only inside
 * each segment, each segment must start with a letter, at least two segments.
 * Satisfies Apple's charset AND Capacitor's Java-package form simultaneously.
 */
const SAFE_APP_ID_RE = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;

/**
 * Validate a bundle identifier. Returns a plain-English problem, or null when
 * the value is safe on both platforms.
 *
 * Deliberately explains the SPECIFIC violation, because the person reading the
 * failure is choosing a permanent, unchangeable name.
 */
export function validateAppId(value: unknown): string | null {
  if (typeof value !== "string") {
    return "The app's bundle identifier is missing. It is required, and it cannot be changed after the first upload to Apple.";
  }
  const id = value.trim();
  if (id === "") {
    return "The app's bundle identifier is blank. It is required, and it cannot be changed after the first upload to Apple.";
  }
  if (id !== value) {
    return `The bundle identifier "${value}" has leading or trailing spaces. Remove them — Apple stores the identifier exactly as written.`;
  }
  if (id.includes("_")) {
    return `The bundle identifier "${id}" contains an underscore. Capacitor accepts underscores but Apple does not: bundle IDs may only contain letters, digits, hyphens and periods. Use letters and digits only.`;
  }
  if (id.includes("-")) {
    return `The bundle identifier "${id}" contains a hyphen. Apple accepts hyphens but Capacitor does not, because Android application IDs must be a valid Java package name. Use letters and digits only.`;
  }
  if (!APPLE_BUNDLE_ID_CHARSET.test(id)) {
    return `The bundle identifier "${id}" contains characters Apple does not allow. Only letters, digits, hyphens and periods are permitted.`;
  }
  if (!id.includes(".")) {
    return `The bundle identifier "${id}" has only one segment. It must be in reverse-domain form with at least two segments, such as "com.greenwaymarijuana.register".`;
  }
  if (!CAPACITOR_APP_ID_RE.test(id) || !SAFE_APP_ID_RE.test(id)) {
    return `The bundle identifier "${id}" is not valid reverse-domain form. Every segment must begin with a letter and contain only letters and digits, for example "com.greenwaymarijuana.register".`;
  }
  if (id !== id.toLowerCase()) {
    return `The bundle identifier "${id}" contains capital letters. Apple treats bundle IDs as case-insensitive, so capitals add no meaning and invite mismatches between Xcode, App Store Connect and this file. Use all lower case.`;
  }
  return null;
}

/**
 * Validate the built-assets folder. Capacitor copies this folder wholesale
 * into the native project, so an absolute path or a `..` escape would drag in
 * something from outside the repo — or, more likely, nothing at all.
 */
export function validateWebDir(value: unknown): string | null {
  if (typeof value !== "string") {
    return "The web assets folder (webDir) is missing. Capacitor would have nothing to put inside the app.";
  }
  const dir = value.trim();
  if (dir === "") {
    return "The web assets folder (webDir) is blank. Capacitor would have nothing to put inside the app.";
  }
  if (dir !== value) {
    return `The web assets folder "${value}" has leading or trailing spaces.`;
  }
  if (dir.startsWith("/") || /^[a-zA-Z]:/.test(dir)) {
    return `The web assets folder "${dir}" is an absolute path. It must be relative to the repository root so the build works on every machine.`;
  }
  if (dir.startsWith("\\\\")) {
    return `The web assets folder "${dir}" is a network path. It must be relative to the repository root.`;
  }
  if (dir.split("/").includes("..")) {
    return `The web assets folder "${dir}" points outside the repository. It must be relative to the repository root.`;
  }
  if (dir.endsWith("/")) {
    return `The web assets folder "${dir}" ends with a slash. Write it without the trailing slash.`;
  }
  return null;
}

/**
 * Validate a colour the way Capacitor's iOS code actually parses it: strip a
 * single leading "#", then require EXACTLY 6 or 8 hex digits. A 3-digit CSS
 * shorthand like "#fff" is perfectly good CSS and is silently DISCARDED by
 * Capacitor — the app just quietly uses the system background instead. That
 * silence is the reason this is checked.
 */
export function validateBackgroundColor(value: unknown): string | null {
  if (value === undefined) return null; // Optional: absence is legal.
  if (typeof value !== "string") {
    return "The background colour must be written as a hex colour string.";
  }
  const raw = value.trim();
  if (raw !== value) {
    return `The background colour "${value}" has leading or trailing spaces.`;
  }
  if (!raw.startsWith("#")) {
    return `The background colour "${raw}" must start with "#".`;
  }
  const digits = raw.slice(1);
  if (!/^[0-9a-fA-F]*$/.test(digits)) {
    return `The background colour "${raw}" contains characters that are not hex digits.`;
  }
  if (digits.length !== 6 && digits.length !== 8) {
    return `The background colour "${raw}" has ${digits.length} hex digits. Capacitor accepts only 6 (#RRGGBB) or 8 (#RRGGBBAA); anything else is silently ignored and the app falls back to the system background.`;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Origin derivation — the bridge between this file and pos/cors-core
 * ---------------------------------------------------------------------- */

/** Documented Capacitor v8 defaults, used when the config stays silent. */
export const DEFAULT_IOS_SCHEME = "capacitor";
export const DEFAULT_ANDROID_SCHEME = "https";
export const DEFAULT_HOSTNAME = "localhost";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function readServer(config: CapacitorConfigLike): CapacitorServerLike {
  const server = config.server;
  return server !== null && typeof server === "object" ? (server as CapacitorServerLike) : {};
}

function readPlatform(value: unknown): CapacitorPlatformLike {
  return value !== null && typeof value === "object" ? (value as CapacitorPlatformLike) : {};
}

/**
 * Work out the exact origins the packaged app will present to our API.
 *
 * Capacitor lower-cases `server.iosScheme` before use (CAPInstanceDescriptor
 * .swift line 90), so we do too — otherwise a config saying "Capacitor" would
 * look like a mismatch here while working fine on the device, and we would be
 * chasing a phantom.
 */
export function deriveNativeOrigins(config: CapacitorConfigLike): {
  ios: string;
  android: string;
} {
  const server = readServer(config);
  const hostname = readString(server.hostname, DEFAULT_HOSTNAME).toLowerCase();
  const iosScheme = readString(server.iosScheme, DEFAULT_IOS_SCHEME).toLowerCase();
  const androidScheme = readString(server.androidScheme, DEFAULT_ANDROID_SCHEME).toLowerCase();
  return {
    ios: `${iosScheme}://${hostname}`,
    android: `${androidScheme}://${hostname}`,
  };
}

/**
 * Do the origins this config produces appear in the /api/pos/* allowlist?
 *
 * This is the single most valuable check in the file. Everything else fails
 * loudly at build time; THIS one fails at the counter, as "the register can't
 * reach Greenway" on a device that otherwise looks perfectly healthy.
 */
export function originsMatchCorsAllowlist(config: CapacitorConfigLike): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const { ios, android } = deriveNativeOrigins(config);
  if (!NATIVE_POS_ORIGINS.includes(ios)) {
    problems.push({
      code: "ios-origin-not-allowlisted",
      message: `This config makes the iPad app call our API from "${ios}", which is not in the allowed list in src/lib/pos/cors-core.ts. Every register request would be blocked. Change the config back, or add the origin to the allowlist deliberately.`,
    });
  }
  if (!NATIVE_POS_ORIGINS.includes(android)) {
    problems.push({
      code: "android-origin-not-allowlisted",
      message: `This config makes the Android app call our API from "${android}", which is not in the allowed list in src/lib/pos/cors-core.ts. Every register request would be blocked.`,
    });
  }
  return problems;
}

/* -------------------------------------------------------------------------
 * Production-safety audit
 * ---------------------------------------------------------------------- */

/**
 * Fields that must never be present in the COMMITTED config. Each one is
 * documented by Capacitor as development-only, and each one has a concrete
 * consequence on a till.
 */
export function auditProductionSafety(config: CapacitorConfigLike): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const server = readServer(config);
  const ios = readPlatform(config.ios);
  const android = readPlatform(config.android);

  if (server.url !== undefined) {
    problems.push({
      code: "server-url-set",
      message:
        "server.url is set. That makes the installed app load the register from a web address instead of from inside the app, which is a live-reload feature for development. Shipped by accident, every till in the shop would depend on whatever machine that address points at.",
    });
  }
  if (server.cleartext !== undefined && server.cleartext !== false) {
    problems.push({
      code: "cleartext-enabled",
      message:
        "server.cleartext is enabled. That permits unencrypted HTTP traffic. Register traffic carries device keys and customer records and must always be encrypted.",
    });
  }
  if (Array.isArray(server.allowNavigation) && server.allowNavigation.length > 0) {
    problems.push({
      code: "allow-navigation-set",
      message:
        "server.allowNavigation lists extra addresses the register is allowed to navigate to. A point-of-sale app should never navigate anywhere except its own screens.",
    });
  }
  if (android.allowMixedContent !== undefined && android.allowMixedContent !== false) {
    problems.push({
      code: "mixed-content-enabled",
      message:
        "android.allowMixedContent is enabled. Capacitor's own documentation marks this as not for production use.",
    });
  }
  for (const [name, platform] of [
    ["ios", ios],
    ["android", android],
  ] as const) {
    if (
      platform.webContentsDebuggingEnabled !== undefined &&
      platform.webContentsDebuggingEnabled !== false
    ) {
      problems.push({
        code: `${name}-debugging-enabled`,
        message: `${name}.webContentsDebuggingEnabled is turned on. That leaves the register's web view open to inspection in a released build — anyone with the iPad and a cable could read and change what is on the till.`,
      });
    }
  }
  const loggingValues = [config.loggingBehavior, ios.loggingBehavior, android.loggingBehavior];
  if (loggingValues.some((v) => v === "production")) {
    problems.push({
      code: "production-logging",
      message:
        'loggingBehavior is set to "production", so log statements are always produced. Capacitor warns this "can leak information on device". Register logs contain customer and sale detail.',
    });
  }
  return problems;
}

/* -------------------------------------------------------------------------
 * Composite audit
 * ---------------------------------------------------------------------- */

/**
 * Full audit of a Capacitor config for THIS app. Returns every problem found,
 * never throws, and never stops at the first one — a person fixing this file
 * should see the whole list at once, not play whack-a-mole.
 */
export function auditCapacitorConfig(config: unknown): ConfigProblem[] {
  if (config === null || typeof config !== "object") {
    return [
      {
        code: "config-not-object",
        message: "The Capacitor config could not be read as an object.",
      },
    ];
  }
  const c = config as CapacitorConfigLike;
  const problems: ConfigProblem[] = [];

  const appIdProblem = validateAppId(c.appId);
  if (appIdProblem) problems.push({ code: "app-id", message: appIdProblem });
  else if (c.appId !== REGISTER_APP_ID) {
    problems.push({
      code: "app-id-not-agreed",
      message: `The bundle identifier is "${String(c.appId)}", but the agreed identifier for this app is "${REGISTER_APP_ID}". Apple will not let this be changed after the first upload, so it must not drift.`,
    });
  }

  if (typeof c.appName !== "string" || c.appName.trim() === "") {
    problems.push({
      code: "app-name-missing",
      message: "The app name is missing. It is what appears under the icon on the iPad.",
    });
  } else if (c.appName !== REGISTER_APP_NAME) {
    problems.push({
      code: "app-name-not-agreed",
      message: `The app name is "${c.appName}", but the agreed name is "${REGISTER_APP_NAME}".`,
    });
  }

  const webDirProblem = validateWebDir(c.webDir);
  if (webDirProblem) problems.push({ code: "web-dir", message: webDirProblem });
  else if (c.webDir !== REGISTER_WEB_DIR) {
    problems.push({
      code: "web-dir-not-agreed",
      message: `The web assets folder is "${String(c.webDir)}", but the register's build writes to "${REGISTER_WEB_DIR}". Capacitor would package the wrong folder and the app would open blank.`,
    });
  }

  const colorProblem = validateBackgroundColor(c.backgroundColor);
  if (colorProblem) problems.push({ code: "background-color", message: colorProblem });

  problems.push(...originsMatchCorsAllowlist(c));
  problems.push(...auditProductionSafety(c));
  return problems;
}

/* -------------------------------------------------------------------------
 * Embedded pure self-tests (repo rule 5). Run by
 * scripts/compliance/run-pure-selftests.ts and mirrored in vitest.
 * ---------------------------------------------------------------------- */
export function __runCapacitorConfigCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`capacitor-config-core FAIL: ${label}`);
    }
  };

  /** The config we actually ship, expressed as data. */
  const GOOD: CapacitorConfigLike = {
    appId: REGISTER_APP_ID,
    appName: REGISTER_APP_NAME,
    webDir: REGISTER_WEB_DIR,
    backgroundColor: REGISTER_BACKGROUND_COLOR,
  };
  const codes = (c: unknown) => auditCapacitorConfig(c).map((p) => p.code);

  // ── the agreed constants themselves ──────────────────────────────────────
  ok(REGISTER_APP_ID === "com.greenwaymarijuana.register", "app id is the owner-confirmed value");
  ok(validateAppId(REGISTER_APP_ID) === null, "the shipped app id passes validation");
  ok(REGISTER_APP_NAME === "Greenway Point of Transaction", "app name is the owner-confirmed value");
  ok(REGISTER_WEB_DIR === "register-app/dist", "web dir matches the vite build output");
  ok(validateWebDir(REGISTER_WEB_DIR) === null, "the shipped web dir passes validation");
  ok(validateBackgroundColor(REGISTER_BACKGROUND_COLOR) === null, "shipped colour passes validation");
  ok(REGISTER_BACKGROUND_COLOR.toLowerCase().startsWith("#060807"), "colour is the dark pos canvas");
  ok(REGISTER_APP_ID === REGISTER_APP_ID.toLowerCase(), "app id is lower case");
  ok(REGISTER_APP_ID.split(".").length === 3, "app id has three segments");

  // ── validateAppId: accepts ───────────────────────────────────────────────
  ok(validateAppId("com.example.app") === null, "accepts a plain two-dot id");
  ok(validateAppId("com.example") === null, "accepts the minimum two segments");
  ok(validateAppId("com.greenwaymarijuana.register2") === null, "accepts digits after a letter");
  ok(validateAppId("a.b") === null, "accepts single-letter segments");

  // ── validateAppId: rejects (each with the RIGHT reason) ──────────────────
  ok(validateAppId(undefined) !== null, "rejects a missing id");
  ok(validateAppId(null) !== null, "rejects a null id");
  ok(validateAppId(42) !== null, "rejects a non-string id");
  ok(validateAppId("") !== null, "rejects a blank id");
  ok(validateAppId("   ") !== null, "rejects a whitespace id");
  ok(validateAppId(" com.example.app") !== null, "rejects a leading space");
  ok(validateAppId("com.example.app ") !== null, "rejects a trailing space");
  ok((validateAppId(" com.example.app") ?? "").includes("spaces"), "space error explains spaces");
  ok(validateAppId("register") !== null, "rejects a single segment");
  ok((validateAppId("register") ?? "").includes("one segment"), "single-segment error is specific");
  ok(validateAppId("com.1greenway.app") !== null, "rejects a segment starting with a digit");
  ok(validateAppId("com..app") !== null, "rejects an empty segment");
  ok(validateAppId("com.example.") !== null, "rejects a trailing dot");
  ok(validateAppId(".com.example") !== null, "rejects a leading dot");
  ok(validateAppId("com.example.app!") !== null, "rejects punctuation");
  ok(validateAppId("com.example.app/x") !== null, "rejects a slash");
  ok(validateAppId("com.exämple.app") !== null, "rejects non-ascii letters");
  ok(validateAppId("com.example.app app") !== null, "rejects an inner space");

  // THE UNDERSCORE TRAP: Capacitor's own regex accepts this, Apple does not.
  ok(CAPACITOR_APP_ID_RE.test("com.greenway.point_of_sale"), "capacitor's regex really does allow _");
  ok(validateAppId("com.greenway.point_of_sale") !== null, "we reject what Apple forbids (_)");
  ok(
    (validateAppId("com.greenway.point_of_sale") ?? "").includes("underscore"),
    "underscore error names the underscore",
  );
  // THE HYPHEN TRAP: Apple accepts this, Capacitor/Android does not.
  ok(APPLE_BUNDLE_ID_CHARSET.test("com.greenway-mj.app"), "apple's charset really does allow -");
  ok(validateAppId("com.greenway-mj.app") !== null, "we reject what Capacitor forbids (-)");
  ok(
    (validateAppId("com.greenway-mj.app") ?? "").includes("hyphen"),
    "hyphen error names the hyphen",
  );
  // Case: legal for Apple, but ambiguous, so we insist on lower case.
  ok(CAPACITOR_APP_ID_RE.test("com.Greenway.Register"), "capacitor accepts mixed case");
  ok(validateAppId("com.Greenway.Register") !== null, "we insist on lower case");
  ok(
    (validateAppId("com.Greenway.Register") ?? "").includes("case-insensitive"),
    "case error explains why capitals are pointless",
  );

  // ── validateWebDir ───────────────────────────────────────────────────────
  ok(validateWebDir("dist") === null, "accepts a simple relative folder");
  ok(validateWebDir("register-app/dist") === null, "accepts a nested relative folder");
  ok(validateWebDir(undefined) !== null, "rejects a missing web dir");
  ok(validateWebDir("") !== null, "rejects a blank web dir");
  ok(validateWebDir("  ") !== null, "rejects a whitespace web dir");
  ok(validateWebDir(7) !== null, "rejects a non-string web dir");
  ok(validateWebDir("/var/www") !== null, "rejects an absolute unix path");
  ok(validateWebDir("C:/build") !== null, "rejects an absolute windows path");
  ok(validateWebDir("\\\\server\\share") !== null, "rejects a network path");
  ok(validateWebDir("../outside") !== null, "rejects a parent escape");
  ok(validateWebDir("register-app/../../etc") !== null, "rejects a buried parent escape");
  ok(validateWebDir("dist/") !== null, "rejects a trailing slash");
  ok(validateWebDir(" dist") !== null, "rejects a leading space");
  ok(validateWebDir("my..dist") === null, "does not confuse '..' inside a name with an escape");

  // ── validateBackgroundColor (mirrors Capacitor's Swift parser exactly) ───
  ok(validateBackgroundColor(undefined) === null, "colour is optional");
  ok(validateBackgroundColor("#060807") === null, "accepts 6 hex digits");
  ok(validateBackgroundColor("#060807ff") === null, "accepts 8 hex digits");
  ok(validateBackgroundColor("#ABCDEF") === null, "accepts upper-case hex");
  ok(validateBackgroundColor("#fff") !== null, "rejects 3-digit css shorthand");
  ok(
    (validateBackgroundColor("#fff") ?? "").includes("silently ignored"),
    "3-digit error warns it is silently ignored",
  );
  ok(validateBackgroundColor("#12345") !== null, "rejects 5 hex digits");
  ok(validateBackgroundColor("#1234567") !== null, "rejects 7 hex digits");
  ok(validateBackgroundColor("#123456789") !== null, "rejects 9 hex digits");
  ok(validateBackgroundColor("060807") !== null, "rejects a missing hash");
  ok(validateBackgroundColor("#06080g") !== null, "rejects a non-hex digit");
  ok(validateBackgroundColor("#") !== null, "rejects a bare hash");
  ok(validateBackgroundColor("rebeccapurple") !== null, "rejects a css colour name");
  ok(validateBackgroundColor(0x060807) !== null, "rejects a number");
  ok(validateBackgroundColor(" #060807") !== null, "rejects a leading space");

  // ── deriveNativeOrigins ──────────────────────────────────────────────────
  {
    const d = deriveNativeOrigins({});
    ok(d.ios === "capacitor://localhost", "default ios origin is capacitor://localhost");
    ok(d.android === "https://localhost", "default android origin is https://localhost");
    ok(d.ios === CAPACITOR_IOS_ORIGIN, "default ios origin equals the cors constant");
    ok(d.android === CAPACITOR_ANDROID_ORIGIN, "default android origin equals the cors constant");
  }
  ok(deriveNativeOrigins(GOOD).ios === CAPACITOR_IOS_ORIGIN, "shipped config yields the ios origin");
  ok(
    deriveNativeOrigins({ server: { iosScheme: "IONIC" } }).ios === "ionic://localhost",
    "ios scheme is lower-cased the way Capacitor lower-cases it",
  );
  ok(
    deriveNativeOrigins({ server: { hostname: "app.local" } }).ios === "capacitor://app.local",
    "a custom hostname is reflected in the origin",
  );
  ok(
    deriveNativeOrigins({ server: { androidScheme: "http" } }).android === "http://localhost",
    "a custom android scheme is reflected in the origin",
  );
  ok(deriveNativeOrigins({ server: null }).ios === CAPACITOR_IOS_ORIGIN, "null server uses defaults");
  ok(deriveNativeOrigins({ server: "nope" }).ios === CAPACITOR_IOS_ORIGIN, "junk server uses defaults");
  ok(
    deriveNativeOrigins({ server: { iosScheme: "   " } }).ios === CAPACITOR_IOS_ORIGIN,
    "blank scheme falls back to the default",
  );
  ok(
    deriveNativeOrigins({ server: { iosScheme: 5 } }).ios === CAPACITOR_IOS_ORIGIN,
    "non-string scheme falls back to the default",
  );

  // ── origin/CORS agreement — the check that protects the counter ──────────
  ok(originsMatchCorsAllowlist(GOOD).length === 0, "shipped config agrees with the cors allowlist");
  ok(originsMatchCorsAllowlist({}).length === 0, "capacitor defaults agree with the cors allowlist");
  {
    const bad = originsMatchCorsAllowlist({ server: { iosScheme: "greenway" } });
    ok(bad.length === 1, "an invented ios scheme is caught");
    ok(bad[0]?.code === "ios-origin-not-allowlisted", "ios mismatch has the right code");
    ok((bad[0]?.message ?? "").includes("cors-core"), "ios mismatch names the file to fix");
  }
  {
    const bad = originsMatchCorsAllowlist({ server: { hostname: "greenway.local" } });
    ok(bad.length === 2, "a custom hostname breaks BOTH platforms and both are reported");
  }
  {
    const bad = originsMatchCorsAllowlist({ server: { androidScheme: "http" } });
    ok(bad.length === 1, "an http android scheme is caught");
    ok(bad[0]?.code === "android-origin-not-allowlisted", "android mismatch has the right code");
  }
  ok(
    originsMatchCorsAllowlist({ server: { iosScheme: "ionic" } }).length === 0,
    "the legacy ionic scheme is allowlisted, so it is not flagged",
  );

  // ── production-safety audit ──────────────────────────────────────────────
  ok(auditProductionSafety(GOOD).length === 0, "the shipped config is production-safe");
  ok(auditProductionSafety({}).length === 0, "an empty config raises no safety problems");
  {
    const p = auditProductionSafety({ server: { url: "http://192.168.1.5:5173" } });
    ok(p.length === 1 && p[0]?.code === "server-url-set", "a live-reload server url is caught");
  }
  ok(
    auditProductionSafety({ server: { cleartext: true } })[0]?.code === "cleartext-enabled",
    "cleartext http is caught",
  );
  ok(
    auditProductionSafety({ server: { cleartext: false } }).length === 0,
    "explicitly disabled cleartext is fine",
  );
  ok(
    auditProductionSafety({ server: { allowNavigation: ["*"] } })[0]?.code === "allow-navigation-set",
    "an allowNavigation wildcard is caught",
  );
  ok(
    auditProductionSafety({ server: { allowNavigation: [] } }).length === 0,
    "an empty allowNavigation list is fine",
  );
  ok(
    auditProductionSafety({ android: { allowMixedContent: true } })[0]?.code ===
      "mixed-content-enabled",
    "android mixed content is caught",
  );
  ok(
    auditProductionSafety({ ios: { webContentsDebuggingEnabled: true } })[0]?.code ===
      "ios-debugging-enabled",
    "ios web inspector left on is caught",
  );
  ok(
    auditProductionSafety({ android: { webContentsDebuggingEnabled: true } })[0]?.code ===
      "android-debugging-enabled",
    "android web inspector left on is caught",
  );
  ok(
    auditProductionSafety({ loggingBehavior: "production" })[0]?.code === "production-logging",
    "always-on logging is caught",
  );
  ok(
    auditProductionSafety({ ios: { loggingBehavior: "production" } })[0]?.code ===
      "production-logging",
    "always-on ios logging is caught",
  );
  ok(
    auditProductionSafety({ loggingBehavior: "none" }).length === 0,
    "logging set to none is fine",
  );
  {
    // Several problems at once must ALL be reported, not just the first.
    const p = auditProductionSafety({
      server: { url: "http://x", cleartext: true, allowNavigation: ["*"] },
      ios: { webContentsDebuggingEnabled: true },
      android: { webContentsDebuggingEnabled: true, allowMixedContent: true },
      loggingBehavior: "production",
    });
    ok(p.length === 7, "every unsafe setting is reported, not just the first");
  }

  // ── composite audit ──────────────────────────────────────────────────────
  ok(auditCapacitorConfig(GOOD).length === 0, "the shipped config audits clean");
  ok(codes(null).includes("config-not-object"), "null config is reported, not thrown");
  ok(codes(undefined).includes("config-not-object"), "undefined config is reported");
  ok(codes("nope").includes("config-not-object"), "string config is reported");
  ok(codes(123).includes("config-not-object"), "number config is reported");
  ok(codes({}).includes("app-id"), "empty config reports the missing app id");
  ok(codes({}).includes("app-name-missing"), "empty config reports the missing app name");
  ok(codes({}).includes("web-dir"), "empty config reports the missing web dir");
  ok(
    codes({ ...GOOD, appId: "com.example.app" }).includes("app-id-not-agreed"),
    "a valid but different app id is still flagged as drift",
  );
  ok(
    !codes({ ...GOOD, appId: "com.example.app" }).includes("app-id"),
    "a valid-but-different id is not ALSO reported as malformed",
  );
  ok(
    codes({ ...GOOD, appId: "com.greenway.point_of_sale" }).includes("app-id"),
    "a malformed id is reported as malformed",
  );
  ok(
    codes({ ...GOOD, appName: "Register" }).includes("app-name-not-agreed"),
    "a drifted app name is flagged",
  );
  ok(
    codes({ ...GOOD, appName: "   " }).includes("app-name-missing"),
    "a blank app name is flagged as missing",
  );
  ok(codes({ ...GOOD, webDir: "dist" }).includes("web-dir-not-agreed"), "a drifted web dir is flagged");
  ok(codes({ ...GOOD, webDir: "/dist" }).includes("web-dir"), "a bad web dir is flagged as bad");
  ok(
    codes({ ...GOOD, backgroundColor: "#fff" }).includes("background-color"),
    "a shorthand colour is flagged",
  );
  ok(
    auditCapacitorConfig({ ...GOOD, backgroundColor: undefined }).length === 0,
    "omitting the colour entirely is allowed",
  );
  {
    // The realistic worst case: someone "quickly tested against their laptop"
    // and committed it. Everything must be caught in one pass.
    const p = codes({
      appId: "com.Greenway.Register_1",
      appName: "Test",
      webDir: "/tmp/dist",
      backgroundColor: "#abc",
      server: { url: "http://192.168.0.9:5173", cleartext: true, iosScheme: "myapp" },
      ios: { webContentsDebuggingEnabled: true },
    });
    ok(p.includes("app-id"), "worst case: app id caught");
    ok(p.includes("app-name-not-agreed"), "worst case: app name caught");
    ok(p.includes("web-dir"), "worst case: web dir caught");
    ok(p.includes("background-color"), "worst case: colour caught");
    ok(p.includes("ios-origin-not-allowlisted"), "worst case: origin caught");
    ok(p.includes("server-url-set"), "worst case: live-reload url caught");
    ok(p.includes("cleartext-enabled"), "worst case: cleartext caught");
    ok(p.includes("ios-debugging-enabled"), "worst case: debugging caught");
  }

  // ── shape guarantees ─────────────────────────────────────────────────────
  {
    const p = auditCapacitorConfig({});
    ok(Array.isArray(p), "audit always returns an array");
    ok(
      p.every((x) => typeof x.code === "string" && x.code !== ""),
      "every problem carries a non-empty code",
    );
    ok(
      p.every((x) => typeof x.message === "string" && x.message.length > 20),
      "every problem carries a real explanation, not a stub",
    );
    ok(new Set(p.map((x) => x.code)).size === p.length, "problem codes are not duplicated");
  }
  {
    // Determinism and non-mutation: auditing must not alter what it is given.
    const input = { ...GOOD, server: { iosScheme: "nope" } };
    const before = JSON.stringify(input);
    const a = auditCapacitorConfig(input);
    const b = auditCapacitorConfig(input);
    ok(JSON.stringify(input) === before, "auditing never mutates its input");
    ok(JSON.stringify(a) === JSON.stringify(b), "auditing is deterministic");
  }

  return { passed, failed };
}
