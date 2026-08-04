"use client";

/**
 * AiLookupPanel — the manual, Google-style AI product/strain lookup on the
 * Product Onboarding table (T-314 / T-315).
 *
 * A text box (pre-filled with the product name + vendor) and a Search button.
 * NOTHING runs until the operator clicks it — never auto-run. On a confident
 * strain result (>= 90%) it autofills the row's strain-type <select> (by id)
 * and marks it "AI-filled, review."
 *
 * RESULTS ARE A CURATION WORKSHEET (T-316 "unchain the beast"): every field the
 * AI returns is shown with a KEEP/DISCARD checkbox and an EDITABLE box pre-filled
 * with the AI's text, plus an honest confidence %. The operator picks what to
 * keep, tweaks the wording, and clicks "Save selected" — which sends ONLY the
 * checked + edited fields to the server (re-sanitized there; the client payload
 * is never trusted). Community / low-confidence findings are SURFACED for review
 * instead of being suppressed — the panel shows everything the model gathered
 * (graded by confidence) and lets the human decide. Only a true empty miss shows
 * the honest "couldn't find anything" note.
 *
 * NOT wired to a <form onSubmit>: this panel renders INSIDE the row's `approve`
 * <form>, and nested <form>s are invalid HTML, so a submit here would post the
 * OUTER approve form (a full-page reload) instead of running the action. We use
 * a plain <div> + a button onClick + an Enter handler.
 *
 * Soft-disables when no AI key is configured.
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Input, Textarea } from "@/components/admin/ui";
import {
  productLookupAction,
  saveLookupToKbAction,
  type ProductLookupActionResult,
  type LookupKbDraft,
} from "./ai-lookup-actions";

type Props = {
  draftId: string;
  /** Row context used to prefill the search box + power the save-draft. */
  productName: string;
  vendorOrBrand: string;
  /** DOM id of the row's strain-type <select>, so we can autofill it. */
  strainSelectId: string;
  /** POS product key (or "") — lets Save-to-KB stage enrichment drafts. */
  posProductKey: string;
  /** False when no AI key is set — the panel soft-disables. */
  aiEnabled: boolean;
};

type Ok = Extract<ProductLookupActionResult, { ok: true }>;

const STRAIN_TYPES = [
  "indica",
  "sativa",
  "hybrid",
  "indica-hybrid",
  "sativa-hybrid",
  "cbd",
  "unknown",
] as const;

/**
 * The editable, per-field worksheet the operator curates. Text fields hold a
 * single string; list fields hold a comma-joined string for easy editing. Each
 * has a `keep` flag. Images are tracked as a selected-set of URLs.
 */
type Draft = {
  strainType: string;
  keepStrainType: boolean;
  summary: string;
  keepSummary: boolean;
  effects: string; // comma-joined
  keepEffects: boolean;
  aroma: string; // comma-joined
  keepAroma: boolean;
  flavor: string; // comma-joined
  keepFlavor: boolean;
  lineage: string;
  keepLineage: boolean;
  description: string;
  keepDescription: boolean;
  shortDescription: string;
  keepShortDescription: boolean;
  category: string;
  keepCategory: boolean;
  potencyRatio: string;
  keepPotencyRatio: boolean;
  size: string;
  keepSize: boolean;
  images: string[]; // selected image URLs
};

/** Build the initial worksheet from a lookup result: keep anything non-empty. */
function draftFromResult(d: Ok): Draft {
  const effects = d.effects.join(", ");
  const aroma = d.aromaNotes.join(", ");
  const flavor = d.flavorNotes.join(", ");
  return {
    strainType: d.strainType,
    keepStrainType: d.strainType !== "unknown",
    summary: d.summary,
    keepSummary: d.summary.length > 0,
    effects,
    keepEffects: d.effects.length > 0,
    aroma,
    keepAroma: d.aromaNotes.length > 0,
    flavor,
    keepFlavor: d.flavorNotes.length > 0,
    lineage: d.lineage,
    keepLineage: d.lineage.length > 0,
    description: d.description,
    keepDescription: d.description.length > 0,
    shortDescription: d.shortDescription,
    keepShortDescription: d.shortDescription.length > 0,
    category: d.category,
    keepCategory: d.category.length > 0,
    potencyRatio: d.potencyRatio,
    keepPotencyRatio: d.potencyRatio.length > 0,
    size: d.size,
    keepSize: d.size.length > 0,
    images: [...d.imageCandidates], // all pre-selected; deselect to drop
  };
}

/** Split a comma/newline-separated editable string into a clean list. */
function splitList(v: string): string[] {
  return v
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AiLookupPanel({
  draftId,
  productName,
  vendorOrBrand,
  strainSelectId,
  posProductKey,
  aiEnabled,
}: Props) {
  const initialQuery = [productName, vendorOrBrand].filter(Boolean).join(" ").trim();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Ok | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | "saved" | "saving-error">(null);
  const [saveMsg, setSaveMsg] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();

  function up<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function run(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.();
    if (!query.trim()) return;
    setError(null);
    setData(null);
    setDraft(null);
    setSaved(null);
    setSaveMsg("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draft_id", draftId);
      fd.set("query", query.trim());
      fd.set("product_name", productName);
      fd.set("vendor_or_brand", vendorOrBrand);
      fd.set("pos_product_key", posProductKey);
      const res = await productLookupAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res);
      setDraft(draftFromResult(res));
      // Autofill the strain-type <select> only when the AI is >= 90% confident.
      if (res.autofillStrainType && res.strainType && res.strainType !== "unknown") {
        const el = document.getElementById(strainSelectId) as HTMLSelectElement | null;
        if (el) {
          const match = Array.from(el.options).find((o) => o.value === res.strainType);
          if (match) el.value = res.strainType;
        }
      }
    });
  }

  /** Build a curated LookupKbDraft from ONLY the checked + edited fields. */
  const curated: LookupKbDraft | null = useMemo(() => {
    if (!data || !draft) return null;
    return {
      name: productName || query,
      strainType: (draft.keepStrainType ? draft.strainType : "unknown") as LookupKbDraft["strainType"],
      strainTypeConfidence: draft.keepStrainType ? data.strainTypeConfidence : 0,
      summary: draft.keepSummary ? draft.summary.trim() : "",
      effects: draft.keepEffects ? splitList(draft.effects) : [],
      aromaNotes: draft.keepAroma ? splitList(draft.aroma) : [],
      flavorNotes: draft.keepFlavor ? splitList(draft.flavor) : [],
      lineage: draft.keepLineage ? draft.lineage.trim() : "",
      sources: data.sources,
      posProductKey,
      description: draft.keepDescription ? draft.description.trim() : "",
      shortDescription: draft.keepShortDescription ? draft.shortDescription.trim() : "",
      category: draft.keepCategory ? draft.category.trim() : "",
      potencyRatio: draft.keepPotencyRatio ? draft.potencyRatio.trim() : "",
      size: draft.keepSize ? draft.size.trim() : "",
      imageCandidates: draft.images,
    };
  }, [data, draft, productName, query, posProductKey]);

  /** How many fields are currently checked to keep (for the button label). */
  const keptCount = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    if (draft.keepStrainType && draft.strainType !== "unknown") n++;
    if (draft.keepSummary && draft.summary.trim()) n++;
    if (draft.keepEffects && draft.effects.trim()) n++;
    if (draft.keepAroma && draft.aroma.trim()) n++;
    if (draft.keepFlavor && draft.flavor.trim()) n++;
    if (draft.keepLineage && draft.lineage.trim()) n++;
    if (draft.keepDescription && draft.description.trim()) n++;
    if (draft.keepShortDescription && draft.shortDescription.trim()) n++;
    if (draft.keepCategory && draft.category.trim()) n++;
    if (draft.keepPotencyRatio && draft.potencyRatio.trim()) n++;
    if (draft.keepSize && draft.size.trim()) n++;
    n += draft.images.length;
    return n;
  }, [draft]);

  function saveSelected() {
    if (!curated) return;
    setSaved(null);
    setSaveMsg("");
    startSaveTransition(async () => {
      const fd = new FormData();
      fd.set("draft_id", draftId);
      fd.set("payload", JSON.stringify(curated));
      const res = await saveLookupToKbAction(fd);
      if (res.ok) {
        setSaved("saved");
      } else {
        setSaved("saving-error");
        setSaveMsg(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/15"
        aria-label="Open AI lookup"
      >
        <span aria-hidden>🔍</span> AI Lookup
      </button>
    );
  }

  return (
    <div className="mt-1 w-80 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-bold text-[var(--admin-accent)]">
          <span aria-hidden>🤖</span> AI Lookup
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]"
          aria-label="Close AI lookup"
        >
          ✕
        </button>
      </div>

      {!aiEnabled ? (
        <p className="text-[11px] text-[var(--admin-gold)]">
          Turns on once an <code className="font-mono">AI_API_KEY</code> (or{" "}
          <code className="font-mono">OPENAI_API_KEY</code>) is set.
        </p>
      ) : (
        <>
          {/* Google-style box + button. Nothing runs until the button is clicked
              (or Enter is pressed). Plain <div>, NOT a <form> — nested forms are
              invalid HTML inside the row's approve form. */}
          <div className="flex items-center gap-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder="Strain or product + brand…"
              className="h-8 w-full text-[11px]"
              aria-label="AI lookup search terms"
            />
            <Button
              type="button"
              onClick={() => run()}
              variant="special"
              size="sm"
              disabled={pending || !query.trim()}
            >
              {pending ? "…" : "Search"}
            </Button>
          </div>

          {error && <p className="mt-1.5 text-[11px] text-[var(--admin-danger)]">{error}</p>}

          {data && draft && (
            <div className="mt-2 max-h-[26rem] space-y-2 overflow-y-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 p-2 text-[11px]">
              {/* Headline banner: overall confidence + live-web vs. AI-knowledge. */}
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span
                  className={
                    data.confidence >= 85
                      ? "rounded bg-[var(--admin-accent-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--admin-accent)]"
                      : data.confidence >= 50
                        ? "rounded bg-[var(--admin-gold)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[var(--admin-gold)]"
                        : "rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--admin-text-muted)]"
                  }
                >
                  {data.confidence}% confidence
                </span>
                <span className="text-[10px] text-[var(--admin-text-faint)]">
                  {data.usedWebSearch ? "🌐 Live web search" : "⚠️ AI knowledge (no live search)"}
                </span>
              </div>

              {!data.hasAnyFindings ? (
                <p className="text-[var(--admin-gold)]">{data.honestMiss}</p>
              ) : (
                <>
                  {!data.found && (
                    <p className="rounded border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/10 px-1.5 py-1 text-[10px] text-[var(--admin-gold)]">
                      Low-confidence / community info — please review carefully before keeping.
                    </p>
                  )}
                  <p className="text-[10px] text-[var(--admin-text-faint)]">
                    Check the fields you want, edit the wording, then Save selected.
                  </p>

                  {/* Strain type — a dropdown row with its own confidence %. */}
                  <FieldRow
                    label="Strain type"
                    kept={draft.keepStrainType}
                    onKeep={(v) => up("keepStrainType", v)}
                    badge={`${data.strainTypeConfidence}%${data.autofillStrainType ? " · autofilled" : ""}`}
                  >
                    <select
                      value={draft.strainType}
                      onChange={(e) => up("strainType", e.target.value)}
                      disabled={!draft.keepStrainType}
                      className="h-7 w-full rounded border border-[var(--admin-border)] bg-black/40 px-1 text-[11px] capitalize text-[var(--admin-text)] disabled:opacity-50"
                    >
                      {STRAIN_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace("-", " ")}
                        </option>
                      ))}
                    </select>
                  </FieldRow>

                  <FieldRow
                    label="Category"
                    kept={draft.keepCategory}
                    onKeep={(v) => up("keepCategory", v)}
                    show={Boolean(data.category || draft.category)}
                  >
                    <Input
                      value={draft.category}
                      onChange={(e) => up("category", e.target.value)}
                      disabled={!draft.keepCategory}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Summary"
                    kept={draft.keepSummary}
                    onKeep={(v) => up("keepSummary", v)}
                    show={Boolean(data.summary || draft.summary)}
                  >
                    <Textarea
                      value={draft.summary}
                      onChange={(e) => up("summary", e.target.value)}
                      disabled={!draft.keepSummary}
                      rows={2}
                      className="w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Description"
                    kept={draft.keepDescription}
                    onKeep={(v) => up("keepDescription", v)}
                    show={Boolean(data.description || draft.description)}
                  >
                    <Textarea
                      value={draft.description}
                      onChange={(e) => up("description", e.target.value)}
                      disabled={!draft.keepDescription}
                      rows={3}
                      className="w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Short line"
                    kept={draft.keepShortDescription}
                    onKeep={(v) => up("keepShortDescription", v)}
                    show={Boolean(data.shortDescription || draft.shortDescription)}
                  >
                    <Input
                      value={draft.shortDescription}
                      onChange={(e) => up("shortDescription", e.target.value)}
                      disabled={!draft.keepShortDescription}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Vibe / effects"
                    kept={draft.keepEffects}
                    onKeep={(v) => up("keepEffects", v)}
                    show={Boolean(data.effects.length || draft.effects)}
                    hint="comma-separated"
                  >
                    <Input
                      value={draft.effects}
                      onChange={(e) => up("effects", e.target.value)}
                      disabled={!draft.keepEffects}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Aroma"
                    kept={draft.keepAroma}
                    onKeep={(v) => up("keepAroma", v)}
                    show={Boolean(data.aromaNotes.length || draft.aroma)}
                    hint="comma-separated"
                  >
                    <Input
                      value={draft.aroma}
                      onChange={(e) => up("aroma", e.target.value)}
                      disabled={!draft.keepAroma}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Flavor"
                    kept={draft.keepFlavor}
                    onKeep={(v) => up("keepFlavor", v)}
                    show={Boolean(data.flavorNotes.length || draft.flavor)}
                    hint="comma-separated"
                  >
                    <Input
                      value={draft.flavor}
                      onChange={(e) => up("flavor", e.target.value)}
                      disabled={!draft.keepFlavor}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Lineage"
                    kept={draft.keepLineage}
                    onKeep={(v) => up("keepLineage", v)}
                    show={Boolean(data.lineage || draft.lineage)}
                  >
                    <Input
                      value={draft.lineage}
                      onChange={(e) => up("lineage", e.target.value)}
                      disabled={!draft.keepLineage}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Potency ratio"
                    kept={draft.keepPotencyRatio}
                    onKeep={(v) => up("keepPotencyRatio", v)}
                    show={Boolean(data.potencyRatio || draft.potencyRatio)}
                  >
                    <Input
                      value={draft.potencyRatio}
                      onChange={(e) => up("potencyRatio", e.target.value)}
                      disabled={!draft.keepPotencyRatio}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label="Size"
                    kept={draft.keepSize}
                    onKeep={(v) => up("keepSize", v)}
                    show={Boolean(data.size || draft.size)}
                  >
                    <Input
                      value={draft.size}
                      onChange={(e) => up("size", e.target.value)}
                      disabled={!draft.keepSize}
                      className="h-7 w-full text-[11px]"
                    />
                  </FieldRow>

                  {/* Image candidates — selectable thumbnails. Click to toggle
                      keep/discard; nothing is auto-imported. */}
                  {data.imageCandidates.length > 0 && (
                    <div className="text-[10px] text-[var(--admin-text-faint)]">
                      <div className="mb-1">
                        Images ({draft.images.length}/{data.imageCandidates.length} kept) — tap to
                        toggle · review only, never auto-imported
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {data.imageCandidates.map((u, i) => {
                          const on = draft.images.includes(u);
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() =>
                                up(
                                  "images",
                                  on
                                    ? draft.images.filter((x) => x !== u)
                                    : [...draft.images, u],
                                )
                              }
                              title={u}
                              className={
                                on
                                  ? "relative block h-12 w-12 overflow-hidden rounded border-2 border-[var(--admin-accent)] bg-black/40"
                                  : "relative block h-12 w-12 overflow-hidden rounded border border-[var(--admin-border)] bg-black/40 opacity-50"
                              }
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt="" className="h-full w-full object-cover" />
                              <span
                                className={
                                  on
                                    ? "absolute right-0 top-0 bg-[var(--admin-accent)] px-0.5 text-[9px] font-bold text-black"
                                    : "absolute right-0 top-0 bg-black/70 px-0.5 text-[9px] text-white"
                                }
                                aria-hidden
                              >
                                {on ? "✓" : "+"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {data.sources.length > 0 && (
                    <div className="text-[10px] text-[var(--admin-text-faint)]">
                      Sources:{" "}
                      {data.sources.slice(0, 6).map((s, i) => (
                        <a
                          key={i}
                          href={s}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="underline hover:text-[var(--admin-accent)]"
                        >
                          [{i + 1}]{" "}
                        </a>
                      ))}
                    </div>
                  )}

                  {data.rejectedEffects.length > 0 && (
                    <p className="text-[10px] text-[var(--admin-text-faint)]">
                      Filtered for compliance: {data.rejectedEffects.map((r) => r.effect).join(", ")}
                    </p>
                  )}

                  <div className="text-[10px] text-[var(--admin-text-faint)]">{data.model}</div>

                  {/* Save selected — sends ONLY the checked + edited fields. The
                      server re-sanitizes; the client payload is never trusted. */}
                  <div className="mt-1 border-t border-[var(--admin-border)] pt-1.5">
                    {saved === "saved" ? (
                      <p className="text-[var(--admin-accent)]">
                        ✓ Saved as a draft. Nothing publishes until you approve it on the KB /
                        enrichment page.
                      </p>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--admin-text-muted)]">
                          {keptCount} field{keptCount === 1 ? "" : "s"} selected
                        </span>
                        <Button
                          type="button"
                          variant="save"
                          size="sm"
                          onClick={saveSelected}
                          disabled={savePending || keptCount === 0}
                        >
                          {savePending ? "Saving…" : "Save selected"}
                        </Button>
                      </div>
                    )}
                    {saved === "saving-error" && (
                      <p className="mt-1 text-[var(--admin-danger)]">
                        {saveMsg || "Could not save the draft. Try again."}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One curation row: a keep/discard checkbox, a label (+ optional confidence
 * badge / hint), and the editable control passed as children. Hidden entirely
 * when `show` is false (nothing to curate for that field).
 */
function FieldRow({
  label,
  kept,
  onKeep,
  children,
  badge,
  hint,
  show = true,
}: {
  label: string;
  kept: boolean;
  onKeep: (v: boolean) => void;
  children: React.ReactNode;
  badge?: string;
  hint?: string;
  show?: boolean;
}) {
  if (!show) return null;
  return (
    <div className="space-y-0.5">
      <label className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--admin-text-muted)]">
        <input
          type="checkbox"
          checked={kept}
          onChange={(e) => onKeep(e.target.checked)}
          className="h-3 w-3 accent-[var(--admin-accent)]"
        />
        <span>{label}</span>
        {badge && (
          <span className="rounded bg-white/10 px-1 text-[9px] text-[var(--admin-text-faint)]">
            {badge}
          </span>
        )}
        {hint && <span className="text-[9px] font-normal text-[var(--admin-text-faint)]">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
