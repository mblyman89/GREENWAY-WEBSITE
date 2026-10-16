"use client";

/**
 * FluxVideoStudio — FLUX 3 video (R62).
 *
 * Modes (all verified against BFL's live OpenAPI): text → video, image →
 * video (1–10 keyframes, evenly spaced or pinned to seconds), continue a
 * video, edit a video, upscale a video. "Draft first" is on by default: a
 * fast HD preview at about a third of the cost, then one click renders the
 * SAME shot at full quality (draft_enhance) at the resolution you pick. Jobs
 * are polled from the browser every 5 s and saved to the media library as
 * DRAFT mp4s.
 */
import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { fluxCreditsAction, submitFluxVideoAction } from "@/app/admin/marketing/midjourney/actions";
import { FLUX_MAX_KEYFRAMES, FLUX_VIDEO_MODES, FLUX_VIDEO_RESOLUTIONS, type FluxVideoSettings } from "@/lib/marketing/flux-video-core";
import { VIDEO_SNIPPETS, VIDEO_TEMPLATES } from "@/lib/marketing/flux-presets-core";
import { PromptBox } from "./PromptBox";
import { ReferenceStrip, type RefImage } from "./ReferenceStrip";
import { DEFAULT_VIDEO_SETTINGS, VideoSettings, type VideoUiSettings } from "./VideoSettings";
import { FluxResults } from "./FluxResults";
import { jobKey, useFluxJobs, type FluxJob } from "./useFluxJobs";
import { CreditsBadge, useNow } from "./FluxImageStudio";

export type VideoSource = { id: string; url: string; label: string };

const PANEL = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";
const CTL =
  "admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2.5 py-1.5 text-sm text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]";

function videoWarnings(prompt: string, mode: string): string[] {
  const out: string[] = [];
  if (mode === "edit" || mode === "upscale") return out;
  if (/\b(avoid|no|without|don'?t|never)\s*:/i.test(prompt)) out.push("Describe what you want instead of listing what to avoid. Naming it can pull it in.");
  if (/"[^"]{2,}"/.test(prompt) && !/\b(says?|said|speaks?|asks?|shouts?|whispers?|sings?)\b/i.test(prompt) && !/\b(sign|text|reads)\b/i.test(prompt)) {
    out.push("Quoted words are treated as speech or text. Say who speaks them (a visible speaker), or what the text is written on.");
  }
  return out;
}

export function FluxVideoStudio({
  images,
  videos: initialVideos,
  configured,
  credits: initialCredits,
}: {
  images: RefImage[];
  videos: VideoSource[];
  configured: boolean;
  credits: number | null;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<VideoUiSettings>(DEFAULT_VIDEO_SETTINGS);
  const [frames, setFrames] = useState<RefImage[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<RefImage[]>([]);
  const [extraVideos, setExtraVideos] = useState<VideoSource[]>([]);
  const [source, setSource] = useState("");
  const [enhanceRes, setEnhanceRes] = useState("fhd");
  const [credits, setCredits] = useState<number | null>(initialCredits);
  const [submitting, startSubmit] = useTransition();

  const refreshCredits = useCallback(() => {
    fluxCreditsAction()
      .then((r) => setCredits(r.credits))
      .catch(() => undefined);
  }, []);
  const { jobs, add, remove, clearFinished, pendingCount } = useFluxJobs({ intervalMs: 5000, onSettled: refreshCredits });
  const now = useNow(pendingCount > 0);

  const library = useMemo(() => {
    const seen = new Set<string>();
    return [...uploads, ...images].filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  }, [uploads, images]);
  const videos = useMemo(() => {
    const seen = new Set<string>();
    return [...extraVideos, ...initialVideos].filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  }, [extraVideos, initialVideos]);

  const mode = settings.mode;
  const modeInfo = FLUX_VIDEO_MODES.find((m) => m.id === mode) ?? FLUX_VIDEO_MODES[0];
  const needsSource = mode === "v2v" || mode === "edit" || mode === "upscale";
  const promptOptional = mode === "upscale";

  function toRequest(): FluxVideoSettings {
    return {
      mode,
      prompt,
      aspect: settings.aspect,
      duration: settings.duration,
      resolution: settings.resolution,
      audio: settings.audio,
      draft: settings.draft,
      safetyTolerance: settings.safety,
      keyframes: frames.map((f) => ({ url: f.url, at: times[f.url] === undefined || times[f.url] === "" ? null : Number(times[f.url]) })),
      timedKeyframes: settings.timedKeyframes,
      sourceVideo: source.trim() || undefined,
      creativity: settings.creativity,
      upscaleFactor: settings.upscaleFactor,
    };
  }

  function metaFor(isDraft: boolean, cost?: number): string {
    const parts = [modeInfo.label];
    if (mode === "upscale") parts.push(`${settings.upscaleFactor}×`);
    else if (mode !== "edit") {
      parts.push(settings.aspect === "auto" ? "auto aspect" : settings.aspect);
      parts.push(settings.duration === "auto" ? "auto length" : `${settings.duration}s`);
      parts.push(isDraft ? "DRAFT (HD)" : FLUX_VIDEO_RESOLUTIONS.find((r) => r.value === settings.resolution)?.label ?? settings.resolution);
      if (!settings.audio) parts.push("no audio");
    }
    if (typeof cost === "number") parts.push(`${cost} cr`);
    return parts.join(" · ");
  }

  function pushJob(pollingUrl: string, text: string, meta: string, cost?: number) {
    const job: FluxJob = { key: jobKey("vid"), batch: jobKey("vb"), kind: "video", prompt: text || "FLUX video", pollingUrl, state: "pending", cost, meta, startedAt: Date.now() };
    add([job]);
  }

  function generate() {
    if (!configured) return;
    const req = toRequest();
    const isDraft = settings.draft && (mode === "t2v" || mode === "i2v" || mode === "v2v");
    startSubmit(async () => {
      const res = await submitFluxVideoAction({ kind: "generate", settings: req });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      for (const w of res.warnings) toast({ tone: "info", message: w });
      pushJob(res.pollingUrl, prompt, metaFor(isDraft, res.cost), res.cost);
      toast({ tone: "success", message: "Video started. It usually takes a few minutes. You can keep working on this page." });
      refreshCredits();
    });
  }

  function enhance(j: FluxJob) {
    if (!j.draftCache) return;
    const cache = j.draftCache;
    startSubmit(async () => {
      const res = await submitFluxVideoAction({ kind: "enhance", draftCache: cache, resolution: enhanceRes, safetyTolerance: settings.safety });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      const label = FLUX_VIDEO_RESOLUTIONS.find((r) => r.value === enhanceRes)?.label ?? enhanceRes;
      pushJob(res.pollingUrl, j.prompt, `Enhanced draft · ${label}${typeof res.cost === "number" ? ` · ${res.cost} cr` : ""}`, res.cost);
      toast({ tone: "success", message: `Rendering the same shot at ${label}.` });
      refreshCredits();
    });
  }

  function setClipAsSource(j: FluxJob) {
    if (!j.asset) return;
    const v = { id: j.asset.id, url: j.asset.url, label: j.asset.title };
    setExtraVideos((prev) => (prev.some((x) => x.url === v.url) ? prev : [v, ...prev]));
    setSource(v.url);
    if (!needsSource) setSettings((s) => ({ ...s, mode: "v2v", duration: s.duration !== "auto" && s.duration > 15 ? 15 : s.duration }));
    toast({ tone: "success", message: "Clip set as the source video." });
  }

  const canGo =
    configured &&
    !submitting &&
    (promptOptional || prompt.trim().length > 0) &&
    (!needsSource || /^https:\/\//i.test(source.trim())) &&
    (mode !== "i2v" || frames.length > 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className={PANEL}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--admin-text)]">FLUX 3 Video</h3>
            <Badge tone={configured ? "green" : "neutral"}>{configured ? "FLUX connected" : "Not configured"}</Badge>
            <span className="ml-auto">
              <CreditsBadge credits={credits} />
            </span>
          </div>
          <div role="radiogroup" aria-label="Video mode" className="flex flex-wrap gap-1">
            {FLUX_VIDEO_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === mode}
                onClick={() => setSettings((s) => ({ ...s, mode: m.id, duration: m.id === "v2v" && s.duration !== "auto" && s.duration > 15 ? 15 : s.duration }))}
                className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition ${m.id === mode ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{modeInfo.note}</p>
        </div>

        {needsSource && (
          <div className={PANEL}>
            <h3 className="mb-2 text-sm font-bold text-[var(--admin-text)]">Source video</h3>
            <select value={videos.some((v) => v.url === source) ? source : ""} onChange={(e) => setSource(e.target.value)} className={CTL} aria-label="Source video from library">
              <option value="">Pick a clip from your media library…</option>
              {videos.map((v) => (
                <option key={v.url} value={v.url}>
                  {v.label}
                </option>
              ))}
            </select>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="…or paste an https:// link to an .mp4" className={`${CTL} mt-2`} aria-label="Source video URL" />
            <p className="mt-1.5 text-[0.68rem] text-[var(--admin-text-faint)]">
              To use a new clip, upload it on the <Link href="/admin/media" className="underline">Media page</Link> (large uploads supported), then pick it here.
              {mode === "upscale" ? " Upscale accepts sources up to 2560×1440 and covers the first 20 seconds." : ""}
            </p>
            {/^https:\/\//i.test(source.trim()) && <video src={source.trim()} controls muted playsInline className="mt-2 max-h-56 w-full rounded-lg bg-black" />}
          </div>
        )}

        {mode === "i2v" && (
          <div className={PANEL}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--admin-text)]">Keyframe images</h3>
              <span className="text-xs text-[var(--admin-text-muted)]">
                {frames.length}/{FLUX_MAX_KEYFRAMES}
              </span>
            </div>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">1 image = the first frame · 2 = first and last · 3+ = first, last, and the rest evenly spaced. Refer to them as image 1, image 2… in the prompt.</p>
            <ReferenceStrip value={frames} onChange={setFrames} max={FLUX_MAX_KEYFRAMES} library={library} onLibraryAdd={(r) => setUploads((p) => (p.some((x) => x.url === r.url) ? p : [r, ...p]))} />
            {settings.timedKeyframes && frames.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {frames.map((f, i) => (
                  <label key={f.url} className="text-xs text-[var(--admin-text-muted)]">
                    image {i + 1} at (s)
                    <input type="number" min={0} max={20} step={0.5} value={times[f.url] ?? (i === 0 ? "0" : "")} onChange={(e) => setTimes((t) => ({ ...t, [f.url]: e.target.value }))} className={`${CTL} mt-0.5`} />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={PANEL}>
          <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">{mode === "edit" ? "Edit instruction" : mode === "upscale" ? "Describe the clip (optional)" : "Prompt"}</h3>
          <PromptBox
            value={prompt}
            onChange={setPrompt}
            templates={mode === "upscale" ? [] : VIDEO_TEMPLATES}
            snippets={mode === "edit" || mode === "upscale" ? [] : VIDEO_SNIPPETS}
            warnings={videoWarnings(prompt, mode)}
            onSubmit={() => canGo && generate()}
            placeholder={
              mode === "edit"
                ? "e.g. Change the season to winter with light snowfall; keep everything else the same."
                : mode === "upscale"
                  ? "Optional: what the clip shows, to steer the added detail. Leave empty for a neutral upscale."
                  : "Describe the shot: subject and action, camera move, light and mood, then an “Audio:” line.\ne.g. A barista pours latte art in a sunlit café, slow dolly-in, warm morning light. Audio: espresso machine hiss and soft jazz. No on-screen text."
            }
          />
        </div>

        <div className={PANEL}>
          <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Settings</h3>
          <VideoSettings value={settings} onChange={setSettings} keyframeCount={frames.length} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={!canGo}>
            {submitting ? "Submitting…" : mode === "edit" ? "Edit video" : mode === "upscale" ? "Upscale video" : settings.draft ? "Generate draft" : "Generate video"}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
            Enhance drafts to
            <select value={enhanceRes} onChange={(e) => setEnhanceRes(e.target.value)} className="rounded-md border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-1.5 py-1 text-xs text-[var(--admin-text)]">
              {FLUX_VIDEO_RESOLUTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {pendingCount > 0 && <span className="text-xs text-[var(--admin-text-muted)]">{pendingCount} running. Keep this tab open.</span>}
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
          onEnhanceDraft={enhance}
          onUseVideo={setClipAsSource}
          onRemove={remove}
          onClear={clearFinished}
          emptyText="Your videos appear here when they finish (usually a few minutes). Each one is saved to the media library as a draft. Drafts can be enhanced to full quality in one click."
        />
      </div>
    </div>
  );
}
