import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runStarPrinterCoreTests,
  auditStarPlist,
  chooseTransport,
  COUNTER_PRINTER,
  describePrintFailure,
  isCounterPrinterAsset,
  ONLINE_ORDER_PRINTER_ASSET_TAG,
  STAR_EA_PROTOCOL,
  STAR_PRINT_WIDTH_DOTS,
  STAR_PRINTER_IS_GRAPHICS_ONLY,
  validatePrintJob,
  type StarErrorCode,
} from "../../src/lib/pos/star-printer-core";

/**
 * SLICE 10 — receipt printing that does not throw the budtender out of the app.
 *
 * These tests read the REAL Info.plist and the REAL register source, not
 * fixtures. A fixture would only prove the validator can validate a copy of
 * itself. The regressions being guarded against are all invisible to tsc and
 * eslint, and all surface only on the iPad, in the store, mid-sale:
 *
 *   1. Info.plist loses the Star accessory protocol (very likely, because
 *      `npx cap add ios` regenerates the file from Capacitor's template).
 *      Result: the printer becomes INVISIBLE, with no error naming the cause.
 *   2. Someone reintroduces the `starpassprnt://` app switch on the sale path,
 *      undoing the entire point of this slice.
 *   3. A reprint is allowed to pop the cash drawer — a genuine cash-control
 *      problem, since a reprint moves no money.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const infoPlist = read("ios", "App", "App", "Info.plist");
const saleFlow = read("src", "app", "pos", "SaleFlow.tsx");
const registerShell = read("src", "app", "pos", "RegisterShell.tsx");
const swiftPlugin = read("ios", "App", "App", "StarPrinterPlugin.swift");

/** The same readers the preflight uses, so this proves the real parse. */
function readAccessoryProtocols(xml: string): string[] | null {
  const block = xml.match(
    /<key>UISupportedExternalAccessoryProtocols<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!block) return null;
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].trim());
}

function readBluetoothUsage(xml: string): string | null {
  const m = xml.match(/<key>NSBluetoothAlwaysUsageDescription<\/key>\s*<string>([^<]*)<\/string>/);
  return m ? m[1] : null;
}

describe("pos/star-printer-core pure self-tests", () => {
  it("passes every embedded self-test", () => {
    const { passed, failed } = __runStarPrinterCoreTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(60);
  });
});

describe("Info.plist can actually reach the Star TSP143IIIBi", () => {
  it("declares the Star external accessory protocol", () => {
    // Verified from the StarXpand-SDK-iOS README, section 2.1.
    expect(readAccessoryProtocols(infoPlist)).toContain(STAR_EA_PROTOCOL);
  });

  it("explains why it wants Bluetooth", () => {
    // Since iOS 13 an app that touches Bluetooth without this key is
    // terminated by the OS — during a sale, in front of a customer.
    const usage = readBluetoothUsage(infoPlist);
    expect(usage).toBeTruthy();
    expect((usage ?? "").trim().length).toBeGreaterThan(20);
  });

  it("passes the same audit the build preflight runs", () => {
    const problems = auditStarPlist({
      externalAccessoryProtocols: readAccessoryProtocols(infoPlist),
      bluetoothUsageDescription: readBluetoothUsage(infoPlist),
    });
    expect(problems).toEqual([]);
  });

  it("keeps the SLICE 9 fixes that live in the same file", () => {
    // Both were added by the previous slice and both would be silently undone
    // by a Capacitor regeneration, so they are re-checked here.
    expect(infoPlist).toContain("<string>arm64</string>");
    expect(infoPlist).not.toContain("<string>armv7</string>");
    expect(infoPlist).toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\s*\/>/,
    );
  });
});

describe("the register no longer switches apps to print", () => {
  it("has no starpassprnt app switch left on the sale path", () => {
    // The whole point of the slice. buildPassPrntUrl still exists, but only
    // inside the bridge as a fallback — never wired directly into the UI.
    expect(saleFlow).not.toContain("buildPassPrntUrl(");
    expect(registerShell).not.toContain("buildPassPrntUrl(");
  });

  it("routes printing through the native bridge instead", () => {
    expect(saleFlow).toContain('from "@/lib/pos/star-printer"');
    expect(registerShell).toContain('from "@/lib/pos/star-printer"');
  });

  it("prefers the native transport whenever it is available", () => {
    expect(
      chooseTransport({ nativePluginAvailable: true, urlSchemeAvailable: true }),
    ).toBe("native");
    // …but never dead-ends: paper still comes out on a laptop.
    expect(
      chooseTransport({ nativePluginAvailable: false, urlSchemeAvailable: true }),
    ).toBe("passprnt");
    expect(
      chooseTransport({ nativePluginAvailable: false, urlSchemeAvailable: false }),
    ).toBe("browser");
  });
});

describe("cash-drawer rules", () => {
  it("refuses to pop the drawer on a reprint", () => {
    // A reprint moves no money. Popping the till for a duplicate slip is a
    // cash-control hole, so it is rejected before reaching the hardware.
    expect(
      validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "reprint" }),
    ).not.toBeNull();
    expect(
      validatePrintJob({ html: "<p>x</p>", openDrawer: false, jobKind: "reprint" }),
    ).toBeNull();
  });

  it("keeps reprints and reports drawer-free at the call sites", () => {
    expect(registerShell).toContain('printSlip(html, false, "reprint")');
  });

  it("still pops the drawer where cash genuinely moves", () => {
    expect(registerShell).toContain('printSlip(html, true, "no_sale")');
    expect(registerShell).toContain('printSlip(slipHtml, true, "refund")');
    expect(registerShell).toContain('printSlip(receiptHtml, true, "refund")');
    expect(registerShell).toContain('printSlip(receiptHtml, true, "sale")');
  });
});

describe("the two printers are never confused", () => {
  it("recognises the counter printer and rejects the online-order printer", () => {
    // PRN-RECEIPT-01 is a TSP143IV on Ethernet behind CloudPRNT. Printing a
    // walk-in receipt there would not fail loudly — it would print in the back.
    expect(isCounterPrinterAsset(COUNTER_PRINTER.assetTag)).toBe(true);
    expect(isCounterPrinterAsset(ONLINE_ORDER_PRINTER_ASSET_TAG)).toBe(false);
  });

  it("matches the hardware seeded in migration 0120", () => {
    const migration = read("supabase", "migrations", "0120_pos_foundation.sql");
    expect(migration).toContain(COUNTER_PRINTER.assetTag);
    expect(migration).toContain(COUNTER_PRINTER.serial);
  });
});

describe("what the budtender is told", () => {
  const codes: StarErrorCode[] = [
    "none",
    "deviceHasError",
    "printerHoldingPaper",
    "printingTimeout",
    "bluetoothUnavailable",
    "networkUnavailable",
    "notFound",
    "openFailed",
    "unknown",
  ];

  it("never leaks an SDK symbol onto the counter screen", () => {
    for (const code of codes) {
      const { message } = describePrintFailure(code);
      expect(message).not.toMatch(/StarIO10|xcframework|errorCode|undefined|null/i);
      expect(message.length).toBeGreaterThan(20);
    }
  });
});

describe("the Swift plugin honours the printer's real limits", () => {
  it("prints an image, because this model cannot print text", () => {
    // Star's manual: "TSP100III series … do not support actionPrintText
    // because these products are graphics-only printers." Sending text would
    // compile fine and print nothing.
    expect(STAR_PRINTER_IS_GRAPHICS_ONLY).toBe(true);
    expect(swiftPlugin).toContain(".actionPrintImage(");
    // Matched as a CALL (".actionPrintText(") rather than as a bare word, so
    // the header comment explaining why it is forbidden does not trip the
    // guard while a real call to it would.
    expect(swiftPlugin).not.toContain(".actionPrintText(");
  });

  it("rasterises at the same width the receipts were designed for", () => {
    expect(STAR_PRINT_WIDTH_DOTS).toBe(576);
    expect(swiftPlugin).toContain("printWidthDots = 576");
  });

  it("uses the verified drawer API", () => {
    expect(swiftPlugin).toContain("setChannel(.no1)");
    expect(swiftPlugin).toContain("setOnTime");
  });
});
