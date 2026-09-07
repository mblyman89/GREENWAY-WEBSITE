/**
 * Compliance tests for the announcer sound library (SLICE 31).
 *
 * The self-test inside announcer-sounds-core.ts proves the logic in bulk.
 * These tests pin the behaviours that would hurt Michael in the shop, and
 * state WHY each one matters, so a future change that breaks one has to
 * argue with the reason rather than just re-recording a number.
 */
import { describe, it, expect } from "vitest";
import {
  __runAnnouncerSoundsTests,
  validateUpload,
  extensionOf,
  labelFromFileName,
  buildStoragePath,
  isValidStoragePath,
  contentTypeFor,
  formatBytes,
  MAX_SOUND_BYTES,
  MIN_SOUND_BYTES,
  ALLOWED_SOUND_EXTENSIONS,
} from "@/lib/announcer/announcer-sounds-core";

describe("announcer sound library — self-test", () => {
  it("passes every built-in assertion", () => {
    const result = __runAnnouncerSoundsTests();
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(70);
  });
});

describe("only formats a Raspberry Pi can actually play are accepted", () => {
  it("accepts wav and mp3, which need only aplay and mpg123", () => {
    expect(ALLOWED_SOUND_EXTENSIONS).toEqual(["wav", "mp3"]);
  });

  // A format the Pi cannot decode uploads fine and then produces SILENCE on
  // the sales floor, which is indistinguishable from a broken speaker.
  it.each(["ogg", "flac", "m4a", "aac", "wma", "opus"])(
    "rejects .%s because the agent cannot play it",
    (ext) => {
      const result = validateUpload({ fileName: `sound.${ext}`, bytes: 100_000 });
      expect(result.ok).toBe(false);
    },
  );

  it("rejects an executable dressed up as a sound", () => {
    expect(validateUpload({ fileName: "evil.exe", bytes: 100_000 }).ok).toBe(false);
    expect(validateUpload({ fileName: "evil.sh", bytes: 100_000 }).ok).toBe(false);
  });
});

describe("size limits keep announcements instant", () => {
  it("allows a file exactly at the limit", () => {
    expect(validateUpload({ fileName: "a.wav", bytes: MAX_SOUND_BYTES }).ok).toBe(true);
  });

  it("rejects one byte over the limit", () => {
    expect(validateUpload({ fileName: "a.wav", bytes: MAX_SOUND_BYTES + 1 }).ok).toBe(false);
  });

  // A zero-byte or stub file would be listed in the library, chosen by the
  // owner, and then fall back to the chime on every single order.
  it("rejects an empty or stub file", () => {
    expect(validateUpload({ fileName: "a.wav", bytes: 0 }).ok).toBe(false);
    expect(validateUpload({ fileName: "a.wav", bytes: MIN_SOUND_BYTES - 1 }).ok).toBe(false);
  });
});

describe("every rejection tells the owner what to do next", () => {
  const rejections = [
    validateUpload({ fileName: "song.flac", bytes: 100_000 }),
    validateUpload({ fileName: "noext", bytes: 100_000 }),
    validateUpload({ fileName: "big.mp3", bytes: 20 * 1024 * 1024 }),
    validateUpload({ fileName: "tiny.wav", bytes: 1 }),
    validateUpload({ fileName: null, bytes: 100_000 }),
  ];

  it("never returns a bare unhelpful message", () => {
    for (const r of rejections) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.length).toBeGreaterThan(40);
        expect(r.error).not.toMatch(/^(invalid|error|bad request)\.?$/i);
        expect(r.error.trim().endsWith(".")).toBe(true);
      }
    }
  });

  it("tells an oversized upload both its size and the limit", () => {
    const r = validateUpload({ fileName: "big.mp3", bytes: 20 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("20.0 MB");
      expect(r.error).toContain("5 MB");
    }
  });
});

describe("storage paths are generated, never taken from the user", () => {
  it("two uploads of the same filename cannot collide", () => {
    const a = buildStoragePath("id-one", "wav");
    const b = buildStoragePath("id-two", "wav");
    expect(a).not.toBe(b);
  });

  it("strips traversal out of an id", () => {
    expect(buildStoragePath("../../etc/passwd", "wav")).toBe("custom/etcpasswd.wav");
  });

  // The download route serves only paths matching what we generate, so a bad
  // device row cannot turn into a request for some other object.
  it.each([
    "custom/../../secret.wav",
    "/etc/passwd",
    "custom/sub/nested.wav",
    "other-bucket/a.wav",
    "custom/a.exe",
    "chime",
    "",
  ])("rejects %s as a storage path", (path) => {
    expect(isValidStoragePath(path)).toBe(false);
  });

  it("accepts the paths it generates", () => {
    expect(isValidStoragePath(buildStoragePath(crypto.randomUUID(), "wav"))).toBe(true);
    expect(isValidStoragePath(buildStoragePath(crypto.randomUUID(), "mp3"))).toBe(true);
  });
});

describe("the Pi is served the right content type", () => {
  // The agent picks aplay vs mpg123 from the extension, so these must agree.
  it("maps wav and mp3 correctly", () => {
    expect(contentTypeFor("custom/a.wav")).toBe("audio/wav");
    expect(contentTypeFor("custom/a.mp3")).toBe("audio/mpeg");
  });
});

describe("hostile and malformed input never throws", () => {
  const junk: unknown[] = [
    null,
    undefined,
    0,
    -1,
    NaN,
    Infinity,
    "",
    "   ",
    {},
    [],
    true,
    "../../etc/passwd",
    "a".repeat(5000),
  ];

  it("survives anything passed as a filename", () => {
    for (const value of junk) {
      expect(() => extensionOf(value)).not.toThrow();
      expect(() => labelFromFileName(value)).not.toThrow();
      expect(() => isValidStoragePath(value)).not.toThrow();
      expect(() => formatBytes(value)).not.toThrow();
      expect(() => validateUpload({ fileName: value, bytes: 50_000 })).not.toThrow();
      expect(() => validateUpload({ fileName: "a.wav", bytes: value })).not.toThrow();
    }
  });

  it("always produces a non-empty label", () => {
    for (const value of junk) {
      expect(labelFromFileName(value).length).toBeGreaterThan(0);
    }
  });

  // Junk must be REJECTED, not quietly accepted with a default size.
  it("never accepts an upload whose size it could not read", () => {
    for (const value of [null, undefined, "big", {}, [], NaN, Infinity]) {
      expect(validateUpload({ fileName: "a.wav", bytes: value }).ok).toBe(false);
    }
  });
});

describe("labels stay recognisable to the person who uploaded the file", () => {
  it("keeps the owner's own words", () => {
    expect(labelFromFileName("new_order_bell.wav")).toBe("new order bell");
    expect(labelFromFileName("AIRHORN_final(2).WAV")).toBe("AIRHORN final 2");
  });

  it("drops directory noise from a browser path", () => {
    expect(labelFromFileName("C:\\Users\\mike\\Desktop\\bell.wav")).toBe("bell");
  });

  it("caps the length so the table cannot be broken by a huge name", () => {
    expect(labelFromFileName(`${"x".repeat(500)}.wav`).length).toBeLessThanOrEqual(60);
  });
});
