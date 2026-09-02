/**
 * src/lib/pos/printer-pairing-core.ts
 *
 * SLICE 11. Everything the "pick a receipt printer" screen needs to DECIDE,
 * with no I/O, no React, no Capacitor and no DOM. The screen renders what this
 * module returns; it does not think for itself.
 *
 * WHY THIS SLICE EXISTS
 * ---------------------
 * SLICE 10 taught the register to print without leaving the app, but nothing
 * ever called `setPairedPrinterIdentifier`. So `getPairedPrinterIdentifier()`
 * always returned null, the bridge always fell back to PassPRNT, and the whole
 * point of SLICE 10 — never leave the app — was unreachable in practice. This
 * module is the missing decision layer.
 *
 * WHERE PAIRING HAPPENS, AND WHY IT IS NOT IN THE ADMIN EQUIPMENT PAGE
 * --------------------------------------------------------------------
 * Bluetooth discovery is physically local to the radio doing the scanning. The
 * admin equipment page runs in a browser on the owner's MacBook, which cannot
 * see — let alone pair — a printer sitting on the shop counter next to an iPad.
 * Any "pair from here" button in the back office would be a lie.
 *
 * So the split is:
 *   - PAIRING happens on the iPad, in the register (MORE > Receipt printer).
 *   - The admin equipment page SHOWS the counter printer in the hardware hub
 *     and says, in words, that pairing is done on the iPad.
 *
 * THE HAZARD THIS MODULE EXISTS TO PREVENT
 * -----------------------------------------
 * Greenway runs more than one till on one counter. Two iPads within Bluetooth
 * range of two printers means a cashier can trivially pair to the NEIGHBOURING
 * printer, and every sale then prints — and pops a cash drawer — at the wrong
 * till. A popped drawer at an unattended till is a cash-control incident, not a
 * printing annoyance. Hence `rankDiscoveries` surfaces the registered serial
 * first, and `describeAmbiguity` forces a human to look when the choice is not
 * obvious.
 */

import {
  COUNTER_PRINTER,
  isValidStarPairing,
  type StarInterfaceType,
  type StarPairing,
} from "./star-printer-core";

// ---------------------------------------------------------------------------
// Discovery results
// ---------------------------------------------------------------------------

/**
 * One printer as reported by StarXpand discovery.
 *
 * `identifier` is OPAQUE — see the long note on `isValidStarPairing`. For
 * Bluetooth Classic it is the iOS Port Name, which the owner can rename with
 * Star's Setting Utility, so nothing here may pattern-match it.
 */
export type DiscoveredPrinter = {
  identifier: string;
  /** Model string, "" when the SDK could not read it. */
  model: string;
  interfaceType: StarInterfaceType;
};

/** A discovery result, scored and explained for the setup list. */
export type RankedPrinter = DiscoveredPrinter & {
  /** True when this looks like the printer in the equipment registry. */
  isRegistered: boolean;
  /** What to show under the name. Never blank. */
  detail: string;
  /** Sort key; higher is more likely to be the right printer. */
  score: number;
};

export function isDiscoveredPrinter(v: unknown): v is DiscoveredPrinter {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<DiscoveredPrinter>;
  if (typeof p.identifier !== "string" || p.identifier.trim() === "") return false;
  if (typeof p.model !== "string") return false;
  return (
    p.interfaceType === "bluetooth" ||
    p.interfaceType === "lan" ||
    p.interfaceType === "bluetoothLE" ||
    p.interfaceType === "usb"
  );
}

/** Drop anything malformed rather than letting it reach the list. */
export function sanitizeDiscoveries(raw: readonly unknown[]): DiscoveredPrinter[] {
  const out: DiscoveredPrinter[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isDiscoveredPrinter(item)) continue;
    const identifier = item.identifier.trim();
    if (seen.has(identifier)) continue; // the SDK can report a device twice
    seen.add(identifier);
    out.push({ identifier, model: item.model.trim(), interfaceType: item.interfaceType });
  }
  return out;
}

/**
 * Does this discovery match the printer recorded in the equipment registry?
 *
 * The registry knows the SERIAL (2550923021300119, read off the device sticker
 * and stored by migration 0120). Star's Bluetooth port names commonly end in a
 * tail of the serial — the self-test page prints both — so a serial-tail match
 * is strong evidence. It is only ever used to SORT and to LABEL. It never
 * auto-selects, because a wrong auto-selection pops the wrong cash drawer.
 */
export function matchesRegisteredPrinter(
  p: DiscoveredPrinter,
  serial: string = COUNTER_PRINTER.serial,
): boolean {
  const id = p.identifier.replace(/[^0-9a-z]/gi, "").toLowerCase();
  const s = serial.replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (!id || !s) return false;
  if (id.includes(s)) return true;
  // Star prints a shortened form on some models; require a long tail so that a
  // coincidental 3-digit overlap between two printers cannot match.
  const tail = s.slice(-8);
  return tail.length >= 8 && id.includes(tail);
}

/** Best guess first. Pure and stable: equal scores keep discovery order. */
export function rankDiscoveries(
  printers: readonly DiscoveredPrinter[],
  serial: string = COUNTER_PRINTER.serial,
): RankedPrinter[] {
  const ranked: RankedPrinter[] = printers.map((p) => {
    const isRegistered = matchesRegisteredPrinter(p, serial);
    let score = 0;
    if (isRegistered) score += 100;
    if (p.interfaceType === "bluetooth") score += 10;
    if (p.model !== "") score += 1;
    return { ...p, isRegistered, score, detail: describeDiscovery(p, isRegistered) };
  });
  // Stability matters: two identical-looking printers on one counter must not
  // swap places between scans, or the cashier taps a different one than the
  // one they read. Array.prototype.sort is stable in every engine we ship to
  // (ES2019+), so equal scores keep discovery order without a tiebreak field.
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** One line of plain English under each printer in the list. */
export function describeDiscovery(p: DiscoveredPrinter, isRegistered: boolean): string {
  const bits: string[] = [];
  bits.push(p.model !== "" ? p.model : "Model not reported");
  if (isRegistered) {
    bits.push("matches the printer on file — almost certainly the right one");
  } else if (p.interfaceType !== "bluetooth") {
    bits.push(`connected by ${p.interfaceType}`);
  }
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

export type PairChoice =
  | { ok: true; pairing: StarPairing; warning: string | null }
  | { ok: false; reason: string };

/**
 * Turn "the cashier tapped this row" into a pairing worth saving.
 *
 * Deliberately returns a WARNING rather than refusing when the chosen printer
 * is not the registered one. The registry can legitimately be out of date — a
 * printer gets replaced under warranty and the sticker changes — and refusing
 * would strand the store with no way to print. Warn, save, and tell the owner.
 */
export function choosePrinter(
  p: DiscoveredPrinter,
  serial: string = COUNTER_PRINTER.serial,
): PairChoice {
  if (!isDiscoveredPrinter(p)) {
    return { ok: false, reason: "That printer was reported incompletely. Search again." };
  }
  const pairing: StarPairing = {
    identifier: p.identifier.trim(),
    interfaceType: p.interfaceType,
    model: p.model.trim() === "" ? null : p.model.trim(),
  };
  if (!isValidStarPairing(pairing)) {
    return { ok: false, reason: "That printer's ID could not be read. Search again." };
  }
  const warning = matchesRegisteredPrinter(p, serial)
    ? null
    : "This is not the printer recorded in the equipment page. If there is another till nearby, " +
      "check you have picked the printer on THIS counter — pairing to the wrong one will pop the " +
      "wrong cash drawer.";
  return { ok: true, pairing, warning };
}

// ---------------------------------------------------------------------------
// Screen state
// ---------------------------------------------------------------------------

export type PairingScreenState =
  | { kind: "unsupported"; headline: string; body: string }
  | { kind: "idle"; headline: string; body: string }
  | { kind: "searching"; headline: string; body: string }
  | { kind: "empty"; headline: string; body: string }
  | { kind: "results"; headline: string; body: string; printers: RankedPrinter[] }
  | { kind: "paired"; headline: string; body: string };

export type PairingInputs = {
  /** False on a laptop browser or before the native plugin is installed. */
  nativeAvailable: boolean;
  searching: boolean;
  /** null = discovery has not been run yet this visit. */
  results: readonly DiscoveredPrinter[] | null;
  paired: StarPairing | null;
  serial?: string;
};

/**
 * The single source of truth for what the setup screen shows. Keeping this
 * pure means every state — including the awkward ones like "plugin missing but
 * a printer is already paired" — is testable without a device.
 */
export function pairingScreenState(inp: PairingInputs): PairingScreenState {
  const serial = inp.serial ?? COUNTER_PRINTER.serial;

  if (!inp.nativeAvailable) {
    return {
      kind: "unsupported",
      headline: "Printer setup is only available on the iPad",
      body:
        "This screen searches for Bluetooth printers, which only works inside the installed " +
        "register app on the iPad. On a laptop browser there is no Bluetooth to search with. " +
        "Receipts will still print using the browser print dialog.",
    };
  }

  if (inp.searching) {
    return {
      kind: "searching",
      headline: "Searching for printers…",
      body: "Make sure the printer is switched on and its blue light is steady, not flashing.",
    };
  }

  if (inp.results === null) {
    return inp.paired
      ? {
          kind: "paired",
          headline: `Paired: ${inp.paired.model ?? inp.paired.identifier}`,
          body: describePairedFor(inp.paired, serial),
        }
      : {
          kind: "idle",
          headline: "No receipt printer paired to this iPad",
          body:
            "Until a printer is paired, receipts open Star's PassPRNT app instead of printing " +
            "here. Tap Search to find the printer on this counter.",
        };
  }

  const ranked = rankDiscoveries(sanitizeDiscoveries(inp.results), serial);

  if (ranked.length === 0) {
    return {
      kind: "empty",
      headline: "No printers found",
      body:
        "Check the printer is switched on, that it has paper, and that it is paired in the " +
        "iPad's Settings › Bluetooth first. A printer that has never been paired in iPad " +
        "Settings will not appear here.",
    };
  }

  return {
    kind: "results",
    headline: ranked.length === 1 ? "Found 1 printer" : `Found ${ranked.length} printers`,
    body: describeAmbiguity(ranked),
    printers: ranked,
  };
}

/**
 * Say something useful about how confident we are.
 *
 * When several printers are in range and none is recognised, the cashier is one
 * careless tap away from the neighbouring till's drawer. Say so plainly.
 */
export function describeAmbiguity(ranked: readonly RankedPrinter[]): string {
  const registered = ranked.filter((r) => r.isRegistered);
  if (registered.length === 1 && ranked.length === 1) {
    return "This matches the printer recorded in the equipment page.";
  }
  if (registered.length === 1) {
    return "The first one matches the printer recorded in the equipment page. Pick that one unless you know otherwise.";
  }
  if (registered.length > 1) {
    return "More than one printer matches the equipment record. Check the serial on the sticker underneath each printer before choosing.";
  }
  if (ranked.length === 1) {
    return "This does not match the printer recorded in the equipment page. Check it is the printer on THIS counter before choosing.";
  }
  return "None of these match the printer recorded in the equipment page. If another till is nearby, its printer will be in this list too — pick carefully, because the wrong choice pops the wrong cash drawer.";
}

/** The body text once a printer is paired. */
export function describePairedFor(p: StarPairing, serial: string = COUNTER_PRINTER.serial): string {
  const known = matchesRegisteredPrinter(
    { identifier: p.identifier, model: p.model ?? "", interfaceType: p.interfaceType },
    serial,
  );
  const head = known
    ? "This is the printer recorded in the equipment page."
    : "Note: this is NOT the printer recorded in the equipment page. That is fine if the printer was replaced — but worth checking.";
  return `${head} Receipts print here without leaving the register. Use Test print to prove it, or Forget to pair a different one.`;
}

// ---------------------------------------------------------------------------
// Test print
// ---------------------------------------------------------------------------

/**
 * The receipt used by the Test print button.
 *
 * Deliberately NOT a fake sale: nothing here may look like a real receipt, or
 * a test slip found in a drawer during an audit becomes a question nobody can
 * answer. It states what it is, names the till, and never opens the drawer.
 */
export function buildTestSlipHtml(opts: {
  printedAt: string;
  deviceLabel: string;
  printerLabel: string;
}): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
    );
  return [
    '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;width:100%;">',
    '<div style="text-align:center;font-weight:700;font-size:20px;">GREENWAY</div>',
    '<div style="text-align:center;font-size:15px;margin-bottom:10px;">PRINTER TEST</div>',
    '<div style="border-top:1px dashed #000;margin:8px 0;"></div>',
    '<div style="font-size:14px;">This is a test slip.</div>',
    '<div style="font-size:14px;">It is NOT a sale and nothing was recorded.</div>',
    '<div style="border-top:1px dashed #000;margin:8px 0;"></div>',
    `<div style="font-size:13px;">Till: ${esc(opts.deviceLabel)}</div>`,
    `<div style="font-size:13px;">Printer: ${esc(opts.printerLabel)}</div>`,
    `<div style="font-size:13px;">Printed: ${esc(opts.printedAt)}</div>`,
    '<div style="border-top:1px dashed #000;margin:8px 0;"></div>',
    '<div style="text-align:center;font-size:13px;">If you can read this, receipt printing works.</div>',
    "</div>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

/**
 * Returns { passed, failed } — the shape the whole repo uses, and the shape
 * `assertNoFailures()` in run-pure-selftests.ts reads. An earlier draft of this
 * module returned an ARRAY of results instead. That type-checked, and the
 * runner reported success, but `result.failed` was `undefined` and
 * `undefined > 0` is false, so every failure in this file would have been
 * silently ignored. Matching the house convention is what makes these tests
 * actually enforceable.
 */
export function __runPrinterPairingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, pass: boolean) => {
    if (pass) passed += 1;
    else {
      failed += 1;
      console.error(`printer-pairing-core FAIL: ${name}`);
    }
  };

  const REAL_SERIAL = COUNTER_PRINTER.serial;
  const bt = (identifier: string, model = "TSP143IIIBi"): DiscoveredPrinter => ({
    identifier,
    model,
    interfaceType: "bluetooth",
  });

  // ── shape guards ────────────────────────────────────────────────────────
  ok("a well-formed discovery is accepted", isDiscoveredPrinter(bt("TSP100-31300119")));
  ok("a missing model is refused", !isDiscoveredPrinter({ identifier: "a", interfaceType: "bluetooth" }));
  ok("an empty identifier is refused", !isDiscoveredPrinter(bt("")));
  ok("null is refused", !isDiscoveredPrinter(null));
  ok(
    "an unknown interface is refused",
    !isDiscoveredPrinter({ identifier: "a", model: "", interfaceType: "smoke-signal" }),
  );

  // ── sanitising ──────────────────────────────────────────────────────────
  ok("garbage entries are dropped", sanitizeDiscoveries([bt("A"), null, 7, {}]).length === 1);
  ok(
    "duplicates are collapsed",
    sanitizeDiscoveries([bt("TSP100-1"), bt("TSP100-1")]).length === 1,
  );
  ok(
    "identifiers are trimmed",
    sanitizeDiscoveries([bt("  TSP100-1  ")])[0]?.identifier === "TSP100-1",
  );
  ok("an empty list stays empty", sanitizeDiscoveries([]).length === 0);

  // ── registry matching ───────────────────────────────────────────────────
  ok(
    "a port name carrying the full serial matches",
    matchesRegisteredPrinter(bt(`TSP100-${REAL_SERIAL}`)),
  );
  ok(
    "a port name carrying the serial tail matches",
    matchesRegisteredPrinter(bt(`TSP100-${REAL_SERIAL.slice(-8)}`)),
  );
  ok("an unrelated printer does not match", !matchesRegisteredPrinter(bt("TSP100-99999999")));
  ok(
    "a short coincidental overlap does not match",
    !matchesRegisteredPrinter(bt(`TSP100-${REAL_SERIAL.slice(-3)}`)),
  );
  ok("punctuation is ignored when matching", matchesRegisteredPrinter(bt(`TSP100_${REAL_SERIAL}`)));
  ok("an empty serial never matches", !matchesRegisteredPrinter(bt("TSP100-1"), ""));

  // ── ranking ─────────────────────────────────────────────────────────────
  const mixed = [bt("TSP100-OTHER"), bt(`TSP100-${REAL_SERIAL}`)];
  const ranked = rankDiscoveries(mixed);
  ok("the registered printer is ranked first", ranked[0]?.identifier === `TSP100-${REAL_SERIAL}`);
  ok("the registered printer is flagged", ranked[0]?.isRegistered === true);
  ok("the other printer is not flagged", ranked[1]?.isRegistered === false);
  ok("every row has a detail line", ranked.every((r) => r.detail.length > 0));
  ok(
    "ranking is stable for equal scores",
    rankDiscoveries([bt("A"), bt("B")])[0]?.identifier === "A",
  );
  ok("ranking an empty list is safe", rankDiscoveries([]).length === 0);
  ok(
    "a model-less printer still gets a detail line",
    rankDiscoveries([bt("A", "")])[0]?.detail.includes("Model not reported") === true,
  );

  // ── choosing ────────────────────────────────────────────────────────────
  const goodChoice = choosePrinter(bt(`TSP100-${REAL_SERIAL}`));
  ok("choosing the registered printer succeeds", goodChoice.ok);
  ok("choosing the registered printer warns about nothing", goodChoice.ok && goodChoice.warning === null);
  ok(
    "the saved pairing keeps the opaque identifier verbatim",
    goodChoice.ok && goodChoice.pairing.identifier === `TSP100-${REAL_SERIAL}`,
  );
  const oddChoice = choosePrinter(bt("TSP100-SOMEONE-ELSE"));
  ok("choosing an unknown printer still succeeds", oddChoice.ok);
  ok(
    "choosing an unknown printer warns about the wrong drawer",
    oddChoice.ok && (oddChoice.warning ?? "").includes("wrong cash drawer"),
  );
  ok(
    "a renamed printer with spaces can be chosen",
    choosePrinter(bt("Front Counter Printer")).ok,
  );
  ok(
    "a model-less printer stores a null model rather than an empty string",
    (() => {
      const c = choosePrinter(bt("TSP100-1", ""));
      return c.ok && c.pairing.model === null;
    })(),
  );
  ok(
    "a malformed discovery is refused",
    !choosePrinter({ identifier: "", model: "", interfaceType: "bluetooth" }).ok,
  );

  // ── screen state ────────────────────────────────────────────────────────
  const base: PairingInputs = { nativeAvailable: true, searching: false, results: null, paired: null };

  ok(
    "a laptop browser is told this is iPad-only",
    pairingScreenState({ ...base, nativeAvailable: false }).kind === "unsupported",
  );
  ok(
    "the unsupported message explains receipts still print",
    pairingScreenState({ ...base, nativeAvailable: false }).body.includes("browser print dialog"),
  );
  ok(
    "an unpaired iPad is told PassPRNT is being used",
    pairingScreenState(base).body.includes("PassPRNT"),
  );
  ok("searching is its own state", pairingScreenState({ ...base, searching: true }).kind === "searching");
  ok(
    "an empty search explains iPad Settings pairing comes first",
    pairingScreenState({ ...base, results: [] }).body.includes("Settings"),
  );
  const withResults = pairingScreenState({ ...base, results: mixed });
  ok("results are returned", withResults.kind === "results");
  ok(
    "the results headline counts them",
    withResults.kind === "results" && withResults.headline === "Found 2 printers",
  );
  ok(
    "a single result is singular",
    (() => {
      const s = pairingScreenState({ ...base, results: [bt("A")] });
      return s.kind === "results" && s.headline === "Found 1 printer";
    })(),
  );
  const paired: StarPairing = {
    identifier: `TSP100-${REAL_SERIAL}`,
    interfaceType: "bluetooth",
    model: "TSP143IIIBi",
  };
  ok("a paired iPad shows the paired state", pairingScreenState({ ...base, paired }).kind === "paired");
  ok(
    "the paired state confirms it is the registered printer",
    pairingScreenState({ ...base, paired }).body.includes("recorded in the equipment page"),
  );
  ok(
    "a paired but unrecognised printer says so",
    pairingScreenState({
      ...base,
      paired: { ...paired, identifier: "TSP100-STRANGER" },
    }).body.includes("NOT the printer recorded"),
  );
  ok(
    "the plugin being missing outranks an existing pairing",
    pairingScreenState({ ...base, nativeAvailable: false, paired }).kind === "unsupported",
  );
  ok(
    "searching outranks an existing pairing",
    pairingScreenState({ ...base, searching: true, paired }).kind === "searching",
  );

  // ── ambiguity wording ───────────────────────────────────────────────────
  ok(
    "one recognised printer reads confidently",
    describeAmbiguity(rankDiscoveries([bt(`TSP100-${REAL_SERIAL}`)])).includes("matches the printer"),
  );
  ok(
    "two unrecognised printers warn about the wrong drawer",
    describeAmbiguity(rankDiscoveries([bt("A"), bt("B")])).includes("wrong cash drawer"),
  );
  ok(
    "two recognised printers send the reader to the sticker",
    describeAmbiguity(
      rankDiscoveries([bt(`TSP100-${REAL_SERIAL}`), bt(`X-${REAL_SERIAL}`)]),
    ).includes("sticker"),
  );

  // ── test slip ───────────────────────────────────────────────────────────
  const slip = buildTestSlipHtml({
    printedAt: "2026-01-02 3:04 PM",
    deviceLabel: "Register 1 iPad",
    printerLabel: "TSP143IIIBi",
  });
  ok("the test slip says it is a test", slip.includes("PRINTER TEST"));
  ok("the test slip denies being a sale", slip.includes("NOT a sale"));
  ok("the test slip names the till", slip.includes("Register 1 iPad"));
  ok("the test slip names the printer", slip.includes("TSP143IIIBi"));
  ok("the test slip carries no money", !slip.includes("$"));
  ok(
    "the test slip escapes injected markup",
    !buildTestSlipHtml({
      printedAt: "x",
      deviceLabel: "<script>alert(1)</script>",
      printerLabel: "y",
    }).includes("<script>"),
  );

  return { passed, failed };
}
