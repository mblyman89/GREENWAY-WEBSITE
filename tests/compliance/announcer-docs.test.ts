/**
 * tests/compliance/announcer-docs.test.ts
 *
 * SLICE 33 — the manuals must stay true.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * While writing the field manual I checked every claim against the source and
 * found a real one that was already wrong and already shipped: install.sh told
 * the owner that pairing codes "expire after 15 minutes", but
 * PAIRING_TTL_MINUTES is 60. Nobody would have noticed until someone threw
 * away a perfectly good code and re-did the pairing for no reason.
 *
 * Documentation rots silently. Code has tests; prose usually doesn't. These
 * tests give the prose the same protection: if someone changes a constant, a
 * command name, or a file path, the manual that mentions it fails the build
 * instead of quietly becoming a lie.
 *
 * These are deliberately cheap string checks. They are not trying to prove the
 * manual is well written — only that the FACTS in it still match the code.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILT_IN_SOUNDS, PAIRING_TTL_MINUTES } from "@/lib/announcer/announcer-core";
import { MAX_SOUND_BYTES } from "@/lib/announcer/announcer-sounds-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MANUAL_PATH = "docs/announcer/10-field-manual.md";
const BUY_PATH = "docs/announcer/20-what-to-buy.md";
const CARD_PATH = "docs/announcer/30-wall-card.md";
const INSTALLER_PATH = "pi-agent/install.sh";
const AGENT_PATH = "pi-agent/greenway_announcer.py";
const UNIT_PATH = "pi-agent/systemd/greenway-announcer.service";

const manual = read(MANUAL_PATH);
const buy = read(BUY_PATH);
const card = read(CARD_PATH);
const installer = read(INSTALLER_PATH);
const agent = read(AGENT_PATH);
const unit = read(UNIT_PATH);

describe("the manual the installer promises actually exists", () => {
  it("install.sh points at a file that is present", () => {
    expect(installer).toContain(MANUAL_PATH);
    expect(manual.length).toBeGreaterThan(2000);
  });

  it("the systemd unit's Documentation link points at the same file", () => {
    const doc = unit.split("\n").find((l) => l.startsWith("Documentation="));
    expect(doc, "the unit must carry a Documentation= line").toBeTruthy();
    expect(doc).toContain(MANUAL_PATH);
  });
});

describe("pairing code lifetime is stated consistently", () => {
  it("the manual quotes the real TTL", () => {
    expect(manual).toContain(`${PAIRING_TTL_MINUTES} minutes`);
  });

  it("the installer quotes the real TTL", () => {
    expect(installer).toContain(`${PAIRING_TTL_MINUTES} minutes`);
  });

  it("nothing still claims the old wrong 15-minute figure", () => {
    // The exact bug this file was written to prevent.
    for (const [name, text] of [
      ["manual", manual],
      ["installer", installer],
      ["wall card", card],
    ] as const) {
      expect(/expires? (in|after) 15 minutes/i.test(text), `${name} states a stale TTL`).toBe(false);
    }
  });
});

describe("every command the manual tells you to run really exists", () => {
  const documented = ["status", "test", "selftest", "pair", "run"];

  it.each(documented)("greenway-announcer %s is a real subcommand", (cmd) => {
    expect(agent).toContain(`add_parser("${cmd}"`);
  });

  it("the manual only teaches subcommands that exist", () => {
    const used = new Set(
      [...manual.matchAll(/greenway-announcer ([a-z]+)/g)].map((m) => m[1]),
    );
    for (const cmd of used) {
      expect(documented, `the manual mentions "greenway-announcer ${cmd}"`).toContain(cmd);
    }
  });

  it("the wall card only teaches subcommands that exist", () => {
    const used = new Set([...card.matchAll(/greenway-announcer ([a-z]+)/g)].map((m) => m[1]));
    for (const cmd of used) {
      expect(documented, `the wall card mentions "greenway-announcer ${cmd}"`).toContain(cmd);
    }
  });
});

describe("every file path the manual sends you to is a real path", () => {
  const paths = [
    "/usr/local/bin/greenway-announcer",
    "/etc/greenway-announcer/config.json",
    "/var/lib/greenway-announcer/sounds",
    "/etc/systemd/system/greenway-announcer.service",
  ];

  it.each(paths)("%s is used by the installer or the agent", (p) => {
    expect(manual, "the manual should document this path").toContain(p);
    expect(installer.includes(p) || agent.includes(p)).toBe(true);
  });
});

describe("the reliability promises in Appendix B are real settings", () => {
  it("'restarts itself after 5 seconds' matches the unit", () => {
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("RestartSec=5");
    expect(manual).toContain("5 seconds");
  });

  it("'will not give up' matches StartLimitBurst=0 in [Unit]", () => {
    // The bug that would otherwise leave a speaker dead all weekend: systemd
    // ignores these keys in [Service], so they must sit above [Service].
    // Find the real [Service] header at the start of a line. The unit has a
    // comment that mentions "[Service]" in prose, and naive indexOf finds that
    // comment first -- which made this test pass a file that was actually fine
    // for the wrong reason. Parse sections properly instead.
    const lines = unit.split("\n");
    const serviceAt = lines.findIndex((l) => l.trim() === "[Service]");
    expect(serviceAt, "the unit must have a [Service] section").toBeGreaterThan(0);
    const unitSection = lines
      .slice(0, serviceAt)
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(unitSection).toContain("StartLimitBurst=0");
    expect(unitSection).toContain("StartLimitIntervalSec=0");
  });

  it("'memory capped at 256 MB' matches the unit", () => {
    expect(unit).toContain("MemoryMax=256M");
    expect(manual).toContain("256 MB");
  });

  it("'logs capped at 50 MB' matches the installer", () => {
    expect(installer).toContain("50M");
    expect(manual).toContain("50 MB");
  });

  it("'remembers the last 500 jobs' matches the agent", () => {
    expect(agent).toContain("PLAYED_MEMORY = 500");
    expect(manual).toContain("500 jobs");
  });

  it("the documented retry backoff matches the agent exactly", () => {
    expect(agent).toContain("POLL_BACKOFF_SECONDS = [1, 2, 5, 10, 20, 30]");
    expect(manual).toContain("1, 2, 5, 10, 20, 30");
  });
});

describe("the sound library facts match the code", () => {
  it("the manual and buy list agree on the 5 MB upload limit", () => {
    expect(MAX_SOUND_BYTES).toBe(5 * 1024 * 1024);
    expect(manual.includes("5 MB") || buy.includes("5 MB")).toBe(true);
  });

  it("the manual promises the same six built-in sounds the agent ships", () => {
    expect(BUILT_IN_SOUNDS.length).toBe(6);
    expect(manual).toMatch(/six built-in sounds/i);
    for (const s of BUILT_IN_SOUNDS) {
      expect(agent, `the agent must be able to synthesise "${s.id}"`).toContain(`"${s.id}"`);
    }
  });
});

describe("the buying guide does not contradict the hardware", () => {
  it("steers to the Pi 4 because the Pi 5 has no analog jack", () => {
    expect(buy).toMatch(/Pi 4 Model B/);
    expect(buy).toMatch(/3\.5 mm/);
    expect(buy).toMatch(/Pi 5/);
  });

  it("names a total budget so it is usable as a shopping list", () => {
    expect(buy).toMatch(/\$\d/);
  });

  it("the wall card stays short enough to actually be a wall card", () => {
    expect(card.split("\n").length).toBeLessThan(120);
  });
});

describe("the tone rules that make these usable under pressure", () => {
  it("the wall card leads with the most common fix, not the cleverest", () => {
    const speakerAt = card.indexOf("VOLUME KNOB");
    const sshAt = card.indexOf("journalctl");
    expect(speakerAt).toBeGreaterThan(-1);
    expect(speakerAt).toBeLessThan(sshAt);
  });

  it("both documents say a silent speaker does not affect an order", () => {
    expect(manual).toMatch(/does not affect|Nothing about a silent speaker/i);
    expect(card).toMatch(/does NOT affect/i);
  });
});
