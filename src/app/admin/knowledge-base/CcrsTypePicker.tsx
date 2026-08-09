"use client";

import { useMemo } from "react";
import {
  buildCcrsTypeVocabulary,
  partitionCcrsNames,
  canonicalizeCcrsTypeName,
  normalizeCcrsName,
  type CcrsVocabularyEntry,
} from "@/lib/ai/kb/ccrs-vocabulary-core";
import { CCRS_INVENTORY_CATEGORIES } from "@/lib/compliance/ccrs-batch-core";

/**
 * Validated pick-list for a KB category's `wa_inventory_types[]` — the exact
 * Washington CCRS inventory-type names this KB category derives from.
 *
 * WHY (owner, Michael): the CCRS name is the stable join key that connects
 * intake → KB (Slice 1). It used to be a free-text box, so a typo created a
 * dead mapping the join could never hit. This picker offers ONLY real CCRS
 * names (derived from the authoritative compliance vocabulary — never invented)
 * while PRESERVING any value already saved, even the older pre-CCRS names: those
 * are shown and clearly flagged "review", never silently dropped.
 *
 * Contract with the server action: we keep a hidden <input name="wa_inventory_types">
 * holding a comma-separated string, so the existing upsert action is unchanged.
 */

// Friendly labels for the CCRS regulatory categories used to group the picker.
const CATEGORY_LABELS: Record<string, string> = {
  PropagationMaterial: "Propagation material",
  HarvestedMaterial: "Harvested material",
  IntermediateProduct: "Intermediate product",
  EndProduct: "End product",
};

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Preserve order, drop normalized duplicates. */
function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = normalizeCcrsName(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function CcrsTypePicker({
  value,
  onChange,
}: {
  /** Comma-separated string (the FormState field). */
  value: string;
  onChange: (next: string) => void;
}) {
  const selected = useMemo(() => dedupe(parseCsv(value)), [value]);
  const selectedKeys = useMemo(
    () => new Set(selected.map(normalizeCcrsName)),
    [selected],
  );

  // Group the authoritative vocabulary by CCRS category for the add-dropdown.
  const grouped = useMemo(() => {
    const vocab = buildCcrsTypeVocabulary().filter((e) => !e.legacy);
    const byCat = new Map<string, CcrsVocabularyEntry[]>();
    for (const e of vocab) {
      if (!byCat.has(e.category)) byCat.set(e.category, []);
      byCat.get(e.category)!.push(e);
    }
    return CCRS_INVENTORY_CATEGORIES.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      label: CATEGORY_LABELS[c] ?? c,
      entries: byCat.get(c)!,
    }));
  }, []);

  // Classify each currently-selected value for its chip styling.
  const partition = useMemo(() => partitionCcrsNames(selected), [selected]);
  const legacyInputs = useMemo(
    () => new Set(partition.legacy.map((l) => normalizeCcrsName(l.input))),
    [partition],
  );
  const unknownInputs = useMemo(
    () => new Set(partition.unknown.map(normalizeCcrsName)),
    [partition],
  );

  function commit(list: string[]) {
    onChange(dedupe(list).join(", "));
  }

  function addName(name: string) {
    if (!name) return;
    if (selectedKeys.has(normalizeCcrsName(name))) return;
    commit([...selected, name]);
  }

  function removeName(name: string) {
    const key = normalizeCcrsName(name);
    commit(selected.filter((s) => normalizeCcrsName(s) !== key));
  }

  function upgradeLegacy(input: string) {
    const canonical = canonicalizeCcrsTypeName(input);
    if (!canonical) return;
    // Replace the legacy spelling with the modern one (preserving position).
    const next = selected.map((s) =>
      normalizeCcrsName(s) === normalizeCcrsName(input) ? canonical : s,
    );
    commit(next);
  }

  const chipBase =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs";

  return (
    <div className="sm:col-span-2">
      <span className="block text-xs font-medium text-[var(--admin-text-muted)]">
        WA CCRS inventory types (the regulatory types this product type derives
        from)
      </span>

      {/* Hidden field keeps the server action unchanged. */}
      <input type="hidden" name="wa_inventory_types" value={selected.join(", ")} />

      {/* Selected chips */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {selected.length === 0 ? (
          <span className="text-xs text-[var(--admin-text-muted)]">
            None yet — add the CCRS type(s) this maps to below.
          </span>
        ) : (
          selected.map((name) => {
            const key = normalizeCcrsName(name);
            const isUnknown = unknownInputs.has(key);
            const isLegacy = legacyInputs.has(key);
            const cls = isUnknown
              ? `${chipBase} border border-[var(--admin-danger,#b91c1c)] text-[var(--admin-danger,#b91c1c)]`
              : isLegacy
                ? `${chipBase} border border-[var(--admin-warning,#a16207)] text-[var(--admin-warning,#a16207)]`
                : `${chipBase} bg-[var(--admin-accent-soft)] text-[var(--admin-text)]`;
            return (
              <span key={key} className={cls} title={name}>
                {name}
                {isUnknown ? " · review" : isLegacy ? " · legacy" : ""}
                {isLegacy ? (
                  <button
                    type="button"
                    onClick={() => upgradeLegacy(name)}
                    className="ml-1 underline"
                    title="Update to the current CCRS spelling"
                  >
                    fix
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeName(name)}
                  className="ml-1 leading-none"
                  aria-label={`Remove ${name}`}
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>

      {/* Add from the authoritative CCRS vocabulary */}
      <select
        value=""
        onChange={(e) => {
          addName(e.target.value);
          e.target.value = "";
        }}
        className="mt-2 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]"
        aria-label="Add a CCRS inventory type"
      >
        <option value="">+ Add a CCRS inventory type…</option>
        {grouped.map((g) => (
          <optgroup key={g.category} label={g.label}>
            {g.entries.map((e) => (
              <option
                key={e.name}
                value={e.name}
                disabled={selectedKeys.has(normalizeCcrsName(e.name))}
              >
                {e.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Honest, contextual guidance. */}
      {partition.unknown.length > 0 ? (
        <p className="mt-1.5 text-xs text-[var(--admin-danger,#b91c1c)]">
          {partition.unknown.length === 1 ? "One entry isn't" : "Some entries aren't"}{" "}
          a current CCRS inventory type — kept as-is so nothing is lost, but the
          intake→KB link won&apos;t match on it. Replace it with a real CCRS type
          from the list when you can.
        </p>
      ) : null}
      {partition.legacy.length > 0 ? (
        <p className="mt-1.5 text-xs text-[var(--admin-warning,#a16207)]">
          Legacy spelling detected — CCRS still accepts it, but you can press
          <strong> fix</strong> to store the current name.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        These are the exact Washington CCRS types a product must carry to map
        here. Picking from the list keeps the intake→KB link accurate.
      </p>
    </div>
  );
}
