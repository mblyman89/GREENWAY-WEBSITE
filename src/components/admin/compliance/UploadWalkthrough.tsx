"use client";

/**
 * UploadWalkthrough (Task W) — the hand-held, step-by-step CCRS upload
 * checklist. CCRS is manual-CSV-upload-only, so the human does the clicking;
 * this walkthrough removes every chance to get the ORDER or TIMING wrong:
 *
 *   Group 1 (Strain, Area, Product) → wait ≥10 min → Group 2 (Inventory)
 *   → wait ≥10 min → Group 3 (InventoryAdjustment, InventoryTransfer, Sale).
 *
 * Progress is persisted in localStorage per week key (the 10-minute dependency
 * waits mean reloads WILL happen mid-process), read via useSyncExternalStore
 * so server render (empty state) and client hydration stay consistent.
 * Built-in countdown timers start when a group is checked off. Finishing all
 * steps points at the "record the submission" form below — the ledger write
 * stays a server action.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

type FileSummary = { type: string; fileName: string; recordCount: number; empty: boolean };

type Props = {
  weekKey: string;
  files: FileSummary[];
  batchZipHref: string;
  submittable: boolean;
};

const PORTAL_URL = "https://cannabisreporting.lcb.wa.gov";
const WAIT_MINUTES = 10;

type StepId =
  | "download"
  | "signin"
  | "group1"
  | "wait1"
  | "group2"
  | "wait2"
  | "group3"
  | "record";

type Persisted = {
  done: Partial<Record<StepId, boolean>>;
  /** epoch ms when group1/group2 were checked (starts the dependency timers). */
  g1At?: number;
  g2At?: number;
};

function storageKey(weekKey: string): string {
  return `ccrs-walkthrough:${weekKey}`;
}

// localStorage as an external store (SSR-safe): getSnapshot returns the raw
// string (strings are Object.is-equal by value, so this is render-stable) and
// writes notify subscribers.
const storeListeners = new Set<() => void>();
function storeSubscribe(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}
function storeWrite(weekKey: string, next: Persisted): void {
  try {
    localStorage.setItem(storageKey(weekKey), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  storeListeners.forEach((l) => l());
}

function parsePersisted(raw: string | null): Persisted {
  if (raw) {
    try {
      return JSON.parse(raw) as Persisted;
    } catch {
      /* ignore */
    }
  }
  return { done: {} };
}

function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function UploadWalkthrough({ weekKey, files, batchZipHref, submittable }: Props) {
  const raw = useSyncExternalStore(
    storeSubscribe,
    () => {
      try {
        return localStorage.getItem(storageKey(weekKey));
      } catch {
        return null;
      }
    },
    () => null, // server snapshot: empty state
  );
  const state = useMemo(() => parsePersisted(raw), [raw]);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second while a dependency wait is running.
  const g1Remaining = state.g1At ? state.g1At + WAIT_MINUTES * 60_000 - now : 0;
  const g2Remaining = state.g2At ? state.g2At + WAIT_MINUTES * 60_000 - now : 0;
  const timing = (state.g1At && g1Remaining > 0) || (state.g2At && g2Remaining > 0);
  useEffect(() => {
    if (!timing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timing]);

  const save = useCallback((next: Persisted) => storeWrite(weekKey, next), [weekKey]);

  const toggle = useCallback(
    (id: StepId) => {
      const done = { ...state.done, [id]: !state.done[id] };
      const next: Persisted = { ...state, done };
      if (id === "group1" && done.group1 && !state.g1At) next.g1At = Date.now();
      if (id === "group2" && done.group2 && !state.g2At) next.g2At = Date.now();
      save(next);
    },
    [state, save],
  );

  const reset = useCallback(() => save({ done: {} }), [save]);

  const group1 = useMemo(() => files.filter((f) => ["Strain", "Area", "Product"].includes(f.type)), [files]);
  const group2 = useMemo(() => files.filter((f) => f.type === "Inventory"), [files]);
  const group3 = useMemo(
    () => files.filter((f) => ["InventoryAdjustment", "InventoryTransfer", "Sale"].includes(f.type)),
    [files],
  );

  const fileList = (group: FileSummary[]) => (
    <ul className="mt-1 space-y-0.5 text-[11px] text-white/45">
      {group.map((f) => (
        <li key={f.type}>
          • {f.fileName} — {f.recordCount} record(s){f.empty ? " (empty — skip uploading this file)" : ""}
        </li>
      ))}
    </ul>
  );

  const steps: { id: StepId; title: string; body: React.ReactNode; locked?: boolean; lockNote?: string }[] = [
    {
      id: "download",
      title: "Download the validated batch (.zip)",
      body: (
        <div>
          <p className="text-xs text-white/55">
            The zip contains every file numbered in upload order with correct CCRS filenames and
            headers. It only downloads when validation passes.
          </p>
          <a
            href={batchZipHref}
            className={`mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              submittable
                ? "bg-[var(--admin-accent)] text-black hover:opacity-90"
                : "cursor-not-allowed border border-white/10 text-white/30"
            }`}
            aria-disabled={!submittable}
            onClick={(e) => {
              if (!submittable) e.preventDefault();
            }}
          >
            {submittable ? "Download batch zip" : "Blocked — fix validation errors first"}
          </a>
        </div>
      ),
    },
    {
      id: "signin",
      title: "Sign in to the CCRS portal",
      body: (
        <p className="text-xs text-white/55">
          Open{" "}
          <a href={PORTAL_URL} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] underline">
            cannabisreporting.lcb.wa.gov
          </a>{" "}
          and sign in with your SecureAccess Washington (SAW) account. (The LCB is moving CCRS to
          WA.gov login around Oct 2026.)
        </p>
      ),
    },
    {
      id: "group1",
      title: "Upload Group 1 — Strain, Area, Product",
      body: (
        <div>
          <p className="text-xs text-white/55">
            Upload these first; Inventory depends on them. Empty files can be skipped.
          </p>
          {fileList(group1)}
        </div>
      ),
    },
    {
      id: "wait1",
      title: `Wait ${WAIT_MINUTES} minutes (CCRS dependency processing)`,
      locked: !state.done.group1,
      lockNote: "Check off Group 1 first — the timer starts automatically.",
      body: state.done.group1 ? (
        g1Remaining > 0 ? (
          <p className="text-xs font-semibold text-amber-300">
            ⏱ {fmtRemaining(g1Remaining)} remaining — CCRS needs time to process Group 1 before
            Inventory can reference it.
          </p>
        ) : (
          <p className="text-xs font-semibold text-emerald-300">
            ✓ 10 minutes have passed — safe to upload Inventory.
          </p>
        )
      ) : null,
    },
    {
      id: "group2",
      title: "Upload Group 2 — Inventory",
      locked: Boolean(state.done.group1 && g1Remaining > 0),
      lockNote: "Wait for the 10-minute timer above before uploading Inventory.",
      body: fileList(group2),
    },
    {
      id: "wait2",
      title: `Wait ${WAIT_MINUTES} minutes again`,
      locked: !state.done.group2,
      lockNote: "Check off Group 2 first — the timer starts automatically.",
      body: state.done.group2 ? (
        g2Remaining > 0 ? (
          <p className="text-xs font-semibold text-amber-300">
            ⏱ {fmtRemaining(g2Remaining)} remaining before Group 3.
          </p>
        ) : (
          <p className="text-xs font-semibold text-emerald-300">✓ Safe to upload Group 3.</p>
        )
      ) : null,
    },
    {
      id: "group3",
      title: "Upload Group 3 — InventoryAdjustment, InventoryTransfer, Sale",
      locked: Boolean(state.done.group2 && g2Remaining > 0),
      lockNote: "Wait for the second 10-minute timer before uploading Group 3.",
      body: fileList(group3),
    },
    {
      id: "record",
      title: "Record the submission in the ledger below",
      body: (
        <p className="text-xs text-white/55">
          Scroll to “Record this week” and mark it SUBMITTED — that stops the reminders, stamps
          who/when, and stores the file manifest as evidence. Then watch your email for CCRS error
          notifications (triage panel below).
        </p>
      ),
    },
  ];

  const doneCount = steps.filter((s) => state.done[s.id]).length;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">
            Guided upload walkthrough
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Hand-held, in order, with the 10-minute dependency waits built in. Progress is saved on
            this device for week {weekKey.slice(2)}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-white/60">
            {doneCount}/{steps.length} done
          </span>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/50 transition hover:bg-white/5"
          >
            Reset
          </button>
        </div>
      </div>

      <ol className="space-y-2">
        {steps.map((s, i) => {
          const done = Boolean(state.done[s.id]);
          const locked = Boolean(s.locked) && !done;
          return (
            <li
              key={s.id}
              className={`rounded-xl border p-3 transition ${
                done
                  ? "border-emerald-400/25 bg-emerald-400/5"
                  : locked
                    ? "border-white/5 bg-black/10 opacity-60"
                    : "border-white/10 bg-black/20"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={locked}
                  onChange={() => toggle(s.id)}
                  className="mt-0.5 h-4 w-4 accent-[var(--admin-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <span className={`text-xs font-bold ${done ? "text-emerald-200" : "text-white/80"}`}>
                    {i + 1}. {s.title}
                  </span>
                  {locked && s.lockNote ? (
                    <p className="mt-1 text-[11px] text-amber-300/70">🔒 {s.lockNote}</p>
                  ) : (
                    <div className="mt-1">{s.body}</div>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
