"use client";

/**
 * MidjourneyPromptBuilder — the Midjourney tab of the Creative Studio.
 *
 * Builds a copy-paste Midjourney prompt from a structured brief (destination,
 * idea + Greenway AI assist, subject/environment/…, MJ parameters, --sref /
 * --oref). R62 moved FLUX out to its own Playground-style tabs; this brief no
 * longer feeds FLUX (FLUX takes your prompt verbatim).
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Field, Input, Select, Badge } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  assemblePrompt,
  ASPECT_RATIOS,
  closestAspectRatio,
  PRESETS,
  presetById,
  COMPLIANCE_NOTE,
  type CreativeBrief,
  type AspectRatio,
} from "@/lib/marketing/midjourney-core";
import { suggestCreativeConceptAction } from "@/app/admin/marketing/midjourney/actions";
import {
  placementById,
  placementsByGroup,
  placementSummaryLine,
  type CreativePlacement,
} from "@/lib/marketing/creative-placements-core";

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

export function MidjourneyPromptBuilder({
  references: allRefs,
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
  const [aiFlags, setAiFlags] = useState<string[]>([]);
  const [pending, start] = useTransition();

  // STEP 1 — destination. Sets the closest Midjourney --ar.
  const [placementId, setPlacementId] = useState<string>("");
  const placement: CreativePlacement | null = placementById(placementId);

  function choosePlacement(id: string) {
    setPlacementId(id);
    const p = placementById(id);
    // Snap --ar to the destination's closest supported Midjourney ratio.
    if (p) setBrief((b) => ({ ...b, aspectRatio: closestAspectRatio(p.width, p.height) }));
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

  // ── Shared sections (same state on both tabs — the brief carries over) ────

  const stepDestination = (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)] p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent)] text-xs font-bold text-black">1</span>
        <h4 className="text-sm font-semibold text-[var(--admin-text)]">Where will this image go?</h4>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-[var(--admin-text-muted)]">
        Pick the destination first — the prompt&rsquo;s <code>--ar</code> snaps to the closest ratio Midjourney supports for
        that spot, and Greenway AI tailors the brief to it. Skip it for freestyle work.
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
  );

  const stepIdea = (
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
  );

  const briefFields = (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 space-y-3">
      <Field label="Subject (lead with this)">
        <Input value={brief.subject} onChange={(e) => set("subject", e.target.value)} placeholder="a ceramic coffee mug with a hand-drawn logo" />
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
  );

  const complianceNote = (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange)]/5 p-4 text-xs text-[var(--admin-text)]">
      <strong className="text-[var(--admin-orange)]">Compliance:</strong> {COMPLIANCE_NOTE}
    </div>
  );

  // ── Midjourney tab — parameters, references, and the copy-paste prompt ────

  const mjParameters = (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Midjourney parameters</h4>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        These tune the copy-paste Midjourney prompt.
      </p>
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
        <Field label={`Weird (${brief.weird ?? 0})`} help="0 normal · 3000 experimental aesthetics">
          <input type="range" min={0} max={3000} step={50} value={brief.weird ?? 0} onChange={(e) => set("weird", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
        </Field>
      </div>
      {placement && (
        <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
          Aspect ratio auto-set to <strong className="text-[var(--admin-text)]">{brief.aspectRatio}</strong> to match your Step&nbsp;1
          destination ({placement.width}×{placement.height}px — Midjourney only supports fixed ratios).
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
          <input type="checkbox" checked={Boolean(brief.raw)} onChange={(e) => set("raw", e.target.checked)} className="accent-[var(--admin-accent)]" /> Raw mode
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
          <input type="checkbox" checked={Boolean(brief.tile)} onChange={(e) => set("tile", e.target.checked)} className="accent-[var(--admin-accent)]" /> Seamless tile
        </label>
      </div>
    </div>
  );

  const mjReferences = (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Midjourney references (optional)</h4>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Pick images from your media library: a <strong>style reference</strong> (<code>--sref</code>) copies the LOOK
        (colors, lighting, vibe); an <strong>omni-reference</strong> (<code>--oref</code>) keeps a specific PRODUCT or
        object recognizable.
      </p>
      {allRefs.length === 0 ? (
        <p className="text-xs text-[var(--admin-text-muted)]">No published images yet. Publish images on the Media page to use them as Midjourney references.</p>
      ) : (
        <>
          <Field label="Style reference (→ --sref)" help="Match this image's aesthetic.">
            <Select value={brief.srefUrl ?? ""} onChange={(e) => set("srefUrl", e.target.value)}>
              <option value="">— None —</option>
              {allRefs.map((r) => (
                <option key={r.id} value={r.url}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          {brief.srefUrl && (
            <Field label={`Style weight (${brief.styleWeight ?? 100})`} help="0 subtle · 1000 strongly matches the reference look" className="mt-3">
              <input type="range" min={0} max={1000} step={10} value={brief.styleWeight ?? 100} onChange={(e) => set("styleWeight", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
            </Field>
          )}
          <Field label="Omni-reference (→ --oref)" help="Keep this exact product/object recognizable in the result." className="mt-3">
            <Select value={brief.orefUrl ?? ""} onChange={(e) => set("orefUrl", e.target.value)}>
              <option value="">— None —</option>
              {allRefs.map((r) => (
                <option key={r.id} value={r.url}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </div>
  );

  const mjPromptPanel = (
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
  );

  const mjStructurePanel = (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Structure</h4>
      <p className="text-xs leading-relaxed text-[var(--admin-text-muted)]">
        <Badge tone="outline">subject</Badge> , environment , composition , lighting , style , color/mood <Badge tone="neutral">--parameters</Badge>
      </p>
      <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
        Parameters always go at the end, one space before each <code>--</code>, with no punctuation inside them.
      </p>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        {stepDestination}
        {stepIdea}
        {briefFields}
        {mjParameters}
        {mjReferences}
      </div>
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {mjPromptPanel}
        {mjStructurePanel}
        {complianceNote}
      </div>
    </div>
  );
}
