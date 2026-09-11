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
    const unitSection = unit.slice(
      unit.indexOf("[Unit]"),
      unit.indexOf("[Service]"),
    );
    expect(unitSection).toContain("StartLimitIntervalSec=0");
    expect(unitSection).toContain("StartLimitBurst=0");
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
    expect(unit).not.toContain("PrivateDevices=yes");
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

  it("tells the owner what to do if they later buy a CloudPRNT printer", () => {
    expect(doc).toContain("/api/cloudprnt");
  });
});
