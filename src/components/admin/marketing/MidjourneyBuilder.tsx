"use client";

/**
 * MidjourneyBuilder — Slice 72 [items 7 + 17]
 *
 * Guided Midjourney prompt builder for the marketing team. Structured brief
 * fields + parameter controls + optional reference image (from the media
 * library) assemble — live — into a syntactically-correct Midjourney prompt
 * string (via the PURE core). An optional AI assist expands a short idea into
 * draft brief fields, grounded in the store's real brand context. We do NOT
 * call Midjourney; this produces a prompt to paste there.
 */
import { useMemo, useState, useTransition } from "react";
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
import { assistBriefAction } from "@/app/admin/marketing/midjourney/actions";

export type ReferenceImage = { id: string; url: string; label: string };

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
}: {
  references: ReferenceImage[];
  aiConfigured: boolean;
}) {
  const { toast } = useToast();
  const [brief, setBrief] = useState<CreativeBrief>(EMPTY);
  const [presetId, setPresetId] = useState("");
  const [idea, setIdea] = useState("");
  const [rationale, setRationale] = useState("");
  const [pending, start] = useTransition();

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
      const preset = presetById(presetId);
      const res = await assistBriefAction({ idea, presetLabel: preset?.label });
      if (res.ok) {
        setBrief((b) => ({
          ...b,
          subject: res.suggestion.subject || b.subject,
          environment: res.suggestion.environment || b.environment,
          composition: res.suggestion.composition || b.composition,
          lighting: res.suggestion.lighting || b.lighting,
          style: res.suggestion.style || b.style,
          colorMood: res.suggestion.colorMood || b.colorMood,
          exclude: res.suggestion.exclude || b.exclude,
        }));
        setRationale(res.suggestion.rationale);
        toast({ tone: "success", message: "Draft brief filled in — review and tweak it." });
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
        {/* Preset + AI assist */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
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
          {presetId && <p className="mt-2 text-xs text-white/40">{presetById(presetId)?.description}</p>}

          <div className="mt-4">
            <Field label="Your idea (for AI assist)" help={aiConfigured ? "A sentence is enough — AI will draft the brief fields." : "AI is not configured; fill the fields below manually."}>
              <div className="flex gap-2">
                <Input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. a cozy autumn menu banner for our new pre-rolls" disabled={!aiConfigured} />
                <Button variant="subtle" onClick={assist} disabled={!aiConfigured || pending}>
                  {pending ? "Thinking…" : "AI assist"}
                </Button>
              </div>
            </Field>
          </div>
          {rationale && (
            <p className="mt-3 rounded-lg border border-[#7ed957]/25 bg-[#7ed957]/5 px-3 py-2 text-xs text-white/70">
              <strong className="text-[#7ed957]">Why:</strong> {rationale}
            </p>
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
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">Parameters</h4>
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
              <input type="range" min={0} max={1000} step={10} value={brief.stylize ?? 0} onChange={(e) => set("stylize", Number(e.target.value))} className="w-full" />
            </Field>
            <Field label={`Chaos (${brief.chaos ?? 0})`} help="variety across results">
              <input type="range" min={0} max={100} step={5} value={brief.chaos ?? 0} onChange={(e) => set("chaos", Number(e.target.value))} className="w-full" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={Boolean(brief.raw)} onChange={(e) => set("raw", e.target.checked)} /> Raw mode
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={Boolean(brief.tile)} onChange={(e) => set("tile", e.target.checked)} /> Seamless tile
            </label>
          </div>
        </div>

        {/* Reference image */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">Style reference (optional)</h4>
          <p className="mb-3 text-xs text-white/40">Pick an image from your media library to emit a <code>--sref</code> tag. Its public URL is used as the style reference.</p>
          {references.length === 0 ? (
            <p className="text-xs text-white/40">No published media yet. Upload images on the Media page to use them as references.</p>
          ) : (
            <Field label="Reference image (→ --sref)">
              <Select value={brief.srefUrl ?? ""} onChange={(e) => set("srefUrl", e.target.value)}>
                <option value="">— None —</option>
                {references.map((r) => (
                  <option key={r.id} value={r.url}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {brief.srefUrl && (
            <Field label={`Style weight (${brief.styleWeight ?? 100})`} className="mt-3">
              <input type="range" min={0} max={1000} step={10} value={brief.styleWeight ?? 100} onChange={(e) => set("styleWeight", Number(e.target.value))} className="w-full" />
            </Field>
          )}
        </div>
      </div>

      {/* Right: output */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-[var(--admin-radius-lg)] border border-[#7ed957]/30 bg-[#7ed957]/5 p-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Your Midjourney prompt</h4>
            <Button size="sm" onClick={copyPrompt} disabled={!assembled.prompt}>
              Copy
            </Button>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--admin-border)] bg-[var(--admin-bg)] p-3 text-sm text-white/90">
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

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Structure</h4>
          <p className="text-xs leading-relaxed text-white/50">
            <Badge tone="outline">subject</Badge> , environment , composition , lighting , style , color/mood <Badge tone="neutral">--parameters</Badge>
          </p>
          <p className="mt-3 text-xs text-white/40">
            Parameters always go at the end, one space before each <code>--</code>, with no punctuation inside them.
          </p>
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange)]/5 p-4 text-xs text-white/70">
          <strong className="text-[var(--admin-orange)]">Compliance:</strong> {COMPLIANCE_NOTE}
        </div>
      </div>
    </div>
  );
}
