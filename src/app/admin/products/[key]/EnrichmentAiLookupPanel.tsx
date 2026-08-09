"use client";

/**
 * EnrichmentAiLookupPanel — the AI PRODUCT LOOK-UP (Gemini) on the product
 * enrichment page.
 *
 * A pre-filled search box (product name + brand + category, sharpened) and a
 * "Look this up" button. NOTHING runs until the operator clicks it — never
 * auto-run, so there's no surprise AI spend. On a result, every field the AI
 * returns is shown as a curation worksheet: a Keep/Discard checkbox + an
 * editable box, an honest confidence %, whether it used LIVE web search or fell
 * back to built-in knowledge, and the REAL source links it consulted.
 *
 * "Save selected" sends ONLY the checked + edited fields to the server, which
 * re-sanitizes them (the client payload is never trusted) and stages them as
 * DRAFTS on this page — description/notes become suggestions to Accept, images
 * go to the review tray. An optional "Also save as KB strain draft" toggle
 * writes a reusable kb_strains draft so a confident strain adds terpene/aroma
 * richness to the product detail page (even for edibles).
 *
 * Each source URL gets a "Deep-read this page →" button that hands the URL to
 * the crawl4ai "Web research" box on the same page (fills its input by id +
 * scrolls to it), so the owner never has to hunt a URL by hand: Gemini finds
 * it, crawl4ai verifies it.
 *
 * Soft-disables when no AI key is configured.
 */

import { useMemo, useState, useTransition } from "react";
import { Button, Input, Textarea } from "@/components/admin/ui";
import {
  enrichmentLookupAction,
  enrichmentSaveLookupAction,
  type EnrichmentLookupActionResult,
  type EnrichmentLookupDraft,
} from "../ai-lookup-actions";

type Props = {
  /** POS product key (the [key] route) — always present here. */
  productKey: string;
  productName: string;
  vendorOrBrand: string;
  /** The sharpened default query (name + brand + category), built server-side. */
  initialQuery: string;
  /** False when no AI key is set — the panel soft-disables. */
  aiEnabled: boolean;
  /**
   * id of the crawl4ai "Web research" url <input> on this same page. The
   * "Deep-read →" button fills that input and scrolls to it. Passing an id
   * (not a function) keeps this a plain client island a server page can render.
   */
  crawlerInputId: string;
  /** id of the crawl4ai section to scroll into view after filling. */
  crawlerAnchorId: string;
};

type Ok = Extract<EnrichmentLookupActionResult, { ok: true }>;

const STRAIN_TYPES = [
  "indica",
  "sativa",
  "hybrid",
  "indica-hybrid",
  "sativa-hybrid",
  "cbd",
  "unknown",
] as const;

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
  images: string[];
};

function draftFromResult(d: Ok): Draft {
  return {
    strainType: d.strainType,
    keepStrainType: d.strainType !== "unknown",
    summary: d.summary,
    keepSummary: d.summary.length > 0,
    effects: d.effects.join(", "),
    keepEffects: d.effects.length > 0,
    aroma: d.aromaNotes.join(", "),
    keepAroma: d.aromaNotes.length > 0,
    flavor: d.flavorNotes.join(", "),
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
    images: [...d.imageCandidates],
  };
}

function splitList(v: string): string[] {
  return v
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EnrichmentAiLookupPanel({
  productKey,
  productName,
  vendorOrBrand,
  initialQuery,
  aiEnabled,
  crawlerInputId,
  crawlerAnchorId,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [data, setData] = useState<Ok | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveStrain, setSaveStrain] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | "saved" | "saving-error">(null);
  const [saveMsg, setSaveMsg] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();

  function up<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  // Hand a source URL to the crawl4ai "Web research" box on this page: fill its
  // input and scroll it into view. We target the input/anchor by id (strings
  // passed from the server page) so this island needs no function prop.
  function handleDeepRead(url: string) {
    if (typeof document === "undefined") return;
    const input = document.getElementById(crawlerInputId) as HTMLInputElement | null;
    if (input) {
      input.value = url;
      // Nudge React-controlled or listener-bound inputs to notice the change.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const anchor = document.getElementById(crawlerAnchorId) ?? input;
    anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
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
      fd.set("key", productKey);
      fd.set("query", query.trim());
      fd.set("product_name", productName);
      fd.set("vendor_or_brand", vendorOrBrand);
      const res = await enrichmentLookupAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res);
      setDraft(draftFromResult(res));
    });
  }

  const curated: EnrichmentLookupDraft | null = useMemo(() => {
    if (!data || !draft) return null;
    return {
      name: productName || query,
      strainType: (draft.keepStrainType ? draft.strainType : "unknown") as EnrichmentLookupDraft["strainType"],
      strainTypeConfidence: draft.keepStrainType ? data.strainTypeConfidence : 0,
      summary: draft.keepSummary ? draft.summary.trim() : "",
      effects: draft.keepEffects ? splitList(draft.effects) : [],
      aromaNotes: draft.keepAroma ? splitList(draft.aroma) : [],
      flavorNotes: draft.keepFlavor ? splitList(draft.flavor) : [],
      lineage: draft.keepLineage ? draft.lineage.trim() : "",
      sources: data.sources,
      posProductKey: productKey,
      description: draft.keepDescription ? draft.description.trim() : "",
      shortDescription: draft.keepShortDescription ? draft.shortDescription.trim() : "",
      category: draft.keepCategory ? draft.category.trim() : "",
      potencyRatio: draft.keepPotencyRatio ? draft.potencyRatio.trim() : "",
      size: draft.keepSize ? draft.size.trim() : "",
      imageCandidates: draft.images,
    };
  }, [data, draft, productName, query, productKey]);

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
      fd.set("key", productKey);
      fd.set("payload", JSON.stringify(curated));
      fd.set("save_strain", saveStrain ? "1" : "0");
      const res = await enrichmentSaveLookupAction(fd);
      if (res.ok) {
        setSaved("saved");
      } else {
        setSaved("saving-error");
        setSaveMsg(res.error);
      }
    });
  }

  if (!aiEnabled) {
    return (
      <p className="mt-2 text-xs text-[var(--admin-gold)]">
        The AI look-up turns on once an <code className="rounded bg-black/40 px-1">AI_API_KEY</code>{" "}
        (or <code className="rounded bg-black/40 px-1">OPENAI_API_KEY</code>) is set. Enrichment
        works without it.
      </p>
    );
  }

  return (
    <div className="mt-3">
      {/* Search box + button. Nothing runs until clicked (or Enter). */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Product + brand… (or just a strain name)"
          className="min-w-[260px] flex-1 text-sm"
          aria-label="AI look-up search terms"
        />
        <Button
          type="button"
          onClick={() => run()}
          variant="special"
          size="sm"
          disabled={pending || !query.trim()}
        >
          {pending ? "Looking up…" : "Look this up"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-white/45">
        Tip: you can also type just a strain name (e.g. “Blue Dream”) to pull terpene &amp; aroma
        richness for the Knowledge Base. Everything lands below as a draft for your review — nothing
        is applied automatically.
      </p>

      {error && <p className="mt-2 text-xs text-[var(--admin-danger)]">{error}</p>}

      {data && draft && (
        <div className="mt-3 space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 p-3 text-xs">
          {/* Headline: overall confidence + live-web vs. built-in knowledge. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
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

              <FieldRow
                label="Strain type"
                kept={draft.keepStrainType}
                onKeep={(v) => up("keepStrainType", v)}
                badge={`${data.strainTypeConfidence}%`}
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

              {/* Image candidates — selectable thumbnails; nothing auto-imported. */}
              {data.imageCandidates.length > 0 && (
                <div className="text-[10px] text-[var(--admin-text-faint)]">
                  <div className="mb-1">
                    Images ({draft.images.length}/{data.imageCandidates.length} kept) — tap to toggle ·
                    review only, never auto-imported
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.imageCandidates.map((u, i) => {
                      const on = draft.images.includes(u);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() =>
                            up(
                              "images",
                              on ? draft.images.filter((x) => x !== u) : [...draft.images, u],
                            )
                          }
                          title={u}
                          className={
                            on
                              ? "relative block h-14 w-14 overflow-hidden rounded border-2 border-[var(--admin-accent)] bg-black/40"
                              : "relative block h-14 w-14 overflow-hidden rounded border border-[var(--admin-border)] bg-black/40 opacity-50"
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

              {/* Sources — each with a one-click "Deep-read this page →" hand-off
                  to the crawl4ai box below, so you never copy a URL by hand. */}
              {data.sources.length > 0 && (
                <div className="space-y-1 border-t border-[var(--admin-border)] pt-1.5 text-[10px] text-[var(--admin-text-faint)]">
                  <div className="font-semibold text-[var(--admin-text-muted)]">
                    Sources Gemini read — send one to the deep crawler:
                  </div>
                  <ul className="space-y-1">
                    {data.sources.slice(0, 8).map((s, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-[var(--admin-text-faint)]">[{i + 1}]</span>
                        <a
                          href={s}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="min-w-0 flex-1 truncate underline hover:text-[var(--admin-accent)]"
                          title={s}
                        >
                          {s}
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeepRead(s)}
                          className="shrink-0 rounded border border-[var(--admin-gold)]/40 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)] transition-colors hover:bg-[var(--admin-gold)] hover:text-black"
                          title="Fill the deep crawler below with this URL"
                        >
                          Deep-read →
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.rejectedEffects.length > 0 && (
                <p className="text-[10px] text-[var(--admin-text-faint)]">
                  Filtered for compliance: {data.rejectedEffects.map((r) => r.effect).join(", ")}
                </p>
              )}

              <div className="text-[10px] text-[var(--admin-text-faint)]">{data.model}</div>

              {/* Save selected — sends ONLY checked + edited fields; server re-sanitizes. */}
              <div className="mt-1 space-y-1.5 border-t border-[var(--admin-border)] pt-2">
                {saved === "saved" ? (
                  <p className="text-[var(--admin-accent)]">
                    ✓ Saved as drafts. Descriptions appear as suggestions to Accept and images in the
                    review tray below — nothing publishes until you approve it.
                  </p>
                ) : (
                  <>
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--admin-text-muted)]">
                      <input
                        type="checkbox"
                        checked={saveStrain}
                        onChange={(e) => setSaveStrain(e.target.checked)}
                        className="h-3 w-3 accent-[var(--admin-accent)]"
                      />
                      <span>
                        Also save as a KB strain draft (adds terpene/aroma richness for future lots)
                      </span>
                    </label>
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
                  </>
                )}
                {saved === "saving-error" && (
                  <p className="text-[var(--admin-danger)]">
                    {saveMsg || "Could not save the draft. Try again."}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One curation row: keep checkbox + label (+ optional badge/hint) + control. */
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
