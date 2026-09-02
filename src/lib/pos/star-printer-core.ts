/**
 * src/lib/pos/star-printer-core.ts  (SLICE 10)
 *
 * PURE decision logic for printing a receipt and kicking the cash drawer on the
 * store's own Star Micronics TSP143IIIBi, FROM INSIDE the register app.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Today the register prints by doing this (SaleFlow.tsx:967):
 *
 *     window.location.href = "starpassprnt://v1/print/nopreview?…"
 *
 * That URL hands the receipt to Star's separate PassPRNT app. iOS SWITCHES
 * APPS to do it: the register disappears, PassPRNT appears, prints, and then
 * tries to bounce back via its `back=` URL. Michael's instruction was explicit
 * — the budtender must not be thrown out of the app and have to find their way
 * back in. He is right, and not only for comfort:
 *
 *   • Every app switch is a chance to land somewhere else — a notification, the
 *     home screen, another app — with a customer waiting and a drawer that may
 *     or may not have opened.
 *   • The return trip is a URL. If it fails, the register reloads and the
 *     budtender is looking at a screen that has lost its place.
 *   • PassPRNT is a THIRD-PARTY DEPENDENCY on the till. If it is not installed,
 *     or is updated, or is removed by an MDM profile, printing simply stops.
 *
 * The fix is Star's own StarXpand SDK (StarIO10), which talks to the printer
 * over Bluetooth from within our process. No app switch, no return URL, and a
 * real success/failure answer we can act on. Star's iOS API reference lists
 * `TSP100IIIBI` — the exact series of the store's printer — as a supported
 * model, and the SDK requires iOS 15+/arm64, which is precisely what SLICE 9
 * configured.
 *
 * ── WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO ────────────────────
 *
 * This module holds every DECISION: which transport to use, what a failure
 * means in English, whether the drawer may open, and whether a receipt may be
 * considered printed. It performs no I/O and imports nothing from Capacitor or
 * the DOM, so all of it is testable here on a machine with no printer attached.
 *
 * The Swift plugin and the web bridge do the talking. They contain no policy.
 *
 * ── THE ONE RULE THAT OUTRANKS EVERYTHING ──────────────────────────────────
 *
 * A CASH SALE IS NEVER BLOCKED BY A PRINTER.
 *
 * The sale is already recorded and synced before any of this runs. Paper is a
 * courtesy to the customer; the ledger is the record of truth. So every failure
 * path here degrades to something the budtender can act on in seconds, and NONE
 * of them can void, delay, or alter a completed sale. A register that refuses
 * to sell because a printer is out of paper is a worse outcome than a customer
 * leaving without a slip.
 *
 * PURE MODULE: no next/*, no I/O, no import-time env reads (repo rule 5).
 */

// ---------------------------------------------------------------------------
// 1. The native transport
// ---------------------------------------------------------------------------

/**
 * Star's Bluetooth Classic accessory protocol string.
 *
 * VERIFIED from the StarXpand-SDK-iOS README, "2.1. Set `Supported external
 * accessory protocols`", which instructs: set Item 0 to `jp.star-m.starpro`.
 *
 * Without this key in Info.plist, iOS never hands our process the External
 * Accessory session and the printer is simply invisible — with no error that
 * points at the cause. That is precisely the kind of silent, device-only
 * failure the SLICE 9 preflight exists to catch, so it is checked there too.
 */
export const STAR_EA_PROTOCOL = "jp.star-m.starpro";

/**
 * Why the app wants Bluetooth. iOS shows this sentence verbatim in the
 * permission alert the budtender sees, so it is written for THEM, not for a
 * developer: it names the thing on the counter.
 */
export const STAR_BLUETOOTH_USAGE_DESCRIPTION =
  "Greenway uses Bluetooth to print receipts and open the cash drawer on the counter receipt printer.";

/** Star `InterfaceType` values this app may use. */
export type StarInterfaceType = "bluetooth" | "lan" | "bluetoothLE" | "usb";

/**
 * The store's front-counter printer, as registered in the equipment hub.
 *
 * Grounded in migration 0120_pos_foundation.sql, which seeds asset
 * `PRN-COUNTER-01` with the model and serial the owner read off the device
 * sticker. Duplicated here as CONSTANTS ONLY so the register can identify the
 * right device offline; the equipment hub remains the system of record.
 */
export const COUNTER_PRINTER = {
  assetTag: "PRN-COUNTER-01",
  manufacturer: "Star Micronics",
  model: "TSP143IIIBi (TSP100III series)",
  serial: "2550923021300119",
  /** Bluetooth Classic (MFi/iAP2) — NOT Bluetooth LE. This drives everything. */
  interfaceType: "bluetooth" as StarInterfaceType,
} as const;

/**
 * The ONLINE-order printer, listed here only so nothing ever confuses the two.
 *
 * PRN-RECEIPT-01 is a TSP143**IV** on Ethernet driven by CloudPRNT from the
 * server. It is not Bluetooth, it is not paired to the iPad, and the register
 * must never try to print a counter receipt on it.
 */
export const ONLINE_ORDER_PRINTER_ASSET_TAG = "PRN-RECEIPT-01";

/**
 * Is this asset tag the counter printer the register is allowed to drive?
 *
 * A real guard, not a formality. The equipment hub holds several printers and
 * two of them are Star receipt printers whose names read almost identically
 * (TSP143IIIBi vs TSP143IV). If a caller ever hands us the ONLINE-order
 * printer's tag, the honest answer is "no" and the job must be refused: that
 * device lives on Ethernet behind CloudPRNT, so the attempt would not fail
 * loudly at the counter, it would silently print a walk-in customer's receipt
 * somewhere else in the building.
 *
 * Comparison is case- and whitespace-insensitive because asset tags reach us
 * from config and from the database, and neither guarantees exact casing.
 */
export function isCounterPrinterAsset(assetTag: string): boolean {
  return assetTag.trim().toUpperCase() === COUNTER_PRINTER.assetTag;
}

// ---------------------------------------------------------------------------
// 2. Print jobs
// ---------------------------------------------------------------------------

/**
 * What the register asks the printer to do.
 *
 * `openDrawer` is per-job rather than a global setting because the three jobs
 * genuinely differ: a cash sale opens the drawer, a reprint must NOT (it would
 * pop the till for a customer asking for a duplicate slip), and a no-sale is
 * the drawer opening on purpose with a paper record of why.
 */
export type StarPrintJob = {
  /** Receipt HTML from pos/receipt-core — the SAME builder every path uses. */
  html: string;
  /** Kick the drawer after the paper is cut. */
  openDrawer: boolean;
  /** For logs and error messages. */
  /**
   * SLICE 11 added "test": the slip printed by the printer-setup screen to
   * prove a pairing works. It is its own kind rather than being dressed up as
   * a "sale", so nothing downstream can mistake a setup test for money
   * changing hands.
   */
  jobKind: "sale" | "reprint" | "refund" | "no_sale" | "test";
};

/**
 * Printable width in dots.
 *
 * 576 dots = 72mm, the TSP100III's printable width, and the same value the
 * legacy PassPRNT path used (`size=3` in pos/receipt-core buildPassPrntUrl).
 * Keeping the number identical is what guarantees a receipt printed natively
 * looks exactly like one printed the old way — no reflowed columns, no
 * truncated totals.
 */
export const STAR_PRINT_WIDTH_DOTS = 576;

/**
 * Drawer pulse width in milliseconds. Matches the legacy `drawerpulse=200`, so
 * the same solenoid behaves identically. Star's drawer API takes a channel and
 * a pulse; the store's drawer is on channel 1 (the printer's DK port).
 */
export const STAR_DRAWER_PULSE_MS = 200;
export const STAR_DRAWER_CHANNEL = 1;

/**
 * The TSP143IIIBi cannot print TEXT. It only prints IMAGES.
 *
 * VERIFIED, and quoted from Star's own manual (Generate Printing Data, Step 1,
 * "Memo"): "TSP100III series and TSP100IIU+ do not support actionPrintText
 * because these products are graphics-only printers. Please use the
 * actionPrintImage method."
 *
 * This is a load-bearing fact, not trivia. It means the native plugin CANNOT
 * take our receipt text and send it line by line - it must render the receipt
 * to a bitmap 576 dots wide and send that with actionPrintImage. Had we built
 * the obvious thing (actionPrintText), it would have compiled cleanly, passed
 * review, and then printed NOTHING on this exact printer.
 *
 * It also explains why the old PassPRNT path took HTML: PassPRNT rasterised
 * the HTML itself. Doing this in-app means WE now own the rasterising step,
 * which is why the plugin renders the same receipt HTML in an offscreen web
 * view at exactly STAR_PRINT_WIDTH_DOTS and prints the resulting image.
 */
export const STAR_PRINTER_IS_GRAPHICS_ONLY = true;

/** Reject a job that cannot possibly print, before touching the hardware. */
export function validatePrintJob(job: StarPrintJob): string | null {
  if (typeof job.html !== "string" || job.html.trim() === "") {
    return "There is nothing to print — the receipt came through empty.";
  }
  if (job.jobKind === "reprint" && job.openDrawer) {
    // A guard, not a preference: reprints happen with a customer at the
    // counter and must never pop the till.
    return "A reprint must never open the cash drawer.";
  }
  if (job.jobKind === "test" && job.openDrawer) {
    // Same reasoning, and stronger: a printer test is run during setup, often
    // repeatedly. If it popped the drawer it would be an unattributed cash
    // exposure with no sale and no manager PIN behind it.
    return "A printer test must never open the cash drawer.";
  }
  return null;
}

/**
 * How long to scan for printers on the setup screen, in seconds.
 *
 * Six seconds is long enough for a TSP143IIIBi that is powered on and in range
 * to answer, and short enough that a cashier does not assume the app has hung.
 * Discovery is SETUP ONLY and never runs on the sale path.
 */
export const STAR_DISCOVERY_SECONDS = 6;

// ---------------------------------------------------------------------------
// 3. Failures, in English
// ---------------------------------------------------------------------------

/**
 * Star error codes this app translates.
 *
 * VERIFIED by scraping Star's official iOS API reference for
 * `StarIO10ErrorCode` (SDK manual 1.13.0). Only the codes that can plausibly
 * occur on a Bluetooth TSP100III at a retail counter are handled individually;
 * everything else falls through to a safe generic message rather than being
 * guessed at.
 */
export type StarErrorCode =
  | "none"
  | "deviceHasError"
  | "printerHoldingPaper"
  | "printingTimeout"
  | "bluetoothUnavailable"
  | "networkUnavailable"
  | "notFound"
  | "openFailed"
  | "unknown";

export type PrintOutcome =
  | { ok: true; usedFallback: boolean; message: string }
  | {
      ok: false;
      code: StarErrorCode;
      /** Shown to the budtender. Says what happened AND what to do next. */
      message: string;
      /** True when trying again could plausibly work (paper reloaded, etc.). */
      retryable: boolean;
      /** True when the drawer may still need opening by other means. */
      drawerMayBeShut: boolean;
    };

/**
 * Turn a Star failure into an instruction.
 *
 * Deliberately written for a budtender mid-transaction with a customer
 * watching: name the physical thing that is wrong and the physical action that
 * fixes it. "StarIO10ErrorCode.printerHoldingPaper" helps nobody at a counter.
 */
export function describePrintFailure(code: StarErrorCode): {
  message: string;
  retryable: boolean;
} {
  switch (code) {
    case "printerHoldingPaper":
      return {
        message:
          "The printer is holding the paper — tear off the last receipt and tap Print again.",
        retryable: true,
      };
    case "deviceHasError":
      return {
        message:
          "The printer reported a problem. Check for a paper jam, that the roll is loaded and the cover is closed, then tap Print again.",
        retryable: true,
      };
    case "printingTimeout":
      return {
        message:
          "The printer did not finish in time. Check it is powered on and in range, then tap Print again.",
        retryable: true,
      };
    case "bluetoothUnavailable":
      return {
        message:
          "Bluetooth is off on this iPad. Turn Bluetooth on in Settings, then tap Print again.",
        retryable: true,
      };
    case "notFound":
      return {
        message:
          "The counter printer was not found. Check it is powered on, then confirm it is paired in Settings → Bluetooth.",
        retryable: true,
      };
    case "openFailed":
      return {
        message:
          "Could not connect to the counter printer. If another iPad or app is connected to it, close that first — the printer accepts one connection at a time.",
        retryable: true,
      };
    case "networkUnavailable":
      return {
        message: "The network is unavailable, so the printer could not be reached.",
        retryable: true,
      };
    case "none":
    case "unknown":
    default:
      return {
        message:
          "The receipt did not print. The sale is saved either way — you can print it again from the sale history.",
        retryable: true,
      };
  }
}

/** Build the failure outcome for a job. */
export function printFailure(code: StarErrorCode, job: StarPrintJob): PrintOutcome {
  const { message, retryable } = describePrintFailure(code);
  return {
    ok: false,
    code,
    message,
    retryable,
    // If the job was meant to kick the drawer and the print never happened,
    // the drawer did not open. Whoever handles this must be told, because a
    // cash sale with a shut drawer needs a manual open (which is audited).
    drawerMayBeShut: job.openDrawer,
  };
}

// ---------------------------------------------------------------------------
// 4. Choosing a transport — and never dead-ending
// ---------------------------------------------------------------------------

/**
 * Where the register is running and what it can reach.
 *
 * `nativePluginAvailable` is false in the browser PWA, and ALSO false in a
 * native build whose Star package has not been added in Xcode yet. Treating
 * those two identically is intentional: both mean "the in-app path is not
 * there," and both must still be able to print.
 */
export type PrintEnvironment = {
  /** True only inside the packaged app WITH the Star plugin compiled in. */
  nativePluginAvailable: boolean;
  /** True on iOS/Android where the PassPRNT URL scheme can be opened. */
  urlSchemeAvailable: boolean;
};

export type PrintTransport = "native" | "passprnt" | "browser";

/**
 * Pick the transport, best first.
 *
 *   native   — StarXpand, in-app. No app switch. The goal.
 *   passprnt — the legacy URL scheme. Switches apps, which the owner does not
 *              want, but it PRINTS, and a printed receipt beats a lost one.
 *   browser  — window.print(). Works on any laptop; the last resort.
 *
 * The fallback chain is not indecision. The register runs in three places (the
 * packaged iPad app, the web PWA on a spare device, and a manager's laptop) and
 * a receipt must come out of all three. What the owner objected to was the app
 * switch being the NORMAL path — after this slice it is only ever the
 * exception, and the UI says so.
 */
export function chooseTransport(env: PrintEnvironment): PrintTransport {
  if (env.nativePluginAvailable) return "native";
  if (env.urlSchemeAvailable) return "passprnt";
  return "browser";
}

/** Plain-English note for the UI, so nobody wonders why an app switch happened. */
export function describeTransport(t: PrintTransport): string {
  switch (t) {
    case "native":
      return "Printing on the counter printer.";
    case "passprnt":
      return "Printing through the Star PassPRNT app — the in-app printer is not set up on this device.";
    case "browser":
      return "Opening the receipt in a print window.";
  }
}

/**
 * True when the drawer can be opened WITHOUT printing anything.
 *
 * Only the native path can do this. The PassPRNT URL scheme couples the drawer
 * to a print job (`drawer=after`), which is why the legacy no-sale flow had to
 * print a slip to open the till. Once native is available, a no-sale can open
 * the drawer directly — though we still print the audit slip, because the slip
 * is a compliance record, not a side effect.
 */
export function canOpenDrawerWithoutPrinting(env: PrintEnvironment): boolean {
  return env.nativePluginAvailable;
}

// ---------------------------------------------------------------------------
// 5. Pairing state
// ---------------------------------------------------------------------------

/**
 * What the register has stored about its printer.
 *
 * `identifier` is Star's device identifier from discovery (a BD address for
 * Bluetooth). It is saved per-iPad after the first successful pairing so the
 * register connects straight to ITS printer, rather than re-running discovery
 * and risking connecting to the printer at the next till over — a real hazard
 * with three registers on one counter.
 */
export type StarPairing = {
  identifier: string;
  interfaceType: StarInterfaceType;
  /** Model string reported by the printer, for the diagnostics screen. */
  model: string | null;
};

/**
 * The identifier is OPAQUE. Do not pattern-match it.
 *
 * SLICE 11 correction. SLICE 10 shipped a regex here that required a MAC-style
 * BD address for Bluetooth. That was wrong, and it would have rejected every
 * genuine pairing on Michael's TSP143IIIBi — the setup screen would have found
 * the printer, refused to save it, and given no reason. It was caught by
 * reading Star's manual rather than by any test, because the test encoded the
 * same wrong assumption as the code.
 *
 * StarXpand's `StarConnectionSettings.identifier` reference states what each
 * interface actually uses:
 *
 *     LAN                   MAC Address / IP Address
 *     Bluetooth             iOS Port Name
 *     USB                   iOS Port Name
 *     Bluetooth Low Energy  Bluetooth Address
 *
 * So the MAC-style form is what LAN and *BLE* use. Bluetooth Classic — which is
 * what the TSP143IIIBi speaks — uses the iOS Port Name, a free-form device name
 * that Star's own Setting Utility lets the owner rename to anything.
 *
 * Star's shipped sample app (example/StarXpandSDK/DiscoveryView.swift) prints
 * the identifier verbatim for all four interfaces and never parses it. We do
 * the same: the only rules are non-empty, sane length, and a known interface.
 * Anything stricter is us inventing a constraint the SDK does not have.
 */
const MAX_IDENTIFIER_LEN = 256;

export function isValidStarPairing(v: unknown): v is StarPairing {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<StarPairing>;
  if (typeof p.identifier !== "string") return false;
  if (p.identifier.trim() === "") return false;
  if (p.identifier.length > MAX_IDENTIFIER_LEN) return false;
  // A control character means the value was mangled in transit, not renamed.
  if (/[\u0000-\u001f\u007f]/.test(p.identifier)) return false;
  return (
    p.interfaceType === "bluetooth" ||
    p.interfaceType === "lan" ||
    p.interfaceType === "bluetoothLE" ||
    p.interfaceType === "usb"
  );
}

/** Describe pairing state for the device-diagnostics screen. */
export function describePairing(p: StarPairing | null): string {
  if (!p) {
    return "No counter printer paired to this iPad yet. Open Printer setup to find it.";
  }
  return `Paired to ${p.model ?? "a Star printer"} (${p.identifier}) over ${
    p.interfaceType === "bluetooth" ? "Bluetooth" : p.interfaceType
  }.`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (repo rule 5)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6. Auditing Info.plist
// ---------------------------------------------------------------------------

/**
 * What the app's Info.plist claims about Bluetooth accessories.
 *
 * Read off disk by the preflight and by the compliance test; JUDGED here,
 * where it can be tested without a plist on disk.
 */
export type StarPlistFacts = {
  /** Contents of UISupportedExternalAccessoryProtocols, or null if absent. */
  externalAccessoryProtocols: readonly string[] | null;
  /** Contents of NSBluetoothAlwaysUsageDescription, or null if absent. */
  bluetoothUsageDescription: string | null;
};

export type StarPlistProblem = { key: string; detail: string };

/**
 * Refuse a build whose Info.plist cannot talk to the counter printer.
 *
 * Both of these failures are invisible on a developer's Mac and only appear on
 * the iPad, in the store, mid-sale - the missing protocol makes the printer
 * silently undiscoverable, and the missing usage string makes iOS KILL the app
 * outright the first time it touches Bluetooth. Neither one breaks the build,
 * which is exactly why a machine has to check them every time.
 */
export function auditStarPlist(facts: StarPlistFacts): StarPlistProblem[] {
  const problems: StarPlistProblem[] = [];

  const protocols = facts.externalAccessoryProtocols;
  if (protocols === null) {
    problems.push({
      key: "UISupportedExternalAccessoryProtocols",
      detail:
        "Info.plist does not declare any external accessory protocols, so iOS will " +
        "never connect the app to the Star TSP143IIIBi. The printer will not appear " +
        "in the register at all - there is no error message for this, it is simply " +
        "invisible. Add " +
        STAR_EA_PROTOCOL +
        " as Item 0. If this key vanished, Info.plist was probably regenerated by " +
        "cap add ios, which would also have undone the arm64 fix.",
    });
  } else if (!protocols.includes(STAR_EA_PROTOCOL)) {
    problems.push({
      key: "UISupportedExternalAccessoryProtocols",
      detail:
        "Info.plist declares external accessory protocols [" +
        protocols.join(", ") +
        "] but not " +
        STAR_EA_PROTOCOL +
        ", which is the protocol Star's own README requires for the TSP143IIIBi. " +
        "Bluetooth printing cannot work without the exact string.",
    });
  }

  const usage = facts.bluetoothUsageDescription;
  if (usage === null || usage.trim() === "") {
    problems.push({
      key: "NSBluetoothAlwaysUsageDescription",
      detail:
        "Info.plist has no NSBluetoothAlwaysUsageDescription. Since iOS 13 the " +
        "system TERMINATES an app that touches Bluetooth without this key, so the " +
        "register would quit on the first attempt to print - during a sale, with a " +
        "customer at the counter. Add a sentence explaining the printer.",
    });
  }

  return problems;
}

export function __runStarPrinterCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`star-printer-core FAIL: ${label}`);
    }
  };

  // ── constants verified against primary sources ───────────────────────────
  ok(STAR_EA_PROTOCOL === "jp.star-m.starpro", "EA protocol matches the Star README");
  ok(STAR_PRINT_WIDTH_DOTS === 576, "576 dots = 72mm, same as the legacy PassPRNT size=3");
  ok(STAR_DRAWER_PULSE_MS === 200, "drawer pulse matches the legacy drawerpulse=200");
  ok(STAR_DRAWER_CHANNEL === 1, "the drawer is on the printer's DK port, channel 1");
  ok(
    STAR_PRINTER_IS_GRAPHICS_ONLY,
    "the TSP100III series is graphics-only - receipts must be rasterised, never sent as text",
  );
  ok(
    COUNTER_PRINTER.serial === "2550923021300119",
    "the serial matches migration 0120 (read off the device sticker)",
  );
  ok(COUNTER_PRINTER.assetTag === "PRN-COUNTER-01", "asset tag matches the equipment hub");
  ok(
    COUNTER_PRINTER.interfaceType === "bluetooth",
    "the TSP143IIIBi is Bluetooth Classic, not LE — this drives the MFi requirement",
  );
  ok(
    isCounterPrinterAsset(COUNTER_PRINTER.assetTag),
    "the counter printer recognises its own asset tag",
  );
  ok(
    !isCounterPrinterAsset(ONLINE_ORDER_PRINTER_ASSET_TAG),
    "the ONLINE-order printer is refused - a walk-in receipt never prints in the back",
  );
  ok(
    isCounterPrinterAsset("  prn-counter-01  "),
    "asset tags are matched despite stray casing or whitespace from config or the DB",
  );
  ok(!isCounterPrinterAsset(""), "an empty asset tag is not the counter printer");

  // ── Info.plist audit ──────────────────────────────────────────────────────
  const goodPlist: StarPlistFacts = {
    externalAccessoryProtocols: [STAR_EA_PROTOCOL],
    bluetoothUsageDescription: STAR_BLUETOOTH_USAGE_DESCRIPTION,
  };
  ok(auditStarPlist(goodPlist).length === 0, "a correctly configured Info.plist passes");
  ok(
    auditStarPlist({ ...goodPlist, externalAccessoryProtocols: null }).some(
      (p) => p.key === "UISupportedExternalAccessoryProtocols",
    ),
    "a missing accessory-protocol key is caught",
  );
  ok(
    auditStarPlist({ ...goodPlist, externalAccessoryProtocols: ["com.example.other"] }).some(
      (p) => p.key === "UISupportedExternalAccessoryProtocols",
    ),
    "the wrong accessory protocol is caught, not just an absent one",
  );
  ok(
    auditStarPlist({ ...goodPlist, bluetoothUsageDescription: null }).length === 1,
    "a missing Bluetooth usage string is caught",
  );
  ok(
    auditStarPlist({ ...goodPlist, bluetoothUsageDescription: "   " }).length === 1,
    "a blank Bluetooth usage string is treated as missing, since iOS shows it to a person",
  );
  ok(
    auditStarPlist({
      externalAccessoryProtocols: null,
      bluetoothUsageDescription: null,
    }).length === 2,
    "both problems are reported together, so one build fixes both",
  );
  ok(
    auditStarPlist({ externalAccessoryProtocols: null, bluetoothUsageDescription: null }).every(
      (p) => p.detail.length > 60,
    ),
    "every plist problem explains the consequence, not just the missing key",
  );
  ok(
    STAR_BLUETOOTH_USAGE_DESCRIPTION.length > 20 &&
      STAR_BLUETOOTH_USAGE_DESCRIPTION.includes("receipt"),
    "the Bluetooth prompt explains itself to the budtender",
  );

  // ── job validation ───────────────────────────────────────────────────────
  const saleJob: StarPrintJob = { html: "<html>x</html>", openDrawer: true, jobKind: "sale" };
  ok(validatePrintJob(saleJob) === null, "a normal cash-sale job is valid");
  ok(
    validatePrintJob({ ...saleJob, html: "" }) !== null,
    "an empty receipt is refused before touching hardware",
  );
  ok(
    validatePrintJob({ ...saleJob, html: "   " }) !== null,
    "a whitespace-only receipt is refused",
  );
  ok(
    validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "reprint" }) !== null,
    "a reprint may NEVER pop the till",
  );
  ok(
    validatePrintJob({ html: "<p>x</p>", openDrawer: false, jobKind: "reprint" }) === null,
    "a reprint without the drawer is fine",
  );
  ok(
    validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "test" }) !== null,
    "a printer test may NOT pop the drawer",
  );
  ok(
    validatePrintJob({ html: "<p>x</p>", openDrawer: false, jobKind: "test" }) === null,
    "a printer test that leaves the drawer shut is fine",
  );
  ok(STAR_DISCOVERY_SECONDS > 0 && STAR_DISCOVERY_SECONDS <= 30, "discovery window is sane");
  ok(
    validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "no_sale" }) === null,
    "a no-sale opens the drawer on purpose",
  );

  // ── failures speak English and say what to DO ────────────────────────────
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
  for (const c of codes) {
    const d = describePrintFailure(c);
    ok(d.message.length > 25, `${c} produces a real sentence`);
    ok(!d.message.includes("StarIO10"), `${c} never leaks an SDK symbol to the counter`);
    ok(!d.message.includes("undefined"), `${c} has no undefined in it`);
  }
  ok(
    describePrintFailure("printerHoldingPaper").message.toLowerCase().includes("tear off"),
    "holding paper tells them to tear it off",
  );
  ok(
    describePrintFailure("bluetoothUnavailable").message.includes("Settings"),
    "bluetooth off points at Settings",
  );
  ok(
    describePrintFailure("openFailed").message.includes("one connection at a time"),
    "a busy printer explains the real cause",
  );
  ok(
    describePrintFailure("unknown").message.includes("sale is saved"),
    "the generic failure reassures that the sale is not lost",
  );

  // ── failure carries the drawer consequence ───────────────────────────────
  const failedSale = printFailure("deviceHasError", saleJob);
  ok(!failedSale.ok, "a failure is not ok");
  ok(
    !failedSale.ok && failedSale.drawerMayBeShut,
    "a failed cash sale flags that the drawer never opened",
  );
  const failedReprint = printFailure("deviceHasError", {
    html: "<p>x</p>",
    openDrawer: false,
    jobKind: "reprint",
  });
  ok(
    !failedReprint.ok && !failedReprint.drawerMayBeShut,
    "a failed reprint does not claim the drawer is shut — it was never opening",
  );
  ok(!failedSale.ok && failedSale.retryable, "device errors are retryable");

  // ── transport choice ─────────────────────────────────────────────────────
  ok(
    chooseTransport({ nativePluginAvailable: true, urlSchemeAvailable: true }) === "native",
    "native wins when available — this is the whole point of the slice",
  );
  ok(
    chooseTransport({ nativePluginAvailable: false, urlSchemeAvailable: true }) === "passprnt",
    "without the plugin we still print, via PassPRNT",
  );
  ok(
    chooseTransport({ nativePluginAvailable: false, urlSchemeAvailable: false }) === "browser",
    "on a laptop we fall back to the browser",
  );
  ok(
    chooseTransport({ nativePluginAvailable: true, urlSchemeAvailable: false }) === "native",
    "native does not need the URL scheme",
  );
  ok(
    describeTransport("passprnt").includes("not set up"),
    "the fallback explains WHY the app switched, instead of just doing it",
  );
  ok(describeTransport("native").length > 10, "the native note is human");

  // ── drawer-without-print is native-only ──────────────────────────────────
  ok(
    canOpenDrawerWithoutPrinting({ nativePluginAvailable: true, urlSchemeAvailable: true }),
    "native can open the drawer with no paper",
  );
  ok(
    !canOpenDrawerWithoutPrinting({ nativePluginAvailable: false, urlSchemeAvailable: true }),
    "PassPRNT cannot — its drawer kick is attached to a print job",
  );

  // ── pairing ──────────────────────────────────────────────────────────────
  const good: StarPairing = {
    identifier: "TSP100-31300119",
    interfaceType: "bluetooth",
    model: "TSP143IIIBi",
  };
  ok(isValidStarPairing(good), "an iOS Port Name is accepted");
  // SLICE 11 regression guards. SLICE 10 required a MAC-style BD address for
  // Bluetooth, which Star's identifier reference shows is the format for LAN
  // and BLE — Bluetooth Classic uses the iOS Port Name. That bug would have
  // refused every real pairing on the TSP143IIIBi. These four cases fail if
  // anyone reintroduces a format assumption.
  ok(
    isValidStarPairing({ ...good, identifier: "Star Micronics" }),
    "the factory default port name is accepted",
  );
  ok(
    isValidStarPairing({ ...good, identifier: "Front Counter Printer" }),
    "an owner-renamed printer with spaces is accepted",
  );
  ok(
    isValidStarPairing({ ...good, identifier: "Register 1 — till" }),
    "a renamed printer with punctuation is accepted",
  );
  ok(
    isValidStarPairing({ ...good, identifier: "00:11:62:00:00:00" }),
    "a MAC-style identifier is still accepted (LAN/BLE form)",
  );
  ok(!isValidStarPairing({ ...good, identifier: "" }), "an empty identifier is refused");
  ok(!isValidStarPairing({ ...good, identifier: "   " }), "a whitespace identifier is refused");
  ok(
    !isValidStarPairing({ ...good, identifier: "bad\u0000name" }),
    "a control character means a mangled value, not a rename",
  );
  ok(
    !isValidStarPairing({ ...good, identifier: "x".repeat(257) }),
    "an absurdly long identifier is refused",
  );
  ok(!isValidStarPairing(null), "null is not a pairing");
  ok(!isValidStarPairing("TSP100-31300119"), "a bare string is not a pairing");
  ok(
    isValidStarPairing({ identifier: "printer.local", interfaceType: "lan", model: null }),
    "a LAN identifier is accepted",
  );
  ok(
    !isValidStarPairing({ identifier: "x", interfaceType: "carrier-pigeon", model: null }),
    "an unknown interface type is refused",
  );
  ok(describePairing(null).includes("No counter printer"), "unpaired state is explained");
  ok(describePairing(good).includes("TSP100-31300119"), "paired state names the device");
  ok(describePairing(good).includes("Bluetooth"), "paired state names the transport");

  return { passed, failed };
}
