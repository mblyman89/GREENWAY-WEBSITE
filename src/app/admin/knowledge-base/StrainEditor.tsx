"use client";

import { useState } from "react";
import { Button } from "@/components/admin/ui/Button";
import type { KbStrainFull } from "@/lib/ai/kb/store";
import type { StrainVocab } from "@/lib/ai/kb/strain-vocab-core";
import type { StrainTypeSuggestion } from "@/lib/ai/kb/strain-type-suggest-core";
import { houseSuggestedSourceTag } from "@/lib/ai/kb/strain-type-suggest-core";
import { upsertStrainAction, toggleStrainAction } from "./actions";
import {
  strainTypeDefinitions,
  strainTypeLabel,
  canonicalStrainType,
} from "@/lib/menu/strain-taxonomy";
import { scoreStrain } from "@/lib/ai/kb/quality";
import { QualityBadge } from "./QualityBadge";
import { TermMultiSelect } from "./TermMultiSelect";
import { StrainLookupPanel } from "./StrainLookupPanel";
import type { StrainLookupActionResult } from "./strain-lookup-actions";

type LookupOk = Extract<StrainLookupActionResult, { ok: true }>;

// Canonical strain-type options for the staff dropdown. Sourced from the single
// taxonomy so the leaning hybrids (Indica-Hybrid / Sativa-Hybrid) stay in sync
// with the website menu, POS transform, and everywhere else. CCRS export is
// untouched (it collapses these to "Hybrid" separately).
const STRAIN_TYPE_OPTIONS = strainTypeDefinitions.map((d) => ({
  value: d.value,
  label: d.label,
}));

const inputCls =
  "mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const labelCls = "block text-xs font-medium text-[var(--admin-text-muted)]";

type FormState = {
  slug: string;
  name: string;
  strain_type: string;
  lineage: string;
  aliases: string;
  aroma_notes: string;
  flavor_notes: string;
  terpenes: string;
  dominant_cannabinoid: string;
  potency_note: string;
  bud_structure: string;
  origin: string;
  sources: string;
  confidence: string;
  summary: string;
  active: boolean;
};

const EMPTY: FormState = {
  slug: "",
  name: "",
  strain_type: "hybrid",
  lineage: "",
  aliases: "",
  aroma_notes: "",
  flavor_notes: "",
  terpenes: "",
  dominant_cannabinoid: "",
  potency_note: "",
  bud_structure: "",
  origin: "",
  sources: "",
  confidence: "",
  summary: "",
  active: true,
};

function rowToForm(s: KbStrainFull): FormState {
  return {
    slug: s.slug ?? "",
    name: s.name ?? "",
    strain_type: s.strain_type ?? "hybrid",
    lineage: s.lineage ?? "",
    aliases: (s.aliases ?? []).join(", "),
    aroma_notes: (s.aroma_notes ?? []).join(", "),
    flavor_notes: (s.flavor_notes ?? []).join(", "),
    terpenes: (s.terpenes ?? []).join(", "),
    dominant_cannabinoid: s.dominant_cannabinoid ?? "",
    potency_note: s.potency_note ?? "",
    bud_structure: s.bud_structure ?? "",
    origin: s.origin ?? "",
    sources: (s.sources ?? []).join(", "),
    confidence: s.confidence === null || s.confidence === undefined ? "" : String(s.confidence),
    summary: s.summary ?? "",
    active: s.active,
  };
}

export function StrainEditor({
  strains,
  migrated,
  total,
  vocab,
  strainTypeSuggestions,
  aiEnabled,
}: {
  strains: KbStrainFull[];
  migrated: boolean;
  total: number;
  vocab: StrainVocab;
  strainTypeSuggestions: Record<string, StrainTypeSuggestion>;
  aiEnabled: boolean;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The strain name the look-up panel should start from (set when you click
  // "Enrich with Gemini" on a row so it targets that exact strain).
  const [lookupSeed, setLookupSeed] = useState("");
  // Auto-run trigger for the look-up panel (Enrich-in-place). Bumping the key
  // remounts the panel with the seeded name so it re-runs cleanly.
  const [lookupKey, setLookupKey] = useState(0);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  // Two independent terpene checkboxes ("Has terpenes" / "No terpenes"). When
  // both are on (or both off) we show everything.
  const [hasTerps, setHasTerps] = useState(false);
  const [noTerps, setNoTerps] = useState(false);
  // Sort is intentionally only A–Z / Z–A (owner request).
  const [sortBy, setSortBy] = useState<"az" | "za">("az");

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Change handler for the three sensory list fields (terpenes / aroma / flavor).
  // If the new value contains any term that is a house-suggested (type-typical)
  // value from the chips, we honestly tag `sources` with
  // "house-suggested (<type> typical)" so the provenance is auditable and never
  // silently passed off as a real finding. The tag is added once (de-duped) and
  // is removed again if no house-suggested terms remain selected across all
  // three fields.
  function setListWithHouseTag(key: "terpenes" | "aroma_notes" | "flavor_notes", value: string) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (!suggestion || !acceptedHouseTag) return next;
      const suggested = new Set(
        [
          ...suggestion.terpenes,
          ...suggestion.aromaNotes,
          ...suggestion.flavorNotes,
        ].map((t) => t.toLowerCase()),
      );
      const anySuggestedSelected = (["terpenes", "aroma_notes", "flavor_notes"] as const)
        .flatMap((k) => next[k].split(",").map((s) => s.trim().toLowerCase()))
        .filter(Boolean)
        .some((t) => suggested.has(t));
      const currentSources = next.sources
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const hasTag = currentSources.some((s) => s.toLowerCase() === acceptedHouseTag.toLowerCase());
      if (anySuggestedSelected && !hasTag) {
        next.sources = [...currentSources, acceptedHouseTag].join(", ");
      } else if (!anySuggestedSelected && hasTag) {
        next.sources = currentSources
          .filter((s) => s.toLowerCase() !== acceptedHouseTag.toLowerCase())
          .join(", ");
      }
      return next;
    });
  }

  function startEdit(s: KbStrainFull) {
    setForm(rowToForm(s));
    setEditingId(s.id);
    if (typeof document !== "undefined") {
      document.getElementById("strain-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function reset() {
    setForm(EMPTY);
    setEditingId(null);
    setLookupSeed("");
  }

  // Merge two comma-lists (existing + found), de-duped case-insensitively,
  // keeping the operator's existing picks first so a look-up never deletes work.
  function mergeCsv(existing: string, found: string[]): string {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    existing
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach(push);
    found.forEach(push);
    return out.join(", ");
  }

  // Fill the form from a Gemini look-up. We only fill EMPTY scalar fields (so we
  // never clobber something you already typed or a row you're editing) and MERGE
  // the list fields. The name always reflects what was searched. Everything is
  // then yours to review/edit before you press Add strain — nothing is saved.
  function fillFromLookup(r: LookupOk) {
    setForm((f) => {
      const fillScalar = (current: string, next: string) =>
        current.trim() ? current : next;
      return {
        ...f,
        name: f.name.trim() ? f.name : r.strainName,
        strain_type:
          f.strain_type && f.strain_type !== "hybrid"
            ? f.strain_type
            : r.strainType !== "unknown"
              ? r.strainType
              : f.strain_type,
        lineage: fillScalar(f.lineage, r.lineage),
        aliases: mergeCsv(f.aliases, r.aliases),
        terpenes: mergeCsv(f.terpenes, r.terpenes),
        aroma_notes: mergeCsv(f.aroma_notes, r.aromaNotes),
        flavor_notes: mergeCsv(f.flavor_notes, r.flavorNotes),
        dominant_cannabinoid: fillScalar(f.dominant_cannabinoid, r.dominantCannabinoid),
        potency_note: fillScalar(f.potency_note, r.potencyNote),
        bud_structure: fillScalar(f.bud_structure, r.budStructure),
        origin: fillScalar(f.origin, r.origin),
        summary: fillScalar(f.summary, r.summary),
        // Record real Gemini sources for provenance (merged, de-duped).
        sources: mergeCsv(f.sources, r.sources),
        confidence:
          f.confidence.trim()
            ? f.confidence
            : r.confidence > 0
              ? (r.confidence / 100).toFixed(2)
              : f.confidence,
      };
    });
    if (typeof document !== "undefined") {
      document.getElementById("strain-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // "Enrich with Gemini" on a row: load that strain into the form, then seed +
  // trigger the look-up panel so it searches for that exact strain name.
  function enrichRow(s: KbStrainFull) {
    setForm(rowToForm(s));
    setEditingId(s.id);
    setLookupSeed(s.name);
    setLookupKey((k) => k + 1);
    if (typeof document !== "undefined") {
      document.getElementById("strain-lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // The house-suggested chips for the CURRENTLY selected strain type (computed
  // server-side; empty for CBD/unknown). These are one-tap adds, never
  // pre-selected — the honest, WA-safe prefill for fields Gemini couldn't fill.
  // Plain derived value (no useMemo): a single map lookup, and the React
  // Compiler memoizes it for us. Using useMemo here tripped
  // react-hooks/preserve-manual-memoization because we index by a field of the
  // `form` object.
  const suggestion = strainTypeSuggestions[canonicalStrainType(form.strain_type)];
  const acceptedHouseTag = suggestion ? houseSuggestedSourceTag(suggestion.type) : "";

  // Type filter.
  //
  // The two leaning designations (Indica-Hybrid / Sativa-Hybrid) are carried by
  // the verified `leaning` column (migration 0074), NOT by `strain_type` — the
  // strain_type field itself is only ever indica/sativa/hybrid for most rows.
  // So for those two options we match on `leaning` (falling back to strain_type
  // if a row happens to store the leaning there too). The base indica/sativa/
  // hybrid options match on the canonical strain_type. This is why the leaning
  // filter previously blanked the table — nothing had a leaning *strain_type*.
  function matchesType(s: KbStrainFull, want: string): boolean {
    if (want === "all") return true;
    if (want === "indica-hybrid" || want === "sativa-hybrid") {
      const lean = canonicalStrainType(s.leaning ?? s.strain_type);
      return lean === want;
    }
    if (want === "cbd") {
      // A strain is CBD-relevant if either its canonical type is cbd OR its
      // dominant cannabinoid is cbd (the CBD lab-data seed, migration 0075,
      // sets dominant_cannabinoid='cbd' while keeping the botanical strain_type
      // like indica/sativa/hybrid).
      return (
        canonicalStrainType(s.strain_type) === "cbd" ||
        (s.dominant_cannabinoid ?? "").trim().toLowerCase() === "cbd"
      );
    }
    // Base type: don't let a leaning row also show under plain "hybrid" via its
    // strain_type; just compare the canonical strain_type directly.
    return canonicalStrainType(s.strain_type) === want;
  }

  const q = query.trim().toLowerCase();
  const filtered = strains
    .filter((s) => {
      if (q) {
        const hit =
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          (s.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
          (s.terpenes ?? []).some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (!matchesType(s, typeFilter)) return false;
      // Terpene checkboxes. When exactly one is ticked we filter to it; when
      // both (or neither) are ticked we show everything.
      const hasTerpData = (s.terpenes ?? []).length > 0;
      if (hasTerps && !noTerps && !hasTerpData) return false;
      if (noTerps && !hasTerps && hasTerpData) return false;
      return true;
    })
    .sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortBy === "za" ? -cmp : cmp;
    });

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--admin-text)]">
          Add or edit a strain
        </h2>
        {editingId ? (
          <span className="rounded-full bg-[var(--admin-accent-soft)] px-3 py-1 text-xs text-[var(--admin-text)]">
            Editing — saving updates this strain
          </span>
        ) : (
          <span className="rounded-full bg-[var(--admin-bg)] px-3 py-1 text-xs text-[var(--admin-text-muted)]">
            New strain
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
        Add a verified strain you found or were told about by a supplier, with every detail the AI
        can use. <strong>Sensory &amp; factual only</strong> — aroma, flavor, lineage, terpenes. There
        is no place for health or effect claims, because Washington advertising rules don&apos;t allow
        them. Brand info isn&apos;t here — that lives on the Vendors page.
      </p>

      {/* Gemini strain look-up — one job: find strain info and fill the form
          below for review. Nothing saves here. */}
      <div id="strain-lookup" className="mt-4 scroll-mt-24">
        <StrainLookupPanel
          key={lookupKey}
          aiEnabled={aiEnabled}
          initialName={lookupSeed}
          onFill={(r) => fillFromLookup(r)}
        />
      </div>

      {/* The form posts to the server action. State is controlled so we can pre-fill on edit. */}
      <form id="strain-form" action={upsertStrainAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={labelCls}>Strain name *</span>
          <input
            name="name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
            placeholder="e.g. Blue Dream"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>Slug (leave blank to auto-derive from the name)</span>
          <input
            name="slug"
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            className={inputCls}
            placeholder="auto: blue dream"
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Type *</span>
          <select
            name="strain_type"
            value={form.strain_type}
            onChange={(e) => set("strain_type", e.target.value)}
            className={inputCls}
          >
            {STRAIN_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className={labelCls}>Lineage (parent cross, factual)</span>
          <input
            name="lineage"
            value={form.lineage}
            onChange={(e) => set("lineage", e.target.value)}
            className={inputCls}
            placeholder="e.g. Blueberry x Haze"
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Aliases (comma-separated nicknames / spellings)</span>
          <input
            name="aliases"
            value={form.aliases}
            onChange={(e) => set("aliases", e.target.value)}
            className={inputCls}
            placeholder="e.g. bluedream, blue dream haze"
          />
        </label>
        <TermMultiSelect
          name="terpenes"
          label="Dominant terpenes"
          value={form.terpenes}
          onChange={(v) => setListWithHouseTag("terpenes", v)}
          options={vocab.terpenes}
          suggestions={suggestion?.terpenes ?? []}
          datalistId="dl-terpenes"
          placeholder="Type or pick a terpene…"
        />

        <TermMultiSelect
          name="aroma_notes"
          label="Aroma notes (sensory only)"
          value={form.aroma_notes}
          onChange={(v) => setListWithHouseTag("aroma_notes", v)}
          options={vocab.aromaNotes}
          suggestions={suggestion?.aromaNotes ?? []}
          datalistId="dl-aroma"
          placeholder="Type or pick an aroma…"
        />

        <TermMultiSelect
          name="flavor_notes"
          label="Flavor notes (sensory only)"
          value={form.flavor_notes}
          onChange={(v) => setListWithHouseTag("flavor_notes", v)}
          options={vocab.flavorNotes}
          suggestions={suggestion?.flavorNotes ?? []}
          datalistId="dl-flavor"
          placeholder="Type or pick a flavor…"
        />

        <label className="text-sm">
          <span className={labelCls}>Dominant cannabinoid</span>
          <input
            name="dominant_cannabinoid"
            value={form.dominant_cannabinoid}
            onChange={(e) => set("dominant_cannabinoid", e.target.value)}
            className={inputCls}
            placeholder="e.g. thc, cbd, balanced"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>Potency note (factual, no claims)</span>
          <input
            name="potency_note"
            value={form.potency_note}
            onChange={(e) => set("potency_note", e.target.value)}
            className={inputCls}
            placeholder="e.g. ~18-24% THC"
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Bud structure</span>
          <input
            name="bud_structure"
            value={form.bud_structure}
            onChange={(e) => set("bud_structure", e.target.value)}
            className={inputCls}
            placeholder="e.g. dense, frosty"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>Origin</span>
          <input
            name="origin"
            value={form.origin}
            onChange={(e) => set("origin", e.target.value)}
            className={inputCls}
            placeholder="e.g. United States"
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Sources (comma-separated)</span>
          <input
            name="sources"
            value={form.sources}
            onChange={(e) => set("sources", e.target.value)}
            className={inputCls}
            placeholder="e.g. leafly, allbud"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>Confidence (0 to 1, optional)</span>
          <input
            name="confidence"
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={form.confidence}
            onChange={(e) => set("confidence", e.target.value)}
            className={inputCls}
            placeholder="e.g. 0.85"
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className={labelCls}>Summary (1–2 sentence factual, non-medical blurb)</span>
          <textarea
            name="summary"
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            rows={2}
            className={inputCls}
            placeholder="A balanced hybrid with sweet berry aroma and a smooth, fruity flavor."
          />
        </label>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="active"
            value="true"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
            className="h-4 w-4 rounded border-[var(--admin-border)]"
          />
          <span className="text-[var(--admin-text-muted)]">
            Active — the AI is allowed to use this strain (uncheck to hide it without deleting).
          </span>
          {/* Ensure a value is always submitted even when unchecked. */}
          {!form.active ? <input type="hidden" name="active" value="false" /> : null}
        </label>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={!migrated}>
            {editingId ? "Save changes" : "Add strain"}
          </Button>
          {editingId ? (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-[var(--admin-text-muted)] hover:underline"
            >
              Cancel edit / start a new strain
            </button>
          ) : null}
        </div>
      </form>

      {/* Manage list — click a row to edit, toggle active. */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">
          Manage strains ({total})
        </h3>

        {/* Search, sort & filter all live on the same row so the whole verified
            library is easy to browse in one place. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-56 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-1.5 text-sm text-[var(--admin-text)]"
            placeholder="Search name, alias, terpene…"
          />
          <div className="flex overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)] text-xs">
            {[
              { v: "all", label: "All types" },
              { v: "indica", label: "Indica" },
              { v: "sativa", label: "Sativa" },
              { v: "hybrid", label: "Hybrid" },
              { v: "indica-hybrid", label: "Indica-Hybrid" },
              { v: "sativa-hybrid", label: "Sativa-Hybrid" },
              { v: "cbd", label: "CBD" },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setTypeFilter(opt.v)}
                className={
                  "px-3 py-1.5 " +
                  (typeFilter === opt.v
                    ? "bg-[var(--admin-accent-soft)] text-[var(--admin-text)]"
                    : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
            <input
              type="checkbox"
              checked={hasTerps}
              onChange={(e) => setHasTerps(e.target.checked)}
              className="accent-[var(--admin-accent)]"
            />
            Has terpenes
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
            <input
              type="checkbox"
              checked={noTerps}
              onChange={(e) => setNoTerps(e.target.checked)}
              className="accent-[var(--admin-accent)]"
            />
            No terpenes
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "az" | "za")}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-xs text-[var(--admin-text)]"
            aria-label="Sort strains"
          >
            <option value="az">Sort: A–Z</option>
            <option value="za">Sort: Z–A</option>
          </select>
          <span className="text-xs text-[var(--admin-text-muted)]">
            {filtered.length} shown
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            {strains.length === 0
              ? "No strains yet. Add one above, or seed the expert starter set."
              : "No strains match these filters. Try clearing the type, terpene, or search filters."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--admin-text-muted)]">
                  <th className="py-2 pr-4 font-medium">Strain</th>
                  <th className="py-2 pr-4 font-medium">Health</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Ratio (I / S)</th>
                  <th className="py-2 pr-4 font-medium">Terpenes</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--admin-border)]">
                    <td className="py-2 pr-4 text-[var(--admin-text)]">
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="text-left hover:underline"
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="py-2 pr-4">
                      {(() => {
                        const sc = scoreStrain(s as unknown as Record<string, unknown>);
                        return (
                          <QualityBadge
                            quality={sc.quality}
                            grade={sc.grade}
                            completeness={sc.completeness}
                          />
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4 text-[var(--admin-text-muted)]">
                      {s.strain_type ? strainTypeLabel(s.strain_type) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-[var(--admin-text-muted)]">
                      {(() => {
                        // Show the verified indica/sativa split when we have it.
                        // NULL means no verified ratio — never render as 0%.
                        const ind = s.indica_pct;
                        const sat = s.sativa_pct;
                        if (ind === null && sat === null) return "—";
                        const i = ind ?? 0;
                        const sv = sat ?? 0;
                        return (
                          <span
                            className="whitespace-nowrap"
                            title={
                              s.ratio_source
                                ? `Source: ${s.ratio_source}`
                                : undefined
                            }
                          >
                            {i}% / {sv}%
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4 text-[var(--admin-text-muted)]">
                      {(s.terpenes ?? []).join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-4 text-[var(--admin-text-muted)]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{s.active ? "Active" : "Hidden"}</span>
                        {/* GAP 6 (migration 0085): drafts-only lifecycle + provenance.
                            A machine-suggested strain lands as 'draft' until a human
                            promotes it; curated rows are 'published'. Only render when
                            the column exists (undefined pre-0085 → no pill). */}
                        {s.status === "draft" ? (
                          <span
                            className="rounded-full bg-[var(--admin-orange-soft,rgba(180,83,9,0.12))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-orange,#b45309)]"
                            title="Machine-suggested — needs human review before it grounds the AI"
                          >
                            Draft
                          </span>
                        ) : s.status === "archived" ? (
                          <span className="rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                            Archived
                          </span>
                        ) : null}
                        {s.source && s.source !== "manual" ? (
                          <span
                            className="rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-[10px] text-[var(--admin-text-faint)]"
                            title={`Provenance: ${s.source}`}
                          >
                            {s.source}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(s)}
                          className="text-xs text-[var(--admin-accent)] hover:underline"
                        >
                          Edit
                        </button>
                        {aiEnabled ? (
                          <button
                            type="button"
                            onClick={() => enrichRow(s)}
                            className="text-xs text-[var(--admin-accent)] hover:underline"
                            title="Load this strain into the form and look it up with Gemini"
                          >
                            Enrich with Gemini
                          </button>
                        ) : null}
                        <form action={toggleStrainAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="active" value={(!s.active).toString()} />
                          <button
                            type="submit"
                            className="text-xs text-[var(--admin-text-muted)] hover:underline"
                          >
                            {s.active ? "Hide" : "Enable"}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
