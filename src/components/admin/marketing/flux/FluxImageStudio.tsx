"use client";

/**
 * FluxImageStudio — the FLUX image generator, Playground-style (R62).
 *
 * Owner directive: "a flux that works exactly as it does on their platform".
 * So: one prompt box whose text is sent to FLUX VERBATIM (no hidden brief
 * assembly, no appended art direction, no "Avoid:" lines), references labelled
 * "image 1…8" in the order FLUX receives them, and the Playground controls
 * (aspect / custom aspect, safety 0–5, format, prompt upsampling, 1–4 or 8
 * images). Tasks are submitted in parallel and polled from the browser, so
 * batches never hit a server time limit; every result lands in the media
 * library as a DRAFT.
 */
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Badge, Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { fluxCreditsAction, submitFluxImagesAction } from "@/app/admin/marketing/midjourney/actions";
import { fluxModel } from "@/lib/marketing/flux-core";
import { IMAGE_SNIPPETS, IMAGE_TEMPLATES, promptWarnings } from "@/lib/marketing/flux-presets-core";
import { PromptBox } from "./PromptBox";
import { ReferenceStrip, type RefImage } from "./ReferenceStrip";
import { DEFAULT_IMAGE_SETTINGS, ImageSettings, sizeSummary, toRequestSettings, type ImageUiSettings } from "./ImageSettings";
import { FluxResults } from "./FluxResults";
import { jobKey, useFluxJobs, type FluxJob } from "./useFluxJobs";

export function CreditsBadge({ credits }: { credits: number | null }) {
  if (credits === null) return null;
  return (
    <span className="rounded-full bg-[var(--admin-surface-2)] px-2.5 py-1 text-[0.7rem] font-bold text-[var(--admin-text-muted)]" title="Your BFL account balance">
      {credits.toLocaleString(undefined, { maximumFractionDigits: 2 })} credits
    </span>
  );
}

/** Ticks once a second while something is running (for elapsed timers). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function FluxImageStudio({
  library: initialLibrary,
  configured,
  defaultModel,
  credits: initialCredits,
}: {
  library: RefImage[];
  configured: boolean;
  defaultModel: string;
  credits: number | null;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [uploads, setUploads] = useState<RefImage[]>([]);
  const [settings, setSettings] = useState<ImageUiSettings>(() => ({ ...DEFAULT_IMAGE_SETTINGS, model: fluxModel(defaultModel).id }));
  const [credits, setCredits] = useState<number | null>(initialCredits);
  const [submitting, startSubmit] = useTransition();

  const refreshCredits = useCallback(() => {
    fluxCreditsAction()
      .then((r) => setCredits(r.credits))
      .catch(() => undefined);
  }, []);
  const { jobs, add, remove, clearFinished, pendingCount } = useFluxJobs({ intervalMs: 2000, onSettled: refreshCredits });
  const now = useNow(pendingCount > 0);

  const model = fluxModel(settings.model);
  const library = useMemo(() => {
    const seen = new Set<string>();
    return [...uploads, ...initialLibrary].filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  }, [uploads, initialLibrary]);
  const warnings = promptWarnings(prompt, refs.length);
  const overCap = refs.length > model.maxRefs;

  // Trim the reference list when switching to a model with fewer slots.
  function changeSettings(next: ImageUiSettings) {
    setSettings(next);
    const cap = fluxModel(next.model).maxRefs;
    if (refs.length > cap) {
      setRefs(refs.slice(0, cap));
      toast({ tone: "info", message: `${fluxModel(next.model).label} takes up to ${cap} references — kept the first ${cap}.` });
    }
  }

  function addLibrary(r: RefImage) {
    setUploads((prev) => (prev.some((x) => x.url === r.url) ? prev : [r, ...prev]));
  }

  function generate() {
    if (!configured) return;
    const text = prompt;
    if (!text.trim()) {
      toast({ tone: "error", message: "Write a prompt first." });
      return;
    }
    const request = { ...toRequestSettings(settings), prompt: text, referenceImages: refs.map((r) => r.url) };
    const size = sizeSummary(settings);
    startSubmit(async () => {
      const res = await submitFluxImagesAction(request);
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      const batch = jobKey("batch");
      const started = Date.now();
      const label = fluxModel(res.model).label;
      const dims = res.width && res.height ? `${res.width}×${res.height}` : size;
      const list: FluxJob[] = res.tasks.map((t) => ({
        key: jobKey("img"),
        batch,
        kind: "image",
        prompt: text,
        pollingUrl: t.ok ? t.pollingUrl : undefined,
        state: t.ok ? "pending" : "failed",
        error: t.ok ? undefined : t.error,
        seed: t.ok ? t.seed : undefined,
        cost: t.ok ? t.cost : undefined,
        meta: `${label} · ${dims}${refs.length ? ` · ${refs.length} ref${refs.length === 1 ? "" : "s"}` : ""}${t.ok && typeof t.cost === "number" ? ` · ${t.cost} cr` : ""}`,
        startedAt: started,
      }));
      add(list);
      for (const w of res.warnings) toast({ tone: "info", message: w });
      const accepted = res.tasks.filter((t) => t.ok).length;
      if (accepted === 0) toast({ tone: "error", message: "FLUX rejected every request — see the error on each card." });
      else refreshCredits();
    });
  }

  function addResultAsReference(j: FluxJob) {
    if (!j.asset) return;
    const r: RefImage = { id: j.asset.id, url: j.asset.url, label: j.asset.title };
    addLibrary(r);
    if (refs.some((x) => x.url === r.url)) return;
    if (refs.length >= model.maxRefs) {
      toast({ tone: "error", message: `Already ${model.maxRefs} references — remove one first.` });
      return;
    }
    setRefs([...refs, r]);
    toast({ tone: "success", message: `Added as image ${refs.length + 1}.` });
  }

  const busy = submitting;
  const countLabel = settings.count === 1 ? "1 image" : `${settings.count} images`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--admin-text)]">Prompt</h3>
            <Badge tone={configured ? "green" : "neutral"}>{configured ? "FLUX connected" : "Not configured"}</Badge>
            <span className="ml-auto">
              <CreditsBadge credits={credits} />
            </span>
          </div>
          <PromptBox
            value={prompt}
            onChange={setPrompt}
            templates={IMAGE_TEMPLATES}
            snippets={IMAGE_SNIPPETS}
            warnings={warnings}
            onSubmit={generate}
            placeholder={
              "Describe the image: subject first, then action, style and setting.\n" +
              "e.g. A ceramic coffee mug on a sunlit oak table, steam rising, shallow depth of field, warm morning light, editorial product photography"
            }
          />
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--admin-text)]">Reference images</h3>
            <span className={`text-xs ${overCap ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}>
              {refs.length}/{model.maxRefs}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--admin-text-muted)]">
            FLUX sees these in order as <strong>image 1</strong>, <strong>image 2</strong>… Put the base image first and name each one
            in your prompt (&ldquo;the person from image 1 wearing the jacket from image 2&rdquo;). With references and Auto size, the
            output follows image 1&rsquo;s shape.
          </p>
          <ReferenceStrip value={refs} onChange={setRefs} max={model.maxRefs} library={library} onLibraryAdd={addLibrary} />
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Settings</h3>
          <ImageSettings value={settings} onChange={changeSettings} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={!configured || busy || !prompt.trim() || overCap}>
            {busy ? "Submitting…" : `Generate ${countLabel}`}
          </Button>
          <span className="text-xs text-[var(--admin-text-muted)]">
            {model.label} · {sizeSummary(settings)}
            {pendingCount > 0 ? ` · ${pendingCount} running` : ""}
          </span>
          <span className="w-full text-[0.68rem] text-[var(--admin-text-faint)]">
            Ctrl/⌘ + Enter in the prompt also generates. Each image is billed by BFL; the exact cost shows on each card.
          </span>
        </div>

        {!configured && (
          <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-xs text-[var(--admin-text-muted)]">
            FLUX isn&rsquo;t connected yet. Add your BFL API key under <strong>Admin → Integrations → FLUX</strong>.
          </p>
        )}
      </div>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <FluxResults
          jobs={jobs}
          now={now}
          onUseAsReference={addResultAsReference}
          onReuseSeed={(seed) => setSettings((s) => ({ ...s, seed: String(seed) }))}
          onRemove={remove}
          onClear={clearFinished}
          emptyText="Your images appear here as they finish. Each one is saved to the media library as a draft."
        />
      </div>
    </div>
  );
}
