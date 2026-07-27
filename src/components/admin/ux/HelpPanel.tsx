"use client";

/**
 * HelpPanel — a collapsible "How this works" panel for the top of complex pages.
 *
 * Plain-language explanation of what a section does and the typical workflow,
 * written for a non-technical user. Collapsed by default (remembers per-page via
 * localStorage so a power user isn't nagged), expandable with one click.
 *
 * Usage:
 *   <HelpPanel
 *     id="menu-imports"
 *     title="How menu uploads work"
 *     steps={["Export the two files from your POS", "Upload them here", "Review", "Publish"]}
 *   />
 */
import { useCallback, useSyncExternalStore, type ReactNode } from "react";

// Panel open/closed preference store. localStorage-backed with an in-memory
// fallback (so toggling still works when storage is unavailable), plus a
// module-level pub/sub so same-tab writes re-render subscribed panels.
// Read via useSyncExternalStore — hydration-safe and effect-free.
const memoryStore = new Map<string, string>();
const listeners = new Set<() => void>();

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // localStorage may be unavailable; fall back to the in-memory store.
    return memoryStore.get(key) ?? null;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage write failures; remember in-memory for this session
  }
  memoryStore.set(key, value);
  for (const notify of listeners) notify();
}

export function HelpPanel({
  id,
  title = "How this works",
  children,
  steps,
  defaultOpen = false,
}: {
  id: string;
  title?: string;
  children?: ReactNode;
  steps?: string[];
  defaultOpen?: boolean;
}) {
  const storageKey = `gw-help-${id}`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [storageKey],
  );

  const getSnapshot = useCallback(() => {
    const saved = memoryStore.get(storageKey) ?? readPref(storageKey);
    return saved !== null && saved !== undefined ? saved === "1" : defaultOpen;
  }, [storageKey, defaultOpen]);

  const getServerSnapshot = useCallback(() => defaultOpen, [defaultOpen]);

  // Remembered open/closed state (server renders defaultOpen, the browser
  // then applies the saved preference — same behavior as before).
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    writePref(storageKey, open ? "0" : "1");
  }

  return (
    <div className="rounded-xl border border-[var(--admin-accent)]/20 bg-[var(--admin-accent)]/[0.04]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-accent)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--admin-accent)]/40 text-xs">
            i
          </span>
          {title}
        </span>
        <span className="text-xs text-[var(--admin-accent)]/70">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed text-white/70">
          {children}
          {steps && steps.length > 0 && (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)]/15 text-xs font-bold text-[var(--admin-accent)]">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
