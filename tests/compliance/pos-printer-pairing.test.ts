import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runPrinterPairingCoreTests,
  buildTestSlipHtml,
  choosePrinter,
  describeAmbiguity,
  matchesRegisteredPrinter,
  pairingScreenState,
  rankDiscoveries,
  sanitizeDiscoveries,
  type DiscoveredPrinter,
} from "../../src/lib/pos/printer-pairing-core";
import {
  COUNTER_PRINTER,
  isValidStarPairing,
  validatePrintJob,
} from "../../src/lib/pos/star-printer-core";
import {
  auditKeyRegistry,
  findKeySpec,
  plannedWrite,
  POS_STORAGE_KEYS,
  POS_STORAGE_PREFIX,
} from "../../src/lib/pos/pos-storage-core";
import { INTEGRATED_DEVICES } from "../../src/lib/equipment/store";

/**
 * SLICE 11 — choosing WHICH printer this iPad prints to.
 *
 * SLICE 10 built the whole native printing path but shipped no way to pick a
 * printer, so the pairing was always empty and every receipt quietly fell back
 * to launching Star's PassPRNT app. This slice adds the picker, and these
 * tests read the REAL source files rather than fixtures, because the failures
 * worth guarding against are all invisible to tsc and eslint and only appear
 * on the iPad, in the store, mid-sale:
 *
 *   1. The pairing key drifts out of POS_STORAGE_KEYS again. plannedWrite()
 *      REJECTS unregistered keys, so this does not throw and does not warn —
 *      it silently makes pairing impossible. This is the exact bug SLICE 10
 *      shipped, and it is the reason this file exists.
 *   2. Someone "tidies" the opaque Bluetooth identifier back into a MAC-address
 *      regex. On Bluetooth Classic the identifier is an iOS PORT NAME, which
 *      the owner can rename; a MAC regex rejects every real printer.
 *   3. The printer test slip starts opening the cash drawer, or starts looking
 *      like a sale. Either is a cash-control problem, not a cosmetic one.
 *   4. The counter printer disappears from the equipment hub again.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const registerShell = read("src", "app", "pos", "RegisterShell.tsx");
const starBridge = read("src", "lib", "pos", "star-printer.ts");
const pairingCore = read("src", "lib", "pos", "printer-pairing-core.ts");
const equipmentPage = read("src", "app", "admin", "equipment", "page.tsx");
const migration0120 = read("supabase", "migrations", "0120_pos_foundation.sql");

const bt = (identifier: string, model = "TSP143IIIBi"): DiscoveredPrinter => ({
  identifier,
  model,
  interfaceType: "bluetooth",
});

describe("pos/printer-pairing-core pure self-tests", () => {
  it("passes every assertion", () => {
    const r = __runPrinterPairingCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(40);
  });

  it("reports the {passed, failed} shape the self-test runner actually reads", () => {
    // assertNoFailures() checks `result.failed > 0`. An array return type
    // passes tsc but makes `failed` undefined, and `undefined > 0` is false,
    // so every failure in this module would be silently ignored.
    const r = __runPrinterPairingCoreTests();
    expect(typeof r.passed).toBe("number");
    expect(typeof r.failed).toBe("number");
  });
});

describe("the pairing key is REGISTERED (the SLICE 10 bug)", () => {
  it("can actually be written — not rejected by plannedWrite", () => {
    for (const key of ["gw-pos-star-printer", "gw-pos-star-printer-model"]) {
      const plan = plannedWrite(key, "Star Micronics");
      expect(plan.rejected, `${key} must be a registered key`).toBeNull();
      expect(plan.writeDurable, `${key} must survive a restart`).toBe(true);
    }
  });

  it("is described in the registry, so the next reader knows what it holds", () => {
    const spec = findKeySpec("gw-pos-star-printer");
    expect(spec).not.toBeNull();
    expect(spec!.what.length).toBeGreaterThan(20);
  });

  it("carries the register prefix, so a bulk cleanup can find it", () => {
    // The rule the registry audits: a key without this prefix is missed by any
    // cleanup that targets the register's own storage.
    expect("gw-pos-star-printer".startsWith(POS_STORAGE_PREFIX)).toBe(true);
    expect("gw-pos-star-printer-model".startsWith(POS_STORAGE_PREFIX)).toBe(true);
  });

  it("leaves the whole registry free of policy problems", () => {
    expect(auditKeyRegistry()).toEqual([]);
  });

  it("uses the registered key name in the bridge, not the dead SLICE 10 name", () => {
    expect(starBridge).toContain('const PAIRED_PRINTER_KEY = "gw-pos-star-printer"');
    expect(starBridge).toContain('const PAIRED_PRINTER_MODEL_KEY = "gw-pos-star-printer-model"');
    // The old name could never persist. If it comes back as a STORED VALUE,
    // pairing breaks again. It is still allowed to appear in the comment that
    // explains the rename, so this checks the assignment, not the prose.
    expect(starBridge).not.toMatch(/=\s*"pos\.star\.pairedPrinter/);
  });

  it("registers every key the registry claims to cover", () => {
    const keys = POS_STORAGE_KEYS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith(POS_STORAGE_PREFIX))).toBe(true);
  });
});

describe("the Bluetooth identifier stays OPAQUE", () => {
  // Verified from Star's StarConnectionSettings.identifier reference:
  //   LAN = MAC or IP, Bluetooth = iOS PORT NAME, USB = iOS port name,
  //   Bluetooth LE = Bluetooth address.
  // Star's own sample app prints the identifier verbatim and never parses it.
  it("accepts a renamed port name, which is what a real TSP143IIIBi reports", () => {
    for (const id of ["Star Micronics", "Front Counter Printer", "Register 1 — till"]) {
      expect(isValidStarPairing({ identifier: id, interfaceType: "bluetooth", model: null })).toBe(
        true,
      );
    }
  });

  it("still accepts a MAC-shaped identifier, which is what LAN reports", () => {
    expect(
      isValidStarPairing({ identifier: "00:11:62:00:00:01", interfaceType: "lan", model: null }),
    ).toBe(true);
  });

  it("refuses only genuinely unusable identifiers", () => {
    expect(isValidStarPairing({ identifier: "", interfaceType: "bluetooth", model: null })).toBe(
      false,
    );
    expect(isValidStarPairing({ identifier: "   ", interfaceType: "bluetooth", model: null })).toBe(
      false,
    );
    // A control character means the value was mangled in transit, not renamed.
    expect(
      isValidStarPairing({ identifier: "a\u0000b", interfaceType: "bluetooth", model: null }),
    ).toBe(false);
  });

  it("has no MAC-address regex anywhere in the pairing logic", () => {
    // Guards the SLICE 10 regression directly: a BD_ADDRESS-style pattern here
    // would reject every genuine Bluetooth pairing.
    expect(pairingCore).not.toMatch(/\{2\}\(:\[0-9A-F\]\{2\}\)\{5\}/i);
    expect(pairingCore).not.toContain("BD_ADDRESS_RE");
  });
});

describe("picking the wrong printer pops the wrong cash drawer", () => {
  it("ranks the printer recorded in the equipment page first", () => {
    const ranked = rankDiscoveries([bt("Some Other Till"), bt(COUNTER_PRINTER.serial)]);
    expect(ranked[0].isRegistered).toBe(true);
  });

  it("keeps discovery order for equally-likely printers, so rows do not shuffle", () => {
    const ranked = rankDiscoveries([bt("AAA"), bt("BBB"), bt("CCC")]);
    expect(ranked.map((r) => r.identifier)).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("warns — but does not refuse — an unrecognised printer", () => {
    // The registry can legitimately be stale after a warranty swap. Refusing
    // would strand the store with no way to print at all.
    const choice = choosePrinter(bt("Some Other Till"));
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.warning).toBeTruthy();
  });

  it("says nothing alarming when the right printer is chosen", () => {
    const choice = choosePrinter(bt(COUNTER_PRINTER.serial));
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.warning).toBeNull();
  });

  it("names the wrong-drawer risk when nothing matches and several are in range", () => {
    const text = describeAmbiguity(rankDiscoveries([bt("One"), bt("Two")]));
    expect(text.toLowerCase()).toContain("wrong cash drawer");
  });

  it("does not match a printer on a short numeric coincidence", () => {
    // A 3-digit overlap must never be treated as the registered serial.
    expect(matchesRegisteredPrinter(bt("119"), COUNTER_PRINTER.serial)).toBe(false);
  });

  it("drops malformed discoveries and collapses duplicate reports", () => {
    const cleaned = sanitizeDiscoveries([bt("A"), bt("A"), null, 7, {}, bt("")]);
    expect(cleaned).toHaveLength(1);
  });
});

describe("the test slip is not a sale", () => {
  const slip = buildTestSlipHtml({
    printedAt: "2026-01-02 3:04 PM",
    deviceLabel: "Register 1 iPad",
    printerLabel: "TSP143IIIBi",
  });

  it("says what it is", () => {
    expect(slip).toContain("PRINTER TEST");
    expect(slip).toContain("NOT a sale");
  });

  it("carries no money, so it can never be mistaken for a receipt in an audit", () => {
    expect(slip).not.toContain("$");
  });

  it("may never open the cash drawer", () => {
    // A setup test is run repeatedly and has no sale and no manager PIN behind
    // it. Popping the drawer would be an unattributed cash exposure.
    expect(
      validatePrintJob({ html: slip, openDrawer: true, jobKind: "test" }),
    ).not.toBeNull();
    expect(validatePrintJob({ html: slip, openDrawer: false, jobKind: "test" })).toBeNull();
  });

  it("escapes markup from the till name", () => {
    const evil = buildTestSlipHtml({
      printedAt: "x",
      deviceLabel: "<script>alert(1)</script>",
      printerLabel: "y",
    });
    expect(evil).not.toContain("<script>");
  });
});

describe("the setup screen is honest about where pairing can happen", () => {
  it("refuses to pretend it can scan in a laptop browser", () => {
    const state = pairingScreenState({
      nativeAvailable: false,
      searching: false,
      results: null,
      paired: null,
    });
    expect(state.kind).toBe("unsupported");
    expect(state.body.toLowerCase()).toContain("ipad");
  });

  it("explains an empty scan instead of leaving the screen blank", () => {
    const state = pairingScreenState({
      nativeAvailable: true,
      searching: false,
      results: [],
      paired: null,
    });
    expect(state.kind).toBe("empty");
    expect(state.body.length).toBeGreaterThan(20);
  });

  it("shows the paired printer once one is chosen", () => {
    const state = pairingScreenState({
      nativeAvailable: true,
      searching: false,
      results: null,
      paired: { identifier: "Star Micronics", interfaceType: "bluetooth", model: "TSP143IIIBi" },
    });
    expect(state.kind).toBe("paired");
  });
});

describe("the register actually wires the picker up", () => {
  it("offers Receipt printer in the MORE menu", () => {
    expect(registerShell).toContain("Receipt printer");
    expect(registerShell).toContain("onPrinterSetup");
  });

  it("renders the setup modal", () => {
    expect(registerShell).toContain("PrinterSetupModal");
  });

  it("keeps printer setup available OFFLINE", () => {
    // Pairing is Bluetooth and device-local. Gating it behind `online` would
    // mean a register that cannot print also cannot be fixed. Every other
    // server-backed action uses the `online ? ... : undefined` form; this one
    // deliberately must not.
    expect(registerShell).not.toMatch(/onPrinterSetup=\{online \?/);
    expect(registerShell).toContain("onPrinterSetup={() => setPrinterSetupOpen(true)}");
  });

  it("test-prints with the drawer shut", () => {
    expect(registerShell).toMatch(/printSlip\(html, false, "test"\)/);
  });

  it("passes the till's own name in, so the slip names the right register", () => {
    expect(registerShell).toContain("deviceLabel={creds.name}");
  });
});

describe("the counter printer appears in the equipment hub", () => {
  const counter = INTEGRATED_DEVICES.find((d) => d.assetTag === "PRN-COUNTER-01");

  it("is in the integrated-device catalog at all (it was missing before)", () => {
    expect(counter).toBeDefined();
  });

  it("matches the model and manufacturer seeded by migration 0120", () => {
    // The migration is the system of record; this must not drift from it.
    expect(migration0120).toContain("TSP143IIIBi (TSP100III series)");
    expect(counter!.model).toBe("TSP143IIIBi (TSP100III series)");
    expect(counter!.manufacturer).toBe("Star Micronics");
  });

  it("tells the reader that pairing happens on the iPad", () => {
    // The admin page runs on a laptop, which has no line of sight to a
    // counter printer over Bluetooth. The card must not imply otherwise.
    expect(counter!.summary).toContain("MORE ▸ Receipt printer");
  });

  it("stays distinct from the CloudPRNT online-order printer", () => {
    const cloud = INTEGRATED_DEVICES.find((d) => d.assetTag === "PRN-RECEIPT-01");
    expect(cloud).toBeDefined();
    expect(cloud!.model).not.toBe(counter!.model);
  });

  it("does not borrow the CloudPRNT heartbeat for its online badge", () => {
    // Only PRN-RECEIPT-01 polls the server. Keying the badge off `kind` would
    // label a healthy Bluetooth printer "offline" and send the owner hunting
    // for a fault that does not exist.
    expect(equipmentPage).toContain('d.assetTag === "PRN-RECEIPT-01" ? printerOnline : null');
    expect(equipmentPage).not.toContain('d.kind === "receipt_printer" ? printerOnline : null');
  });
});
