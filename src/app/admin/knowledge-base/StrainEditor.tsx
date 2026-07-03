"use client";

import { useState } from "react";
import { Button } from "@/components/admin/ui/Button";
import type { KbStrainFull } from "@/lib/ai/kb/store";
import { upsertStrainAction, toggleStrainAction } from "./actions";
import {
  strainTypeDefinitions,
  strainTypeLabel,
  canonicalStrainType,
} from "@/lib/menu/strain-taxonomy";
import { scoreStrain } from "@/lib/ai/kb/quality";
import { QualityBadge } from "./QualityBadge";

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
}: {
  strains: KbStrainFull[];
  migrated: boolean;
  total: number;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  }

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
        <label className="text-sm">
          <span className={labelCls}>Dominant terpenes (comma-separated)</span>
          <input
            name="terpenes"
            value={form.terpenes}
            onChange={(e) => set("terpenes", e.target.value)}
            className={inputCls}
            placeholder="e.g. myrcene, pinene, caryophyllene"
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Aroma notes (comma-separated, sensory only)</span>
          <input
            name="aroma_notes"
            value={form.aroma_notes}
            onChange={(e) => set("aroma_notes", e.target.value)}
            className={inputCls}
            placeholder="e.g. berry, sweet, herbal"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>Flavor notes (comma-separated, sensory only)</span>
          <input
            name="flavor_notes"
            value={form.flavor_notes}
            onChange={(e) => set("flavor_notes", e.target.value)}
            className={inputCls}
            placeholder="e.g. blueberry, sweet, vanilla"
          />
        </label>

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
                      {s.active ? "Active" : "Hidden"}
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
