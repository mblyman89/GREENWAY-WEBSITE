/**
 * src/lib/announcer/announcer-library-core.ts
 *
 * SLICE 34 — the view-model behind the Sound Library panel.
 *
 * PURE. No imports from the database, no React, no Node APIs. Everything the
 * library screen shows is decided here so the JSX is layout only and every
 * judgement is testable without a browser or a server.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Slice 31 gave us storage: upload, list, rename, delete. But a stored file is
 * useless until it can be *chosen*. The dropdowns on the Announcer panel only
 * listed the six built-in tones, so an uploaded sound could never actually be
 * assigned to a speaker. This file merges the two worlds into one list that a
 * <select> can render, and it does it in a way that cannot produce a value the
 * agent will fail to resolve.
 *
 * THE CONTRACT WITH THE PI (the important part)
 * --------------------------------------------
 * greenway_announcer.py decides what a sound id means with is_builtin_sound():
 * a bare id like "chime" is a built-in; anything containing "/" is a storage
 * path it must download. So the OPTION VALUES here must be exactly one of:
 *
 *   "chime" | "bell" | "ding" | "alert" | "cash" | "voice"   (built-in)
 *   "custom/<uuid>.wav" | "custom/<uuid>.mp3"                (storage path)
 *
 * That is why optionsForSounds() emits `storage_path` as the value and never an
 * uploaded row's `id`: sending a bare UUID would look like a built-in to the
 * agent, fail to match, and fall back to the chime forever — a silent bug that
 * sounds like "my custom sound doesn't work" and is miserable to diagnose.
 */
import { BUILT_IN_SOUNDS } from "./announcer-core";
import { formatBytes, isValidStoragePath } from "./announcer-sounds-core";

/** One entry in a sound <select>. */
export type SoundOption = {
  /** The value stored in the database and sent to the Pi. */
  value: string;
  /** What the human reads. */
  label: string;
  /** Which group it belongs under in the dropdown. */
  group: "Built-in sounds" | "My uploads";
};

/** The minimum shape optionsForSounds needs. Matches SoundRow structurally. */
export type LibrarySoundInput = {
  id: string;
  label: string;
  storage_path: string;
  bytes?: number | null;
  mime_type?: string | null;
  created_at?: string;
};

/** A row as the library table renders it. */
export type LibraryRow = {
  id: string;
  label: string;
  storagePath: string;
  /** "1.2 MB" — already formatted, never a raw number. */
  size: string;
  /** "WAV" or "MP3", derived from the path, not from a client-supplied type. */
  format: string;
  /** True when this sound is currently in use somewhere. */
  inUse: boolean;
  /** Plain English: where it is used, or why it is safe to delete. */
  usage: string;
};

/**
 * The one-sentence state of the library, shown above the table.
 * Mirrors the verdict-first style of the main Announcer panel.
 */
export type LibraryVerdict = {
  tone: "good" | "warn" | "info";
  headline: string;
  detail: string;
};

/**
 * Build the option list for every sound dropdown.
 *
 * Built-ins always come first and are always present, even when the uploads
 * table is empty or broken, so the shop can never end up with an empty sound
 * picker and therefore no way to fix itself.
 *
 * Rows whose storage_path is not a valid custom path are DROPPED rather than
 * rendered. A malformed path cannot be played by the Pi, so offering it would
 * only let someone select permanent silence.
 */
export function optionsForSounds(sounds: readonly LibrarySoundInput[] | null | undefined): SoundOption[] {
  const options: SoundOption[] = BUILT_IN_SOUNDS.map((s) => ({
    value: s.id,
    label: s.label,
    group: "Built-in sounds" as const,
  }));

  if (!Array.isArray(sounds)) return options;

  for (const row of sounds) {
    if (!row || typeof row !== "object") continue;
    if (!isValidStoragePath(row.storage_path)) continue;
    const label = typeof row.label === "string" && row.label.trim() !== "" ? row.label.trim() : "Untitled sound";
    options.push({ value: row.storage_path, label, group: "My uploads" });
  }

  return options;
}

/**
 * True when `value` can actually be played by an agent right now.
 *
 * Used to spot a speaker still pointing at a sound that has since been deleted.
 * Slice 31's deleteSound() detaches devices first, so this should normally be
 * true — but "should" is not "is", and a stale value means silence.
 */
export function isPlayableSound(
  value: unknown,
  sounds: readonly LibrarySoundInput[] | null | undefined,
): boolean {
  if (typeof value !== "string" || value === "") return false;
  if (BUILT_IN_SOUNDS.some((s) => s.id === value)) return true;
  if (!Array.isArray(sounds)) return false;
  return sounds.some((r) => r && r.storage_path === value);
}

/** "WAV" / "MP3" / "FILE" — from the path, which is the only trustworthy source. */
export function formatOfPath(path: unknown): string {
  if (typeof path !== "string") return "FILE";
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return "FILE";
  const ext = path.slice(dot + 1).toLowerCase();
  if (ext === "wav") return "WAV";
  if (ext === "mp3") return "MP3";
  return "FILE";
}

/**
 * Turn stored rows into table rows, marking which ones are in use.
 *
 * `usedBy` is a map of storage path -> the human names using it (speaker names,
 * or "Shop default"). Knowing this BEFORE someone clicks Delete is the whole
 * point: it turns a scary irreversible button into an informed one.
 */
export function buildLibraryRows(
  sounds: readonly LibrarySoundInput[] | null | undefined,
  usedBy: Readonly<Record<string, readonly string[]>> | null | undefined,
): LibraryRow[] {
  if (!Array.isArray(sounds)) return [];
  const uses = usedBy && typeof usedBy === "object" ? usedBy : {};

  return sounds
    .filter((r) => r && typeof r === "object" && typeof r.storage_path === "string")
    .map((r) => {
      const names = Array.isArray(uses[r.storage_path]) ? uses[r.storage_path] : [];
      const inUse = names.length > 0;
      return {
        id: String(r.id ?? ""),
        label: typeof r.label === "string" && r.label.trim() !== "" ? r.label.trim() : "Untitled sound",
        storagePath: r.storage_path,
        size: formatBytes(r.bytes ?? null),
        format: formatOfPath(r.storage_path),
        inUse,
        usage: inUse
          ? `In use by ${names.join(", ")}.`
          : "Not used by any speaker. Safe to delete.",
      };
    });
}

/**
 * Which human-readable names are using each custom sound.
 *
 * Built-in ids are ignored on purpose: they can never be deleted, so warning
 * about them would be noise. The shop default is included because deleting the
 * default is the single most damaging delete available.
 */
export function usageMap(
  devices: readonly { name?: string | null; sound_id?: string | null }[] | null | undefined,
  defaultSoundId: unknown,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const add = (key: unknown, who: string) => {
    if (typeof key !== "string" || key === "" || !key.includes("/")) return;
    if (!map[key]) map[key] = [];
    if (!map[key].includes(who)) map[key].push(who);
  };

  if (Array.isArray(devices)) {
    for (const d of devices) {
      if (!d || typeof d !== "object") continue;
      const who = typeof d.name === "string" && d.name.trim() !== "" ? d.name.trim() : "A speaker";
      add(d.sound_id, who);
    }
  }
  add(defaultSoundId, "Shop default");
  return map;
}

/**
 * The sentence at the top of the library.
 *
 * Never scolds and never shows a raw error: every unhappy state names the next
 * action, matching how the rest of the announcer talks.
 */
export function libraryVerdict(input: {
  count: number;
  notInstalled: boolean;
  error: string | null;
}): LibraryVerdict {
  if (input.notInstalled) {
    return {
      tone: "info",
      headline: "Uploads are not switched on yet",
      detail:
        "The sound library needs one database migration before it can store files. " +
        "The six built-in sounds work right now and need nothing.",
    };
  }
  if (input.error) {
    return {
      tone: "warn",
      headline: "The library could not be read",
      detail: `${input.error} The built-in sounds still work, so orders will still be announced.`,
    };
  }
  if (input.count <= 0) {
    return {
      tone: "info",
      headline: "No uploads yet",
      detail:
        "You have six built-in sounds ready to use. Upload a WAV or MP3 below if you want your own — " +
        "a short one, under 3 seconds, works best.",
    };
  }
  return {
    tone: "good",
    headline: input.count === 1 ? "1 custom sound ready" : `${input.count} custom sounds ready`,
    detail: "Pick any of them for a speaker, or as the shop default, in the settings above.",
  };
}

/**
 * Pointers shown next to the upload box. Deliberately short and concrete —
 * these are the four things that actually go wrong with uploaded audio.
 */
export const UPLOAD_HINTS: readonly string[] = [
  "WAV or MP3 only, up to 5 MB.",
  "Keep it under 3 seconds — long sounds overlap when orders come in fast.",
  "Record it loud. A quiet file cannot be fixed by turning the volume up.",
  "Test it on the speaker in the noisiest room before you trust it.",
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Self-test                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function __runAnnouncerLibraryTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ ${name}`);
    }
  };
  const eq = (name: string, actual: unknown, expected: unknown) =>
    check(`${name} (got ${JSON.stringify(actual)})`, actual === expected);

  const rows: LibrarySoundInput[] = [
    { id: "11111111-1111-1111-1111-111111111111", label: "My Horn", storage_path: "custom/aaa.mp3", bytes: 2048 },
    { id: "22222222-2222-2222-2222-222222222222", label: "Door", storage_path: "custom/bbb.wav", bytes: 1048576 },
  ];

  // ── optionsForSounds ────────────────────────────────────────────────────
  const opts = optionsForSounds(rows);
  eq("options: built-ins plus uploads", opts.length, BUILT_IN_SOUNDS.length + 2);
  eq("options: built-ins come first", opts[0].group, "Built-in sounds");
  eq("options: first value is a bare id", opts[0].value, BUILT_IN_SOUNDS[0].id);
  check(
    "options: every built-in is present",
    BUILT_IN_SOUNDS.every((b) => opts.some((o) => o.value === b.id && o.group === "Built-in sounds")),
  );
  eq("options: upload uses its storage path as the value", opts[opts.length - 2].value, "custom/aaa.mp3");
  eq("options: upload keeps its label", opts[opts.length - 2].label, "My Horn");
  eq("options: uploads are grouped separately", opts[opts.length - 1].group, "My uploads");
  check(
    "options: no upload value is ever a bare uuid (the Pi would call it built-in)",
    !opts.some((o) => o.group === "My uploads" && !o.value.includes("/")),
  );
  check(
    "options: every custom value contains a slash, matching is_builtin_sound()",
    opts.filter((o) => o.group === "My uploads").every((o) => o.value.includes("/")),
  );

  // Degenerate inputs must never produce an empty picker.
  eq("options: null is safe", optionsForSounds(null).length, BUILT_IN_SOUNDS.length);
  eq("options: undefined is safe", optionsForSounds(undefined).length, BUILT_IN_SOUNDS.length);
  eq("options: empty list is safe", optionsForSounds([]).length, BUILT_IN_SOUNDS.length);
  eq(
    "options: non-array is safe",
    optionsForSounds("nope" as unknown as LibrarySoundInput[]).length,
    BUILT_IN_SOUNDS.length,
  );

  // Malformed rows are dropped, not rendered.
  const bad = optionsForSounds([
    { id: "x", label: "Bad", storage_path: "uploads/legacy.mp3" },
    { id: "y", label: "Worse", storage_path: "../../etc/passwd" },
    { id: "z", label: "Empty", storage_path: "" },
  ]);
  eq("options: invalid storage paths are dropped", bad.length, BUILT_IN_SOUNDS.length);

  const blankLabel = optionsForSounds([{ id: "q", label: "   ", storage_path: "custom/ccc.wav" }]);
  eq("options: blank label falls back", blankLabel[blankLabel.length - 1].label, "Untitled sound");

  // ── isPlayableSound ─────────────────────────────────────────────────────
  check("playable: built-in id", isPlayableSound("chime", rows));
  check("playable: known upload", isPlayableSound("custom/aaa.mp3", rows));
  check("playable: deleted upload is not", !isPlayableSound("custom/gone.mp3", rows));
  check("playable: empty string is not", !isPlayableSound("", rows));
  check("playable: null is not", !isPlayableSound(null, rows));
  check("playable: number is not", !isPlayableSound(42, rows));
  check("playable: built-in survives an empty library", isPlayableSound("bell", []));
  check("playable: built-in survives a null library", isPlayableSound("bell", null));

  // ── formatOfPath ────────────────────────────────────────────────────────
  eq("format: wav", formatOfPath("custom/a.wav"), "WAV");
  eq("format: mp3", formatOfPath("custom/a.mp3"), "MP3");
  eq("format: uppercase extension still recognised", formatOfPath("custom/a.WAV"), "WAV");
  eq("format: unknown extension", formatOfPath("custom/a.ogg"), "FILE");
  eq("format: no extension", formatOfPath("custom/a"), "FILE");
  eq("format: trailing dot", formatOfPath("custom/a."), "FILE");
  eq("format: non-string", formatOfPath(null), "FILE");

  // ── usageMap ────────────────────────────────────────────────────────────
  const uses = usageMap(
    [
      { name: "Office", sound_id: "custom/aaa.mp3" },
      { name: "Sales floor", sound_id: "custom/aaa.mp3" },
      { name: "Storage", sound_id: "chime" },
      { name: "  ", sound_id: "custom/bbb.wav" },
    ],
    "custom/bbb.wav",
  );
  eq("usage: two speakers share a sound", uses["custom/aaa.mp3"].length, 2);
  eq("usage: names are kept", uses["custom/aaa.mp3"][0], "Office");
  check("usage: built-in ids are ignored", uses["chime"] === undefined);
  check("usage: blank speaker name falls back", uses["custom/bbb.wav"].includes("A speaker"));
  check("usage: shop default is counted", uses["custom/bbb.wav"].includes("Shop default"));
  const noDupes = usageMap([{ name: "Office", sound_id: "custom/aaa.mp3" }], "custom/aaa.mp3");
  eq("usage: no duplicate names", noDupes["custom/aaa.mp3"].length, 2);
  const dupSame = usageMap(
    [
      { name: "Office", sound_id: "custom/aaa.mp3" },
      { name: "Office", sound_id: "custom/aaa.mp3" },
    ],
    null,
  );
  eq("usage: the same name is not listed twice", dupSame["custom/aaa.mp3"].length, 1);
  eq("usage: null devices is safe", Object.keys(usageMap(null, null)).length, 0);
  eq("usage: non-array devices is safe", Object.keys(usageMap(7 as never, null)).length, 0);

  // ── buildLibraryRows ────────────────────────────────────────────────────
  const table = buildLibraryRows(rows, uses);
  eq("rows: one per sound", table.length, 2);
  eq("rows: size is formatted, not raw", table[0].size, formatBytes(2048));
  eq("rows: format comes from the path", table[1].format, "WAV");
  check("rows: in-use is flagged", table[0].inUse);
  check("rows: usage names the speakers", table[0].usage.includes("Office"));
  const freeRows = buildLibraryRows(rows, {});
  check("rows: unused says it is safe to delete", freeRows[0].usage.includes("Safe to delete"));
  check("rows: unused is not flagged in use", !freeRows[0].inUse);
  eq("rows: null sounds is safe", buildLibraryRows(null, uses).length, 0);
  eq("rows: null usage is safe", buildLibraryRows(rows, null).length, 2);
  const blankRow = buildLibraryRows([{ id: "a", label: "", storage_path: "custom/x.wav" }], null);
  eq("rows: blank label falls back", blankRow[0].label, "Untitled sound");
  const nullBytes = buildLibraryRows([{ id: "a", label: "X", storage_path: "custom/x.wav", bytes: null }], null);
  check("rows: null size still renders something", nullBytes[0].size.length > 0);

  // ── libraryVerdict ──────────────────────────────────────────────────────
  const vNone = libraryVerdict({ count: 0, notInstalled: false, error: null });
  eq("verdict: empty is info, not an error", vNone.tone, "info");
  check("verdict: empty still reassures about built-ins", vNone.detail.includes("built-in"));
  const vOne = libraryVerdict({ count: 1, notInstalled: false, error: null });
  eq("verdict: one is singular", vOne.headline, "1 custom sound ready");
  eq("verdict: one is good", vOne.tone, "good");
  const vMany = libraryVerdict({ count: 4, notInstalled: false, error: null });
  eq("verdict: many is plural", vMany.headline, "4 custom sounds ready");
  const vNot = libraryVerdict({ count: 0, notInstalled: true, error: null });
  eq("verdict: not installed is info", vNot.tone, "info");
  check("verdict: not installed says built-ins still work", vNot.detail.includes("built-in"));
  const vErr = libraryVerdict({ count: 0, notInstalled: false, error: "Storage is unreachable." });
  eq("verdict: error is a warning", vErr.tone, "warn");
  check("verdict: error promises orders still announce", vErr.detail.includes("still be announced"));
  check(
    "verdict: not-installed beats error",
    libraryVerdict({ count: 0, notInstalled: true, error: "boom" }).tone === "info",
  );
  check(
    "verdict: every headline and detail is non-empty",
    [vNone, vOne, vMany, vNot, vErr].every((v) => v.headline.length > 0 && v.detail.length > 20),
  );

  // ── hints ───────────────────────────────────────────────────────────────
  eq("hints: four pointers", UPLOAD_HINTS.length, 4);
  check("hints: each is a full sentence", UPLOAD_HINTS.every((h) => h.trim().endsWith(".")));
  check("hints: the size limit is stated", UPLOAD_HINTS.some((h) => h.includes("5 MB")));

  return { passed, failed };
}
