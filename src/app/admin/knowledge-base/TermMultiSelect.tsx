"use client";

/**
 * TermMultiSelect — a smart selector for a list of short terms (terpenes,
 * aroma notes, flavor notes) on the Strain Editor.
 *
 * Michael asked to "pick the right description quickly" from the vocab we
 * already have. This gives:
 *   • a text box backed by a <datalist> of the canonical options (type-to-
 *     filter, click to pick) — you can still type a new term if it's genuinely
 *     missing, so we never block a real word;
 *   • selected values shown as removable pills;
 *   • optional greyed "house-suggested" chips (type-typical values) that are
 *     one-tap-to-add and NEVER pre-selected — the honest, WA-safe prefill.
 *
 * Controlled: the parent owns `values` (a comma-joined string, matching how the
 * existing strain form + upsertStrainAction already store these fields) so the
 * hidden <input name=…> still posts exactly what the server expects.
 */
import { useMemo, useState } from "react";

function splitCsv(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinCsv(list: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join(", ");
}

export function TermMultiSelect({
  name,
  label,
  value,
  onChange,
  options,
  suggestions = [],
  placeholder,
  datalistId,
}: {
  /** Form field name (posts the comma-joined value). */
  name: string;
  label: string;
  /** Comma-joined selected values (controlled by the parent). */
  value: string;
  onChange: (next: string) => void;
  /** Canonical vocab options for the datalist. */
  options: string[];
  /** Optional greyed "house-suggested" chips (one-tap add, never pre-selected). */
  suggestions?: string[];
  placeholder?: string;
  /** Unique id for the shared <datalist> element. */
  datalistId: string;
}) {
  const [draft, setDraft] = useState("");
  const selected = useMemo(() => splitCsv(value), [value]);
  const selectedSet = useMemo(
    () => new Set(selected.map((s) => s.toLowerCase())),
    [selected],
  );

  function add(term: string) {
    const t = term.trim();
    if (!t) return;
    onChange(joinCsv([...selected, t]));
    setDraft("");
  }

  function remove(term: string) {
    onChange(joinCsv(selected.filter((s) => s.toLowerCase() !== term.toLowerCase())));
  }

  // Suggestions worth showing = not already selected.
  const openSuggestions = suggestions.filter((s) => !selectedSet.has(s.toLowerCase()));

  const inputCls =
    "flex-1 min-w-[8rem] rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";

  return (
    <div className="text-sm">
      <span className="block text-xs font-medium text-[var(--admin-text-muted)]">{label}</span>

      {/* Selected pills */}
      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {selected.map((term) => (
            <span
              key={term}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--admin-accent-soft)] px-2 py-0.5 text-xs text-[var(--admin-text)]"
            >
              {term}
              <button
                type="button"
                onClick={() => remove(term)}
                aria-label={`Remove ${term}`}
                className="text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Type-to-filter + pick from the canonical list (or add a new term). */}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          list={datalistId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          className={inputCls}
          placeholder={placeholder ?? "Type or pick, then Enter…"}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-xs font-medium text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]"
        >
          Add
        </button>
      </div>
      <datalist id={datalistId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      {/* House-suggested chips — greyed, one-tap add, never pre-selected. */}
      {openSuggestions.length > 0 && (
        <div className="mt-1.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
            Suggested for this type (tap to add — a house suggestion, not a fact)
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {openSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--admin-border)] bg-transparent px-2 py-0.5 text-xs text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-text)]"
                title="House suggestion based on other strains of this type. Tap to add; it will be tagged as a suggestion in Sources."
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden field posts the comma-joined value exactly as the server expects. */}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
