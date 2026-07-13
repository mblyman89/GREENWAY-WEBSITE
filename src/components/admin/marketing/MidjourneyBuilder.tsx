"use client";

/**
 * MidjourneyBuilder — the Creative Studio (Task U PR B).
 *
 * FOOL-PROOF FLOW (owner directive: "completely fool proof and simple…
 * tons of helper text and ai assistance", images "sized perfectly for where
 * they will be displayed"):
 *
 *   1. PICK A DESTINATION — website slot, social post, email banner, blog
 *      hero, or print/in-store — from the verified placements registry. The
 *      image is then generated at that destination's EXACT pixel size with
 *      destination-specific art direction appended automatically.
 *   2. DESCRIBE THE IDEA — Greenway AI drafts the full brief, grounded in the
 *      store's real profile AND its LIVE promotions (so "Monday deal banner"
 *      uses the actual Monday deal). Drafts-only; compliance-scanned.
 *   3. GENERATE WITH FLUX — the dominant generator (baked-in API pipeline);
 *      results save to the media library as DRAFTS for human review.
 *
 * Midjourney remains as the copy-a-prompt fallback on the same brief.
 * Up to 8 reference images can be selected from published media OR uploaded
 * inline (stored via the same verified media pipeline, reusable later).
 */
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button, Field, Input, Select, Badge } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  assemblePrompt,
  ASPECT_RATIOS,
  PRESETS,
  presetById,
  COMPLIANCE_NOTE,
  type CreativeBrief,
  type AspectRatio,
} from "@/lib/marketing/midjourney-core";
import {
  generateFluxAction,
  suggestCreativeConceptAction,
  uploadFluxReferenceAction,
} from "@/app/admin/marketing/midjourney/actions";
import {
  placementById,
  placementsByGroup,
  placementSummaryLine,
  type CreativePlacement,
} from "@/lib/marketing/creative-placements-core";
import type { FluxOutputFormat } from "@/lib/marketing/flux-core";

export type ReferenceImage = { id: string; url: string; label: string };

type FluxAsset = { id: string; url: string; filename: string; title: string };

const EMPTY: CreativeBrief = {
  subject: "",
  environment: "",
  composition: "",
  lighting: "",
  style: "",
  colorMood: "",
  exclude: "",
  aspectRatio: "1:1",
  version: 7,
  stylize: 150,
  chaos: 0,
  weird: 0,
};

export function MidjourneyBuilder({
  references,
  aiConfigured,
  fluxConfigured,
}: {
  references: ReferenceImage[];
  aiConfigured: boolean;
  fluxConfigured: boolean;
}) {
  const { toast } = useToast();
  const [brief, setBrief] = useState<CreativeBrief>(EMPTY);
  const [presetId, setPresetId] = useState("");
  const [idea, setIdea] = useState("");
  const [rationale, setRationale] = useState("");
  const [aiFlags, setAiFlags] = useState<string[]>([]);
  const [pending, start] = useTransition();

  // STEP 1 — destination. Drives the exact output size + composition hint.
  const [placementId, setPlacementId] = useState<string>("");
  const placement: CreativePlacement | null = placementById(placementId);

  // FLUX generation (baked-in API pipeline; same brief, same page).
  const [fluxPending, startFlux] = useTransition();
  const [fluxFormat, setFluxFormat] = useState<FluxOutputFormat>("png");
  const [fluxAsset, setFluxAsset] = useState<FluxAsset | null>(null);
  const [fluxWarnings, setFluxWarnings] = useState<string[]>([]);
  const [fluxMeta, setFluxMeta] = useState<{ width?: number; height?: number; cost?: number } | null>(null);
  // FLUX.2 multi-reference: up to 8 images (verified API limit). Selected URLs.
  const [fluxRefs, setFluxRefs] = useState<string[]>([]);
  // Images uploaded directly here (merged with the published-media grid).
  const [uploadedRefs, setUploadedRefs] = useState<ReferenceImage[]>([]);
  const [uploadPending, setUploadPending] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // FLUX 2 enhances prompts BY DEFAULT (verified API: disable_pup=false);
  // the checkbox mirrors that default so what you see is what the API does.
  const [promptUpsampling, setPromptUpsampling] = useState(true);

  const MAX_FLUX_REFS = 8;

  // All references the FLUX grid shows: published media + inline uploads
  // (uploads first so the freshly-added image is easy to find).
  const allRefs = useMemo<ReferenceImage[]>(() => {
    const seen = new Set<string>();
    const out: ReferenceImage[] = [];
    for (const r of [...uploadedRefs, ...references]) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      out.push(r);
    }
    return out;
  }, [uploadedRefs, references]);

  function choosePlacement(id: string) {
    setPlacementId(id);
    const p = placementById(id);
    if (p) setFluxFormat(p.format);
  }

  function toggleFluxRef(url: string) {
    setFluxRefs((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= MAX_FLUX_REFS) return prev; // cap at 8
      return [...prev, url];
    });
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Respect the 8-reference cap: only accept as many new files as free slots.
    const freeSlots = MAX_FLUX_REFS - fluxRefs.length;
    if (freeSlots <= 0) {
      toast({ tone: "error", message: `You already have ${MAX_FLUX_REFS} references selected. Remove one first.` });
      return;
    }
    const chosen = Array.from(files).slice(0, freeSlots);
    if (files.length > chosen.length) {
      toast({ tone: "info", message: `Only ${chosen.length} image(s) uploaded — max ${MAX_FLUX_REFS} references.` });
    }

    setUploadPending(true);
    try {
      for (const file of chosen) {
        const fd = new FormData();
        fd.set("file", file);
        const res = await uploadFluxReferenceAction(fd);
        if (res.ok) {
          setUploadedRefs((prev) =>
            prev.some((r) => r.url === res.reference.url) ? prev : [res.reference, ...prev],
          );
          // Auto-select the freshly uploaded reference (still honouring the cap).
          setFluxRefs((prev) =>
            prev.includes(res.reference.url) || prev.length >= MAX_FLUX_REFS
              ? prev
              : [...prev, res.reference.url],
          );
        } else {
          toast({ tone: "error", message: res.error });
        }
      }
      toast({ tone: "success", message: "Reference image uploaded and saved to your media library (draft)." });
    } finally {
      setUploadPending(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function generateFlux() {
    setFluxAsset(null);
    setFluxWarnings([]);
    setFluxMeta(null);
    startFlux(async () => {
      const res = await generateFluxAction({
        brief,
        outputFormat: fluxFormat,
        referenceImages: fluxRefs,
        promptUpsampling,
        placementId: placementId || null,
      });
      if (res.ok) {
        setFluxAsset(res.asset);
        setFluxWarnings(res.warnings);
        setFluxMeta({ width: res.width, height: res.height, cost: res.cost });
        toast({ tone: "success", message: `Image generated with ${res.endpoint} and saved to your media library (draft).` });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  const assembled = useMemo(() => assemblePrompt(brief), [brief]);

  function set<K extends keyof CreativeBrief>(key: K, value: CreativeBrief[K]) {
    setBrief((b) => ({ ...b, [key]: value }));
  }

  function applyPreset(id: string) {
    setPresetId(id);
    const p = presetById(id);
    if (!p) return;
    setBrief((b) => ({ ...b, ...p.brief }));
  }

  function assist() {
    start(async () => {
      const res = await suggestCreativeConceptAction({ idea, placementId: placementId || null });
      if (res.ok) {
        const c = res.concept;
        setBrief((b) => ({
          ...b,
          subject: c.subject || b.subject,
          environment: c.environment || b.environment,
          composition: c.composition || b.composition,
          lighting: c.lighting || b.lighting,
          style: c.style || b.style,
          colorMood: c.colorMood || b.colorMood,
          exclude: c.exclude || b.exclude,
        }));
        setRationale(c.rationale);
        setAiFlags(res.complianceFlags);
        if (res.complianceFlags.length > 0) {
          toast({ tone: "warning", message: `Draft filled in — but flagged: ${res.complianceFlags.join(", ")}. Review before generating.` });
        } else {
          toast({ tone: "success", message: "Draft brief filled in — review and tweak it, then generate." });
        }
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(assembled.prompt);
      toast({ tone: "success", message: "Prompt copied to clipboard." });
    } catch {
      toast({ tone: "error", message: "Copy failed — select and copy manually." });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: inputs */}
      <div className="space-y-5">
        {/* STEP 1 — destination picker. Drives exact pixel size + art direction. */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)] p-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)] text-xs font-bold text-black">1</span>
            <h4 className="text-sm font-semibold text-[var(--admin-text)]">Where will this image go?</h4>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--admin-text-muted)]">
            Pick the destination first — the image is generated at that spot&rsquo;s <strong>exact pixel size</strong> and
            the right composition guidance is added automatically. Skip it only for freestyle experiments.
          </p>
          <Field label="Destination">
            <Select value={placementId} onChange={(e) => choosePlacement(e.target.value)}>
              <option value="">— Freestyle (no destination, uses aspect ratio below) —</option>
              {placementsByGroup().map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.placements.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.width}×{p.height}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {placement && (
            <div className="mt-3 space-y-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2.5">
              <p className="text-xs text-[var(--admin-text)]">
                <strong className="text-[var(--admin-accent)]">Used for:</strong> {placement.where}
              </p>
              <p className="text-xs text-[var(--admin-text-muted)]">{placementSummaryLine(placement)}</p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                <strong className="text-[var(--admin-text)]">Tip:</strong> {placement.tip}
              </p>
              {placement.printNote && (
                <p className="text-xs text-[var(--admin-orange)]">
                  <strong>Print note:</strong> {placement.printNote}
                </p>
              )}
            </div>
          )}
        </div>

        {/* STEP 2 — Preset + AI assist */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)] text-xs font-bold text-black">2</span>
            <h4 className="text-sm font-semibold text-[var(--admin-text)]">Describe the idea — Greenway AI drafts the brief</h4>
          </div>
          <Field label="Start from a preset">
            <Select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">— None —</option>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          {presetId && <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{presetById(presetId)?.description}</p>}

          <div className="mt-4">
            <Field
              label="Your idea (for AI assist)"
              help={
                aiConfigured
                  ? "A sentence is enough — Greenway AI drafts the brief using your store profile AND your live weekly deals. Try “a banner for our Monday deal”."
                  : "AI is not configured; fill the fields below manually."
              }
            >
              <div className="flex gap-2">
                <Input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. a cozy autumn banner for our Monday pre-roll deal" disabled={!aiConfigured} />
                <Button variant="neutral" onClick={assist} disabled={!aiConfigured || pending}>
                  {pending ? "Thinking…" : "AI assist"}
                </Button>
              </div>
            </Field>
          </div>
          {rationale && (
            <p className="mt-3 rounded-lg border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/10 px-3 py-2 text-xs text-[var(--admin-text)]">
              <strong className="text-[var(--admin-accent)]">Why:</strong> {rationale}
            </p>
          )}
          {aiFlags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-[var(--admin-orange)]">Compliance flags:</span>
              {aiFlags.map((f) => (
                <span key={f} className="rounded-full border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-2 py-0.5 text-[0.65rem] font-medium text-[var(--admin-orange)]">
                  {f}
                </span>
              ))}
              <span className="text-[0.65rem] text-[var(--admin-text-muted)]">— review the draft before generating.</span>
            </div>
          )}
        </div>

        {/* Brief fields */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 space-y-3">
          <Field label="Subject (lead with this)">
            <Input value={brief.subject} onChange={(e) => set("subject", e.target.value)} placeholder="a jar of premium cannabis flower" />
          </Field>
          <Field label="Environment / setting">
            <Input value={brief.environment ?? ""} onChange={(e) => set("environment", e.target.value)} placeholder="on a warm wooden countertop" />
          </Field>
          <Field label="Composition / shot">
            <Input value={brief.composition ?? ""} onChange={(e) => set("composition", e.target.value)} placeholder="centered close-up hero shot" />
          </Field>
          <Field label="Lighting">
            <Input value={brief.lighting ?? ""} onChange={(e) => set("lighting", e.target.value)} placeholder="soft diffused studio lighting" />
          </Field>
          <Field label="Style / medium">
            <Input value={brief.style ?? ""} onChange={(e) => set("style", e.target.value)} placeholder="premium editorial product photography" />
          </Field>
          <Field label="Color / mood">
            <Input value={brief.colorMood ?? ""} onChange={(e) => set("colorMood", e.target.value)} placeholder="warm earthy palette, calm premium mood" />
          </Field>
          <Field label="Exclude (→ --no)">
            <Input value={brief.exclude ?? ""} onChange={(e) => set("exclude", e.target.value)} placeholder="text, watermark, blur" />
          </Field>
        </div>

        {/* Parameters */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Parameters</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Aspect ratio">
              <Select value={brief.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value as AspectRatio)}>
                {ASPECT_RATIOS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model version">
              <Select
                value={brief.niji ? "niji" : String(brief.version ?? 7)}
                onChange={(e) => {
                  if (e.target.value === "niji") setBrief((b) => ({ ...b, niji: true }));
                  else setBrief((b) => ({ ...b, niji: false, version: Number(e.target.value) }));
                }}
              >
                <option value="7">V7</option>
                <option value="6.1">V6.1</option>
                <option value="niji">Niji (anime)</option>
              </Select>
            </Field>
            <Field label={`Stylize (${brief.stylize ?? 0})`} help="0 literal · 1000 stylized">
              <input type="range" min={0} max={1000} step={10} value={brief.stylize ?? 0} onChange={(e) => set("stylize", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
            </Field>
            <Field label={`Chaos (${brief.chaos ?? 0})`} help="variety across results">
              <input type="range" min={0} max={100} step={5} value={brief.chaos ?? 0} onChange={(e) => set("chaos", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
              <input type="checkbox" checked={Boolean(brief.raw)} onChange={(e) => set("raw", e.target.checked)} className="accent-[var(--admin-accent)]" /> Raw mode
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
              <input type="checkbox" checked={Boolean(brief.tile)} onChange={(e) => set("tile", e.target.checked)} className="accent-[var(--admin-accent)]" /> Seamless tile
            </label>
          </div>
        </div>

        {/* Reference image (Midjourney --sref) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Style reference (optional)</h4>
          <p className="mb-3 text-xs text-[var(--admin-text-muted)]">Pick an image from your media library to emit a <code>--sref</code> tag. Its public URL is used as the style reference.</p>
          {allRefs.length === 0 ? (
            <p className="text-xs text-[var(--admin-text-muted)]">No images yet. Upload one in the FLUX section, or add published media on the Media page.</p>
          ) : (
            <Field label="Reference image (→ --sref)">
              <Select value={brief.srefUrl ?? ""} onChange={(e) => set("srefUrl", e.target.value)}>
                <option value="">— None —</option>
                {allRefs.map((r) => (
                  <option key={r.id} value={r.url}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {brief.srefUrl && (
            <Field label={`Style weight (${brief.styleWeight ?? 100})`} className="mt-3">
              <input type="range" min={0} max={1000} step={10} value={brief.styleWeight ?? 100} onChange={(e) => set("styleWeight", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
            </Field>
          )}
        </div>
      </div>

      {/* Right: output */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/10 p-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[var(--admin-text)]">Your Midjourney prompt</h4>
            <Button size="sm" onClick={copyPrompt} disabled={!assembled.prompt}>
              Copy
            </Button>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] p-3 text-sm text-[var(--admin-text)]">
            {assembled.prompt || "Fill in a subject to build your prompt…"}
          </pre>
          {assembled.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-[var(--admin-orange)]">
              {assembled.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        {/* FLUX 2 — baked-in API pipeline (same brief, saved to media library) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)] text-xs font-bold text-black">3</span>
              <h4 className="text-sm font-semibold text-[var(--admin-text)]">Generate with FLUX</h4>
            </div>
            <Badge tone={fluxConfigured ? "green" : "neutral"}>{fluxConfigured ? "Connected" : "Not configured"}</Badge>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--admin-text-muted)]">
            Uses the same brief above as a natural-language prompt (no <code>--</code> flags). With a destination picked in
            Step&nbsp;1 the image comes out at that spot&rsquo;s exact pixel size; otherwise the brief&rsquo;s aspect ratio is used. The
            result saves straight into your media library as a <strong>draft</strong> to review before publishing.
          </p>

          {/* Reference images — FLUX.2 multi-reference (up to 8, verified API limit) */}
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                Reference images (optional · up to {MAX_FLUX_REFS})
              </h5>
              <span className="text-xs text-[var(--admin-text-muted)]">{fluxRefs.length}/{MAX_FLUX_REFS} selected</span>
            </div>
            <p className="mb-2 text-xs text-[var(--admin-text-muted)]">
              FLUX.2 can blend up to {MAX_FLUX_REFS} references — combine product shots, styles, or brand
              assets. Upload your own below or click to select from your media.
            </p>

            {/* Inline upload — bring your own reference images (B4) */}
            <div className="mb-3">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => handleUploadFiles(e.target.files)}
              />
              <Button
                variant="save"
                size="sm"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadPending || fluxRefs.length >= MAX_FLUX_REFS}
              >
                {uploadPending ? "Uploading…" : "Upload reference image(s)"}
              </Button>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                PNG, JPG, WEBP, or GIF · up to 10 MB each. Uploads are saved to your media library (draft) and selected automatically.
              </p>
            </div>

            {allRefs.length === 0 ? (
              <p className="text-xs text-[var(--admin-text-muted)]">No images yet. Upload one above, or publish media on the Media page.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {allRefs.map((r) => {
                  const selected = fluxRefs.includes(r.url);
                  const idx = fluxRefs.indexOf(r.url);
                  const atCap = !selected && fluxRefs.length >= MAX_FLUX_REFS;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleFluxRef(r.url)}
                      disabled={atCap}
                      title={r.label}
                      className={`relative aspect-square overflow-hidden rounded-lg border transition ${
                        selected
                          ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/60"
                          : atCap
                            ? "border-[var(--admin-border)] opacity-40"
                            : "border-[var(--admin-border)] hover:border-[var(--admin-accent)]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt={r.label} className="h-full w-full object-cover" />
                      {selected ? (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--admin-accent)] text-[0.65rem] font-bold text-black">
                          {idx + 1}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <label className="mb-3 flex items-start gap-2 text-sm text-[var(--admin-text)]">
            <input
              type="checkbox"
              checked={promptUpsampling}
              onChange={(e) => setPromptUpsampling(e.target.checked)}
              className="mt-0.5 accent-[var(--admin-accent)]"
            />{" "}
            <span>
              FLUX enhances your prompt automatically (recommended){" "}
              <span className="text-xs text-[var(--admin-text-muted)]">— untick to use your exact words only.</span>
            </span>
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Format" className="w-28">
              <Select value={fluxFormat} onChange={(e) => setFluxFormat(e.target.value as FluxOutputFormat)}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WEBP</option>
              </Select>
            </Field>
            <Button
              variant="primary"
              onClick={generateFlux}
              disabled={!fluxConfigured || fluxPending || !brief.subject.trim()}
            >
              {fluxPending ? "Generating…" : "Generate with FLUX"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            {placement ? (
              <>
                Will generate at <strong className="text-[var(--admin-text)]">{placement.width}×{placement.height}px</strong> — sized
                exactly for <strong className="text-[var(--admin-text)]">{placement.label}</strong>.
              </>
            ) : (
              <>No destination picked — FLUX will use the aspect ratio from the brief ({brief.aspectRatio}). Pick a destination in Step&nbsp;1 for pixel-perfect sizing.</>
            )}
          </p>

          {!fluxConfigured && (
            <p className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-xs text-[var(--admin-text-muted)]">
              Add your Black Forest Labs API key in <strong>Settings → Integrations</strong> to enable one-click generation.
            </p>
          )}

          {fluxWarnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-[var(--admin-orange)]">
              {fluxWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {fluxAsset && (
            <div className="mt-4 space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fluxAsset.url} alt={fluxAsset.title} className="w-full rounded-lg border border-[var(--admin-border)]" />
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--admin-text-muted)]">
                <span className="truncate">{fluxAsset.filename}</span>
                <Link href="/admin/media" className="shrink-0 text-[var(--admin-accent)] hover:underline">
                  Open in Media →
                </Link>
              </div>
              {fluxMeta && (fluxMeta.width || fluxMeta.cost !== undefined) && (
                <p className="text-xs text-[var(--admin-text-muted)]">
                  {fluxMeta.width && fluxMeta.height ? (
                    <>Generated at <strong className="text-[var(--admin-text)]">{fluxMeta.width}×{fluxMeta.height}px</strong></>
                  ) : null}
                  {fluxMeta.cost !== undefined ? (
                    <>{fluxMeta.width ? " · " : ""}Cost: {fluxMeta.cost} credit{fluxMeta.cost === 1 ? "" : "s"}</>
                  ) : null}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Structure</h4>
          <p className="text-xs leading-relaxed text-[var(--admin-text-muted)]">
            <Badge tone="outline">subject</Badge> , environment , composition , lighting , style , color/mood <Badge tone="neutral">--parameters</Badge>
          </p>
          <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
            Parameters always go at the end, one space before each <code>--</code>, with no punctuation inside them.
          </p>
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange)]/5 p-4 text-xs text-[var(--admin-text)]">
          <strong className="text-[var(--admin-orange)]">Compliance:</strong> {COMPLIANCE_NOTE}
        </div>
      </div>
    </div>
  );
}
