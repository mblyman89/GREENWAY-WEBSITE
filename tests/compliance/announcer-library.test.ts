/**
 * tests/compliance/announcer-library.test.ts
 *
 * SLICE 34 — the sound library view-model.
 *
 * The pure module carries its own self-test (__runAnnouncerLibraryTests) which
 * the compliance sweep runs and which fails the build. This file exists for the
 * things a self-test cannot express well: the CONTRACT with the Raspberry Pi
 * agent, spelled out so that if anyone ever changes what a dropdown value looks
 * like, a test named after the consequence breaks.
 *
 * The rule being protected, from greenway_announcer.py's is_builtin_sound():
 *   - a bare id  ("chime")             -> play the built-in tone
 *   - anything with a "/" in it        -> download it from the website
 * A value that is neither playable nor downloadable is silent. Silence is the
 * only real failure mode this whole feature has.
 */
import { describe, expect, it } from "vitest";

import { BUILT_IN_SOUNDS } from "@/lib/announcer/announcer-core";
import {
  UPLOAD_HINTS,
  __runAnnouncerLibraryTests,
  buildLibraryRows,
  formatOfPath,
  isPlayableSound,
  libraryVerdict,
  optionsForSounds,
  usageMap,
} from "@/lib/announcer/announcer-library-core";
import { isValidStoragePath } from "@/lib/announcer/announcer-sounds-core";

const ROWS = [
  { id: "11111111-1111-1111-1111-111111111111", label: "My Horn", storage_path: "custom/aaa.mp3", bytes: 2048 },
  { id: "22222222-2222-2222-2222-222222222222", label: "Door", storage_path: "custom/bbb.wav", bytes: 1048576 },
];

describe("announcer sound library — pure self-test", () => {
  it("passes every one of its own assertions", () => {
    const result = __runAnnouncerLibraryTests();
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(60);
  });
});

describe("the contract with the Pi agent", () => {
  it("every option value is something the agent can resolve", () => {
    for (const opt of optionsForSounds(ROWS)) {
      const builtIn = BUILT_IN_SOUNDS.some((b) => b.id === opt.value);
      const custom = isValidStoragePath(opt.value);
      expect(
        builtIn || custom,
        `"${opt.value}" is neither a built-in id nor a valid storage path, so the speaker would be silent`,
      ).toBe(true);
    }
  });

  it("never offers a bare uuid, which the agent would mistake for a built-in", () => {
    const uploads = optionsForSounds(ROWS).filter((o) => o.group === "My uploads");
    expect(uploads.length).toBe(2);
    for (const o of uploads) expect(o.value).toContain("/");
  });

  it("keeps the six built-in ids exactly as the agent spells them", () => {
    const values = optionsForSounds([]).map((o) => o.value);
    expect(values).toEqual(["chime", "bell", "ding", "alert", "cash", "voice"]);
  });

  it("still offers a full picker when the library is broken or empty", () => {
    for (const input of [null, undefined, [], "junk" as never]) {
      expect(optionsForSounds(input as never).length).toBe(BUILT_IN_SOUNDS.length);
    }
  });
});

describe("delete safety", () => {
  it("warns which speaker uses a sound before it can be deleted", () => {
    const uses = usageMap([{ name: "Sales floor", sound_id: "custom/aaa.mp3" }], null);
    const rows = buildLibraryRows(ROWS, uses);
    const horn = rows.find((r) => r.storagePath === "custom/aaa.mp3");
    expect(horn?.inUse).toBe(true);
    expect(horn?.usage).toContain("Sales floor");
  });

  it("flags the shop default, the most damaging thing to delete", () => {
    const uses = usageMap([], "custom/bbb.wav");
    expect(uses["custom/bbb.wav"]).toContain("Shop default");
  });

  it("only says 'safe to delete' when nothing at all points at it", () => {
    const rows = buildLibraryRows(ROWS, usageMap([{ name: "Office", sound_id: "chime" }], "chime"));
    expect(rows.every((r) => r.usage.includes("Safe to delete"))).toBe(true);
  });
});

describe("what the owner reads", () => {
  it("never shows a raw byte count", () => {
    const rows = buildLibraryRows(ROWS, null);
    expect(rows[0].size).not.toBe("2048");
    expect(rows.every((r) => /[A-Z]|—/.test(r.size))).toBe(true);
  });

  it("describes an empty library as a normal state, not an error", () => {
    const v = libraryVerdict({ count: 0, notInstalled: false, error: null });
    expect(v.tone).toBe("info");
    expect(v.detail.toLowerCase()).toContain("built-in");
  });

  it("promises orders still announce even when storage is broken", () => {
    const v = libraryVerdict({ count: 0, notInstalled: false, error: "Storage is unreachable." });
    expect(v.tone).toBe("warn");
    expect(v.detail).toContain("still be announced");
  });

  it("gives hints that are short, complete sentences", () => {
    expect(UPLOAD_HINTS.length).toBeGreaterThan(0);
    for (const h of UPLOAD_HINTS) {
      expect(h.trim().endsWith(".")).toBe(true);
      expect(h.length).toBeLessThan(120);
    }
  });

  it("labels formats from the path, not from a claimed mime type", () => {
    expect(formatOfPath("custom/a.mp3")).toBe("MP3");
    expect(formatOfPath("custom/a.wav")).toBe("WAV");
    expect(formatOfPath("custom/a.exe")).toBe("FILE");
  });
});

describe("stale assignments", () => {
  it("spots a speaker pointing at a sound that was deleted", () => {
    expect(isPlayableSound("custom/deleted.mp3", ROWS)).toBe(false);
  });

  it("treats built-ins as always playable, even with no uploads", () => {
    for (const b of BUILT_IN_SOUNDS) expect(isPlayableSound(b.id, [])).toBe(true);
  });

  it("rejects junk values", () => {
    for (const junk of [null, undefined, 0, 42, "", {}, []]) {
      expect(isPlayableSound(junk, ROWS)).toBe(false);
    }
  });
});
