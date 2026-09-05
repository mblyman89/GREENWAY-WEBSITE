/**
 * tests/compliance/socket-native-resilience.test.ts  (SLICE 15)
 *
 * The native half of the scanner cannot be executed here -- there is no Swift
 * toolchain and no iPad in CI, and no test can change that. What CAN be
 * protected is the small set of native decisions that took real evidence to
 * reach and would be quietly undone by someone tidying up later.
 *
 * These are honest about what they are: assertions on source and on a parsed
 * plist, NOT proof that the plugin works. The behavioural proof lives in
 * socket-resilience-core.test.ts, which drives the real TypeScript modules.
 * The one thing this file must never do is let a reader mistake a green tick
 * here for a working scanner.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const swift = readFileSync(
  resolve(process.cwd(), "ios/App/App/SocketScannerPlugin.swift"),
  "utf8",
);
const plist = readFileSync(resolve(process.cwd(), "ios/App/App/Info.plist"), "utf8");

/** Strip comments so prose describing a defect cannot satisfy a guard. */
function stripSwiftComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const code = stripSwiftComments(swift);

describe("SLICE 15: the native plugin reports Capture's truth, not a drifting tally", () => {
  /**
   * connectedDevices is incremented and decremented from callbacks. An app
   * suspended overnight misses events, so the tally can describe a scanner
   * that powered off hours ago on its documented 2-hour idle timer. A tally
   * reading high suppresses the keyboard wedge with nothing attached, which
   * is a register that cannot scan at all.
   */
  it("getStatus asks Capture for the live device list", () => {
    const body = code.slice(code.indexOf("func getStatus"));
    expect(body).toMatch(/capture\.getDevices\(\)\.count/);
  });

  it("getStatus reports zero devices when Capture is not open", () => {
    const body = code.slice(code.indexOf("func getStatus"), code.indexOf("func getStatus") + 700);
    expect(body).toMatch(/guard isOpen else/);
    expect(body).toMatch(/"deviceCount": 0/);
  });

  it("a re-open pops the delegate first so no barcode is delivered twice", () => {
    // Two delegates on Capture's stack means one trigger pull becomes two
    // line items. At a register that is a double charge.
    const body = code.slice(code.indexOf("func open"), code.indexOf("func close"));
    const pop = body.indexOf("capture.popDelegate(self)");
    const push = body.indexOf("capture.pushDelegate(self)");
    expect(pop).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(-1);
    expect(pop).toBeLessThan(push);
  });

  it("open() still resolves rather than rejects, so a sale is never blocked", () => {
    const body = code.slice(code.indexOf("func open"), code.indexOf("func close"));
    expect(body).toMatch(/call\.resolve/);
    expect(body).not.toMatch(/call\.reject/);
  });
});

describe("SLICE 15: Info.plist keeps the MFi requirements and refuses the wrong fix", () => {
  it("declares the Socket MFi protocol string", () => {
    // Socket: "You will need to add the string com.socketmobile.chs in your
    // app's info.plist."
    expect(plist).toContain("com.socketmobile.chs");
  });

  it("keeps the Companion app URL scheme so pairing can be launched", () => {
    expect(plist).toContain("sktcompanion");
  });

  /**
   * The tempting wrong fix, pinned so it cannot be added on a hunch.
   *
   * Apple lists external-accessory for accessories that deliver data "at
   * regular intervals" and warns to use background modes sparingly. Socket
   * states apps have no access to their readers in the background at all, and
   * that iOS re-delivers the arrival event on foreground. The entitlement
   * would buy nothing and invites an App Store question.
   */
  it("does NOT declare the external-accessory background mode", () => {
    const withoutComments = plist.replace(/<!--[\s\S]*?-->/g, "");
    expect(withoutComments).not.toContain("UIBackgroundModes");
    expect(withoutComments).not.toContain("external-accessory");
  });
});
