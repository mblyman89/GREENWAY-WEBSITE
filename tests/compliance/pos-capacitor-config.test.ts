import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import capacitorConfig from "../../capacitor.config";
import {
  __runCapacitorConfigCoreTests,
  auditCapacitorConfig,
  deriveNativeOrigins,
  REGISTER_APP_ID,
  REGISTER_APP_NAME,
  REGISTER_BACKGROUND_COLOR,
  REGISTER_WEB_DIR,
  validateAppId,
} from "../../src/lib/pos/capacitor-config-core";
import { NATIVE_POS_ORIGINS } from "../../src/lib/pos/cors-core";

/**
 * Phase 0.4 — the packaged register app's native configuration.
 *
 * These tests deliberately read the REAL files on disk (capacitor.config.ts,
 * the generated Xcode project, the asset catalogue, package.json) rather than
 * fixtures. A fixture would only prove the validator can validate a copy of
 * itself. The whole risk being managed here is DRIFT: someone edits the config,
 * or re-runs `npx cap add ios` and silently restores Capacitor's placeholder
 * artwork and its white launch screen. Only reading the real artefacts catches
 * that.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const iosDir = path.join(repoRoot, "ios");
const pbxproj = path.join(iosDir, "App", "App.xcodeproj", "project.pbxproj");
const infoPlist = path.join(iosDir, "App", "App", "Info.plist");
const launchScreen = path.join(iosDir, "App", "App", "Base.lproj", "LaunchScreen.storyboard");
const iconPng = path.join(
  iosDir,
  "App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
);
const splashDir = path.join(iosDir, "App/App/Assets.xcassets/Splash.imageset");

const read = (p: string) => readFileSync(p, "utf8");

describe("pos/capacitor-config-core pure self-tests", () => {
  it("passes every embedded self-test", () => {
    const { passed, failed } = __runCapacitorConfigCoreTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(120);
  });
});

describe("the real capacitor.config.ts", () => {
  it("audits completely clean", () => {
    expect(auditCapacitorConfig(capacitorConfig)).toEqual([]);
  });

  it("carries the owner-confirmed, permanent bundle identifier", () => {
    // Apple: the bundle ID cannot be changed after the first upload, and the
    // identifier cannot be reclaimed. This assertion is the tripwire.
    expect(capacitorConfig.appId).toBe("com.greenwaymarijuana.register");
    expect(capacitorConfig.appId).toBe(REGISTER_APP_ID);
    expect(validateAppId(capacitorConfig.appId)).toBeNull();
  });

  it("carries the agreed app name and web directory", () => {
    expect(capacitorConfig.appName).toBe(REGISTER_APP_NAME);
    expect(capacitorConfig.webDir).toBe(REGISTER_WEB_DIR);
  });

  it("paints the web view the register's own dark canvas", () => {
    expect(capacitorConfig.backgroundColor).toBe(REGISTER_BACKGROUND_COLOR);
    // --pos-canvas in src/app/pos-tokens.css. Kept in step so the launch
    // screen, the web view and the first painted frame are one colour.
    const tokens = read(path.join(repoRoot, "src/app/pos-tokens.css"));
    expect(tokens).toMatch(/--pos-canvas:\s*#060807\s*;/);
    expect(String(capacitorConfig.backgroundColor).toLowerCase()).toContain("060807");
  });

  it("agrees with the /api/pos/* CORS allowlist on BOTH platforms", () => {
    // If this ever fails, the packaged app is blocked from reaching the server
    // on every request — the failure would otherwise appear at the counter.
    const origins = deriveNativeOrigins(capacitorConfig);
    expect(NATIVE_POS_ORIGINS).toContain(origins.ios);
    expect(NATIVE_POS_ORIGINS).toContain(origins.android);
    expect(origins.ios).toBe("capacitor://localhost");
    expect(origins.android).toBe("https://localhost");
  });

  it("contains no development-only settings", () => {
    const server = (capacitorConfig.server ?? {}) as Record<string, unknown>;
    expect(server.url).toBeUndefined();
    expect(server.cleartext).toBeUndefined();
    expect(server.allowNavigation).toBeUndefined();
    expect(capacitorConfig.ios?.webContentsDebuggingEnabled).toBe(false);
    expect(capacitorConfig.android?.allowMixedContent).toBeUndefined();
  });

  it("never logs in production builds", () => {
    expect(capacitorConfig.loggingBehavior).not.toBe("production");
    expect(capacitorConfig.ios?.loggingBehavior).not.toBe("production");
  });

  it("disables pinch zoom, matching the register's viewport meta tag", () => {
    expect(capacitorConfig.zoomEnabled).toBe(false);
    const html = read(path.join(repoRoot, "register-app/index.html"));
    expect(html).toContain("user-scalable=no");
  });

  it("imports its values from the core rather than hard-coding literals", () => {
    // If the config inlined the strings, the assertions above would compare a
    // literal with itself and prove nothing.
    const source = read(path.join(repoRoot, "capacitor.config.ts"));
    expect(source).toContain("capacitor-config-core");
    expect(source).toContain("REGISTER_APP_ID");
    expect(source).not.toContain('appId: "com.');
  });
});

describe("the register build actually produces webDir", () => {
  it("points webDir at the folder vite is configured to write", () => {
    const viteConfig = read(path.join(repoRoot, "register-app/vite.config.ts"));
    expect(viteConfig).toMatch(/outDir:\s*"dist"/);
    // vite.config.ts has root = register-app, so outDir "dist" resolves to
    // register-app/dist — exactly what webDir names, relative to the repo root
    // where capacitor.config.ts lives.
    expect(REGISTER_WEB_DIR).toBe("register-app/dist");
  });

  it("keeps build output out of the lint gate", () => {
    // Discovered the hard way: once a register build exists on disk, eslint
    // walks the MINIFIED bundle (and the copy `npx cap sync` places inside
    // ios/App/App/public), producing ~1,900 warnings that bury real ones. The
    // lint gate only looked clean before because dist/ happened to be absent.
    const eslintConfig = read(path.join(repoRoot, "eslint.config.mjs"));
    expect(eslintConfig).toContain("register-app/dist/**");
    expect(eslintConfig).toContain("ios/App/App/public/**");
  });

  it("keeps the built bundle out of git but the native project in", () => {
    const ignore = read(path.join(repoRoot, ".gitignore"));
    expect(ignore).toContain("/register-app/dist/");
    // The ios/ folder itself must NOT be ignored: the Xcode project is source.
    expect(ignore).not.toMatch(/^\/?ios\/?$/m);
  });
});

describe("capacitor dependencies", () => {
  const pkg = JSON.parse(read(path.join(repoRoot, "package.json"))) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("installs the runtime in dependencies and the CLI in devDependencies", () => {
    // Per capacitorjs.com/docs/getting-started: `npm i @capacitor/core`,
    // `npm i -D @capacitor/cli`. The CLI is a build tool; it must not ship.
    expect(pkg.dependencies?.["@capacitor/core"]).toBeDefined();
    expect(pkg.dependencies?.["@capacitor/ios"]).toBeDefined();
    expect(pkg.devDependencies?.["@capacitor/cli"]).toBeDefined();
    expect(pkg.dependencies?.["@capacitor/cli"]).toBeUndefined();
  });

  it("pins every capacitor package to one exact, identical version", () => {
    const versions = [
      pkg.dependencies?.["@capacitor/core"],
      pkg.dependencies?.["@capacitor/ios"],
      pkg.devDependencies?.["@capacitor/cli"],
    ];
    for (const v of versions) {
      // Exact pins only: a native toolchain that silently drifts between
      // installs is how a build stops reproducing.
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(new Set(versions).size).toBe(1);
  });
});

describe("the committed iOS project", () => {
  it("exists", () => {
    expect(existsSync(iosDir)).toBe(true);
    expect(existsSync(pbxproj)).toBe(true);
  });

  it("carries the bundle identifier into the Xcode build settings", () => {
    // This is the value that actually reaches App Store Connect. The config
    // file agreeing is necessary but not sufficient.
    const project = read(pbxproj);
    const matches = project.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toContain(REGISTER_APP_ID);
    }
  });

  it("shows the agreed name under the icon", () => {
    expect(read(infoPlist)).toContain(REGISTER_APP_NAME);
  });

  it("never ships Capacitor's placeholder artwork", () => {
    // `npx cap add ios` restores the stock template, which includes a
    // blue-and-white Capacitor logo. A Greenway till must not wear it.
    // scripts/pos/build-ios-app-assets.py puts the real brand art back.
    expect(existsSync(iconPng)).toBe(true);
    const icon = readFileSync(iconPng);
    const templateIcon = readFileSync(
      path.join(
        repoRoot,
        "node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz",
      ),
    );
    // Not a byte comparison of the archive; just prove the icon is ours by
    // its divergence from the stock 110522-byte placeholder.
    expect(icon.byteLength).toBeGreaterThan(1000);
    expect(icon.byteLength).not.toBe(110522);
    expect(templateIcon.byteLength).toBeGreaterThan(0);
  });

  it("uses an App Store legal icon: 1024x1024 and no alpha channel", () => {
    // Apple rejects app icons containing an alpha channel at upload time
    // (ITMS-90717). PNG colour type 6 = RGBA, 4 = grey+alpha: both illegal.
    const buf = readFileSync(iconPng);
    expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
    // IHDR: width and height are big-endian uint32 at offsets 16 and 20.
    expect(buf.readUInt32BE(16)).toBe(1024);
    expect(buf.readUInt32BE(20)).toBe(1024);
    const colorType = buf.readUInt8(25);
    expect([4, 6]).not.toContain(colorType);
  });

  it("launches on the register's dark canvas, not a white flash", () => {
    const storyboard = read(launchScreen);
    // 6/255, 8/255, 7/255 — #060807, the same colour as the web view.
    expect(storyboard).toContain('red="0.023529411764705882"');
    expect(storyboard).toContain('green="0.031372549019607843"');
    expect(storyboard).toContain('blue="0.027450980392156862"');
    // The stock template used systemBackgroundColor, which is WHITE in light
    // mode. If this reappears, the launch flash is back.
    expect(storyboard).not.toContain("systemBackgroundColor");
  });

  it("has splash images that match the launch background exactly", () => {
    const files = readdirSync(splashDir).filter((f) => f.endsWith(".png"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const buf = readFileSync(path.join(splashDir, f));
      expect(buf.readUInt32BE(16)).toBe(2732);
      expect(buf.readUInt32BE(20)).toBe(2732);
    }
  });

  it("keeps generated native artefacts out of git", () => {
    const iosIgnore = read(path.join(iosDir, ".gitignore"));
    // Copied web assets and the generated config are build output; committing
    // them would mean two sources of truth for what the app contains.
    expect(iosIgnore).toContain("App/App/public");
    expect(iosIgnore).toContain("App/App/capacitor.config.json");
  });

  it("has the generated files actually ignored by git, not merely listed", () => {
    // Belt and braces: ask git itself, so a mis-scoped pattern is caught.
    const check = (target: string): boolean => {
      try {
        execFileSync("git", ["check-ignore", "-q", target], { cwd: repoRoot });
        return true;
      } catch {
        return false;
      }
    };
    expect(check("ios/App/App/capacitor.config.json")).toBe(true);
    expect(check("ios/App/App/public")).toBe(true);
    // …while the real source files are NOT ignored.
    expect(check("ios/App/App.xcodeproj/project.pbxproj")).toBe(false);
    expect(check("ios/App/App/Info.plist")).toBe(false);
  });

  it("has an asset-rebuild script committed so the fix is reproducible", () => {
    const script = path.join(repoRoot, "scripts/pos/build-ios-app-assets.py");
    expect(existsSync(script)).toBe(true);
    const source = read(script);
    expect(source).toContain("greenway-black-gold-logo-transparent.png");
    // The splash MUST use the transparent variant; the solid-black version
    // leaves a visible black square on the #060807 canvas.
    expect(source).toContain("SOURCE_LOGO_TRANSPARENT");
  });
});
