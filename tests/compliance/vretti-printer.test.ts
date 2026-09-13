/**
 * tests/compliance/vretti-printer.test.ts
 *
 * Pins the vretti receipt-printer work so it cannot silently rot.
 *
 * THREE THINGS ARE GUARDED HERE
 * -----------------------------
 *  1. The back-office page is about the VRETTI. The owner's complaint was that
 *     it "knows nothing about this new printer" — it described a Star Micronics
 *     on Ethernet, configured through a setup utility that does not exist for
 *     this hardware. These tests fail if that wording ever comes back.
 *
 *  2. The guide is actually MOUNTED. A previous slice shipped a guide component
 *     that passed its own test while being unmounted, because the assertion
 *     matched the import line. Every mount assertion here is anchored.
 *
 *  3. The TypeScript ASCII fold and the Python one AGREE. The renderer measures
 *     column widths against folded text; if the Pi's fold table changed and
 *     ours did not, receipts would quietly mis-align on paper. This test reads
 *     the real table out of greenway_printer.py and compares.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPrinterSetupGuide,
  normalizeSiteUrl,
  VRETTI_FACTS,
  PRINTER_HARDWARE,
  PRINTER_CHEAT_SHEET,
  PRINTER_TROUBLESHOOTING,
} from "@/lib/printing/vretti-setup-core";
import {
  formatEscposReceipt,
  buildTestPrintBody,
  asciiFold,
} from "@/lib/printing/receipt-escpos-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PANEL = "src/components/admin/equipment/ReceiptPrinterPanel.tsx";
const GUIDE = "src/components/admin/equipment/VrettiSetupGuide.tsx";
const AGENT = "pi-agent/greenway_printer.py";
const INSTALLER = "pi-agent/install-printer.sh";

describe("back office: the printer page is about the vretti", () => {
  const panel = read(PANEL);
  const guide = read(GUIDE);

  it("no longer names the old Star hardware anywhere", () => {
    for (const source of [panel, guide]) {
      expect(source).not.toMatch(/Star Micronics/i);
      expect(source).not.toMatch(/TSP143/i);
      expect(source).not.toMatch(/Quick Setup Utility/i);
      expect(source).not.toMatch(/PassPRNT/i);
      // Part numbers from the old recommendation.
      expect(source).not.toMatch(/3947301|3947311/);
    }
  });

  it("does not tell the owner to plug this printer into the network", () => {
    // The single most misleading instruction on the old page: the vretti has
    // no network port at all.
    expect(panel).not.toMatch(/Ethernet/i);
    expect(guide).not.toMatch(/Ethernet cable/i);
    expect(panel).not.toMatch(/printer's IP|printer&apos;s IP/i);
    // The old page handed out the Star web-page default login.
    expect(panel).not.toMatch(/password\s+<code[^>]*>public</i);
  });

  it("describes the real connection: USB into the Pi", () => {
    expect(panel).toMatch(/USB/);
    expect(panel).toMatch(/vretti/i);
    expect(guide).toMatch(/vretti/i);
  });

  it("mounts the setup guide (anchored, not just imported)", () => {
    expect(panel).toMatch(/import \{ VrettiSetupGuide \} from/);
    // The element must really be rendered, with props, as a self-closing tag.
    expect(panel).toMatch(/<VrettiSetupGuide[\s\S]{0,400}?\/>/);
    // Guard against the exact bug found before: a renamed component
    // (<VrettiSetupGuideXX) must NOT satisfy this test.
    expect(panel).not.toMatch(/<VrettiSetupGuide[A-Za-z0-9_]/);
  });

  it("passes the guide real values rather than hardcoded ones", () => {
    const mount = panel.match(/<VrettiSetupGuide[\s\S]{0,400}?\/>/)?.[0] ?? "";
    expect(mount).toMatch(/siteUrl=\{/);
    expect(mount).toMatch(/pollToken=\{/);
    expect(mount).toMatch(/hasPolled=\{/);
    // A literal string prop would mean a fabricated token on screen.
    expect(mount).not.toMatch(/pollToken="/);
  });

  it("renders a live preview of the receipt", () => {
    expect(panel).toMatch(/buildTestPrintBody/);
    expect(panel).toMatch(/\{receiptPreview\}/);
  });

  it("keeps the controls that actually operate the printer", () => {
    for (const action of [
      "rotatePollTokenAction",
      "testPrintAction",
      "cancelJobAction",
      "requeueJobAction",
      "savePrinterSettingsAction",
    ]) {
      expect(panel).toContain(action);
    }
    expect(panel).toMatch(/PrinterDiagnosticChat/);
  });
});

describe("the guide's commands match the real installer and agent", () => {
  const guide = buildPrinterSetupGuide({
    siteUrl: "https://example.com",
    pollToken: "REALTOKEN",
    hasPolled: false,
  });
  const commands = guide.flatMap((s) => s.steps).flatMap((s) => s.commands.map((c) => c.command));
  const installer = read(INSTALLER);
  const installer_announcer = read("pi-agent/install.sh");
  const agent = read(AGENT);

  it("uses the flags install-printer.sh actually accepts", () => {
    // Anchored: "chmod +x install-printer.sh" also contains that filename.
    const install = commands.find((c) => c.startsWith("sudo ./install-printer.sh"));
    expect(install).toBeTruthy();
    // Parsed straight out of the installer's own argument loop.
    expect(installer).toMatch(/--site\)\s*SITE=/);
    expect(installer).toMatch(/--token\)\s*TOKEN=/);
    expect(install).toContain("--site ");
    expect(install).toContain("--token ");
    // --code belongs to the ANNOUNCER installer; using it here would fail.
    expect(install).not.toContain("--code");
  });

  it("runs the installer from the clone already on the Pi, not through curl", () => {
    const install = commands.find((c) => c.startsWith("sudo ./install-printer.sh")) ?? "";
    expect(install).toBeTruthy();
    // install-printer.sh looks next to itself FIRST and uses that copy, which
    // is why running it from pi-agent/ downloads nothing at all.
    expect(installer).toMatch(/SCRIPT_DIR\/greenway_printer\.py/);
    // Piping a download into a root shell is the path that breaks when a
    // gateway answers with an HTML CAPTCHA page instead of the file.
    expect(install).not.toContain("curl");
    // "./" only resolves from the folder holding the script, so the guide has
    // to have sent you there -- with an absolute path, because `~` under sudo
    // is root's home, not the Pi user's.
    const cd = commands.find((c) => c.startsWith("cd /"));
    expect(cd).toBeTruthy();
    expect(cd).toContain("/pi-agent");
    for (const c of commands) {
      expect(c).not.toMatch(/cd ~|\s~\//);
    }
  });

  it("addresses the Pi by its real login, not the factory default", () => {
    const ssh = commands.find((c) => c.startsWith("ssh "));
    expect(ssh).toBeTruthy();
    // The shop Pi's own prompt reads greenway-office@greenway-office.
    expect(ssh).toContain("greenway-office");
    for (const c of commands) {
      expect(c).not.toMatch(/\bpi@raspberrypi\b/);
    }
  });

  it("explains that a git pull alone does not apply the always-on settings", () => {
    const update = guide.find((s) => s.id === "update");
    expect(update).toBeTruthy();
    const cmds = (update?.steps ?? []).flatMap((s) => s.commands.map((c) => c.command));
    // Keep-awake is written BY install.sh -- pulling the file changes nothing
    // under /usr/local/bin, /etc/systemd or /etc/NetworkManager until it runs.
    expect(installer_announcer).toMatch(/greenway-keep-awake/);
    expect(cmds.some((c) => c.startsWith("sudo ./install.sh"))).toBe(true);
    // Re-running WITHOUT --code keeps the existing pairing (install.sh:
    // `elif [ -f "$CONFIG_PATH" ]` -> "Already paired").
    expect(installer_announcer).toMatch(/Already paired/);
    expect(cmds.every((c) => !c.includes("--code"))).toBe(true);
    // Without `iw` the keep-awake service is skipped with a warning.
    expect(installer_announcer).toMatch(/apt install -y iw|'iw' tool is missing/);
    expect(cmds.some((c) => c.includes("apt install -y iw"))).toBe(true);
    // And it must be PROVEN, not assumed.
    expect(cmds.some((c) => c.includes("systemctl is-enabled greenway-keep-awake"))).toBe(true);
  });

  it("only uses subcommands the agent really has", () => {
    const declared = [...agent.matchAll(/sub\.add_parser\(\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const used = [...PRINTER_CHEAT_SHEET, ...guide.flatMap((s) => s.steps).flatMap((s) => s.commands)]
      .map((c) => c.command.match(/greenway-printer\s+([a-z]+)/)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(used.length).toBeGreaterThan(0);
    for (const sub of used) expect(declared).toContain(sub);
  });

  it("names the service exactly as the installer registers it", () => {
    expect(installer).toMatch(/SERVICE="greenway-printer"/);
    for (const c of PRINTER_CHEAT_SHEET.map((x) => x.command)) {
      if (c.includes("systemctl") || c.includes("journalctl")) {
        expect(c).toContain("greenway-printer");
      }
    }
  });

  it("names the device path the agent really writes to", () => {
    expect(agent).toContain("/dev/usb/lp0");
    expect(JSON.stringify(VRETTI_FACTS)).toContain("/dev/usb/lp0");
  });

  it("never ships a command containing a placeholder once values exist", () => {
    for (const c of commands) {
      expect(c).not.toContain("YOUR-TOKEN");
      expect(c).not.toContain("your-site.com");
      expect(c).not.toMatch(/undefined|null/);
    }
  });

  it("shows an honest placeholder instead of a fake token when none exists", () => {
    const noToken = buildPrinterSetupGuide({
      siteUrl: "https://example.com",
      pollToken: null,
      hasPolled: false,
    });
    const cmds = noToken.flatMap((s) => s.steps).flatMap((s) => s.commands.map((c) => c.command));
    expect(cmds.some((c) => c.includes("YOUR-TOKEN"))).toBe(true);
    expect(cmds.some((c) => /--token\s+(null|undefined)/.test(c))).toBe(false);
  });

  it("is complete: every step explains itself and its failure mode", () => {
    const steps = guide.flatMap((s) => s.steps);
    expect(steps).toHaveLength(14);
    for (const s of steps) {
      expect(s.title.trim()).not.toBe("");
      expect(s.body.trim()).not.toBe("");
    }
    // Exactly one step is pure explanation, and it must genuinely ask you to
    // do nothing -- otherwise this is a licence to drop troubleshooting.
    const explainOnly = steps.filter((s) => s.ifItGoesWrong == null);
    expect(explainOnly).toHaveLength(1);
    expect(explainOnly[0].commands).toHaveLength(0);
    expect(explainOnly[0].expect).toBeNull();

    // Every OTHER step must say what success looks like and how it fails.
    //
    // Scope this by "is not the explanation step", NOT by "has commands". A
    // commands.length > 0 filter silently exempts step 1, "load the paper the
    // right way round" -- which has no commands and is exactly where the
    // upside-down roll (prints nothing at all) has to be described. A mutation
    // probe caught that: stripping step 1's `expect` left the suite green.
    for (const s of steps.filter((x) => x !== explainOnly[0])) {
      expect(s.expect, `step ${s.number} has no expected result`).toBeTruthy();
      expect(s.ifItGoesWrong, `step ${s.number} has no recovery`).toBeTruthy();
    }
  });

  it("covers the failures that actually happen", () => {
    const blob = JSON.stringify(PRINTER_TROUBLESHOOTING).toLowerCase();
    expect(blob).toContain("blank");
    expect(blob).toContain("lp0");
    expect(blob).toContain("power");
    expect(PRINTER_HARDWARE.filter((h) => h.critical)).toHaveLength(2);
  });

  it("the printer installer rejects a mistyped web address up front", () => {
    // The owner typed "https//greenwaywebsite1.vercel.app" -- no colon. The
    // ANNOUNCER installer has always caught that; the PRINTER one did not,
    // and without the guard the bad value reaches:
    //     DL_URL="https//site/printer/greenway_printer.py"
    // which has no scheme, so curl treats it as a relative PATH and the
    // failure arrives minutes later saying nothing about a missing colon.
    expect(installer).toMatch(/https\/\/\*\|http\/\/\*/);
    expect(installer).toContain("is missing the ':' after");
    expect(installer).toContain("has only one '/' after");
    expect(installer).toContain("does not look like a web address");
    // It must refuse BEFORE doing anything, so nothing is half-installed.
    //
    // Anchor on the REAL assignment, not on any line that merely mentions it:
    // the comment above the guard quotes "DL_URL=..." to explain the bug, and a
    // plain indexOf("DL_URL=") finds that prose first and silently compares the
    // wrong two positions. Require a line that STARTS with the assignment.
    const assignment = /^[ \t]*DL_URL=/m.exec(installer);
    expect(assignment, "no real DL_URL assignment found").not.toBeNull();
    const guardAt = installer.indexOf("is missing the ':' after");
    const downloadAt = assignment!.index;
    expect(guardAt).toBeGreaterThan(-1);
    expect(downloadAt).toBeGreaterThan(guardAt);
    // The same guard the announcer has, so the two cannot drift apart.
    expect(installer_announcer).toContain("is missing the ':' after");
  });

  it("normalizes site URLs without inventing one", () => {
    expect(normalizeSiteUrl("https://a.com/")).toBe("https://a.com");
    expect(normalizeSiteUrl(null)).toBe("");
  });
});

describe("ASCII fold parity: TypeScript must agree with the Pi", () => {
  const agent = read(AGENT);

  /** Pull the replacements dict out of greenway_printer.py's ascii_fold(). */
  function pythonFoldTable(): Record<string, string> {
    const start = agent.indexOf("def ascii_fold");
    expect(start).toBeGreaterThan(-1);
    const openIdx = agent.indexOf("replacements = {", start);
    expect(openIdx).toBeGreaterThan(-1);
    const closeIdx = agent.indexOf("}", openIdx);
    const body = agent.slice(openIdx, closeIdx);
    const table: Record<string, string> = {};
    // Matches "\u2018": "'",  and  "\u201c": '"',
    const re = /"(\\u[0-9a-fA-F]{4})"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
    for (const m of body.matchAll(re)) {
      const key = String.fromCharCode(parseInt(m[1].slice(2), 16));
      const raw = m[2] !== undefined ? m[2] : m[3];
      table[key] = raw.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    }
    return table;
  }

  it("parses a meaningful table out of the Python (harness check)", () => {
    const table = pythonFoldTable();
    // If this ever drops to a handful, the parser broke — not the code.
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(30);
    expect(table["\u2014"]).toBe("-");
    expect(table["\u00b7"]).toBe("*");
  });

  it("folds every character exactly as the Pi would", () => {
    for (const [ch, expected] of Object.entries(pythonFoldTable())) {
      expect(asciiFold(ch), `fold of U+${ch.codePointAt(0)!.toString(16)}`).toBe(expected);
    }
  });

  it("agrees on accents and unmappable characters", () => {
    expect(asciiFold("café")).toBe("cafe");
    expect(asciiFold("Renée")).toBe("Renee");
    expect(asciiFold("中")).toBe("?");
  });

  it("is idempotent, so the Pi folding again changes nothing", () => {
    const once = asciiFold("Acme® · café… ½");
    expect(asciiFold(once)).toBe(once);
  });
});

describe("the pickup receipt is laid out like a register sale", () => {
  const receipt = formatEscposReceipt(
    {
      orderNumber: "Purple Rain",
      placedAt: "2024-01-15T13:05:00.000Z",
      customerName: "Jamie R.",
      customerPhone: "360-555-0100",
      customerNote: "Please double-bag.",
      lines: [
        {
          productName: "Blue Dream 3.5g",
          quantity: 2,
          priceMinorUnits: 1500,
          regularPriceMinorUnits: 1800,
          category: "flower",
          brand: "Artizen",
          unitGrams: 3.5,
          appliedLabel: "Happy Hour",
        },
      ],
      subtotalMinorUnits: 2050,
      savingsMinorUnits: 600,
      estimatedTaxMinorUnits: 950,
      totalMinorUnits: 3000,
    },
    { columns: 48 },
  );

  it("keeps the register's section order", () => {
    const idx = (s: string) => receipt.indexOf(s);
    expect(idx("GREENWAY MARIJUANA")).toBeGreaterThan(-1);
    expect(idx("Receipt # Purple Rain")).toBeGreaterThan(idx("GREENWAY MARIJUANA"));
    expect(idx("2x Blue Dream 3.5g")).toBeGreaterThan(idx("Receipt # Purple Rain"));
    expect(idx("Subtotal (pre-tax)")).toBeGreaterThan(idx("2x Blue Dream 3.5g"));
    expect(idx("TOTAL")).toBeGreaterThan(idx("Subtotal (pre-tax)"));
    expect(idx("Return Policy")).toBeGreaterThan(idx("TOTAL"));
  });

  it("prints the register's item detail line", () => {
    expect(receipt).toContain("Artizen");
    expect(receipt).toContain("3.5g");
    expect(receipt).toContain("Happy Hour");
    expect(receipt).toContain("2 @ $15.00 each");
  });

  it("itemizes excise separately from sales tax (RCW 69.50.535(1)(a))", () => {
    expect(receipt).toContain("WA Cannabis Excise");
    expect(receipt).toContain("State & Local Sales Tax");
    expect(receipt).toContain("Total tax");
    const excise = Number(receipt.match(/WA Cannabis Excise[^$]*\$([0-9.]+)/)![1]);
    const sales = Number(receipt.match(/State & Local Sales Tax[^$]*\$([0-9.]+)/)![1]);
    // The printed parts must sum EXACTLY to the tax charged.
    expect(Math.round(excise * 100) + Math.round(sales * 100)).toBe(950);
  });

  it("never claims an unpaid reservation was paid", () => {
    expect(receipt).toContain("NOT PAID");
    expect(receipt).not.toContain("Change");
    expect(receipt).not.toContain("Cash tendered");
  });

  it("fits the paper and is pure ASCII", () => {
    for (const line of receipt.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(48);
      expect(/[^\x00-\x7F]/.test(line)).toBe(false);
    }
  });

  it("honours a narrower paper setting", () => {
    for (const line of buildTestPrintBody({ columns: 32 }).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });
});

describe("the queue sends register-style receipts", () => {
  it("printer-store renders with the ESC/POS builder, not the old plain one", () => {
    const store = read("src/lib/printing/printer-store.ts");
    expect(store).toMatch(/formatEscposReceipt/);
    expect(store).toMatch(/getPosReceiptConfig/);
    // queueOrderReceipt must no longer use the legacy layout.
    const fn = store.slice(store.indexOf("export async function queueOrderReceipt"));
    expect(fn).not.toMatch(/\bformatReceipt\(/);
  });

  it("the orders API forwards the enrichment the receipt needs", () => {
    const route = read("src/app/api/orders/route.ts");
    const call = route.slice(route.indexOf("queueOrderReceipt({"));
    expect(call).toMatch(/lineExtras/);
    // Category is what makes the statutory tax split printable at all.
    expect(call).toMatch(/category/);
    expect(call).toMatch(/regularPriceMinorUnits/);
  });

  it("both test-print buttons use the one shared builder", () => {
    for (const p of ["src/app/admin/equipment/printer-actions.ts", "src/app/admin/orders/actions.ts"]) {
      const src = read(p);
      expect(src).toMatch(/buildTestPrintBody/);
      expect(src).not.toMatch(/Sample item A/);
    }
  });
});
