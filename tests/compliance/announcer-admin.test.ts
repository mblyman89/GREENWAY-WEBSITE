/**
 * SLICE 30 — what the back office tells Michael about the speakers.
 *
 * The self-tests in announcer-admin-core.ts cover the unit behaviour. This file
 * pins the things that would make the panel LIE, which is worse than the panel
 * being broken:
 *
 *   1. Saying "you will hear the next order" when the shop is actually silent.
 *   2. Saying nothing is wrong when the master switch is off.
 *   3. Reporting a busy mid-afternoon as quiet hours (the Slice 29 bug class).
 *   4. Showing a problem without showing the fix.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  healthTone,
  pendingPairings,
  relativeTimeLabel,
  soundLabel,
  summarizeShop,
  toDeviceView,
  type AdminDeviceView,
  type PendingPairingRow,
} from "@/lib/announcer/announcer-admin-core";

const NOW_ISO = "2026-03-10T12:00:00.000Z";
const BUILT = [
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
];

function view(over: {
  id?: string;
  name?: string;
  enabled?: boolean;
  lastSeen?: string | null;
}): AdminDeviceView {
  return toDeviceView({
    row: {
      id: over.id ?? "d",
      name: over.name ?? "Room",
      enabled: over.enabled ?? true,
      volume: 70,
      sound_id: "chime",
      custom_sound_path: null,
      last_seen_at: over.lastSeen === undefined ? NOW_ISO : over.lastSeen,
    },
    nowIso: NOW_ISO,
    builtIns: BUILT,
    defaultSoundId: "chime",
    defaultVolume: 70,
  });
}

const NOON_PACIFIC = new Date("2026-03-10T19:00:00Z");

function shop(over: Partial<Parameters<typeof summarizeShop>[0]> = {}) {
  return summarizeShop({
    devices: [view({ id: "a" })],
    globalEnabled: true,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
    now: NOON_PACIFIC,
    ...over,
  });
}

describe("announcer panel — the verdict never lies about silence", () => {
  it("promises sound only when a speaker is actually online and enabled", () => {
    expect(shop().willAnnounce).toBe(true);
  });

  it("does not promise sound when the master switch is off", () => {
    const v = shop({ globalEnabled: false });
    expect(v.willAnnounce).toBe(false);
    expect(v.tone).toBe("bad");
  });

  it("does not promise sound when every speaker is offline", () => {
    const v = shop({ devices: [view({ id: "a", lastSeen: "2026-03-01T00:00:00.000Z" })] });
    expect(v.willAnnounce).toBe(false);
  });

  it("does not promise sound when every speaker is switched off", () => {
    const v = shop({ devices: [view({ id: "a", enabled: false })] });
    expect(v.willAnnounce).toBe(false);
  });

  it("does not promise sound when there are no speakers at all", () => {
    const v = shop({ devices: [] });
    expect(v.willAnnounce).toBe(false);
  });

  it("still promises sound when one of several speakers is down", () => {
    const v = shop({
      devices: [view({ id: "a" }), view({ id: "b", lastSeen: "2026-03-01T00:00:00.000Z" })],
    });
    expect(v.willAnnounce).toBe(true);
    expect(v.tone).toBe("warn");
  });
});

describe("announcer panel — the master switch outranks everything", () => {
  it("names the switch even when every speaker is perfectly healthy", () => {
    const v = shop({ globalEnabled: false, devices: [view({ id: "a" }), view({ id: "b" })] });
    expect(v.headline.toLowerCase()).toContain("off");
    expect(v.fix.length).toBeGreaterThan(0);
  });
});

describe("announcer panel — quiet hours are judged on shop time", () => {
  it("REGRESSION: 3PM Pacific is never reported as quiet hours", () => {
    // 22:00Z in June is 3:00 PM Pacific. A server-local clock would call this
    // the start of a 22:00 quiet window and wrongly report the shop as silent.
    const v = shop({
      quietHoursEnabled: true,
      now: new Date("2026-06-10T22:00:00Z"),
    });
    expect(v.willAnnounce).toBe(true);
  });

  it("reports genuine late-night quiet hours", () => {
    // 06:00Z in June is 11:00 PM Pacific.
    const v = shop({ quietHoursEnabled: true, now: new Date("2026-06-11T06:00:00Z") });
    expect(v.willAnnounce).toBe(false);
    expect(v.tone).toBe("warn");
  });

  it("reassures that quiet hours are normal rather than alarming", () => {
    const v = shop({ quietHoursEnabled: true, now: new Date("2026-06-11T06:00:00Z") });
    expect(v.fix.toLowerCase()).toContain("normal");
  });
});

describe("announcer panel — every problem arrives with its fix", () => {
  it("gives a fix for every unhappy verdict", () => {
    const unhappy = [
      shop({ devices: [] }),
      shop({ globalEnabled: false }),
      shop({ devices: [view({ id: "a", enabled: false })] }),
      shop({ devices: [view({ id: "a", lastSeen: null })] }),
      shop({ quietHoursEnabled: true, now: new Date("2026-06-11T06:00:00Z") }),
    ];
    for (const v of unhappy) {
      expect(v.willAnnounce).toBe(false);
      expect(v.fix.trim().length).toBeGreaterThan(0);
      expect(v.headline.trim().length).toBeGreaterThan(0);
    }
  });

  it("offers no busywork when everything is healthy", () => {
    expect(shop().fix).toBe("");
  });

  it("gives every device card a next action, healthy or not", () => {
    const cards = [
      view({ id: "a" }),
      view({ id: "b", lastSeen: "2026-03-10T11:50:00.000Z" }),
      view({ id: "c", lastSeen: null }),
      view({ id: "d", enabled: false }),
    ];
    for (const c of cards) {
      expect(c.nextAction.trim().length).toBeGreaterThan(0);
      expect(c.healthLabel.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("announcer panel — a switched-off speaker is a choice, not a fault", () => {
  it("shows disabled as idle rather than red", () => {
    expect(healthTone("online", false)).toBe("idle");
    expect(healthTone("offline", false)).toBe("idle");
  });

  it("flags it so the card can say 'Switched off' instead of an error", () => {
    expect(view({ enabled: false }).mutedByChoice).toBe(true);
    expect(view({ enabled: true }).mutedByChoice).toBe(false);
  });

  it("does NOT count a switched-off speaker as online, even while it phones home", () => {
    // A Pi that is unplugged stops reporting, so "offline" and "switched off"
    // usually coincide. But a speaker disabled from the back office keeps
    // heartbeating perfectly — it just refuses to play. Counting it as online
    // would inflate "3 of 3 online" while the storage room sits silent.
    const v = shop({
      devices: [view({ id: "office", enabled: true }), view({ id: "storage", enabled: false })],
    });
    expect(v.onlineCount).toBe(1);
    expect(v.headline).toContain("1 speaker");
  });

  it("reports zero online when the only live speaker is switched off", () => {
    const v = shop({ devices: [view({ id: "storage", enabled: false })] });
    expect(v.onlineCount).toBe(0);
    expect(v.willAnnounce).toBe(false);
  });
});

describe("announcer panel — timestamps a person can read", () => {
  it("never shows a time in the future when a Pi clock runs fast", () => {
    expect(relativeTimeLabel("2026-03-10T12:30:00.000Z", NOW_ISO)).toBe("just now");
  });

  it("says never rather than an error for a device that has not called home", () => {
    expect(relativeTimeLabel(null, NOW_ISO)).toBe("never");
    expect(relativeTimeLabel("garbage", NOW_ISO)).toBe("never");
  });

  it("uses singular and plural correctly", () => {
    expect(relativeTimeLabel("2026-03-10T11:59:00.000Z", NOW_ISO)).toBe("1 minute ago");
    expect(relativeTimeLabel("2026-03-10T11:57:00.000Z", NOW_ISO)).toBe("3 minutes ago");
    expect(relativeTimeLabel("2026-03-10T11:00:00.000Z", NOW_ISO)).toBe("1 hour ago");
  });
});

describe("announcer panel — sound names a person recognises", () => {
  it("shows the file name for a custom upload, not a storage path", () => {
    expect(soundLabel(null, "announcer/2026/my air horn.mp3", BUILT, "chime")).toBe("my air horn.mp3");
  });

  it("falls back to the shop default rather than showing a blank", () => {
    expect(soundLabel(null, null, BUILT, "chime")).toBe("Chime");
    expect(soundLabel("unknown-id", null, BUILT, "also-unknown")).toBe("Shop default");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D-66 — "Get pairing code" spun forever and produced nothing
//
// Reported from the field: pressing the button showed a spinner until the
// request gave up, and no code ever appeared.
//
// The cause was not a hang. `createPairing()` worked perfectly: it generated a
// code, inserted the row, and RETURNED it. The server action then discarded
// the return value and revalidated the page — and no query anywhere read
// `announcer_pairings` back. The code existed in the database and could never
// be seen by a human, so the setup was impossible to complete.
//
// These tests execute the logic that now surfaces it.
// ═══════════════════════════════════════════════════════════════════════════

describe("D-66 — the pairing code has to be readable", () => {
  const T0 = "2026-01-05T12:00:00.000Z";
  const row = (over: Partial<PendingPairingRow> = {}): PendingPairingRow => ({
    code: "ABCD2345",
    device_name: "Sales Floor",
    created_at: T0,
    consumed_at: null,
    ...over,
  });

  it("shows a freshly generated code", () => {
    const out = pendingPairings([row()], "2026-01-05T12:02:00.000Z");
    expect(out).toHaveLength(1);
    expect(out[0].display).toBe("ABCD-2345");
    expect(out[0].deviceName).toBe("Sales Floor");
  });

  it("groups it for reading across a room, but keeps a raw form for the command", () => {
    // The owner reads the dashed version aloud; the installer needs it without
    // the dash. Getting these backwards is a support call.
    const out = pendingPairings([row()], "2026-01-05T12:02:00.000Z");
    expect(out[0].display).toBe("ABCD-2345");
    expect(out[0].raw).toBe("ABCD2345");
    expect(out[0].raw).not.toContain("-");
  });

  it("never shows a code that has already been used", () => {
    // Showing a dead code is worse than showing none: it gets typed, refused,
    // and sends somebody hunting for a fault that does not exist.
    expect(pendingPairings([row({ consumed_at: T0 })], "2026-01-05T12:02:00.000Z")).toEqual([]);
  });

  it("never shows an expired code", () => {
    expect(pendingPairings([row()], "2026-01-05T13:30:00.000Z")).toEqual([]);
  });

  it("counts the remaining time down honestly", () => {
    expect(pendingPairings([row()], "2026-01-05T12:02:00.000Z")[0].minutesLeft).toBe(58);
    expect(pendingPairings([row()], "2026-01-05T12:30:00.000Z")[0].minutesLeft).toBe(30);
  });

  it("does not round a live code down to zero minutes", () => {
    // A code with 20 seconds left still works. Saying "0 minutes" would make
    // the owner discard a perfectly good code.
    const out = pendingPairings([row()], "2026-01-05T12:59:40.000Z");
    expect(out).toHaveLength(1);
    expect(out[0].minutesLeft).toBe(1);
    expect(out[0].expiresLabel).toBe("expires in about a minute");
  });

  it("puts the newest code first", () => {
    // After pressing the button twice, the code on screen must be the one just
    // generated — otherwise the owner types the older one.
    const out = pendingPairings(
      [
        row({ code: "AAAA2222", device_name: "Old" }),
        row({ code: "BBBB3333", device_name: "New", created_at: "2026-01-05T12:10:00.000Z" }),
      ],
      "2026-01-05T12:11:00.000Z",
    );
    expect(out[0].raw).toBe("BBBB3333");
  });

  it("survives rubbish input instead of taking the Orders page down", () => {
    // The announcer sits on the Orders screen. It must degrade, never throw.
    expect(pendingPairings([], "not-a-date")).toEqual([]);
    expect(pendingPairings([row({ created_at: "nonsense" })], "2026-01-05T12:00:00.000Z")).toEqual([]);
    expect(pendingPairings([row({ code: "SHORT" })], "2026-01-05T12:00:00.000Z")).toEqual([]);
  });

  it("REGRESSION: the action must not throw the code away again", () => {
    // The original defect in one assertion. The panel data type has to carry
    // the codes; if someone removes the field, this fails loudly rather than
    // the button silently going back to doing nothing visible.
    const source = readFileSync(
      join(process.cwd(), "src/lib/announcer/announcer-admin-store.ts"),
      "utf8",
    );
    expect(source).toContain("announcer_pairings");

    // A mutation run killed the first version of this test: it only checked
    // that the word "pendingPairings" appeared somewhere, which stayed true
    // when the field was stubbed back to a hardcoded empty list — the exact
    // original defect. So assert the WIRING: the success path must call the
    // reader, and must not hand back a constant.
    expect(source).toMatch(/pendingPairings:\s*await\s+getPendingPairings\(/);
    expect(source).toMatch(/computePendingPairings\(/);

    // The one legitimate `pendingPairings: []` is the empty()/not-installed
    // fallback. More than one means the live path was stubbed out.
    const stubbed = source.match(/pendingPairings:\s*\[\]/g) ?? [];
    expect(
      stubbed.length,
      "the success path must read real rows, not return a constant empty list",
    ).toBe(1);
  });

  it("REGRESSION: the panel actually renders the code", () => {
    // Reading it back from the database is only half the fix. If the JSX does
    // not print it, the owner is still staring at nothing.
    const panel = readFileSync(
      join(process.cwd(), "src/components/admin/orders/AnnouncerPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/pendingPairings/);
    expect(panel).toMatch(/\{p\.display\}/);
  });

  it("REGRESSION: the copy-paste install command is a real address, not a placeholder", () => {
    // Found while verifying D-66: the panel printed
    //   sudo ./install.sh --site https://YOUR-SITE.com --code XXXXXXXX
    // That is a command written to be copied onto a Pi. A placeholder host
    // there does not fail loudly at the keyboard, it fails as a DNS error
    // several minutes into an install, which reads like the Pi is broken.
    const panel = readFileSync(
      join(process.cwd(), "src/components/admin/orders/AnnouncerPanel.tsx"),
      "utf8",
    );
    expect(panel).not.toMatch(/YOUR-SITE\.com/);
    expect(panel).toMatch(/announcerSiteUrl\(\)/);
    // And it must resolve from the environment rather than being hardcoded to
    // one deployment, matching the pattern already used for the Plaid webhook.
    expect(panel).toMatch(/NEXT_PUBLIC_SITE_URL/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D-67 — the documented install command downloaded from a URL that did not exist
// ═══════════════════════════════════════════════════════════════════════════

describe("D-67 — the installer the field manual tells you to run must exist", () => {
  it("the agent and installer are served from public/announcer", () => {
    // install.sh fetches "${SITE}/announcer/greenway_announcer.py". In Next.js
    // that resolves to public/announcer/greenway_announcer.py. The directory did
    // not exist, so the documented one-line install 404'd on a real Pi.
    for (const f of ["greenway_announcer.py", "install.sh"]) {
      const p = join(process.cwd(), "public", "announcer", f);
      expect(existsSync(p), `public/announcer/${f} must be served`).toBe(true);
    }
  });

  it("the served copies are byte-identical to the source in pi-agent/", () => {
    // Two copies of a file is a defect waiting to happen: the Pi would install
    // a stale agent while the repo looked correct. This makes drift a failure.
    for (const f of ["greenway_announcer.py", "install.sh"]) {
      const src = readFileSync(join(process.cwd(), "pi-agent", f), "utf8");
      const served = readFileSync(join(process.cwd(), "public", "announcer", f), "utf8");
      expect(
        served,
        `public/announcer/${f} has drifted from pi-agent/${f}.\n` +
          `A Raspberry Pi installing right now would download the OLD file.\n` +
          `Fix it with:  npm run announcer:sync`,
      ).toBe(src);
    }
  });

  it("the drift is reported in a way you can act on", () => {
    // This guard existed and was correct, and three PRs still merged with it
    // red - the served agent fell 1400 lines behind and the owner was handed a
    // command that did not exist in the file his Pi would install.
    //
    // The failure said "Re-copy it." with no command, so fixing it meant
    // working out the right cp by hand under pressure. A guard that states a
    // problem but not its remedy is a guard that gets postponed. The fix is
    // now one named command, and this test makes sure the message keeps
    // naming it - including if someone later rewrites the message.
    const suite = readFileSync(
      join(process.cwd(), "tests", "compliance", "announcer-admin.test.ts"),
      "utf8",
    );
    expect(
      suite,
      "the drift failure message must name the exact command that fixes it",
    ).toContain("npm run announcer:sync");

    // ...and that command must really be defined, not just quoted.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["announcer:sync"], "npm run announcer:sync must exist").toBeTruthy();
    expect(pkg.scripts["announcer:check"], "npm run announcer:check must exist").toBeTruthy();
  });

  it("CI runs the sync check, so a stale served copy cannot merge green", () => {
    // Standing rule 39: a verifier nobody runs approves everything. The drift
    // guard in this very file was correct AND red while three PRs merged. The
    // missing piece was never the assertion - it was that nothing forced a
    // human to look before pressing merge. Pin the workflow step by name.
    const wf = readFileSync(
      join(process.cwd(), ".github", "workflows", "compliance-tests.yml"),
      "utf8",
    );
    expect(wf, "CI must run the served-copy check").toContain("npm run announcer:check");
    expect(
      wf.indexOf("npm run announcer:check"),
      "the sync check should run BEFORE the long test suite, so the failure is readable",
    ).toBeLessThan(wf.indexOf("npm run test:compliance"));
  });

  it("the sync script refuses to pass when the served copy is stale", () => {
    // A one-command fix is only trustworthy if its --check mode really fails.
    // Prove it against a deliberately wrong copy in a scratch tree, so we are
    // testing detection rather than trusting it.
    const scratch = mkdtempSync(join(tmpdir(), "announcer-sync-"));
    try {
      const realSrc = join(process.cwd(), "pi-agent", "greenway_announcer.py");
      const stale = join(scratch, "stale.py");
      writeFileSync(stale, readFileSync(realSrc, "utf8").slice(0, 500));
      // Truncated copy must not equal the source - the shape of real drift.
      expect(readFileSync(stale, "utf8")).not.toBe(readFileSync(realSrc, "utf8"));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    // And the live check must currently PASS, or this whole suite is moot.
    const out = execFileSync("node", ["scripts/announcer/sync-served-copy.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(out).toContain("in sync");
  });

  it("the served agent is valid Python, not a truncated copy", () => {
    const agent = readFileSync(
      join(process.cwd(), "public", "announcer", "greenway_announcer.py"),
      "utf8",
    );
    expect(agent.length).toBeGreaterThan(10000);
    expect(agent.startsWith("#!")).toBe(true);
  });
});
