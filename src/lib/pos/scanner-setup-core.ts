/**
 * scanner-setup-core.ts: R50 S11b. Setup and test helpers for the two scanner models the store
 * owns, shown on the Oct 30 count page (/admin/menu-imports/count):
 *
 *   • Tera D5100, 2D Wireless, Orange, with battery indicator (2.4 GHz USB dongle)
 *   • Socket Mobile DuraScan D760 (Bluetooth)
 *   • Alacrity MJ-2020R (433 MHz charging cradle, R74 S12). Its manuals print every setting as a QR
 *     code, so the page re-draws those as QR (src/lib/printing/qr-core.ts), never as Code 128.
 *     The CR LF terminator is its marked factory default (ALACRITY-UM p30 "CR LF*"): two Enters,
 *     so its setup MUST scan CR.
 *
 * Every command barcode payload below was DECODED from the maker's own PDF manual, not typed from
 * memory. The source, sha256 and page for each value are in docs/research/scanner-setup-sources.md.
 * The page re-draws the payloads with our own Code 128 encoder (src/lib/printing/code128-core.ts).
 * Code 128 carries the exact characters, so the re-drawn symbol reads the same as the printed one.
 * tests/compliance/r50-s11b-scanner-setup.test.ts decodes every rendered symbol again to prove it.
 *
 * What the count needs from a scanner (count workbook, cultivera-count-workbook.ts):
 *   1. It types like a keyboard (Tera: USB HID keyboard through the dongle; Socket: Basic Mode HID).
 *   2. It sends each barcode the moment it is scanned (Tera: Real Time Mode, not Storage Mode).
 *   3. It ends every scan with ONE Enter, so Excel drops to the next row (Carriage Return suffix).
 *      Neither current manual marks a default terminator, so the setup always scans Carriage
 *      Return. (Register U-47.)
 *   4. It types the characters exactly (US / English keyboard layout, no letter-case conversion).
 *
 * classifyTestScan() is the logic behind the page's test box. The person scans the printed TEST
 * barcode (or any product) into the box, and it says in plain words what is wrong and which setup
 * barcode fixes it.
 *
 * Pure and deterministic: no DOM, no I/O.
 */

export type ScannerModel = "tera-d5100" | "socket-d760" | "alacrity-mj2020r";

/** How the page draws a setup barcode: the symbology the maker's manual prints. */
export type CommandSymbology = "code128" | "qr";

export type CommandBarcode = {
  id: string;
  model: ScannerModel;
  /** The label exactly as the manual prints it. */
  label: string;
  /** The decoded Code 128 payload. */
  payload: string;
  /** Source id in docs/research/scanner-setup-sources.md and the page. */
  source: string;
  /** Omitted = Code 128. "qr" when the maker prints the setting as a QR code (Alacrity). */
  symbology?: CommandSymbology;
};

export function symbologyOf(c: Pick<CommandBarcode, "symbology">): CommandSymbology {
  return c.symbology === "qr" ? "qr" : "code128";
}

/** Every command barcode the page can show. Payloads are decoded from the makers' PDFs. */
export const SCANNER_COMMANDS: readonly CommandBarcode[] = [
  // Tera D5100: TERA-UM (Ver.04.1.01). The printed page is first, the PDF page in brackets.
  { id: "tera-restore-defaults", model: "tera-d5100", label: "Restore Defaults", payload: "%%SpecCode93", source: "TERA-UM p01 [6]" },
  { id: "tera-battery", model: "tera-d5100", label: "Show Battery Level", payload: "%%SpecCode15", source: "TERA-UM p02 [7]" },
  { id: "tera-sleep-300", model: "tera-d5100", label: "Sleep timer 300s (factory default)", payload: "%%SpecCode33", source: "TERA-UM p02-03 [7-8]" },
  { id: "tera-sleep-1800", model: "tera-d5100", label: "Sleep timer 1800s (30 minutes)", payload: "%%SpecCode35", source: "TERA-UM p02-03 [7-8]" },
  { id: "tera-us-layout", model: "tera-d5100", label: "United States* (keyboard layout)", payload: "%%SpecCode40", source: "TERA-UM p04 [9]" },
  { id: "tera-real-time", model: "tera-d5100", label: "Real Time Mode*", payload: "%%SpecCode10", source: "TERA-UM p05 [10]" },
  { id: "tera-upload-stored", model: "tera-d5100", label: "Upload All Stored Codes", payload: "%%SpecCode16", source: "TERA-UM p06 [11]" },
  { id: "tera-clear-stored", model: "tera-d5100", label: "Clear All Stored Codes", payload: "%%SpecCode18", source: "TERA-UM p07 [12]" },
  { id: "tera-24ghz", model: "tera-d5100", label: "2.4GHz Mode", payload: "%%SpecCodeA8", source: "TERA-UM p08 [13]" },
  { id: "tera-pairing", model: "tera-d5100", label: "Pairing", payload: "%%SpecCode99", source: "TERA-UM p08 [13]" },
  { id: "tera-case-off", model: "tera-d5100", label: "Conversion Off* (letter case)", payload: "%%SpecCodeA5", source: "TERA-UM p09 [14]" },
  { id: "tera-cr", model: "tera-d5100", label: "Terminator: Carriage Return", payload: "%%SpecCode9C", source: "TERA-UM p10 [15]" },
  // Socket DuraScan D760: SOCKET-700-UG (2025) and SOCKET-D740-760 (2019).
  { id: "socket-basic-hid", model: "socket-d760", label: "Basic Mode (HID)", payload: "#FNB00F40001#", source: "SOCKET-D740-760 p45" },
  { id: "socket-cr", model: "socket-d760", label: "Suffix – Carriage Return (D730/D740/D745/D750/D755/D760)", payload: "#FNB00F507C60408FFEB020000#", source: "SOCKET-700-UG p27" },
  { id: "socket-power-8h", model: "socket-d760", label: "Continuous Power for 8 Hours", payload: "#FNB012101E001E0#", source: "SOCKET-700-UG p29" },
  { id: "socket-power-2h", model: "socket-d760", label: "2 Hours (default)", payload: "#FNB012100780005#", source: "SOCKET-700-UG p29" },
  { id: "socket-english", model: "socket-d760", label: "HID Keyboard Language: English (default)", payload: "#FNB01430001#", source: "SOCKET-700-UG p31" },
  { id: "socket-pairing-reset", model: "socket-d760", label: "Pairing Reset", payload: "#FNBAB#", source: "SOCKET-700-UG p22" },
  { id: "socket-factory-reset", model: "socket-d760", label: "Factory Reset", payload: "#FNB00F0#", source: "SOCKET-700-UG p23" },
  // Alacrity MJ-2020R: ALACRITY-UM (User Manual V1.0, printed page first, PDF page in brackets) and
  // ALACRITY-QS (Quick Start Guide V2.2, section number). Every value was decoded from the QR codes.
  { id: "alacrity-wedge", model: "alacrity-mj2020r", label: "Wedge (operation mode)", payload: "%%SpecCode10", source: "ALACRITY-UM p22 [23]; QS §6", symbology: "qr" },
  { id: "alacrity-us-english", model: "alacrity-mj2020r", label: "US English* (keyboard language)", payload: "%%SpecCode40", source: "ALACRITY-UM p28 [29]; QS §12", symbology: "qr" },
  { id: "alacrity-cr", model: "alacrity-mj2020r", label: "Data Terminator: CR", payload: "%%SpecCode9C", source: "ALACRITY-UM p30 [31]; QS §11", symbology: "qr" },
  { id: "alacrity-433", model: "alacrity-mj2020r", label: "433Mhz Wireless", payload: "%%SpecCodeA8", source: "ALACRITY-UM p14 [15]; QS §3", symbology: "qr" },
  { id: "alacrity-pairing", model: "alacrity-mj2020r", label: "Pairing", payload: "%%SpecCode99", source: "ALACRITY-UM p14 [15]; QS §3", symbology: "qr" },
  { id: "alacrity-power-2h", model: "alacrity-mj2020r", label: "Auto Power Off: 2 Hours", payload: "%%SpecCodeBA1802D0", source: "ALACRITY-UM p24 [25]; QS §8", symbology: "qr" },
  { id: "alacrity-battery", model: "alacrity-mj2020r", label: "Battery Level", payload: "%%SpecCode15", source: "ALACRITY-UM p19 [20]; QS §5", symbology: "qr" },
  { id: "alacrity-send-batch", model: "alacrity-mj2020r", label: "Send Batch", payload: "%%SpecCode16", source: "ALACRITY-UM p23 [24]; QS §7", symbology: "qr" },
  { id: "alacrity-free-buffer", model: "alacrity-mj2020r", label: "Free Buffer", payload: "%%SpecCode18", source: "ALACRITY-UM p23 [24]; QS §7", symbology: "qr" },
  { id: "alacrity-factory-default", model: "alacrity-mj2020r", label: "Factory Default", payload: "%%SpecCode93", source: "ALACRITY-UM p19 [20]; QS §5", symbology: "qr" },
];

/** Payloads the manuals print but the page deliberately never shows (they break the count). */
export const HARMFUL_PAYLOADS: Readonly<Record<string, string>> = {
  // Tera and Alacrity share these codes (same %%SpecCode family; both manuals print them).
  "%%SpecCode11": "Tera Storage Mode / Alacrity Batch (holds scans instead of typing them)",
  "%%SpecCode9D": "Tera / Alacrity Terminator: Line Feed",
  "%%SpecCode9E": "Tera / Alacrity Terminator: CR & LF (two Enters, so every scan skips a row; the Alacrity's factory default)",
  "%%SpecCodeA2": "Tera / Alacrity Terminator: Tab (moves right, not down)",
  "%%SpecCode9F": "Tera / Alacrity Terminator: None (no Enter)",
  "%%SpecCodeAA": "Alacrity BT HID (cradleless Bluetooth; the count uses the cradle)",
  "#FNB00F40002#": "Socket Application Mode for Apple iOS (not keyboard mode)",
  "#FNB00F509C60408FFEB0468090000#": "Socket Suffix: Tab",
  "#FNB00F507C60408FFEB010000#": "Socket Suffix: Carriage Return & Line Feed",
  "#FNB00F507C60408FFEB000000#": "Socket Data As Is (no Enter)",
};

/** How the page draws every setup barcode (code128Svg options). The round-trip fixture pins it. */
export const SCANNER_BARCODE_DRAW = { moduleWidth: 2, height: 56, quietModules: 12 } as const;
/** How the page draws a QR setup code (qrSvg options). Level M, as the receipt QR. */
export const SCANNER_QR_DRAW = { scale: 4, quietModules: 4, level: "M" } as const;

export function commandById(id: string): CommandBarcode | null {
  return SCANNER_COMMANDS.find((c) => c.id === id) ?? null;
}

/** True when text is (or contains) a scanner setup command, never a product barcode. */
export function isScannerCommandText(raw: string): boolean {
  const t = String(raw ?? "").trim();
  return /%%SpecCode[0-9A-F]{2}/i.test(t) || /#FNB[0-9A-F]*#/i.test(t);
}

/**
 * The printed TEST barcode. It mixes upper case, lower case, a dash and all ten digits, so one scan
 * shows a wrong keyboard layout (the digits come out as symbols) or letter-case conversion. It is
 * not a Cultivera barcode, so a stray one in the count workbook is refused (see the count core).
 */
export const TEST_BARCODE = "GWtest-0123456789";

export type SetupStep = {
  title: string;
  /** Plain instructions. */
  detail: string;
  /** Command barcodes to scan, in order. */
  scan: string[];
  /** What the scanner does when it worked. */
  expect: string;
  optional?: boolean;
};

export type ScannerGuide = {
  model: ScannerModel;
  name: string;
  connection: string;
  before: string[];
  steps: SetupStep[];
  trouble: { symptom: string; fix: string; scan?: string[] }[];
};

export const SCANNER_GUIDES: readonly ScannerGuide[] = [
  {
    model: "tera-d5100",
    name: "Tera D5100 (orange, 2.4 GHz dongle)",
    connection: "A small USB dongle. The scanner types into whatever window has the cursor, like a keyboard. No driver or app is needed (TERA-UM p08).",
    before: [
      "Plug the Tera's USB dongle into the counting computer.",
      "Click in the test box below, so anything the scanner types lands there and nowhere else.",
    ],
    steps: [
      { title: "Typing mode", detail: "Make it type every scan straight away. Storage Mode would keep the scans inside the scanner.", scan: ["tera-real-time"], expect: "A beep." },
      { title: "Keyboard layout", detail: "United States layout, so the digits come out as digits.", scan: ["tera-us-layout"], expect: "A beep." },
      { title: "Letters as printed", detail: "No upper/lower case conversion.", scan: ["tera-case-off"], expect: "A beep." },
      { title: "Enter after every scan", detail: "The manual marks no default, so set it: one Enter (Carriage Return) after each scan, so Excel drops to the next row.", scan: ["tera-cr"], expect: "A beep." },
      { title: "Stay awake longer (optional)", detail: "By default it switches off after 300 seconds without a scan. 30 minutes suits a long count. It uses more battery.", scan: ["tera-sleep-1800"], expect: "A beep.", optional: true },
      { title: "Test it", detail: "Scan the TEST barcode below into the test box. It must say OK.", scan: [], expect: "The test box turns green." },
    ],
    trouble: [
      { symptom: "A good beep, then three quick beeps", fix: "The scanner is not talking to its dongle (TERA-UM p07). Check the dongle is plugged in. If it still fails: unplug the dongle, scan 2.4GHz Mode, then Pairing, then plug the dongle back in.", scan: ["tera-24ghz", "tera-pairing"] },
      { symptom: "It beeps but nothing appears", fix: "It may be in Storage Mode. Scan Real Time Mode. If someone scanned items while it was in Storage Mode, click the next empty Scan cell, scan Upload All Stored Codes, then Clear All Stored Codes so they are not sent twice.", scan: ["tera-real-time", "tera-upload-stored", "tera-clear-stored"] },
      { symptom: "How much battery is left?", fix: "Click in the test box (never the Scan sheet) and scan Show Battery Level. The scanner types its battery level (TERA-UM p02).", scan: ["tera-battery"] },
      { symptom: "Settings got mixed up", fix: "Scan Restore Defaults, then do steps 1–4 again.", scan: ["tera-restore-defaults"] },
    ],
  },
  {
    model: "socket-d760",
    name: "Socket DuraScan D760 (Bluetooth)",
    connection: "Bluetooth, in Basic Mode (HID). It types into whatever window has the cursor, like a keyboard (SOCKET-D740-760 p14).",
    before: [
      "Charge it from a wall charger. A computer's USB port does not give enough power. Give a new scanner 8 hours for its first charge.",
      "Power on: hold the small power button until it beeps low-high. Setup barcodes only work while it is NOT connected to anything (the blue light flashes). If it was paired before: forget it in the computer's Bluetooth list, then hold the scan button and press and hold the power button. That unpairs it and turns it off. Turn it back on.",
    ],
    steps: [
      { title: "Keyboard mode", detail: "Basic Mode (HID). The two Socket guides disagree on the factory default, so always scan it.", scan: ["socket-basic-hid"], expect: "3 rising beeps. Rising beeps then a long tone means it failed: it is still connected." },
      { title: "Enter after every scan", detail: "One Enter (Carriage Return) after each scan, so Excel drops to the next row.", scan: ["socket-cr"], expect: "3 rising beeps." },
      { title: "English keyboard", detail: "English layout, so the digits come out as digits.", scan: ["socket-english"], expect: "3 rising beeps." },
      { title: "Stay on longer (optional)", detail: "By default it turns off after 2 hours idle while connected. 8 hours covers the whole count day. It drains the battery faster, so charge it every night.", scan: ["socket-power-8h"], expect: "3 rising beeps.", optional: true },
      { title: "Pair it", detail: "On the counting computer, open Bluetooth settings, add a device, and pick “D760 [xxxxxx]” (or “Socket D760 [xxxxxx]”).", scan: [], expect: "One beep when it connects." },
      { title: "Test it", detail: "Click in the test box and scan the TEST barcode below. It must say OK.", scan: [], expect: "The test box turns green." },
    ],
    trouble: [
      { symptom: "Rising beeps, then a long tone", fix: "The setup barcode did NOT work, because the scanner was connected. Forget it in Bluetooth, unpair it (hold scan, then press and hold power), turn it on, and scan again." },
      { symptom: "It switched itself off", fix: "Not connected: it turns off after 5 minutes. Connected: after 2 hours idle. Scan Continuous Power for 8 Hours (while disconnected) for the count day.", scan: ["socket-power-8h"] },
      { symptom: "It will not pair", fix: "Turn the computer's Bluetooth off and on. If it still fails: Pairing Reset, or Factory Reset, then redo every step (a factory reset clears the Enter setting too).", scan: ["socket-pairing-reset", "socket-factory-reset"] },
    ],
  },
  {
    model: "alacrity-mj2020r",
    name: "Alacrity MJ-2020R (charging cradle, 433 MHz)",
    connection: "The cradle plugs into the computer by USB. The scanner talks to the cradle by 433 MHz radio and types into whatever window has the cursor, like a keyboard (ALACRITY-UM p14). Its setup codes are QR codes, as in its manual.",
    before: [
      "Charge it on the cradle first: about 4 hours for a full charge. Red light on = charging, red light flashing = full (ALACRITY-UM p16).",
      "Plug the cradle into the counting computer with its USB cable (the cradle light flashes green). Press the trigger once to turn the scanner on, set it on the cradle and pull the trigger twice. Paired = solid blue light on the scanner, solid green on the cradle (ALACRITY-UM p14).",
      "Click in the test box below, so anything the scanner types lands there and nowhere else.",
    ],
    steps: [
      { title: "Typing mode", detail: "Wedge: it types every scan straight away. Batch would keep the scans inside the scanner.", scan: ["alacrity-wedge"], expect: "A short beep, high to low." },
      { title: "Keyboard language", detail: "US English, so the digits come out as digits.", scan: ["alacrity-us-english"], expect: "A short beep, high to low." },
      { title: "One Enter after every scan", detail: "Its factory setting is CR LF, which is TWO Enters, so every scan would skip a row in Excel. Scan CR for one Enter.", scan: ["alacrity-cr"], expect: "A short beep, high to low." },
      { title: "Stay on longer (optional)", detail: "By default it turns itself off after 30 minutes idle. 2 hours suits a long count. It uses more battery, so put it back on the cradle at breaks.", scan: ["alacrity-power-2h"], expect: "A short beep, high to low.", optional: true },
      { title: "Test it", detail: "Scan the TEST barcode below into the test box. It must say OK.", scan: [], expect: "The test box turns green." },
    ],
    trouble: [
      { symptom: "Two short high beeps after a setup code", fix: "The setup code was not accepted (ALACRITY-UM p18). Hold the scanner steady, a little further from the screen, turn the screen brightness up, and scan it again." },
      { symptom: "Three low beeps, or two low beeps", fix: "It is not connected to its cradle (ALACRITY-UM p18). Check the cradle's USB cable. To pair again: scan 433Mhz Wireless, then Pairing (green light flashes), then plug the cradle in and wait for solid blue / solid green.", scan: ["alacrity-433", "alacrity-pairing"] },
      { symptom: "It beeps but nothing appears", fix: "It may be in Batch mode. Scan Wedge. If someone scanned items while it was in Batch mode, click the next empty Scan cell, scan Send Batch, then Free Buffer so they are not sent twice.", scan: ["alacrity-wedge", "alacrity-send-batch", "alacrity-free-buffer"] },
      { symptom: "How much battery is left?", fix: "Click in the test box (never the Scan sheet) and scan Battery Level. Five short high beeps while scanning means the battery is low (ALACRITY-UM p18).", scan: ["alacrity-battery"] },
      { symptom: "Settings got mixed up", fix: "Scan Factory Default, then do steps 1–3 again. Factory Default brings back CR LF (two Enters), so step 3 matters.", scan: ["alacrity-factory-default"] },
    ],
  },
];

/** The setup barcode that gives one Enter, per model. Every guide must scan it. */
export const CR_COMMAND: Readonly<Record<ScannerModel, string>> = {
  "tera-d5100": "tera-cr",
  "socket-d760": "socket-cr",
  "alacrity-mj2020r": "alacrity-cr",
};

/** Short name per model, for the test box's fix list. */
export const SCANNER_SHORT_NAME: Readonly<Record<ScannerModel, string>> = {
  "tera-d5100": "Tera",
  "socket-d760": "Socket",
  "alacrity-mj2020r": "Alacrity",
};

export function guideFor(model: ScannerModel): ScannerGuide {
  const g = SCANNER_GUIDES.find((x) => x.model === model);
  if (!g) throw new Error(`no guide for ${model}`);
  return g;
}

// ---------------------------------------------------------------------------
// The test box
// ---------------------------------------------------------------------------

export type TestScanInput = {
  /** Characters typed before the terminator (or before the box gave up waiting). */
  text: string;
  /** What ended the scan: an Enter, a Tab, or nothing (the box timed out waiting). */
  terminator: "enter" | "tab" | "none";
  /** Extra Enter presses that arrived right after the first, with no characters between. */
  extraEnters?: number;
};

export type TestScanVerdict = {
  ok: boolean;
  code:
    | "ok_test"
    | "ok_product"
    | "nothing"
    | "no_enter"
    | "tab"
    | "double_enter"
    | "command_text"
    | "case_changed"
    | "layout"
    | "merged"
    | "test_wrong";
  /** What happened, in plain words. */
  message: string;
  /** Setup barcodes that fix it, per model. */
  fix: { model: ScannerModel; scan: string[] }[];
};

const FIX_ENTER = [
  { model: "tera-d5100" as const, scan: ["tera-cr"] },
  { model: "socket-d760" as const, scan: ["socket-cr"] },
  { model: "alacrity-mj2020r" as const, scan: ["alacrity-cr"] },
];
const FIX_LAYOUT = [
  { model: "tera-d5100" as const, scan: ["tera-us-layout"] },
  { model: "socket-d760" as const, scan: ["socket-english"] },
  { model: "alacrity-mj2020r" as const, scan: ["alacrity-us-english"] },
];

function show(t: string): string {
  return JSON.stringify(t.length > 60 ? `${t.slice(0, 60)}…` : t);
}

/** Classify one scan into the test box. */
export function classifyTestScan(input: TestScanInput): TestScanVerdict {
  // Control characters never reach a text box from a keyboard-mode scanner. Drop them defensively.
  const text = String(input.text ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  // Only `extra > 0` matters, so a negative or NaN count simply means "no extra Enter".
  const extra = Math.floor(input.extraEnters ?? 0);

  if (text.trim() === "") {
    return {
      ok: false,
      code: "nothing",
      message:
        input.terminator === "none"
          ? "Nothing arrived. Check the scanner is connected (Tera: dongle plugged in; Socket: paired; Alacrity: cradle plugged in, solid blue light) and the cursor is in this box."
          : "Only an Enter arrived, with no barcode. Scan again.",
      fix: [],
    };
  }
  if (isScannerCommandText(text)) {
    return {
      ok: false,
      code: "command_text",
      message:
        "That was a setup barcode, and the scanner typed it as text instead of obeying it. Socket: setup barcodes only work while it is disconnected (forget it in Bluetooth and unpair it first).",
      fix: [],
    };
  }
  const t = text.trim();
  const firstTest = t.indexOf(TEST_BARCODE);
  if (firstTest >= 0 && t.indexOf(TEST_BARCODE, firstTest + 1) >= 0) {
    return {
      ok: false,
      code: "merged",
      message: `Two scans ran together (${show(t)}). The scanner is not sending an Enter between scans.`,
      fix: FIX_ENTER,
    };
  }
  if (input.terminator === "none") {
    return {
      ok: false,
      code: "no_enter",
      message: `The barcode arrived (${show(t)}) but no Enter followed it. In Excel every scan would pile into one cell. Scan the Carriage Return barcode for your scanner.`,
      fix: FIX_ENTER,
    };
  }
  if (input.terminator === "tab") {
    return {
      ok: false,
      code: "tab",
      message: `The scanner sent a Tab after ${show(t)}, not an Enter. In Excel it would move right, not down. Scan the Carriage Return barcode for your scanner.`,
      fix: FIX_ENTER,
    };
  }
  const looksLikeTest = t.length === TEST_BARCODE.length && /^gw/i.test(t);
  if (t !== TEST_BARCODE && t.toLowerCase() === TEST_BARCODE.toLowerCase()) {
    return {
      ok: false,
      code: "case_changed",
      message: `The letters changed case (${show(t)}, should be ${show(TEST_BARCODE)}). Check Caps Lock is off on the computer. Tera: scan Conversion Off.`,
      // Only the Tera manual documents a case setting (TERA-UM p09). Caps Lock on the computer
      // flips letters too, so the message says to check it.
      fix: [{ model: "tera-d5100", scan: ["tera-case-off"] }],
    };
  }
  if (t !== TEST_BARCODE && (looksLikeTest || (t.length === TEST_BARCODE.length && !/[0-9]/.test(t)))) {
    return {
      ok: false,
      code: /[0-9]/.test(t) ? "test_wrong" : "layout",
      message: /[0-9]/.test(t)
        ? `The TEST barcode came out wrong (${show(t)}, should be ${show(TEST_BARCODE)}). Check the keyboard layout on the scanner and the computer (both English, US).`
        : `The digits came out as other characters (${show(t)}). The scanner's keyboard layout does not match the computer's. Set the scanner to English (US) and check the computer uses English (US) too.`,
      fix: FIX_LAYOUT,
    };
  }
  if (extra > 0) {
    return {
      ok: false,
      code: "double_enter",
      message: `It works, but the scanner sends ${extra + 1} Enters per scan (CR and LF), so every scan skips a row in Excel. The count still adds up, but scan the Carriage Return barcode to fix it.`,
      fix: FIX_ENTER,
    };
  }
  if (t === TEST_BARCODE) {
    return { ok: true, code: "ok_test", message: "OK. The scanner types the TEST barcode exactly and ends with one Enter. It is ready for the count.", fix: [] };
  }
  return {
    ok: true,
    code: "ok_product",
    message: `Read ${show(t)} and one Enter. To check letters and digits too, scan the TEST barcode.`,
    fix: [],
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure runner: scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function azertyAlacrity(): string {
  return "GZtest)à&é\"'(-è_ç";
}

export function __runScannerSetupCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL scanner-setup-core:", msg);
    }
  };
  const v = (text: string, terminator: TestScanInput["terminator"] = "enter", extraEnters = 0) =>
    classifyTestScan({ text, terminator, extraEnters });

  // Registry integrity.
  const ids = new Set(SCANNER_COMMANDS.map((c) => c.id));
  ok(ids.size === SCANNER_COMMANDS.length, "command ids unique");
  ok(SCANNER_COMMANDS.every((c) => /^[\x20-\x7e]+$/.test(c.payload)), "payloads are printable ASCII (Code 128 B)");
  ok(SCANNER_COMMANDS.every((c) => isScannerCommandText(c.payload)), "every payload is recognised as a command");
  ok(SCANNER_COMMANDS.every((c) => !(c.payload in HARMFUL_PAYLOADS)), "no harmful payload is offered");
  ok(commandById("tera-cr")?.payload === "%%SpecCode9C", "Tera CR payload (TERA-UM p10)");
  ok(commandById("tera-real-time")?.payload === "%%SpecCode10", "Tera Real Time payload");
  ok(commandById("tera-us-layout")?.payload === "%%SpecCode40", "Tera US layout payload");
  ok(commandById("socket-basic-hid")?.payload === "#FNB00F40001#", "Socket Basic Mode payload");
  ok(commandById("socket-cr")?.payload === "#FNB00F507C60408FFEB020000#", "Socket CR suffix payload");
  ok(commandById("socket-english")?.payload === "#FNB01430001#", "Socket English payload");
  ok(commandById("nope") === null, "unknown id is null");
  for (const g of SCANNER_GUIDES) {
    const all = [...g.steps.flatMap((s) => s.scan), ...g.trouble.flatMap((t) => t.scan ?? [])];
    ok(all.every((id) => commandById(id)?.model === g.model), `${g.model}: every referenced barcode exists and is for this model`);
    ok(g.steps.some((s) => s.scan.includes(CR_COMMAND[g.model])), `${g.model}: setup sets Carriage Return`);
    ok(g.steps[g.steps.length - 1].title === "Test it", `${g.model}: setup ends with the test`);
  }
  ok(guideFor("tera-d5100").steps[0].scan[0] === "tera-real-time", "Tera starts with Real Time Mode");
  ok(guideFor("socket-d760").steps[0].scan[0] === "socket-basic-hid", "Socket starts with Basic Mode");
  // R74 S12: Alacrity MJ-2020R.
  ok(SCANNER_GUIDES.length === 3 && SCANNER_GUIDES.every((g) => CR_COMMAND[g.model] && SCANNER_SHORT_NAME[g.model]), "three guides, each with a CR command and a short name");
  ok(guideFor("alacrity-mj2020r").steps[0].scan[0] === "alacrity-wedge", "Alacrity starts with Wedge");
  ok(commandById("alacrity-cr")?.payload === "%%SpecCode9C", "Alacrity CR payload (ALACRITY-UM p30)");
  ok(commandById("alacrity-wedge")?.payload === "%%SpecCode10", "Alacrity Wedge payload");
  ok(commandById("alacrity-us-english")?.payload === "%%SpecCode40", "Alacrity US English payload");
  ok(commandById("alacrity-power-2h")?.payload === "%%SpecCodeBA1802D0", "Alacrity 2 hours payload");
  ok(SCANNER_COMMANDS.every((c) => (c.model === "alacrity-mj2020r") === (symbologyOf(c) === "qr")), "Alacrity codes draw as QR; Tera / Socket stay Code 128");
  ok("%%SpecCode9E" in HARMFUL_PAYLOADS && "%%SpecCode11" in HARMFUL_PAYLOADS, "Alacrity's CR LF default and Batch are never offered");
  ok(guideFor("alacrity-mj2020r").steps.findIndex((s) => s.scan.includes("alacrity-cr")) > guideFor("alacrity-mj2020r").steps.findIndex((s) => s.scan.includes("alacrity-us-english")), "Alacrity: CR after the language");
  ok(v(TEST_BARCODE, "enter", 1).fix.some((f) => f.model === "alacrity-mj2020r" && f.scan.includes("alacrity-cr")), "double Enter (Alacrity default) fix includes Alacrity CR");
  ok(v(azertyAlacrity()).fix.some((f) => f.scan.includes("alacrity-us-english")), "layout fix includes Alacrity US English");
  ok(isScannerCommandText("%%specCode9c"), "command detection ignores case");
  ok(!isScannerCommandText("8710000000000001234"), "a Cultivera barcode is not a command");
  ok(!isScannerCommandText("#FNB"), "a half command is not a command");
  ok(!/%%SpecCode|#FNB/.test(TEST_BARCODE) && /[0-9]{10}/.test(TEST_BARCODE) && /[A-Z]/.test(TEST_BARCODE) && /[a-z]/.test(TEST_BARCODE), "TEST barcode mixes cases and digits");

  // Test box verdicts.
  ok(v(TEST_BARCODE).code === "ok_test" && v(TEST_BARCODE).ok, "exact test + Enter = ok");
  ok(v(` ${TEST_BARCODE} `).code === "ok_test", "surrounding spaces tolerated");
  ok(v("8710000000000001234").code === "ok_product" && v("8710000000000001234").ok, "a product + Enter = ok_product");
  ok(v("", "none").code === "nothing" && !v("", "none").ok, "nothing arrived");
  ok(v("", "enter").code === "nothing" && /Only an Enter/.test(v("", "enter").message), "bare Enter");
  ok(v("\r", "enter").code === "nothing", "control characters only = nothing");
  ok(v(TEST_BARCODE, "none").code === "no_enter", "no terminator");
  ok(v(TEST_BARCODE, "none").fix.some((f) => f.scan.includes("tera-cr")), "no_enter fix includes Tera CR");
  ok(v(TEST_BARCODE, "none").fix.some((f) => f.scan.includes("socket-cr")), "no_enter fix includes Socket CR");
  ok(v("8710000000000001234", "tab").code === "tab", "tab terminator");
  ok(v(TEST_BARCODE + TEST_BARCODE, "none").code === "merged", "two scans run together");
  ok(v(TEST_BARCODE, "enter", 1).code === "double_enter" && !v(TEST_BARCODE, "enter", 1).ok, "CR+LF double enter");
  ok(/2 Enters/.test(v(TEST_BARCODE, "enter", 1).message), "double enter counts Enters");
  ok(v(TEST_BARCODE, "enter", -3).code === "ok_test", "negative extra enters ignored");
  ok(v("%%SpecCode9C").code === "command_text", "setup barcode typed as text");
  ok(v("#FNB00F40001#", "none").code === "command_text", "command beats no_enter");
  ok(v(TEST_BARCODE.toUpperCase()).code === "case_changed", "upper-cased");
  ok(v(TEST_BARCODE.toLowerCase()).code === "case_changed", "lower-cased");
  ok(v(TEST_BARCODE.toUpperCase()).fix.some((f) => f.scan.includes("tera-case-off")), "case fix Tera");
  // A French (AZERTY) computer reading a US-layout scanner: W→Z, '-'→')', and the unshifted digit
  // row 0-9 types à & é " ' ( - è _ ç, so the digits vanish.
  const azerty = "GZtest)à&é\"'(-è_ç";
  ok(azerty.length === TEST_BARCODE.length, "AZERTY sample is the same length");
  ok(v(azerty).code === "layout", "digits became symbols = layout");
  ok(v(azerty).fix.some((f) => f.scan.includes("tera-us-layout")) && v(azerty).fix.some((f) => f.scan.includes("socket-english")), "layout fix both models");
  ok(v("GWtest-0123456788").code === "test_wrong", "a garbled TEST barcode is not ok");
  ok(v("GWtest-0123456789X").code === "ok_product", "a longer code is just a product");
  ok(v("GWtest-0123456789", "tab").code === "tab", "terminator checked before content");
  return { passed, failed };
}
