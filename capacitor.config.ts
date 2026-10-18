import type { CapacitorConfig } from "@capacitor/cli";

import {
  REGISTER_APP_ID,
  REGISTER_APP_NAME,
  REGISTER_BACKGROUND_COLOR,
  REGISTER_IOS_SCROLL_ENABLED,
  REGISTER_WEB_DIR,
} from "./src/lib/pos/capacitor-config-core";

/**
 * Native configuration for the packaged register app,
 * "Greenway Point of Transaction".
 *
 * READ THIS BEFORE EDITING. Every value below is deliberate, and several of
 * them are effectively permanent. The reasoning, the sources, and the
 * consequences of getting each one wrong are documented in
 * src/lib/pos/capacitor-config-core.ts, which also validates this file:
 * tests/compliance/pos-capacitor-config.test.ts loads the real config and
 * audits it, so a mistake here fails the test suite rather than the till.
 *
 * The four headline values are imported rather than typed inline on purpose.
 * If they lived here as string literals, the test could only compare a literal
 * to itself and would prove nothing. Keeping them in the core module means the
 * tests check the DECISION, and this file is just where Capacitor reads it.
 *
 * Everything Capacitor offers that is documented as development-only —
 * `server.url`, `server.cleartext`, `server.allowNavigation`,
 * `allowMixedContent`, `webContentsDebuggingEnabled` — is deliberately ABSENT,
 * and the audit fails if any of them reappears.
 *
 * BUILDING THE APP (on a Mac with Xcode):
 *   npm ci
 *   npm run register:build     # writes register-app/dist
 *   npx cap sync ios           # copies dist into ios/App/App/public
 *   npx cap open ios           # opens Xcode
 *
 * NOTE: the Capacitor 8 CLI requires Node 22 or newer (its own engines field).
 * Node 20 refuses to run `npx cap` at all, with a "requires NodeJS >=22.0.0"
 * message. The Next.js site is unaffected; this applies only to the `cap`
 * commands above.
 *
 * The generated iOS project is COMMITTED (it is source: it carries the bundle
 * identifier, the app name, the launch screen and the Greenway icon). What
 * `cap sync` generates on top of it — ios/App/App/public and
 * ios/App/App/capacitor.config.json — is build output and is git-ignored.
 * If the project is ever regenerated with `npx cap add ios`, re-run
 * `python3 scripts/pos/build-ios-app-assets.py` to restore the Greenway
 * artwork, which the stock template overwrites with Capacitor's own logo.
 */
const config: CapacitorConfig = {
  /**
   * PERMANENT. Apple: "After you upload a build to App Store Connect, you
   * can't change the bundle ID or delete the associated explicit App ID in
   * your developer account." Confirmed by the owner before first upload.
   */
  appId: REGISTER_APP_ID,

  /** Name under the icon on the iPad. */
  appName: REGISTER_APP_NAME,

  /**
   * Built web assets, produced by `npm run register:build`
   * (register-app/vite.config.ts writes to register-app/dist).
   * `npx cap sync` copies this folder into the native project.
   */
  webDir: REGISTER_WEB_DIR,

  /**
   * The register's dark canvas (--pos-canvas). RegisterShell starts in dark
   * mode and only switches after reading the saved preference, so painting the
   * web view this colour removes the white flash on every launch.
   */
  backgroundColor: REGISTER_BACKGROUND_COLOR,

  /**
   * Logs in debug builds only. Register logs can contain customer and sale
   * detail, and Capacitor warns that always-on logging "can leak information
   * on device". This is also the documented default; it is stated explicitly
   * so that it is a recorded decision rather than an accident.
   */
  loggingBehavior: "debug",

  /**
   * A pinch-zoom on a till leaves the cashier looking at a magnified fragment
   * of the screen in the middle of a sale, with a queue waiting. Off. This
   * matches the viewport meta tag in register-app/index.html.
   */
  zoomEnabled: false,

  server: {
    /**
     * Left at the documented defaults on purpose: iosScheme "capacitor" and
     * androidScheme "https", both on hostname "localhost". Those produce the
     * origins capacitor://localhost and https://localhost, which are exactly
     * the origins allowlisted for /api/pos/* in src/lib/pos/cors-core.ts.
     * Changing any of the three would silently block every register request.
     * Stating hostname explicitly keeps that link visible to the next reader.
     */
    hostname: "localhost",
  },

  ios: {
    /**
     * The register paints its own full-bleed layout and handles the safe area
     * itself (viewport-fit=cover in register-app/index.html). "never" stops
     * iOS adding its own inset on top, which would otherwise leave a band of
     * background at the top of the screen.
     */
    contentInset: "never",

    /**
     * Vertical pan is ON (owner request: "There have been times where I
     * needed to pan down a little to clear a message"). With this false, iOS
     * froze the web view, so anything taller than the screen (a long message,
     * a dialog pushed up by the on-screen keyboard) was simply unreachable.
     *
     * This does NOT bring back the rubber-band "till comes loose" effect:
     * Capacitor always sets scrollView.bounces = false on the web view
     * (CAPBridgeViewController.swift), register.css sets overscroll-behavior:
     * none, and pinch-zoom stays off (zoomEnabled above + the viewport meta).
     * When everything fits on screen there is nothing to pan, so the till
     * stays put exactly as before. Pinned by
     * REGISTER_IOS_SCROLL_ENABLED in capacitor-config-core.
     */
    scrollEnabled: REGISTER_IOS_SCROLL_ENABLED,

    /**
     * A long-press on a link inside a POS should never offer a page preview.
     * There is nowhere to preview to.
     */
    allowsLinkPreview: false,

    /**
     * Never leave the web inspector open in a released build. Explicitly false
     * rather than omitted, because this is a till: the default is already
     * false, and it stays false on purpose.
     */
    webContentsDebuggingEnabled: false,

    /** Same reasoning as the global setting; stated per-platform for clarity. */
    loggingBehavior: "debug",
  },
};

export default config;
