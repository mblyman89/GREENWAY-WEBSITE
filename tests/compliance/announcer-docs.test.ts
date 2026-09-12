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

// ═════════════════════════════════════════════════════════════════════════════
// THE COPY-PASTE QUICKSTART
//
// This document exists because the owner asked to be walked through setting up
// the speaker one step at a time. It quotes the installer's and the agent's
// on-screen output verbatim, and it quotes the admin panel's button labels, so
// that the reader can compare what they see against the page.
//
// Quoted output is a liability unless it is pinned. Three of the lines quoted
// in the equivalent PRINTER quickstart were wrong when first drafted -- written
// from memory rather than read from the source -- and only grepping the source
// caught them. Every assertion below reads the real string out of the real file
// and demands the document still contains it. Change the software and this
// fails, instead of the owner following a manual that lies.
// ═════════════════════════════════════════════════════════════════════════════

const QUICKSTART_PATH = "docs/announcer/06-copy-paste-quickstart.md";
const quickstart = read(QUICKSTART_PATH);
/**
 * The same prose, with Markdown's line wrapping and blockquote markers taken
 * out, so a sentence quoted from the UI can be compared as one sentence. A
 * quoted string is still a quoted string when the editor has wrapped it across
 * two lines with a "> " in front.
 */
const quickstartFlat = quickstart
  .split("\n")
  .map((line) => line.replace(/^\s*>\s?/, ""))
  .join(" ")
  .replace(/\s+/g, " ");
const panel = read("src/components/admin/orders/AnnouncerPanel.tsx");
const adminCore = read("src/lib/announcer/announcer-admin-core.ts");
const core = read("src/lib/announcer/announcer-core.ts");

describe("quickstart: the installer's seven steps are quoted exactly", () => {
  it("quotes every step banner the installer actually prints", () => {
    // Pull the step banners straight out of install.sh. If a step is renamed,
    // added or removed, the document must follow.
    const steps = [...installer.matchAll(/step "(Step \d of \d: [^"]+)"/g)].map((m) => m[1]);
    expect(steps.length).toBe(7);
    for (const step of steps) {
      expect(quickstart, `quickstart must quote the banner "${step}"`).toContain(step);
    }
  });

  it("quotes the installer's opening two lines", () => {
    expect(installer).toContain("Greenway Order Announcer - installer");
    expect(installer).toContain("This takes about two minutes. You can leave it running.");
    expect(quickstart).toContain("Greenway Order Announcer - installer");
    expect(quickstart).toContain("This takes about two minutes. You can leave it running.");
  });

  it("quotes the finish line the reader is told to look for", () => {
    expect(installer).toContain("================ DONE ================");
    expect(installer).toContain("Your speaker is installed and running.");
    expect(quickstart).toContain("================ DONE ================");
    expect(quickstart).toContain("Your speaker is installed and running.");
  });

  it("quotes OK lines that really are printed by the installer", () => {
    for (const line of [
      "Sound tools and Python libraries are ready",
      "Built-in self-test passed",
      "This speaker is paired",
      "Service installed, enabled at boot, and started",
      "Log size capped at 50MB to protect the SD card",
      "The announcer is running right now",
    ]) {
      expect(installer, `install.sh must print "${line}"`).toContain(line);
      expect(quickstart, `quickstart must quote "${line}"`).toContain(line);
    }
  });

  it("quotes the 'already paired' line used in the update section", () => {
    expect(installer).toContain("Already paired - keeping the existing setup");
    expect(quickstart).toContain("Already paired - keeping the existing setup");
  });

  it("quotes the uninstall confirmation", () => {
    expect(installer).toContain("Removed the service, the program and the cached sounds.");
    expect(quickstart).toContain("Removed the service, the program and the cached sounds.");
    expect(installer).toContain("--uninstall");
    expect(quickstart).toContain("sudo ./install.sh --uninstall");
  });
});

describe("quickstart: the agent's output is quoted exactly", () => {
  it("quotes the 'greenway-announcer test' header and its promise of six tones", () => {
    expect(agent).toContain("Playing each built-in sound. You should hear six different tones.");
    expect(quickstart).toContain("Playing each built-in sound. You should hear six different tones.");
  });

  it("lists exactly the six sound names the test command plays, in order", () => {
    const expected = ["chime", "bell", "ding", "alert", "cash", "voice"];

    // The set is defined exactly once, so the command and its selftest cannot
    // drift apart. (They previously did: a refactor split the list in two and
    // dropped "chime" from one half.)
    const constant = agent.match(/BUILTIN_SOUND_ORDER = \(([^)]*)\)/);
    expect(constant, "the built-in sounds must be defined in one named constant").toBeTruthy();
    expect(
      [...constant![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]),
      "BUILTIN_SOUND_ORDER must be exactly the six sounds, in order",
    ).toEqual(expected);

    // And nothing may re-declare its own list of sounds behind its back.
    const tuples = [...agent.matchAll(/for kind in \(([^)]*)\):/g)].map((m) => m[1]);
    for (const tuple of tuples) {
      const names = [...tuple.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
      expect(
        names,
        "a hard-coded sound list has reappeared; use BUILTIN_SOUND_ORDER instead",
      ).toEqual([]);
    }

    // Every loop over the sounds must come from the constant.
    const loops = [...agent.matchAll(/for kind in ([^\n:]+):/g)].map((m) => m[1].trim());
    expect(loops.length).toBeGreaterThanOrEqual(2);
    for (const loop of loops) {
      expect(loop, `"for kind in ${loop}" must iterate BUILTIN_SOUND_ORDER`).toContain(
        "BUILTIN_SOUND_ORDER",
      );
    }
    // The document shows them as a column of results, one per line.
    const shown = ["chime", "bell", "ding", "alert", "cash", "voice"].map((k) =>
      quickstart.indexOf(`  ${k}`),
    );
    for (const [i, at] of shown.entries()) {
      expect(at, `quickstart must show the ${i + 1}th sound`).toBeGreaterThan(-1);
    }
    // ...and in the same order the agent plays them.
    expect([...shown].sort((a, b) => a - b)).toEqual(shown);
  });

  it("quotes the test command's success line", () => {
    expect(agent).toContain("All six sounds played. The audio hardware on this Pi is working.");
    expect(quickstart).toContain("All six sounds played. The audio hardware on this Pi is working.");
  });

  it("quotes the status command's success lines", () => {
    for (const line of [
      "OK. The website answered and this speaker is checked in.",
      "It should show a green dot on the Orders page right now.",
    ]) {
      expect(agent, `agent must print "${line}"`).toContain(line);
      expect(quickstart, `quickstart must quote "${line}"`).toContain(line);
    }
  });

  it("quotes the NOT PAIRED failure with the real config path", () => {
    expect(agent).toContain("NOT PAIRED. No config at");
    expect(agent).toContain('Path("/etc/greenway-announcer/config.json")');
    expect(quickstart).toContain("NOT PAIRED. No config at /etc/greenway-announcer/config.json");
  });

  it("quotes the 401 message that tells you to re-pair", () => {
    expect(agent).toContain("The website rejected this speaker's key (401).");
    expect(quickstart).toContain("The website rejected this speaker's key (401).");
  });

  it("names the mute-check tools the agent's own advice names", () => {
    expect(agent).toContain("aplay -l");
    expect(agent).toContain("alsamixer");
    expect(agent).toContain("MM means muted");
    expect(quickstart).toContain("aplay -l");
    expect(quickstart).toContain("alsamixer");
    expect(quickstart).toMatch(/MM.{0,40}mute/i);
  });
});

describe("quickstart: every command it tells you to run is real", () => {
  it("only uses subcommands the agent's parser actually defines", () => {
    const subcommands = [...quickstart.matchAll(/greenway-announcer (\w[\w-]*)/g)]
      .map((m) => m[1])
      .filter((w) => !["pair"].includes(w));
    expect(subcommands.length).toBeGreaterThan(0);
    for (const sub of new Set(subcommands)) {
      expect(
        agent,
        `greenway-announcer ${sub} is in the quickstart but not in the agent's parser`,
      ).toContain(`add_parser("${sub}"`);
    }
  });

  it("uses the flags the installer really accepts, and no invented ones", () => {
    const flags = new Set(
      [...quickstart.matchAll(/sudo \.\/install\.sh([^\n`]*)/g)]
        .flatMap((m) => [...m[1].matchAll(/--[a-z-]+/g)])
        .map((m) => m[0]),
    );
    expect(flags.size).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(installer, `install.sh must accept ${flag}`).toContain(`${flag})`);
    }
  });

  it("uses the audio flags with the exact example value the code documents", () => {
    expect(installer).toContain('--audio-device DEV  ALSA device, e.g. "plughw:1,0"');
    expect(quickstart).toContain("--audio-device plughw:1,0");
    expect(installer).toContain('--mixer-control C   ALSA mixer name, e.g. "PCM"');
    expect(quickstart).toContain("--mixer-control PCM");
  });

  it("only passes flags to 'greenway-announcer' that its subcommands define", () => {
    // The installer and the agent take different flags. A mutant renamed
    // --audio-device to --sound-device on an AGENT line and survived, because
    // the installer line still carried the right spelling. Check both callers.
    const calls = [...quickstart.matchAll(/greenway-announcer (\w[\w-]*)([^\n`#]*)/g)];
    const checked: string[] = [];
    for (const call of calls) {
      const flags = [...call[2].matchAll(/--[a-z-]+/g)].map((m) => m[0]);
      for (const flag of flags) {
        checked.push(flag);
        expect(
          agent,
          `'greenway-announcer ${call[1]} ${flag}' is in the quickstart but the agent has no ${flag}`,
        ).toContain(`add_argument("${flag}"`);
      }
    }
    expect(checked.length, "expected the quickstart to demonstrate an agent flag").toBeGreaterThan(0);
  });

  it("names the systemd unit exactly as the installer registers it", () => {
    expect(installer).toContain("greenway-announcer.service");
    expect(quickstart).toContain("systemctl restart greenway-announcer");
    expect(quickstart).toContain("journalctl -u greenway-announcer -f");
    expect(installer).toContain("journalctl -u greenway-announcer -f");
  });

  it("uses the SSH user and host the walkthrough established", () => {
    expect(quickstart).toContain("ssh greenway-office@greenway-office.local");
    expect(manual + read("docs/announcer/05-first-pi-walkthrough.md")).toContain(
      "greenway-office@greenway-office.local",
    );
  });
});

describe("quickstart: the back-office wording matches the panel", () => {
  it("quotes the panel's heading and its buttons", () => {
    for (const label of ["🔊 Order Announcer", "➕ Add a speaker", "Get pairing code", "▶ Test all speakers"]) {
      expect(panel, `panel must render "${label}"`).toContain(label);
      expect(quickstart, `quickstart must quote "${label}"`).toContain(label);
    }
  });

  it("quotes the 'Add a speaker' explanation verbatim", () => {
    // The panel wraps this across lines in JSX, so compare on collapsed space.
    const collapse = (s: string) => s.replace(/\s+/g, " ");
    const sentence =
      "Name the room first, then press the button. You will get an eight-character code to type into the Raspberry Pi during setup. The code lasts one hour.";
    expect(collapse(panel)).toContain(sentence);
    expect(quickstartFlat).toContain(sentence);
  });

  it("names the Room name field and its real example", () => {
    expect(panel).toContain('label="Room name"');
    expect(panel).toContain('hint="For example: Sales Floor"');
    expect(panel).toContain('placeholder="Sales Floor"');
    expect(quickstart).toContain("Room name");
    expect(quickstart).toContain("Sales Floor");
  });

  it("states the Room name length limit that the input really enforces", () => {
    const max = /maxLength=\{(\d+)\}/.exec(panel);
    expect(max).not.toBeNull();
    expect(quickstart, "quickstart must state the real character limit").toContain(
      `${max![1]} characters`,
    );
  });

  it("quotes the master switch and quiet-hours hints from the panel", () => {
    for (const hint of [
      "The master switch for every speaker.",
      "Test still works during quiet hours.",
    ]) {
      expect(panel, `panel must show "${hint}"`).toContain(hint);
      expect(quickstart, `quickstart must quote "${hint}"`).toContain(hint);
    }
    expect(panel).toContain('label="Announce new orders"');
    expect(quickstart).toContain("Announce new orders");
  });

  it("quotes the shop verdict headlines it tells the reader to expect", () => {
    for (const headline of [
      "No speakers are set up yet.",
      "Announcements are turned OFF for the whole shop.",
      "Quiet hours are active right now, so orders will not make a sound.",
    ]) {
      expect(adminCore, `verdict "${headline}" must exist`).toContain(headline);
      expect(quickstartFlat, `quickstart must quote "${headline}"`).toContain(headline);
    }
  });

  it("quotes the all-online headline exactly as it is built", () => {
    expect(adminCore).toContain(
      "headline: `All ${online} speaker${online === 1 ? \"\" : \"s\"} online. You will hear the next order.`",
    );
    expect(quickstart).toContain("All 1 speaker online. You will hear the next order.");
    expect(quickstart).toContain("1 of 1 speaker online");
  });

  it("uses the four device health labels exactly as the code spells them", () => {
    const labels = ["Online", "Not responding", "Offline", "Never connected"];
    for (const label of labels) {
      expect(core, `deviceHealthLabel must return "${label}"`).toContain(`return "${label}"`);
      expect(quickstart, `quickstart must use the label "${label}"`).toContain(label);
    }
    expect(panel).toContain('"Switched off"');
    expect(quickstart).toContain("Switched off");
  });

  it("gives the same next action for a bad device as the code does", () => {
    expect(core).toContain(
      "Unplug the Pi's power for 10 seconds, plug it back in, and wait 2 minutes.",
    );
    expect(quickstart).toMatch(/Unplug the Pi's power for 10 seconds/);
    expect(core).toContain("Setup did not finish. Re-run the installer on the Pi and pair it again.");
    expect(quickstart).toMatch(/Re-run the installer/i);
  });

  it("quotes the 'Last heard from' line and a real relative label", () => {
    expect(panel).toContain("Last heard from {d.lastSeenLabel}");
    // relativeTimeLabel lives in announcer-admin-core, not announcer-core.
    expect(adminCore).toContain('return "just now"');
    expect(quickstart).toContain("Last heard from just now");
  });
});

describe("quickstart: the numbers it states are the real constants", () => {
  it("states the pairing code lifetime from PAIRING_TTL_MINUTES", () => {
    expect(PAIRING_TTL_MINUTES).toBe(60);
    // Every stated lifetime must be right, not just the first one. A single
    // toContain() check let a wrong second occurrence survive in the printer
    // docs, so assert against all of them.
    // Catch EVERY way a duration can be phrased, not just "expires after N".
    // A mutant changed "It lasts 60 minutes." to 30 and stayed green because
    // another sentence still said 60.
    const stated = [
      ...quickstart.matchAll(/(?:lasts|last|expires? after|good for)\s+(\d+)\s+minutes/gi),
    ].map((m) => Number(m[1]));
    expect(stated.length, "the quickstart must state the code lifetime").toBeGreaterThan(0);
    for (const value of stated) {
      expect(value, `stated lifetime ${value} does not match PAIRING_TTL_MINUTES`).toBe(
        PAIRING_TTL_MINUTES,
      );
    }
    // An hour stated in words must also be an hour in the code.
    if (/lasts? (?:one|an) hour/i.test(quickstart)) {
      expect(PAIRING_TTL_MINUTES).toBe(60);
    }
    // And no stray other number of minutes may be attached to a code.
    const wrong = [...quickstart.matchAll(/code[^.\n]{0,40}?(\d+)\s+minutes/gi)].map((m) =>
      Number(m[1]),
    );
    for (const value of wrong) {
      expect(value).toBe(PAIRING_TTL_MINUTES);
    }
  });

  it("states the online window from DEVICE_ONLINE_GRACE_SECONDS", () => {
    const grace = /DEVICE_ONLINE_GRACE_SECONDS = (\d+)/.exec(core);
    expect(grace).not.toBeNull();
    expect(quickstart, "quickstart must state the real online grace window").toContain(
      `${grace![1]} seconds`,
    );
  });

  it("states the code length the panel promises", () => {
    expect(panel).toContain("eight-character code");
    expect(quickstart).toMatch(/eight-character/);
    // The example code must be exactly that long, dash removed.
    const example = /`([A-Z]{4}-\d{4})`/.exec(quickstart);
    expect(example).not.toBeNull();
    expect(example![1].replace("-", "").length).toBe(8);
  });

  it("states the journal cap the installer really configures", () => {
    const cap = /SystemMaxUse=(\d+)M/.exec(installer);
    expect(cap).not.toBeNull();
    expect(quickstart).toContain(`${cap![1]}MB`);
  });

  it("tells the reader to drop the dash, which is how the agent parses it", () => {
    // cmd_pair strips non-alphanumerics, so ABCD-2345 would in fact work --
    // but the instruction must still match what we tell people to type.
    expect(agent).toContain('"".join(ch for ch in args.code.upper() if ch.isalnum())');
    expect(quickstart).toMatch(/without the dash/i);
  });
});

describe("quickstart: it steers around the security gateway on the live domain", () => {
  it("tells the reader to use the development site for the install", () => {
    expect(quickstart).toContain("https://greenwaywebsite1.vercel.app");
  });

  it("never hands over an install command pointing at the blocked live domain", () => {
    // PROVED against the real domain: greenwaymarijuana.com answers
    // /api/announcer/pair with 202 and a CAPTCHA page, so an install command
    // using it cannot work. The admin panel falls back to that address when
    // NEXT_PUBLIC_SITE_URL is unset, which is exactly the trap this document
    // is written to defuse -- so it must not repeat it.
    const commands = [...quickstart.matchAll(/sudo \.\/install\.sh[^\n`]*/g)].map((m) => m[0]);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command, `this command points at the blocked domain: ${command}`).not.toContain(
        "greenwaymarijuana.com",
      );
    }
  });

  it("no announcer document hands over an install command for the blocked domain", () => {
    // Applies to every manual, not just the quickstart. The walkthrough used
    // to print the live domain in three places, which is a guaranteed dead end
    // on a real Pi until the domain is cut over.
    const docs: [string, string][] = [
      [QUICKSTART_PATH, quickstart],
      ["docs/announcer/05-first-pi-walkthrough.md", read("docs/announcer/05-first-pi-walkthrough.md")],
      [MANUAL_PATH, manual],
      [CARD_PATH, card],
      [BUY_PATH, buy],
    ];
    for (const [path, text] of docs) {
      const commands = [...text.matchAll(/(?:sudo )?(?:\.\/install\.sh|greenway-announcer pair)[^\n`]*/g)]
        .map((m) => m[0])
        .filter((c) => c.includes("--site"));
      for (const command of commands) {
        expect(
          command,
          `${path} tells the reader to run a command against the blocked live domain: ${command}`,
        ).not.toContain("greenwaymarijuana.com");
      }
    }
  });

  it("warns that the panel's own copy-paste command uses the wrong address", () => {
    // Pin the fallback that causes it, so that setting NEXT_PUBLIC_SITE_URL
    // (or changing the fallback) forces this warning to be revisited.
    expect(panel).toContain('process.env.NEXT_PUBLIC_SITE_URL ?? "https://greenwaymarijuana.com"');
    expect(quickstart).toContain("greenwaymarijuana.com");
    expect(quickstart).toMatch(/security gateway/i);
  });

  it("quotes the gateway diagnosis the agent now prints", () => {
    expect(agent).toContain("instead of handling the speaker request");
    expect(agent).toMatch(/security\s+"\s*\n\s*"gateway or CAPTCHA|security gateway or CAPTCHA/);
    expect(quickstart).toContain("The website answered 202 instead of handling the speaker request.");
  });

  it("quotes the installer's download refusal", () => {
    expect(installer).toContain("returned HTTP $DL_CODE, not 200");
    expect(quickstart).toContain("returned HTTP 202, not 200");
  });
});

describe("quickstart: it is usable by somebody who is stuck", () => {
  it("explains the exec-bit failure that actually happened in the field", () => {
    // "command not found" is sudo's wording for "not executable", which sends
    // people hunting for a missing file. Reproduced empirically.
    // Pin it as a table row, so deleting the row fails even though the same
    // string appears elsewhere in the document. A mutant edited one of the two
    // occurrences and survived.
    const occurrences = quickstart.split("sudo: ./install.sh: command not found").length - 1;
    expect(
      occurrences,
      "the exec-bit failure must be explained where it happens AND in the error table",
    ).toBeGreaterThanOrEqual(2);
    expect(quickstart).toMatch(
      /\|\s*`sudo: \.\/install\.sh: command not found`\s*\|.*not marked runnable/i,
    );
    expect(quickstart).toMatch(/git pull/);
  });

  it("quotes the cross-installer guard so the wrong flag is self-explaining", () => {
    expect(installer).toContain(
      "is a RECEIPT PRINTER option, but this is the ANNOUNCER installer",
    );
    expect(quickstart).toContain("is a RECEIPT PRINTER option, but this is the ANNOUNCER installer");
  });

  it("warns that a typed password shows nothing, which looks broken", () => {
    expect(quickstart).toMatch(/Nothing appears as you type/i);
  });

  it("leads the silent-speaker advice with the volume knob, not the clever fix", () => {
    const knobAt = quickstart.search(/volume knob/i);
    const alsaAt = quickstart.indexOf("alsamixer");
    expect(knobAt).toBeGreaterThan(-1);
    expect(knobAt).toBeLessThan(alsaAt);
  });

  it("tells the reader a failed install changed nothing", () => {
    expect(quickstart).toMatch(/left your Pi exactly as it was|has left your Pi/i);
  });

  it("numbers every step exactly once, in order, with no gaps", () => {
    // Steps 1..12 are the spine. A lettered step (8b) is a branch the reader
    // only takes when something is wrong, so it must NOT renumber the spine --
    // otherwise "go to step 9" in the text points at the wrong place.
    const headings = [...quickstart.matchAll(/^## Step (\d+)([a-z]?)/gm)];
    const spine = headings.filter((m) => m[2] === "").map((m) => Number(m[1]));
    expect(spine).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Every lettered branch must hang off a step that exists.
    const branches = headings.filter((m) => m[2] !== "");
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) {
      expect(spine, `Step ${branch[1]}${branch[2]} has no Step ${branch[1]}`).toContain(
        Number(branch[1]),
      );
    }

    // Every "go to step N" must point at a step that exists.
    const pointers = [...quickstart.matchAll(/go to step (\d+)/gi)].map((m) => Number(m[1]));
    expect(pointers.length).toBeGreaterThan(0);
    for (const target of pointers) {
      expect(spine, `the text says "go to step ${target}" but there is no such step`).toContain(
        target,
      );
    }
  });

  /**
   * Two real field failures drove this section, and the guidance that fixes
   * them must not quietly rot:
   *
   *   1. `greenway-announcer test` crashed with PermissionError because the
   *      config directory is mode 700. The fix a human needs is the word
   *      "sudo", printed where they will see it.
   *   2. The first speaker buzzed. The cause was the Pi's PWM headphone jack
   *      driven at full volume -- not a broken speaker. Telling somebody that
   *      is the difference between a 30-second fix and a wasted purchase.
   */
  it("tells you to use sudo for the commands that read the root-only config", () => {
    // The config lives in a mode-700 directory, set by the installer itself.
    expect(installer).toContain('chmod 700 "$CONFIG_DIR"');

    // So the commands that read it must be shown WITH sudo -- and it is not
    // enough for ONE mention to carry the sudo. Every single occurrence of
    // these subcommands as a runnable command must have it, or the one line
    // somebody happens to copy is the one that crashes.
    for (const sub of ["status", "test", "audio"]) {
      // Ignore Markdown's inline-code backticks when reading the word before
      // the command, so `sudo greenway-announcer status` counts as sudo.
      const all = [
        ...quickstart
          .replace(/`/g, "")
          .matchAll(new RegExp(`(\\S+ )?greenway-announcer ${sub}\\b`, "g")),
      ];
      expect(
        all.length,
        `the quickstart never mentions "greenway-announcer ${sub}"`,
      ).toBeGreaterThan(0);
      const bare = all.filter((m) => (m[1] ?? "").trim() !== "sudo");
      expect(
        bare.map((m) => m[0]),
        `every "greenway-announcer ${sub}" in the quickstart must be run with sudo, because the config directory is mode 700`,
      ).toEqual([]);
    }

    // And the agent must actually offer that advice itself, naming the fix.
    expect(agent).toContain("Run the same command with 'sudo' in front:");
    expect(agent).toContain("sudo greenway-announcer {command}");
  });

  it("promises the test command degrades instead of crashing without sudo", () => {
    // The crash was the defect. The documented behaviour is "say so and carry
    // on", so the agent must have both halves: the note and the fallback.
    expect(quickstartFlat).toContain("It will not stop and it will not crash");
    expect(agent).toContain("cannot read the saved audio output from");
    expect(agent).toContain("def usable_cache_dir");
    expect(agent).toContain("usable_cache_dir(Path(args.cache_dir))");
  });

  it("has a branch for buzzing that names the cause and the counter-intuitive fix", () => {
    expect(quickstart).toMatch(/##\s+Step 8c\b/);
    expect(quickstartFlat).toMatch(/hiss, buzz or static/i);

    // The reassurance: it is the socket, not the speaker.
    expect(quickstartFlat).toContain("normal for that socket");
    expect(quickstartFlat).toContain("It is not a broken speaker");
    expect(quickstartFlat).toContain("Do not go and buy a new speaker");

    // The fix is backwards from what people expect, so both halves must be
    // present: Pi DOWN, speaker UP. Half of this advice is useless.
    expect(quickstartFlat).toMatch(/Turn the \*\*Pi's\*\* volume \*\*down\*\*/i);
    expect(quickstartFlat).toMatch(/the \*\*speaker's\*\* knob \*\*up\*\*/i);
    expect(quickstartFlat).toContain("80%");

    // Both kinds of buzz are distinguished, because the fixes differ.
    expect(quickstartFlat).toContain("even when nothing is playing");
    expect(quickstartFlat).toContain("only happens while a sound plays");

    // And the permanent cure.
    expect(quickstartFlat).toMatch(/USB audio adapter/i);

    // Step 8 must actually route the reader to 8c, or the branch is orphaned.
    expect(quickstartFlat).toMatch(/go to step 8c/i);
  });

  it("the buzz advice in the docs matches the advice the agent prints", () => {
    // If these drift apart, the Pi and the manual contradict each other in
    // front of a customer.
    expect(agent).toContain("PWM-driven and is genuinely noisy");
    expect(agent).toContain("not a broken speaker");
    expect(agent).toContain("down to about 80%");
    expect(agent).toContain("even when nothing is playing");
    expect(agent).toContain("ONLY while a sound plays");
    expect(agent).toContain("USB audio adapter");
  });

  it("the audio command it documents is a real subcommand", () => {
    expect(agent).toContain('add_parser("audio"');
    expect(agent).toContain("def cmd_audio");
    expect(agent).toContain("p_audio.set_defaults(func=cmd_audio)");
    // It is listed in the commands worth keeping, not buried in one branch.
    expect(quickstartFlat).toContain("what is it plugged into? why is it buzzing?");
  });

  it("the keep-these-commands list counts itself correctly", () => {
    // A heading that says FIVE above a list of six is the kind of small lie
    // that makes somebody distrust the rest of the page.
    const heading = quickstart.match(/## THE (\w+) COMMANDS WORTH KEEPING/);
    expect(heading, "the commands-worth-keeping section must exist").toBeTruthy();
    const block = quickstart.split("COMMANDS WORTH KEEPING")[1].split("```")[1];
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      // Drop the fence's language tag ("bash"), which is not a command.
      .filter((l) => l.length > 0 && l !== "bash" && l.includes(" "));
    const words: Record<string, number> = {
      THREE: 3,
      FOUR: 4,
      FIVE: 5,
      SIX: 6,
      SEVEN: 7,
      EIGHT: 8,
    };
    expect(
      words[heading![1]],
      `the heading says ${heading![1]} but the block lists ${lines.length} commands`,
    ).toBe(lines.length);
  });

  it("points onward to manuals that exist", () => {
    for (const path of [
      "docs/announcer/10-field-manual.md",
      "docs/announcer/05-first-pi-walkthrough.md",
      "docs/announcer/20-what-to-buy.md",
      "docs/announcer/30-wall-card.md",
    ]) {
      expect(quickstart).toContain(path);
      expect(() => read(path)).not.toThrow();
    }
  });
});
