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

const doc = read(WALKTHROUGH_PATH);
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
