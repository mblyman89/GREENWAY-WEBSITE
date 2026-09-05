"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  clampIndex,
  facetSummary,
  highlightParts,
  narrowOptions,
  type TypeaheadOption,
} from "@/lib/inventory/facet-typeahead-core";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SLICE 14 — one facet, contained in one control.
 *
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 * Slice 13 rendered every facet as an always-open box with its own scrollbar,
 * twelve of them at once. This is the same power behind a single closed
 * button: click it, a search field appears above the same list, typing narrows
 * the list, clicking adds a value, and each choice becomes a removable pill.
 *
 * THIS IS THE W3C COMBOBOX PATTERN, NOT AN INVENTION
 * ---------------------------------------------------------------------------
 * Roles and keys follow the ARIA Authoring Practices Guide "Combobox Pattern"
 * with `aria-autocomplete="list"`:
 *   * the text input carries role=combobox, aria-expanded, aria-controls
 *   * the popup is role=listbox, its rows are role=option
 *   * DOM FOCUS STAYS IN THE INPUT. The active row is pointed at with
 *     `aria-activedescendant` rather than by moving focus, which is what lets
 *     someone keep typing while arrowing through results.
 *   * Down/Up move the active row, Enter toggles it, Escape closes.
 * Following the published pattern is the point: a screen reader, a keyboard
 * user and a mouse user all get the behaviour they already know.
 *
 * WHY IT STILL WORKS WITHOUT JAVASCRIPT
 * ---------------------------------------------------------------------------
 * The page's doctrine is that the URL is the single source of truth. Every
 * option below is a real <a href> produced by the same `toggleFacetHref` the
 * server used before, so a click navigates exactly as it did in Slice 13. The
 * JavaScript only opens the panel and narrows the list; it never becomes the
 * mechanism by which a filter is applied. A filtered view stays bookmarkable
 * and shareable, and the panel can never disagree with the table.
 *
 * A NOTE ON THE SEARCH INPUT
 * ---------------------------------------------------------------------------
 * It is deliberately NOT a form field — no `name`. It exists only to narrow
 * what is on screen. If it were submitted it would look like a filter, and the
 * employee would wonder why their typing changed nothing after they hit Apply.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type FacetComboboxProps = {
  /** Human label for the facet, e.g. "Vendor". */
  label: string;
  /** Every option, with counts, built from the UNFILTERED set (Slice 13 rule). */
  options: readonly TypeaheadOption[];
  /** Currently selected values. */
  selected: readonly string[];
  /**
   * NOTE: there is deliberately no `hrefFor` callback here. Each option
   * carries its own precomputed `href`, because this is a Client Component and
   * React cannot serialise a function sent from a Server Component parent.
   */
  /** Href that clears this facet entirely. */
  clearHref: string;
  /** Value treated as "(not set)", rendered in italics. */
  unsetValue?: string;
};

/** Rows shown before the popup list scrolls. Keeps the popup from filling the screen. */
const VISIBLE_ROWS = 7;

export function FacetCombobox({
  label,
  options,
  selected,
  clearHref,
  unsetValue,
}: FacetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // All narrowing/ranking lives in the pure core, which is unit-tested.
  const shown = useMemo(
    () => narrowOptions(options, query, selected),
    [options, query, selected],
  );

  const labelFor = useMemo(() => {
    const map = new Map(options.map((o) => [o.value, o.label]));
    return (v: string) => map.get(v) ?? v;
  }, [options]);

  /**
   * Toggle link for a value, looked up from the server-precomputed hrefs.
   * Falls back to `clearHref` only if an option somehow arrived without one,
   * so a pill is never a dead link.
   */
  const hrefOf = useMemo(() => {
    const map = new Map(options.map((o) => [o.value, o.href]));
    return (v: string) => map.get(v) ?? clearHref;
  }, [options, clearHref]);

  const summary = facetSummary(selected, labelFor);

  /** Shut the popup and forget the transient search state, in one place. */
  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(-1);
  };

  /* Close when focus or a click leaves the control. Without this, opening a
     second facet would leave the first hanging open and we would be right back
     to a wall of open boxes. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  /* Autofocus the search box on open. Enterprise UX guidance is explicit:
     "Enable autofocus … it's possible for the user to start typing right
     away." Opening a search box that is not focused wastes a click.

     Note this effect ONLY focuses. Resetting the query/active row happens in
     `close()` instead: clearing state from inside an effect triggers a second
     render pass for something we already know at the moment of the click. */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* Keep the active row scrolled into view during keyboard navigation. */
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: "nearest" });
    // optionId is derived from baseId, which is stable for this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const go = (href: string) => {
    // A plain navigation, identical to clicking the underlying <a>. The server
    // re-renders from the URL, which keeps the URL authoritative.
    window.location.href = href;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => clampIndex(i + 1, shown.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => clampIndex(i - 1, shown.length));
    } else if (e.key === "Enter") {
      if (active >= 0 && active < shown.length) {
        e.preventDefault();
        go(hrefOf(shown[active]!.value));
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(clampIndex(0, shown.length));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(clampIndex(shown.length - 1, shown.length));
    }
  };

  const hasSelection = selected.length > 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
          {label}
        </span>
        {hasSelection && (
          <a
            href={clearHref}
            className="text-[0.65rem] text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]"
          >
            clear
          </a>
        )}
      </div>

      {/*
        THE CLOSED CONTROL. It reads like a form field on purpose, so the panel
        looks like a short row of inputs rather than a wall of lists. The
        summary line carries the state: "Any", the single value, or "N
        selected" — so a shut facet still tells the truth about itself.
      */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${summary}`}
        className={`flex w-full items-center justify-between gap-2 rounded-[var(--admin-radius)] border px-2.5 py-1.5 text-left text-xs transition ${
          hasSelection
            ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
            : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:border-[var(--admin-border-strong)]"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="shrink-0 text-[0.6rem] opacity-70">
          {open ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {/*
        SELECTED VALUES AS PILLS, under the control and always visible even when
        the popup is shut. Each one is a link that removes itself. This is the
        "additive lozenges" pattern, and the redundancy is deliberate: a filter
        the employee cannot see is the reason people stop trusting a row count.
      */}
      {hasSelection && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.map((v) => (
            <a
              key={v}
              href={hrefOf(v)}
              title={`Remove ${labelFor(v)}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[0.65rem] text-[var(--admin-accent)] transition hover:border-[var(--admin-danger)]"
            >
              <span className="truncate">{labelFor(v)}</span>
              <span aria-hidden="true" className="opacity-70">
                {"\u00d7"}
              </span>
            </a>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[14rem] rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] p-2 shadow-lg">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-label={`Search ${label}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1); // a new query invalidates the old highlight
            }}
            onKeyDown={onKeyDown}
            placeholder={`Search ${label.toLowerCase()}\u2026`}
            className="mb-1.5 w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]"
          />

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            className="overflow-y-auto pr-0.5"
            style={{ maxHeight: `${VISIBLE_ROWS * 1.75}rem` }}
          >
            {shown.length === 0 && (
              <li className="px-1.5 py-2 text-center text-[0.7rem] text-[var(--admin-text-faint)]">
                No match for {`"${query}"`}
              </li>
            )}

            {shown.map((o, i) => {
              const isOn = selected.includes(o.value);
              const parts = highlightParts(o.label, o.start, o.end);
              return (
                <li key={o.value} role="none">
                  <a
                    id={optionId(i)}
                    role="option"
                    aria-selected={isOn}
                    href={o.href ?? hrefOf(o.value)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs transition ${
                      i === active
                        ? "bg-white/10 text-[var(--admin-text)]"
                        : isOn
                          ? "text-[var(--admin-accent)]"
                          : "text-[var(--admin-text-muted)] hover:bg-white/5"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border text-[8px] leading-none ${
                          isOn
                            ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                            : "border-[var(--admin-border-strong)]"
                        }`}
                      >
                        {isOn ? "\u2713" : ""}
                      </span>
                      <span
                        className={`truncate ${o.value === unsetValue ? "italic" : ""}`}
                        title={o.label}
                      >
                        {parts.before}
                        {parts.match && (
                          <mark className="bg-[var(--admin-accent)]/30 text-inherit">
                            {parts.match}
                          </mark>
                        )}
                        {parts.after}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.65rem] text-[var(--admin-text-faint)]">
                      {o.count}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FacetCombobox;
