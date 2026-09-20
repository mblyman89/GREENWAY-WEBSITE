/**
 * The back-office setup guide must stay true to the software it describes.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The owner asked for the speaker instructions to live in the back office
 * rather than in files he cannot reach:
 *
 *   "will you make sure the instructions for doing everything is included in
 *    the back office so I dont need to search everywhere to find the steps."
 *
 * Putting instructions on screen creates a new failure mode. Documentation in
 * a repository that goes stale is embarrassing. Documentation on the Orders
 * page that goes stale actively misleads the person holding the Raspberry Pi:
 * they will trust it, type what it says, and be sent somewhere the software no
 * longer goes.
 *
 * The *wording* of the guide is already covered by 53 self-checks inside
 * announcer-setup-core.ts and a mutation round in
 * scripts/compliance/mutation-announcer-setup-guide.sh. What THIS file pins is
 * the two things those cannot see:
 *
 *   1. The guide is actually RENDERED, wired to real values, on the real page.
 *      A perfectly-worded guide no component mounts is the same as no guide.
 *   2. Every command it tells him to run is a command the software really
 *      accepts, checked against install.sh and greenway_announcer.py as they
 *      exist on disk right now.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SETUP_CHEAT_SHEET,
  SETUP_HARDWARE,
  buildSetupGuide,
} from "@/lib/announcer/announcer-setup-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const PANEL_PATH = "src/components/admin/orders/AnnouncerPanel.tsx";
const GUIDE_PATH = "src/components/admin/orders/AnnouncerSetupGuide.tsx";
const COPY_PATH = "src/components/admin/orders/CopyCommandButton.tsx";

const panel = read(PANEL_PATH);
const guide = read(GUIDE_PATH);
const copyBtn = read(COPY_PATH);
const installer = read("pi-agent/install.sh");
const agent = read("pi-agent/greenway_announcer.py");

const SITE = "https://greenwaywebsite1.vercel.app";
const built = buildSetupGuide({ siteUrl: SITE, pairingCode: "28C6P3UU", hasPairedSpeaker: false });
const allCommands = [
  ...built.flatMap((s) => s.steps.flatMap((st) => st.commands.map((c) => c.command))),
  ...SETUP_CHEAT_SHEET.map((c) => c.command),
];

describe("the guide is actually on the Online Orders page", () => {
  it("is mounted by the Announcer panel", () => {
    // The owner said "it should be in the online orders in the back office".
    // AnnouncerPanel is rendered by src/app/admin/orders/page.tsx.
    // Anchored with \b on purpose. A bare toContain("AnnouncerSetupGuide")
    // also matches "AnnouncerSetupGuideXX" and any other near-miss, so it
    // would keep passing while the real component was unmounted. Verified by
    // renaming the tag and confirming this test turns red.
    expect(panel).toMatch(/import \{ AnnouncerSetupGuide \} from/);
    expect(panel).toMatch(/<AnnouncerSetupGuide\b[\s\S]{0,400}?\/>/);
    expect(panel).not.toMatch(/<AnnouncerSetupGuide[A-Za-z0-9_]/);
  });

  it("is fed the real site address, not a hardcoded one", () => {
    // announcerSiteUrl() reads the deployment's own address. Hardcoding it
    // here is how the guide would start naming the wrong website after a
    // domain change, while still looking perfectly confident.
    expect(panel).toMatch(/siteUrl=\{announcerSiteUrl\(\)\}/);
  });

  it("is told whether a speaker is already paired", () => {
    // This is the input that decides whether he is told to pass --code or
    // told to leave his existing speaker alone. If it were hardcoded, the
    // "should I delete it and try again?" question would get a wrong answer.
    expect(panel).toMatch(/hasPairedSpeaker=\{devices\.length > 0\}/);
  });

  it("passes a real pairing code or none at all", () => {
    expect(panel).toMatch(/pairingCode=\{pendingPairings\[0\]\?\.raw \?\? null\}/);
  });

  it("appears above the speaker cards, where it will be found", () => {
    // Ordering matters: a guide buried under everything else is a guide he
    // has to search for, which is the exact complaint that prompted it.
    const mountedAt = panel.search(/<AnnouncerSetupGuide\s/);
    const cardsAt = panel.indexOf("2. ONE CARD PER ROOM");
    expect(mountedAt).toBeGreaterThan(-1);
    expect(cardsAt).toBeGreaterThan(-1);
    expect(mountedAt).toBeLessThan(cardsAt);
  });
});

describe("the guide renders every part of the data", () => {
  it("renders the steps, the shopping list and the cheat sheet", () => {
    // If a section of the data stops being rendered, the self-tests would
    // still pass -- they only check the data. This checks it reaches a screen.
    expect(guide).toContain("buildSetupGuide");
    expect(guide).toContain("SETUP_HARDWARE");
    expect(guide).toContain("SETUP_CHEAT_SHEET");
  });

  it("shows what to expect and what to do when it goes wrong", () => {
    expect(guide).toContain("step.expect");
    expect(guide).toContain("step.ifItGoesWrong");
  });

  it("shows the purpose of every command, not just the command", () => {
    expect(guide).toContain("entry.purpose");
  });

  it("stays a server component", () => {
    // It takes no input and holds no state. Shipping it to the browser would
    // be waste, and the surrounding panel is a server component.
    expect(guide.startsWith('"use client"')).toBe(false);
  });
});

describe("commands can be copied without being retyped", () => {
  it("every command has a copy button", () => {
    // Must be RENDERED, not merely imported. Checking for the bare name also
    // matches the import statement, so the assertion kept passing when the
    // button was deleted from the markup. Verified by removing it.
    expect(guide).toMatch(/<CopyCommandButton\s+command=\{entry\.command\}\s*\/>/);
    expect(copyBtn.startsWith('"use client"')).toBe(true);
    expect(copyBtn).toContain("navigator.clipboard.writeText");
  });

  it("the command text is still on screen if the clipboard is blocked", () => {
    // A copy button that fails silently leaves an empty clipboard and a
    // person pasting nothing into a terminal. The text must remain readable
    // and the failure must be visible.
    expect(guide).toContain("{entry.command}");
    expect(copyBtn).toContain("failed");
  });

  it("does not visually truncate a command", () => {
    // Half a copied command is worse than none: it runs, and does something
    // other than what was intended.
    expect(guide).toContain("break-all");
    // Checked against className attributes only. A blunt substring search also
    // matches the source comment that explains WHY truncation is avoided,
    // which would fail on the presence of the reasoning rather than the bug.
    const classNames = [...guide.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    expect(classNames.length).toBeGreaterThan(5);
    for (const cls of classNames) {
      expect(cls, "a command must never be visually truncated").not.toContain("truncate");
    }
  });
});

describe("no command sends him somewhere the software will not go", () => {
  it("never contains a placeholder he would have to edit first", () => {
    // This is the whole point. A command with YOUR-SITE in it fails a minute
    // later with an error that reads like broken hardware.
    const placeholders = ["YOUR-SITE", "YOUR-CODE", "XXXX", "example.com", "your-site", "<"];
    for (const cmd of allCommands) {
      for (const bad of placeholders) {
        expect(cmd, `command must be copyable as-is: ${cmd}`).not.toContain(bad);
      }
    }
  });

  it("only uses installer flags the installer actually parses", () => {
    for (const cmd of allCommands.filter((c) => c.includes("install.sh"))) {
      for (const flag of cmd.match(/--[a-z-]+/g) ?? []) {
        expect(installer, `install.sh must accept ${flag}`).toContain(flag);
      }
    }
  });

  it("only uses agent subcommands the agent actually has", () => {
    // greenway-announcer subcommands are registered as argparse parsers.
    const known = [...agent.matchAll(/add_parser\(\s*"([a-z][a-z-]*)"/g)].map((m) => m[1]);
    expect(known.length).toBeGreaterThan(3);
    for (const cmd of allCommands) {
      const m = cmd.match(/greenway-announcer ([a-z][a-z-]*)/);
      if (m) {
        expect(known, `the agent must have a "${m[1]}" subcommand`).toContain(m[1]);
      }
    }
  });

  it("only names systemd units the installer really creates", () => {
    for (const cmd of allCommands) {
      for (const m of cmd.matchAll(/systemctl \w+ ([a-z-]+)/g)) {
        expect(installer, `install.sh must create the ${m[1]} unit`).toContain(m[1]);
      }
    }
  });

  it("only points at helper programs the installer really writes", () => {
    for (const cmd of allCommands) {
      for (const m of cmd.matchAll(/(\/usr\/local\/bin\/[a-z-]+)/g)) {
        expect(installer, `install.sh must create ${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe("it answers the question he actually asked", () => {
  it("tells an already-paired shop NOT to delete the speaker", () => {
    // Verbatim: "the speaker is already created there. should I delete it and
    // try again?" The answer is no, and it must be on screen, because
    // install.sh run without --code keeps the existing pairing.
    const paired = buildSetupGuide({ siteUrl: SITE, pairingCode: null, hasPairedSpeaker: true });
    const text = JSON.stringify(paired);
    expect(text).toContain("Already paired - keeping the existing setup");
    expect(installer).toContain("Already paired - keeping the existing setup");
    // The warning is rendered by the guide component, which the panel mounts.
    expect(guide).toContain("Do NOT delete it");
  });

  it("explains the Pi appearing to turn itself off, both causes", () => {
    // Verbatim: "I feel like the pi keeps turning itself off". That sentence
    // covers two unrelated faults with opposite fixes, so the guide must not
    // pick one and hope.
    const text = JSON.stringify(built);
    expect(text).toContain("power supply");
    expect(text.toLowerCase()).toContain("power saving");
    expect(text).toContain("Up for:");
  });

  it("flags the two parts that cause most dead Pis", () => {
    const critical = SETUP_HARDWARE.filter((h) => h.critical).map((h) => h.item.toLowerCase());
    expect(critical.some((i) => i.includes("power supply"))).toBe(true);
    expect(critical.some((i) => i.includes("microsd"))).toBe(true);
    expect(guide).toContain("Must be right");
  });
});

describe("the installer does not cry wolf", () => {
  // FIELD-REPORTED. A real install on the shop's Pi finished with every step
  // reporting OK, but printed this in the middle of it:
  //
  //   bash: line 500: /sys/module/kernel/parameters/consoleblank: Permission denied
  //
  // Nothing was broken -- turning off screen blanking is cosmetic -- but the
  // owner stopped and asked whether the install had actually worked. That is
  // the real cost: an installer that prints scary errors during a successful
  // run teaches people to ignore its output, and then they ignore a real one.

  it("suppresses stderr BEFORE the redirection, not after", () => {
    // The subtlety that caused the bug: when a REDIRECTION fails, the shell
    // prints the error itself before the command ever runs, so a trailing
    // `2>/dev/null` has not taken effect yet and cannot suppress it. The
    // redirect must come first. Verified empirically against an unwritable
    // path -- `echo 0 > p 2>/dev/null` leaks, `echo 0 2>/dev/null > p` does not.
    const line = installer
      .split("\n")
      .find((l) => l.includes("consoleblank") && l.trim().startsWith("echo"));
    expect(line, "installer must still write consoleblank").toBeTruthy();
    expect(line!).toMatch(/echo 0 2>\/dev\/null > \/sys\/module\/kernel\/parameters\/consoleblank/);
    // The broken form must not come back.
    expect(line!).not.toMatch(/consoleblank 2>\/dev\/null/);
  });

  it("never lets an optional cosmetic step abort the install", () => {
    // `set -e` plus a failing write would end the run at step 7 of 8, with the
    // service installed but the user told nothing. `|| true` keeps it advisory.
    const line = installer
      .split("\n")
      .find((l) => l.includes("consoleblank") && l.trim().startsWith("echo"));
    expect(line!).toMatch(/\|\| true\s*$/);
  });
});
