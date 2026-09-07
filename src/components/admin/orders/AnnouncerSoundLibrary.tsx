/**
 * src/components/admin/orders/AnnouncerSoundLibrary.tsx
 *
 * SLICE 34 — the Sound Library section of the Announcer panel.
 *
 * A SERVER component, and layout only. Every judgement on this screen — what
 * counts as "in use", what the verdict sentence says, how a size is written —
 * was already decided by announcer-library-core.ts, which is pure and tested.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 *   1. "Can I use my own sound?"   -> the upload box, with the four rules.
 *   2. "What have I already got?"  -> the table, with size and format.
 *   3. "Is it safe to delete?"     -> every row says who is using it, first.
 *
 * The delete confirmation is not decoration. Deleting a sound that a speaker is
 * using is the one action here that can make a room go quiet, so the row tells
 * you which room before you click, not after.
 */
import { Button } from "@/components/admin/ui/Button";
import {
  UPLOAD_HINTS,
  buildLibraryRows,
  libraryVerdict,
  usageMap,
} from "@/lib/announcer/announcer-library-core";
import type { LibrarySoundInput } from "@/lib/announcer/announcer-library-core";
import {
  announcerDeleteSoundAction,
  announcerRenameSoundAction,
  announcerUploadSoundAction,
} from "@/app/admin/orders/announcer-actions";

const VERDICT_CLS: Record<"good" | "warn" | "info", string> = {
  good: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10",
  warn: "border-[var(--admin-warning,#d99a2b)]/40 bg-[var(--admin-warning,#d99a2b)]/10",
  info: "border-[var(--admin-border)] bg-[var(--admin-surface-1)]",
};

const INPUT_CLS =
  "admin-focus rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-2.5 py-1.5 text-sm text-[var(--admin-text)]";

export function AnnouncerSoundLibrary({
  sounds,
  notInstalled,
  error,
  devices,
  defaultSoundId,
}: {
  sounds: readonly LibrarySoundInput[];
  notInstalled: boolean;
  error: string | null;
  devices: readonly { name?: string | null; sound_id?: string | null }[];
  defaultSoundId: string | null;
}) {
  const verdict = libraryVerdict({ count: sounds.length, notInstalled, error });
  const rows = buildLibraryRows(sounds, usageMap(devices, defaultSoundId));

  return (
    <details className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3.5 py-3">
      <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">
        🎵 Sound library {sounds.length > 0 ? `(${sounds.length})` : ""}
      </summary>

      {/* ── The one-sentence state, before anything else ──────────────── */}
      <div className={`mt-3 rounded-[var(--admin-radius-sm,8px)] border px-3 py-2 ${VERDICT_CLS[verdict.tone]}`}>
        <p className="text-sm font-bold text-[var(--admin-text)]">{verdict.headline}</p>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{verdict.detail}</p>
      </div>

      {/* ── Upload ───────────────────────────────────────────────────── */}
      {notInstalled ? null : (
        <form action={announcerUploadSoundAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-text-muted)]">
              Choose a file
            </span>
            <input
              name="file"
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              required
              className={INPUT_CLS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-text-muted)]">
              Name it (optional)
            </span>
            <input
              name="label"
              type="text"
              maxLength={60}
              placeholder="Front door chime"
              className={INPUT_CLS}
            />
          </label>
          <Button type="submit" variant="save" size="sm">
            Upload
          </Button>
          <ul className="sm:col-span-3 mt-1 space-y-0.5 text-[0.68rem] text-[var(--admin-text-faint)]">
            {UPLOAD_HINTS.map((h) => (
              <li key={h}>• {h}</li>
            ))}
          </ul>
        </form>
      )}

      {/* ── What is already here ─────────────────────────────────────── */}
      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--admin-border)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="rounded-full border border-[var(--admin-border-strong)] px-1.5 text-[0.62rem] font-bold uppercase text-[var(--admin-text-faint)]">
                {r.format}
              </span>

              <form action={announcerRenameSoundAction} className="flex items-center gap-1.5">
                <input type="hidden" name="soundId" value={r.id} />
                <input
                  name="label"
                  defaultValue={r.label}
                  maxLength={60}
                  aria-label={`Name for ${r.label}`}
                  className={`${INPUT_CLS} w-44`}
                />
                <Button type="submit" variant="neutral" size="sm">
                  Rename
                </Button>
              </form>

              <span className="text-xs text-[var(--admin-text-faint)]">{r.size}</span>

              <span
                className={`text-xs ${
                  r.inUse ? "text-[var(--admin-text-muted)]" : "text-[var(--admin-text-faint)]"
                }`}
              >
                {r.usage}
              </span>

              <form action={announcerDeleteSoundAction} className="ml-auto">
                <input type="hidden" name="soundId" value={r.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── The pointer that saves a support call ────────────────────── */}
      <p className="mt-3 text-[0.68rem] text-[var(--admin-text-faint)]">
        After uploading, pick the new sound above for a speaker or as the shop default, then press
        <strong className="text-[var(--admin-text-muted)]"> Test all speakers</strong>. The Pi downloads a new
        sound once and keeps it, so the very first play may take a second longer than usual.
      </p>
    </details>
  );
}
