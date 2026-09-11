/**
 * tests/compliance/printer-docs.test.ts
 *
 * The printer manual, the installer and the agent must stay true to each other.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Documentation rots silently. Code has tests; prose usually does not. The
 * announcer proved this the hard way: install.sh told the owner that pairing
 * codes "expire after 15 minutes" when the constant was 60, and it shipped.
 *
 * While writing the printer walkthrough I made exactly the same class of
 * mistake — the uninstall row in the command table pointed at
 * /usr/local/bin/install-printer.sh, a path the installer never creates,
 * because only the AGENT is copied to /usr/local/bin. Caught by reading the
 * installer instead of trusting the draft. These tests make that catch
 * permanent, and cover the D-67 lesson too: every URL the manual tells the
 * owner to curl must actually resolve to a file in public/.
 *
 * These are deliberately cheap string checks. They do not judge the writing —
 * only that the FACTS still match the code.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const WALKTHROUGH_PATH = "docs/printer/05-first-printer-walkthrough.md";
const INSTALLER_PATH = "pi-agent/install-printer.sh";
const AGENT_PATH = "pi-agent/greenway_printer.py";
const UNIT_PATH = "pi-agent/systemd/greenway-printer.service";
const PUBLIC_AGENT = "public/printer/greenway_printer.py";
const PUBLIC_INSTALLER = "public/printer/install-printer.sh";

const QUICKSTART_PATH = "docs/printer/06-copy-paste-quickstart.md";

const doc = read(WALKTHROUGH_PATH);
const quickstart = read(QUICKSTART_PATH);
const installer = read(INSTALLER_PATH);
const agent = read(AGENT_PATH);
const unit = read(UNIT_PATH);

/**
 * Parse a systemd unit into { Section: { Key: [values] } }.
 *
 * WHY A PARSER INSTEAD OF indexOf()
 * ---------------------------------
 * The first draft of this file asked two questions with raw substring
 * matching, and got BOTH answers wrong on a unit file that was correct:
 *
 *   1. "is StartLimitIntervalSec=0 inside [Unit]?" was answered by slicing
 *      from indexOf("[Unit]") to indexOf("[Service]"). The comment directly
 *      above the directive explains that the key "belongs in [Unit], NOT
 *      [Service]" -- so indexOf("[Service]") matched inside that COMMENT and
 *      the slice ended before the directive it was looking for. False alarm.
 *
 *   2. "is PrivateDevices=yes absent?" was answered by unit.includes(...).
 *      The unit contains a five-line comment explaining exactly why
 *      PrivateDevices=yes must never be set (it hides /dev/usb/lp0). The
 *      words the test feared were the words documenting the safeguard.
 *      False alarm again.
 *
 * A test that fails because the code is well commented is a broken test: the
 * cure is to read the file the way systemd reads it, not to delete the
 * comments. So: comments stripped, sections tracked, values collected.
 * Directive names are case-insensitive to systemd, so they are folded here.
 */
function parseUnit(text: string): Record<string, Record<string, string[]>> {
  const sections: Record<string, Record<string, string[]>> = {};
  let current = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    // systemd treats both '#' and ';' as comment introducers, and ignores
    // blank lines. Neither can carry a directive.
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = header[1];
      sections[current] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    sections[current] ??= {};
    (sections[current][key] ??= []).push(value);
  }
  return sections;
}

const unitSections = parseUnit(unit);

/** Effective value of a directive in a section, or undefined if unset. */
const directive = (section: string, key: string): string | undefined => {
  const values = unitSections[section]?.[key.toLowerCase()];
  return values === undefined ? undefined : values[values.length - 1];
};

describe("the download URLs the manual promises actually resolve (D-67)", () => {
  // The manual tells the owner to curl https://SITE/printer/install-printer.sh.
  // Next.js serves that from public/printer/. If the file is not there, the
  // very first command in the walkthrough 404s.
  it("public/printer/install-printer.sh exists", () => {
    expect(existsSync(join(ROOT, PUBLIC_INSTALLER))).toBe(true);
  });

  it("public/printer/greenway_printer.py exists", () => {
    expect(existsSync(join(ROOT, PUBLIC_AGENT))).toBe(true);
  });

  it("the published installer is identical to the source of truth", () => {
    expect(read(PUBLIC_INSTALLER)).toBe(installer);
  });

  it("the published agent is identical to the source of truth", () => {
    expect(read(PUBLIC_AGENT)).toBe(agent);
  });

  it("the installer's own download path matches where the file is published", () => {
    // install-printer.sh falls back to downloading ${SITE}/printer/...
    expect(installer).toContain("/printer/greenway_printer.py");
    expect(doc).toContain("/printer/install-printer.sh");
  });
});

describe("every command the manual tells the owner to run really exists", () => {
  const commands = ["status", "test", "selftest", "pair", "run"];

  for (const cmd of commands) {
    it(`the agent implements the '${cmd}' subcommand`, () => {
      expect(agent).toContain(`sub.add_parser("${cmd}"`);
    });
  }

  it("the manual only references subcommands that exist", () => {
    const referenced = [...doc.matchAll(/greenway-printer\s+([a-z]+)/g)]
      .map((m) => m[1])
      .filter((c) => c !== "pair" || true);
    for (const cmd of new Set(referenced)) {
      expect(commands).toContain(cmd);
    }
  });

  it("the installed program name matches what the manual says to type", () => {
    expect(installer).toContain('BIN_PATH="/usr/local/bin/greenway-printer"');
    expect(doc).toContain("sudo greenway-printer status");
  });

  it("does NOT claim the installer is copied into /usr/local/bin", () => {
    // The bug this test was born from: only the agent is installed there.
    expect(doc).not.toContain("/usr/local/bin/install-printer.sh");
  });

  it("the service name in the manual matches the unit file", () => {
    expect(doc).toContain("systemctl status greenway-printer");
    expect(doc).toContain("journalctl -u greenway-printer");
    expect(installer).toContain('SERVICE="greenway-printer"');
  });
});

describe("the installer flags the manual mentions are real flags", () => {
  const flags = ["--site", "--token", "--columns", "--no-cut", "--uninstall"];

  for (const flag of flags) {
    it(`the installer or agent accepts ${flag}`, () => {
      expect(installer.includes(flag) || agent.includes(flag)).toBe(true);
    });
  }
});

describe("the numbers in the manual match the code", () => {
  it("the default column count is what the manual claims (48)", () => {
    expect(agent).toContain("DEFAULT_COLUMNS = 48");
    expect(doc).toContain("48 is standard for 80mm paper");
  });

  it("the narrow-paper example is within the agent's clamp", () => {
    // The manual suggests --columns 32 for 58mm paper; safe_columns clamps to
    // 24..96, so 32 must be accepted rather than silently rewritten.
    expect(doc).toContain("--columns 32");
    expect(agent).toContain("if value < 24:");
    expect(agent).toContain("if value > 96:");
  });

  it("the device path the manual names is the first one the agent tries", () => {
    expect(doc).toContain("/dev/usb/lp0");
    expect(agent).toContain('DEVICE_CANDIDATES = [f"/dev/usb/lp{n}"');
  });

  it("the admin location the manual names matches the agent's error text", () => {
    expect(doc).toContain("Admin → Equipment → Receipt printer");
    expect(agent).toContain("Equipment");
  });
});

describe("the promises the manual makes are actually implemented", () => {
  it("'never confirmed before it prints' — confirm happens after the write", () => {
    const printIdx = agent.indexOf("ok, detail = self.print_text(text)");
    const confirmIdx = agent.indexOf("confirm_error = self.confirm_job(token)");
    expect(printIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(printIdx);
  });

  it("'the service never gives up' — the start limit is disabled in [Unit]", () => {
    // These two keys are parsed by systemd ONLY in [Unit]. Put them in
    // [Service] and systemd ignores them without a word, the default of
    // 5-starts-in-10s applies, and after five crashes the printer is dead
    // until somebody notices. So assert the section, not just the string.
    expect(directive("Unit", "StartLimitIntervalSec")).toBe("0");
    expect(directive("Unit", "StartLimitBurst")).toBe("0");
    // ...and prove they are NOT hiding in [Service], where they do nothing.
    expect(directive("Service", "StartLimitIntervalSec")).toBeUndefined();
    expect(directive("Service", "StartLimitBurst")).toBeUndefined();
    // The restart itself has to be requested, or there is nothing to unlimit.
    expect(directive("Service", "Restart")).toBe("always");
    expect(doc).toContain("restarts forever");
  });

  it("'accented characters are converted' — the fold runs before encoding", () => {
    expect(agent).toContain("ascii_fold(body_text)");
    expect(doc).toContain("José");
  });

  it("'an absurdly long receipt is refused' — the guard exists", () => {
    expect(agent).toContain("MAX_RECEIPT_BYTES");
    expect(agent).toContain("if len(raw) > MAX_RECEIPT_BYTES:");
  });

  it("'complains once then goes quiet' — the log throttle exists", () => {
    expect(agent).toContain("self.consecutive_failures % 20 == 0");
  });

  it("'the Pi always calls out' — there is no inbound listener in the agent", () => {
    expect(agent).not.toContain("HTTPServer");
    expect(agent).not.toContain("socket.bind");
    expect(doc).toContain("no port forwarding");
  });

  it("PrivateDevices stays off or /dev/usb/lp0 would vanish", () => {
    // Verified empirically, not assumed: a unit with PrivateDevices=yes was
    // run and /dev listed. The private /dev has no usb/ directory and no lp*
    // node, so the printer device simply does not exist inside the sandbox
    // and every single receipt fails with "No printer found".
    //
    // Any truthy value is fatal, not just "yes" -- systemd accepts yes/true/
    // on/1 for booleans, so check the parsed directive, not a fixed string.
    const priv = directive("Service", "PrivateDevices");
    if (priv !== undefined) {
      expect(["no", "false", "off", "0"]).toContain(priv.toLowerCase());
    }
    // Same trap, same reason: this one also masks device nodes.
    const devPolicy = directive("Service", "DevicePolicy");
    if (devPolicy !== undefined) {
      expect(devPolicy.toLowerCase()).toBe("auto");
    }
    // The reason must stay written down, or a future hardening pass will
    // "helpfully" add PrivateDevices=yes and silently break every receipt.
    expect(unit).toContain("PrivateDevices is deliberately NOT set");
  });

  it("the unit parser used by these tests actually works", () => {
    // A parser-based test is only as trustworthy as the parser. This pins the
    // exact two behaviours the old substring checks got wrong: comments must
    // not be able to open a section, and comments must not be able to define
    // a directive.
    const parsed = parseUnit(
      [
        "[Unit]",
        "# this key belongs in [Unit], NOT [Service]",
        "StartLimitIntervalSec=0",
        "",
        "[Service]",
        "; PrivateDevices=yes would hide the printer",
        "Restart=always",
        "Restart=on-failure",
      ].join("\n"),
    );
    // The comment mentioning [Service] must NOT have ended the [Unit] section.
    expect(parsed.Unit?.startlimitintervalsec).toEqual(["0"]);
    // The commented-out directive must NOT have been recorded.
    expect(parsed.Service?.privatedevices).toBeUndefined();
    // Repeated single-value directives: systemd honours the last one.
    expect(parsed.Service?.restart).toEqual(["always", "on-failure"]);
    // And the real unit must have parsed into the sections we expect.
    expect(Object.keys(unitSections).sort()).toEqual([
      "Install",
      "Service",
      "Unit",
    ]);
  });
});

describe("the manual's troubleshooting quotes match the agent's real messages", () => {
  // If a message is reworded in the agent, the manual's quoted version becomes
  // unfindable and the reader concludes the manual is for a different version.
  const quotes = [
    "No printer found at",
    "is not allowed to write to it",
    "The website refused this Pi's printer token (401)",
    "Cannot reach the website",
  ];

  for (const quote of quotes) {
    it(`the agent really says: "${quote}"`, () => {
      expect(agent).toContain(quote);
    });
  }

  it("the manual quotes them so a reader can search the log", () => {
    for (const quote of quotes) {
      expect(doc).toContain(quote);
    }
  });

  it("the 503 message the manual quotes is the agent's actual wording", () => {
    expect(agent).toContain("refusing printer requests until a poll token is set");
    expect(doc).toContain("refusing printer requests until a poll token is set");
  });
});

describe("the manual is substantial enough to actually follow", () => {
  it("is a real walkthrough, not a stub", () => {
    expect(doc.length).toBeGreaterThan(6000);
  });

  it("covers the paper-upside-down trap", () => {
    expect(doc.toLowerCase()).toContain("shiny side");
  });

  it("explains why the Pi is needed at all", () => {
    expect(doc).toContain("Why there is a Raspberry Pi in the middle");
  });

  it("every script the manual tells the owner to run is executable", () => {
    // THE FIELD BUG THIS PINS
    // -----------------------
    // install.sh shipped as mode 100644. Running `sudo ./install.sh ...` then
    // fails with "sudo: ./install.sh: command not found" -- which reads like a
    // MISSING FILE, sending the reader off hunting for a bad clone or a wrong
    // directory. Reproduced deliberately: a non-executable script invoked via
    // sudo gives exactly that message, while bash gives "Permission denied".
    //
    // Anything the manual says to invoke as ./script must carry the exec bit
    // in git, or the first thing the owner types fails and misdirects them.
    const mustBeExecutable = [
      "pi-agent/install-printer.sh",
      "pi-agent/install.sh",
      "pi-agent/greenway_printer.py",
    ];
    for (const rel of mustBeExecutable) {
      // Read the mode git records, not the working tree: a fresh clone gets
      // git's mode, and the working tree can drift locally.
      const mode = execFileSync("git", ["ls-files", "-s", "--", rel], {
        cwd: ROOT,
        encoding: "utf8",
      })
        .trim()
        .split(/\s+/)[0];
      expect(mode, `${rel} must be executable in git (is ${mode})`).toBe(
        "100755",
      );
    }
  });

  it("the two installers refuse each other's options", () => {
    // Both scripts live in the same folder and take a --site, so it is very
    // easy to pick up the wrong one. Each must name the other by filename
    // rather than just saying "I don't understand".
    const announcer = read("pi-agent/install.sh");
    // The printer's flags must be trapped by the announcer, and vice versa.
    for (const flag of ["--token", "--device", "--columns"]) {
      expect(announcer).toContain(flag);
    }
    expect(announcer).toContain("install-printer.sh");
    for (const flag of ["--code", "--audio-device"]) {
      expect(installer).toContain(flag);
    }
    expect(installer).toContain("./install.sh");
    // The manual has to explain the split, or the guard is the only teacher.
    expect(doc).toContain("install-printer.sh");
    expect(doc).toContain("install.sh");
    expect(doc).toContain("command not found");
  });

  it("the installer verifies the download is not a gateway/CAPTCHA page", () => {
    // VERIFIED, NOT ASSUMED: the live domain answered HTTP 202 with an HTML
    // body containing a /.well-known/sgcaptcha/ redirect, and `curl -fsSL`
    // exited 0 on it -- because -f only fails on 4xx/5xx. Piping that into
    // an interpreter yields a syntax error that looks like a corrupt release.
    //
    // So the installer must check the STATUS CODE explicitly and sniff the
    // body for HTML, rather than trusting curl's exit status.
    expect(installer).toContain("%{http_code}");
    expect(installer).toMatch(/DL_CODE/);
    expect(installer).toMatch(/!= *"200"/);
    expect(installer).toMatch(/<html|doctype html/i);
    // And the agent must explain a 202 as a gateway, not as a token fault.
    expect(agent).toContain("security gateway");
    // The manual must warn which address to use.
    expect(doc).toMatch(/security gateway/i);
    expect(doc).toContain("202");
  });

  it("the manual names the right site and how to re-point later", () => {
    // The live domain is not the deployment target yet. If the manual does
    // not say so, the owner points the Pi at the WAF-protected domain and it
    // polls forever without ever printing.
    expect(doc).toContain("vercel.app");
    expect(doc).toContain("greenwaymarijuana.com");
    // The re-point command must be real: `pair` with a --site flag.
    expect(doc).toMatch(/greenway-printer pair .*--site/);
    expect(agent).toContain('"pair"');
  });

  it("the site-address typo hint is real and quotes the mistake back", () => {
    // The exact field typo: "https//host" (missing colon). A bare "I need the
    // website address" does not help, because the eye reads "https" and moves
    // on. The agent must echo what was typed and show the corrected form.
    expect(agent).toContain("The ':' is missing after 'https'");
    expect(agent).toContain("You typed:");
    // And the rejection itself must still happen (never silently accepted).
    expect(agent).toContain("normalize_site_url");
    expect(doc).toContain("https//");
  });

  it("the copy-paste quickstart quotes the program's REAL output", () => {
    // WHY THIS IS THE STRICTEST TEST IN THE FILE
    // ------------------------------------------
    // The quickstart tells a non-technical reader "you should see exactly
    // this". That is a promise. If the quoted output does not match the real
    // program, the reader concludes something is broken when it is not, or
    // worse, that it worked when it did not.
    //
    // Writing it, I got three lines wrong from memory and caught them only by
    // grepping the source: the status line is "OK - the website accepted this
    // Pi's token." (hyphen, not colon, and no word "printer"), the installer
    // says "Saving the settings" not "Saving your settings", and the boot
    // message says "The printer agent will now start automatically on boot."
    // These assertions make that class of mistake impossible to ship.

    // -- lines quoted from the agent -------------------------------------
    for (const line of [
      "OK - the website accepted this Pi's token.",
      "No receipts waiting (this is normal).",
    ]) {
      expect(agent, `agent must really print: ${line}`).toContain(line);
      expect(quickstart, `quickstart must quote: ${line}`).toContain(line);
    }

    // -- lines quoted from the installer ---------------------------------
    for (const line of [
      "Checking this Pi",
      "Installing the printer program",
      "The program passed its own self-check.",
      "Saving the settings",
      "Paired with the website.",
      "Setting up automatic start",
      "The printer agent will now start automatically on boot.",
      "The printer agent is running.",
      "Printing a test page",
      "Test page sent.",
    ]) {
      expect(installer, `installer must really print: ${line}`).toContain(line);
      expect(quickstart, `quickstart must quote: ${line}`).toContain(line);
    }

    // -- the error table must quote real messages ------------------------
    expect(agent).toContain("No printer found at");
    expect(quickstart).toContain("No printer found at /dev/usb/lp0");
    expect(installer).toContain("is an ANNOUNCER option");
    expect(quickstart).toContain("is an ANNOUNCER option");
    expect(agent).toContain("The ':' is missing after 'https'");
    expect(quickstart).toContain("The ':' is missing after 'https'");
  });

  it("the quickstart's commands, flags and paths are all real", () => {
    // Every command the reader is told to paste must exist. A single wrong
    // flag stops a non-technical reader dead.
    for (const sub of ["status", "test", "pair"]) {
      expect(quickstart).toContain(`greenway-printer ${sub}`);
      expect(agent).toContain(`"${sub}"`);
    }
    // The install command must use the printer script and the printer's flag.
    expect(quickstart).toContain(
      "sudo ./install-printer.sh --site https://greenwaywebsite1.vercel.app --token",
    );
    // --columns and --uninstall are quoted as real options.
    expect(installer).toContain("--columns");
    expect(installer).toContain("--uninstall");
    expect(quickstart).toContain("--columns 32");
    expect(quickstart).toContain("--uninstall");
    // The service name used in systemctl/journalctl must match the unit.
    expect(quickstart).toContain("systemctl status greenway-printer");
    expect(quickstart).toContain("journalctl -u greenway-printer");
    expect(existsSync(join(ROOT, UNIT_PATH))).toBe(true);
    // Paths quoted to the reader must be the ones the code uses.
    expect(agent).toContain("/etc/greenway-printer/config.json");
    expect(quickstart).toContain("/etc/greenway-printer/config.json");
    expect(installer).toContain("/usr/local/bin/greenway-printer");
    expect(quickstart).toContain("/usr/local/bin/greenway-printer");
    // The admin URL must be the tab the panel actually lives on.
    expect(quickstart).toContain("/admin/equipment?tab=printer");
  });

  it("the quickstart's button labels match the admin UI", () => {
    // The reader is told to click a button by name. If the label changes and
    // the doc does not, they hunt for a button that is not there.
    const panel = read(
      "src/components/admin/equipment/ReceiptPrinterPanel.tsx",
    );
    for (const label of ["Generate token", "Rotate token", "Send test print"]) {
      expect(panel, `UI must have the button: ${label}`).toContain(label);
      expect(quickstart, `quickstart must name: ${label}`).toContain(label);
    }
    // The "not set" placeholder the reader is told to look for.
    expect(panel).toContain("not set");
    expect(quickstart).toContain("— not set —");
    // Auto-print is named as a checkbox on that page.
    expect(panel).toContain("Auto-print online orders");
    expect(quickstart).toContain("Auto-print online orders");
  });

  it("the quickstart states the token length the server really generates", () => {
    // It tells the reader to expect 36 characters, so they can sanity-check
    // their copy/paste. randomBytes(18).toString("hex") => 36 chars.
    const actions = read("src/app/admin/equipment/printer-actions.ts");
    const match = /randomBytes\((\d+)\)\.toString\("hex"\)/.exec(actions);
    expect(match, "token generation must be randomBytes(N).toString('hex')")
      .not.toBeNull();
    const hexChars = Number(match![1]) * 2;
    expect(hexChars).toBe(36);

    // The length is stated TWICE (prose, and the sample status output), so a
    // toContain() check passes even when one of them is wrong -- proven by
    // mutating one occurrence and watching this test stay green. Assert on
    // EVERY "N characters" claim about the token instead.
    //
    // Excluded: "48 characters per line", which is paper width, not the token.
    const claims = [...quickstart.matchAll(/\((\d+) characters\)/g)].map((m) =>
      Number(m[1]),
    );
    const proseClaims = [
      ...quickstart.matchAll(/It is (\d+) characters of letters and numbers/g),
    ].map((m) => Number(m[1]));

    const allClaims = [...claims, ...proseClaims];
    expect(
      allClaims.length,
      "the quickstart must state the token length at least twice",
    ).toBeGreaterThanOrEqual(2);
    for (const claimed of allClaims) {
      expect(claimed, `every stated token length must be ${hexChars}`).toBe(
        hexChars,
      );
    }
  });

  it("the quickstart warns about the live domain and the gateway", () => {
    // The single most expensive mistake available to the reader: pointing the
    // Pi at the WAF-protected live domain, where it polls forever in silence.
    expect(quickstart).toContain("greenwaywebsite1.vercel.app");
    expect(quickstart).toContain("greenwaymarijuana.com");
    expect(quickstart).toMatch(/security gateway/i);
    expect(quickstart).toContain("202");
    // And it must give the one-line fix for after the cutover.
    expect(quickstart).toMatch(
      /greenway-printer pair .*--site https:\/\/greenwaymarijuana\.com/,
    );
    // The 503 it quotes must be the server's real wording.
    const route = read("src/app/api/cloudprnt/route.ts");
    expect(route).toContain("printer poll token not configured");
    expect(quickstart).toContain("printer poll token not configured");
  });

  it("the quickstart covers the traps that cost the most time", () => {
    // Each of these was either hit for real or is a known thermal-printer
    // trap. They must stay documented.
    expect(quickstart).toContain("command not found"); // sudo's misleading msg
    expect(quickstart).toContain("shiny side"); // paper upside down
    expect(quickstart).toContain("git pull"); // stale clone
    expect(quickstart).toContain("ssh greenway-office@greenway-office.local");
    // Nothing appears when typing a password -- the classic panic moment.
    expect(quickstart).toMatch(/Nothing appears as you type/i);
    // The two-installer confusion that actually happened.
    expect(quickstart).toContain("install-printer.sh");
    expect(quickstart).toContain("install.sh");
    // Numbered steps, so "step 7" means something over the phone.
    expect(quickstart).toMatch(/### Step 1 /);
    expect(quickstart).toMatch(/### Step 12 /);
    // Substantial enough to actually hold a hand.
    expect(quickstart.length).toBeGreaterThan(6000);
  });

  it("the test commands the manual lists actually exist and behave", () => {
    // The manual now tells a future maintainer to run a specific runner with
    // a specific flag. If either drifts, the first thing they try fails and
    // they conclude the whole document is stale.
    const runner = "pi-agent/tests/run-all-printer.sh";
    expect(existsSync(join(ROOT, runner))).toBe(true);
    expect(doc).toContain("bash pi-agent/tests/run-all-printer.sh");
    expect(doc).toContain("sudo bash pi-agent/tests/run-all-printer.sh --full");

    const runnerText = read(runner);
    // --full must be a real flag, not something the manual invented.
    expect(runnerText).toContain('--full');
    // Every stage the manual promises must really be invoked by the runner.
    for (const stage of [
      "greenway_printer.py",
      "test_printer_e2e.py",
      "mutation-printer.sh",
      "mutation-printer-docs.sh",
      "test_install_printer_systemd.sh",
    ]) {
      expect(runnerText).toContain(stage);
    }
    // Each referenced test file must exist.
    for (const f of [
      "pi-agent/tests/test_printer_e2e.py",
      "pi-agent/tests/mutation-printer.sh",
      "pi-agent/tests/test_install_printer_systemd.sh",
      "scripts/recon/mutation-printer-docs.sh",
    ]) {
      expect(existsSync(join(ROOT, f))).toBe(true);
    }
    // The manual claims --full refuses to run over a real install. That
    // safeguard has to be in the installer test, or the claim is a lie that
    // could cost somebody a working shop Pi.
    const instTest = read("pi-agent/tests/test_install_printer_systemd.sh");
    expect(instTest).toContain("/etc/greenway-printer");
    expect(doc).toContain("refuses to run if a real printer install already");
  });

  it("tells the owner what to do if they later buy a CloudPRNT printer", () => {
    expect(doc).toContain("/api/cloudprnt");
  });
});
