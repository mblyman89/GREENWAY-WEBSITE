"use client";

/**
 * D234 C-6 (SOP-11b G-106; F-11-31; Q-11-15 "I agree with your
 * recommendation."): help inside the Banner Design Studio.
 *   - `Tip`: a tooltip on hover AND keyboard focus; the control is linked to
 *     its words with aria-describedby (always in the page, so screen readers
 *     read it too); Esc hides it.
 *   - `KeySheet`: the "?" sheet with every key, and the 60-second tour.
 *   - `TourStrip`: "New here? 60-second tour", dismissible, re-opened from "?".
 *   - `StepStrip`: "Make a banner": picture → text → phone → check → publish.
 * Words and rules: `studio-help-core.ts`.
 */
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { helperHref } from "@/lib/admin/page-helpers-core";
import {
  STUDIO_SHORTCUTS,
  TOUR_DISMISSED_KEY,
  TOUR_STEPS,
  isHelpKey,
  nextStep,
  tourStripVisible,
  type MakeStep,
  type StepId,
} from "@/lib/cms/studio-help-core";

export function Tip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        className={
          open
            ? "pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-white/15 bg-[#1a1a1a] px-2 py-1 text-[0.7rem] font-normal leading-snug text-white/90 shadow-xl"
            : "sr-only"
        }
      >
        {text}
      </span>
    </span>
  );
}

export type SheetMode = false | "keys" | "tour";

/** The "?" key, the sheet, the tour strip and "has the owner looked at Phone yet". */
export function useStudioHelp(
  rootRef: RefObject<HTMLDivElement | null>,
  device: "desktop" | "mobile",
) {
  const [sheet, setSheet] = useState<SheetMode>(false);
  // The studio is client-only (dynamic, ssr: false), so localStorage is there on first render.
  const [tour, setTour] = useState<boolean>(() => {
    try {
      return (
        typeof window !== "undefined" &&
        tourStripVisible(window.localStorage.getItem(TOUR_DISMISSED_KEY))
      );
    } catch {
      return true;
    }
  });
  const [seenPhone, setSeenPhone] = useState(false);
  if (device === "mobile" && !seenPhone) setSeenPhone(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        isHelpKey(
          e,
          !!t.closest("input, textarea, select") || t.isContentEditable,
        )
      ) {
        e.preventDefault();
        setSheet("keys");
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [rootRef]);
  const dismissTour = () => {
    setTour(false);
    try {
      window.localStorage.setItem(TOUR_DISMISSED_KEY, "1");
    } catch {
      /* private mode: hidden for this visit only */
    }
  };
  return { sheet, setSheet, tour, dismissTour, seenPhone };
}

export function TourStrip({
  visible,
  onStart,
  onDismiss,
}: {
  visible: boolean;
  onStart: () => void;
  onDismiss: () => void;
}) {
  if (!visible) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-3 py-1.5 text-xs text-white/85"
      data-tour-strip
    >
      <span>👋 New here? Take the 60-second tour of the studio.</span>
      <button
        type="button"
        onClick={onStart}
        className="rounded-full bg-[var(--admin-accent)] px-3 py-0.5 font-bold text-black"
      >
        Start the tour
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto text-white/60 underline hover:text-white"
        aria-label="Hide the tour strip (open it again with ?)"
      >
        Hide (press ? to see it again)
      </button>
    </div>
  );
}

export function StepStrip({
  steps,
  onGo,
}: {
  steps: MakeStep[];
  onGo: (id: StepId) => void;
}) {
  const next = nextStep(steps);
  return (
    <ol
      aria-label="Make a banner, step by step"
      className="flex flex-wrap items-center gap-1 text-[0.7rem]"
      data-step-strip
    >
      <li className="mr-1 font-semibold text-white/60">Make a banner:</li>
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          {i ? (
            <span aria-hidden="true" className="text-white/30">
              →
            </span>
          ) : null}
          <Tip text={s.tip}>
            <button
              type="button"
              onClick={() => onGo(s.id)}
              aria-current={s.id === next ? "step" : undefined}
              className={
                s.state === "done"
                  ? "rounded-full bg-[var(--admin-accent)]/20 px-2 py-0.5 text-[var(--admin-accent)]"
                  : s.id === next
                    ? "rounded-full bg-[#ffd700] px-2 py-0.5 font-bold text-black"
                    : "rounded-full bg-white/10 px-2 py-0.5 text-white/70 hover:bg-white/20"
              }
            >
              {s.state === "done" ? "✓ " : `${i + 1}. `}
              {s.label}
              {s.detail ? ` (${s.detail})` : ""}
            </button>
          </Tip>
        </li>
      ))}
    </ol>
  );
}

/** The "?" sheet: every key, or the tour (six cards). */
export function KeySheet({
  mode,
  onMode,
  onClose,
  onGo,
}: {
  mode: SheetMode;
  onMode: (m: SheetMode) => void;
  onClose: () => void;
  onGo: (id: StepId) => void;
}) {
  const [card, setCard] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const closeLive = useRef(onClose);
  useEffect(() => {
    closeLive.current = onClose;
  });
  useEffect(() => {
    if (!mode) return;
    const t = window.setTimeout(() => closeRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeLive.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [mode]);
  if (!mode) return null;
  const c = TOUR_STEPS[Math.min(card, TOUR_STEPS.length - 1)];
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-key-sheet
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl border border-white/15 bg-[var(--admin-surface,#111)] p-5 text-sm text-white/85 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 id={titleId} className="text-base font-semibold text-white">
            {mode === "keys" ? "Keys in the studio" : "The 60-second tour"}
          </h2>
          <button
            type="button"
            onClick={() => onMode(mode === "keys" ? "tour" : "keys")}
            className="ml-auto rounded-full bg-white/10 px-3 py-0.5 text-xs hover:bg-white/20"
          >
            {mode === "keys" ? "▶ 60-second tour" : "⌨ All keys"}
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-0.5 text-xs hover:bg-white/20"
          >
            Close (Esc)
          </button>
        </div>
        {mode === "keys" ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {STUDIO_SHORTCUTS.map((s) => (
              <div key={s.keys} className="contents">
                <dt className="font-mono font-semibold text-[var(--admin-accent)]">
                  {s.keys}
                </dt>
                <dd className="text-white/75">{s.what}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div aria-live="polite">
            <p className="font-semibold text-white">{c.title}</p>
            <p className="mt-1 text-white/75">{c.text}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                disabled={card === 0}
                onClick={() => setCard((n) => Math.max(0, n - 1))}
                className="rounded-full bg-white/10 px-3 py-1 disabled:opacity-30"
              >
                ← Back
              </button>
              {c.go ? (
                <button
                  type="button"
                  onClick={() => {
                    onGo(c.go!);
                    onClose();
                  }}
                  className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20"
                >
                  Show me
                </button>
              ) : null}
              <span className="text-white/45">
                {card + 1} / {TOUR_STEPS.length}
              </span>
              {card < TOUR_STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCard((n) => n + 1)}
                  className="ml-auto rounded-full bg-[var(--admin-accent)] px-3 py-1 font-bold text-black"
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="ml-auto rounded-full bg-[var(--admin-accent)] px-3 py-1 font-bold text-black"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}
        <p className="mt-4 border-t border-white/10 pt-2 text-xs text-white/55">
          The full guide:{" "}
          <a className="underline" href={helperHref("banner-studio")}>
            How the Banner Design Studio works
          </a>{" "}
          (Helpers page). Ask the chat bubble (bottom-right) anything about
          banners.
        </p>
      </div>
    </div>
  );
}
