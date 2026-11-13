"use client";
/* eslint-disable @next/next/no-img-element -- previews of hosted AI pictures (any host), not page images */

/**
 * CanvasPictureTools — D243 E-4 (SOP-22 G-124).
 *
 * The AI picture tools of the newsletter studio ("like Canva or Adobe"):
 * Make a picture, Edit with words, Remove background, Erase (paint over it),
 * Replace what I paint, Extend / stretch, Change a colour, Relight, Style
 * look, Variations, Enlarge 2×, AI GIF. Works on any picture in the selected
 * section (picture, design, picture-with-words, cards, columns).
 *
 * Results are new Media files. Before / after drag compares them with the
 * original; "Use it" swaps the picture in (Undo brings the old one back).
 */
import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { Badge, Button, Select, Textarea } from "@/components/admin/ui";
import { newBlockId, type CanvasBlock, type CanvasDoc } from "@/lib/cms/newsletter-canvas-core";
import { ENGINE_LABEL, IMAGE_ASPECTS, type ImageEngine } from "@/lib/cms/newsletter-ai-core";
import { STYLE_SWATCHES } from "@/lib/cms/newsletter-style-core";
import {
  EXTEND_AMOUNTS,
  EXTEND_SHAPES,
  EXTEND_SIDES,
  GIF_MOTIONS,
  PICTURE_TOOLS,
  RELIGHT_LOOKS,
  STYLE_LOOKS,
  clampSplit,
  maskCoverageIssue,
  pictureTargets,
  swapPicture,
  toolDef,
  toolEngines,
  type ExtendSide,
  type PictureTool,
  type ToolEngine,
} from "@/lib/cms/newsletter-picture-core";
import { aiPictureToolAction } from "@/app/admin/newsletter/canvas/picture-actions";
import { aiFluxPollAction } from "@/app/admin/newsletter/canvas/ai-actions";

type Api = { doc: CanvasDoc; setDoc: (d: CanvasDoc) => void; selected: CanvasBlock | null; update: (b: CanvasBlock) => void; commit?: (d: CanvasDoc) => void };

const FLUX_POLL_MS = 4000;
const FLUX_MAX_POLLS = 75;
const ENGINE_NAME: Record<ToolEngine, string> = { ...ENGINE_LABEL, local: "Our server (free)" };

/** Paint the area to change; white strokes on a black mask the size of the preview. */
function MaskBrush({ src, onMask }: { src: string; onMask: (dataUrl: string | null, coverage: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drawing = useRef(false);
  const [size, setSize] = useState(36);
  const [erasing, setErasing] = useState(false);

  const fit = () => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    c.width = img.naturalWidth > 0 ? Math.min(1024, img.naturalWidth) : 600;
    c.height = img.naturalWidth > 0 ? Math.round((c.width * img.naturalHeight) / img.naturalWidth) : 400;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    onMask(null, 0);
  };

  const report = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 0) painted++;
    const coverage = painted / (data.length / 16);
    // Export: black everywhere, white where painted.
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const o = out.getContext("2d");
    if (!o) return;
    o.fillStyle = "#000";
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(c, 0, 0);
    const px = o.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < px.data.length; i += 4) {
      const v = px.data[i] + px.data[i + 1] + px.data[i + 2] > 30 ? 255 : 0;
      px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
      px.data[i + 3] = 255;
    }
    o.putImageData(px, 0, 0);
    onMask(coverage > 0 ? out.toDataURL("image/png") : null, coverage);
  };

  const paint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c || !drawing.current) return;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(255,64,64,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, (size / 2) * (c.width / r.width), 0, Math.PI * 2);
    ctx.fill();
  };

  return (
    <div className="space-y-1" data-testid="mask-brush">
      <div className="relative w-full overflow-hidden rounded border border-[var(--admin-border)]">
        <img ref={imgRef} src={src} alt="Paint over the part to change" className="block w-full select-none" onLoad={fit} draggable={false} crossOrigin="anonymous" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none opacity-60"
          onPointerDown={(e) => {
            drawing.current = true;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            paint(e);
          }}
          onPointerMove={paint}
          onPointerUp={() => {
            drawing.current = false;
            report();
          }}
          onPointerLeave={() => {
            if (drawing.current) report();
            drawing.current = false;
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text)]">
        <label className="flex items-center gap-1">
          Brush
          <input type="range" min={8} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush size" />
        </label>
        <Button type="button" size="sm" variant={erasing ? "confirm" : "neutral"} onClick={() => setErasing((v) => !v)}>{erasing ? "Un-painting" : "Un-paint"}</Button>
        <Button type="button" size="sm" variant="neutral" onClick={fit}>Clear</Button>
      </div>
    </div>
  );
}

/** Drag to compare the original (left) with the result (right). */
function BeforeAfter({ before, after, transparent }: { before: string; after: string; transparent: boolean }) {
  const [split, setSplit] = useState(50);
  return (
    <div className="space-y-1" data-testid="before-after">
      <div className={`relative w-full overflow-hidden rounded border border-[var(--admin-border)] ${transparent ? "bg-[repeating-conic-gradient(#ccc_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]" : ""}`}>
        <img src={after} alt="After" className="block w-full" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
          <img src={before} alt="Before" className="block h-full max-w-none object-cover" style={{ width: `${10000 / Math.max(split, 1)}%` }} />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${split}%` }} />
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">Before</span>
        <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">After</span>
      </div>
      <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(clampSplit(e.target.value))} className="w-full" aria-label="Before and after" />
    </div>
  );
}

export function CanvasPictureTools({ postId, engines, api }: { postId: string; engines: ImageEngine[]; api: Api }) {
  const { doc, setDoc, selected, update, commit } = api;
  const [pending, start] = useTransition();
  const [tool, setTool] = useState<PictureTool>("generate");
  const [engine, setEngine] = useState<ToolEngine | null>(null);
  const [ask, setAsk] = useState("");
  const [colour, setColour] = useState("#7ed957");
  const [look, setLook] = useState("");
  const [motion, setMotion] = useState<string>(GIF_MOTIONS[0].key);
  const [frames, setFrames] = useState(3);
  const [aspect, setAspect] = useState("wide");
  const [side, setSide] = useState<ExtendSide>("all");
  const [percent, setPercent] = useState<number>(50);
  const [shape, setShape] = useState<string>("");
  const [mask, setMask] = useState<{ url: string | null; coverage: number }>({ url: null, coverage: 0 });
  const [target, setTarget] = useState<string>("");
  const [results, setResults] = useState<{ url: string; transparent: boolean }[]>([]);
  const [picked, setPicked] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [fluxState, setFluxState] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const targets = pictureTargets(selected);
  const source = targets.find((t) => t.url === target)?.url ?? targets[0]?.url ?? null;
  const def = toolDef(tool);
  const can = toolEngines(tool, engines);
  const eng = engine && can.includes(engine) ? engine : can[0] ?? null;
  const busy = pending || fluxState !== null;
  const needsPick = def.needsSource && !source;
  const maskIssue = def.needsMask ? maskCoverageIssue(mask.coverage) : null;
  const askMissing = def.ask === "required" && !ask.trim();
  const result = results[picked] ?? null;

  const chooseTool = (t: PictureTool) => {
    setTool(t);
    setResults([]);
    setMsg(null);
    setMask({ url: null, coverage: 0 });
    setLook(t === "relight" ? RELIGHT_LOOKS[0].key : t === "style" ? STYLE_LOOKS[0].key : "");
  };

  const pollFlux = async (pollingUrl: string, prompt: string) => {
    for (let n = 0; n < FLUX_MAX_POLLS && alive.current; n++) {
      await new Promise((res) => setTimeout(res, FLUX_POLL_MS));
      const r = await aiFluxPollAction(postId, pollingUrl, prompt);
      if (!alive.current) return;
      if (r.state === "pending") {
        setFluxState(`FLUX is working${r.progress ? ` (${Math.round(r.progress * 100)}%)` : ""}…`);
        continue;
      }
      setFluxState(null);
      if (r.state === "failed") return setMsg({ tone: "err", text: `FLUX: ${r.error}` });
      setResults([{ url: r.url, transparent: false }]);
      setPicked(0);
      return setMsg({ tone: "ok", text: "Saved to Media as a new file. Drag to compare, then Use it." });
    }
    setFluxState(null);
    if (alive.current) setMsg({ tone: "err", text: "FLUX took too long. The picture may still appear in Media later." });
  };

  const run = () =>
    start(async () => {
      setMsg(null);
      setResults([]);
      const r = await aiPictureToolAction(postId, {
        tool,
        engine: eng,
        sourceUrl: def.needsSource || tool === "gif-frame" ? source : null,
        ask,
        colour,
        look,
        motion,
        frames,
        count: 3,
        aspect,
        maskDataUrl: def.needsMask ? mask.url : null,
        extend: { side, percent, shape: shape || null },
      });
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      if (r.kind === "flux") {
        setFluxState("FLUX is working…");
        void pollFlux(r.pollingUrl, r.prompt);
        return;
      }
      setResults(r.results.map((x) => ({ url: x.url, transparent: r.transparent })));
      setPicked(0);
      setMsg({ tone: "ok", text: `${ENGINE_NAME[r.engine]}: saved to Media as ${r.results.length > 1 ? `${r.results.length} new files` : "a new file"}. ${r.note ?? ""} The original is kept.`.trim() });
    });

  const save = (d: CanvasDoc) => (commit ? commit(d) : setDoc(d));
  const useHere = () => {
    if (!result) return;
    if (selected && source && def.needsSource) {
      const b = swapPicture(selected, source, result.url);
      if (commit) save({ ...doc, blocks: doc.blocks.map((x) => (x.id === b.id ? b : x)) });
      else update(b);
      setTarget(result.url);
      setMsg({ tone: "ok", text: "Picture swapped in. Undo brings the old one back." });
    } else {
      const i = selected ? doc.blocks.findIndex((x) => x.id === selected.id) + 1 : doc.blocks.length;
      const block: CanvasBlock = { id: newBlockId("image"), type: "image", src: result.url, alt: ask.slice(0, 200), href: "", width: 600, caption: "" };
      const blocks = [...doc.blocks];
      blocks.splice(i, 0, block);
      save({ ...doc, blocks });
      setMsg({ tone: "ok", text: "Added as a new Picture section. Write the alt text, then Save." });
    }
    setResults([]);
  };

  if (!engines.length) {
    return <p className="text-xs text-[var(--admin-text-muted)]">No picture AI is set up. GPT Image needs OPENAI_API_KEY; Gemini needs AI_GEMINI_API_KEY; FLUX is in Settings &gt; Integrations. Enlarge 2× works without AI on a selected picture.</p>;
  }

  return (
    <section className="space-y-2" data-testid="picture-tools">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">AI picture tools</p>
        <Badge tone="green">{engines.map((e) => ENGINE_LABEL[e]).join(" · ")}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {PICTURE_TOOLS.map((t) => {
          const off = toolEngines(t.key, engines).length === 0;
          return (
            <button
              key={t.key}
              type="button"
              disabled={busy || off}
              onClick={() => chooseTool(t.key)}
              title={off ? `${t.label} needs ${t.engines.map((e) => ENGINE_NAME[e]).join(" or ")}` : t.help}
              className={`rounded border px-2 py-1 text-left text-xs ${tool === t.key ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "border-[var(--admin-border)] text-[var(--admin-text)]"} ${off ? "opacity-40" : ""}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--admin-text-muted)]">{def.help}</p>

      {def.needsSource || tool === "gif-frame" ? (
        targets.length ? (
          targets.length > 1 ? (
            <Select value={source ?? ""} onChange={(e) => setTarget(e.target.value)} aria-label="Which picture">
              {targets.map((t) => (
                <option key={t.url} value={t.url}>{t.label}</option>
              ))}
            </Select>
          ) : (
            <p className="text-xs text-[var(--admin-text)]">Working on: {targets[0].label}</p>
          )
        ) : (
          <p className="text-xs text-[var(--admin-orange)]">{def.needsSource ? "Select a section with a picture (Picture, Design, Picture with words, Cards or Columns)." : "Optional: select a picture to animate it; otherwise the AI draws one."}</p>
        )
      ) : null}

      {can.length > 1 ? (
        <Select value={eng ?? ""} onChange={(e) => setEngine(e.target.value as ToolEngine)} aria-label="Picture AI">
          {can.map((e) => (
            <option key={e} value={e}>{ENGINE_NAME[e]}</option>
          ))}
        </Select>
      ) : eng ? (
        <p className="text-xs text-[var(--admin-text-muted)]">Runs on {ENGINE_NAME[eng]}.</p>
      ) : (
        <p className="text-xs text-[var(--admin-orange)]">{def.label} needs {def.engines.map((e) => ENGINE_NAME[e]).join(" or ")}.</p>
      )}

      {def.needsMask && source ? <MaskBrush key={source} src={source} onMask={(url, coverage) => setMask({ url, coverage })} /> : null}

      {tool === "extend" ? (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {EXTEND_SHAPES.map((s) => (
              <Button key={s.key} type="button" size="sm" variant={shape === s.key ? "confirm" : "neutral"} onClick={() => setShape(shape === s.key ? "" : s.key)}>{s.label}</Button>
            ))}
          </div>
          {!shape ? (
            <div className="flex flex-wrap gap-2">
              <Select value={side} onChange={(e) => setSide(e.target.value as ExtendSide)} aria-label="Which side">
                {EXTEND_SIDES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </Select>
              <Select value={String(percent)} onChange={(e) => setPercent(Number(e.target.value))} aria-label="How much">
                {EXTEND_AMOUNTS.map((a) => (
                  <option key={a} value={a}>+{a}%</option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      {tool === "recolor" ? (
        <div className="flex flex-wrap items-center gap-1">
          {STYLE_SWATCHES.map((s) => (
            <button key={s.hex} type="button" title={s.label} aria-label={s.label} onClick={() => setColour(s.hex)} className={`h-6 w-6 rounded border ${colour === s.hex ? "ring-2 ring-[var(--admin-accent)]" : ""}`} style={{ background: s.hex }} />
          ))}
          <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="Any colour" className="h-6 w-8" />
        </div>
      ) : null}

      {tool === "relight" || tool === "style" ? (
        <div className="flex flex-wrap gap-1">
          {(tool === "relight" ? RELIGHT_LOOKS : STYLE_LOOKS).map((l) => (
            <Button key={l.key} type="button" size="sm" variant={look === l.key ? "confirm" : "neutral"} onClick={() => setLook(l.key)}>{l.label}</Button>
          ))}
        </div>
      ) : null}

      {tool === "gif-frame" ? (
        <div className="flex flex-wrap gap-2">
          <Select value={motion} onChange={(e) => setMotion(e.target.value)} aria-label="Motion">
            {GIF_MOTIONS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </Select>
          <Select value={String(frames)} onChange={(e) => setFrames(Number(e.target.value))} aria-label="Frames">
            <option value="3">3 frames</option>
            <option value="4">4 frames</option>
          </Select>
        </div>
      ) : null}

      {tool === "generate" || tool === "gif-frame" ? (
        <Select value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Shape">
          {IMAGE_ASPECTS.map((a) => (
            <option key={a.key} value={a.key}>{a.label}</option>
          ))}
        </Select>
      ) : null}

      {def.ask !== "none" ? (
        <Textarea
          rows={2}
          maxLength={1500}
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder={
            tool === "recolor" ? "What to recolour, e.g. the jar lid" : tool === "replace" ? "What goes in the painted area, e.g. a small potted plant" : tool === "erase" ? "Optional: what you painted, e.g. the price sticker" : tool === "extend" ? "Optional: what the new edges show, e.g. more wooden counter" : tool === "gif-frame" ? "e.g. A glass jar on a wooden counter in warm light" : "e.g. A cozy autumn storefront banner with falling leaves, no people"
          }
        />
      ) : null}

      <Button type="button" variant="confirm" size="sm" onClick={run} disabled={busy || !eng || needsPick || Boolean(maskIssue) || askMissing}>
        {busy ? "Working…" : def.label}
      </Button>
      {maskIssue && source ? <p className="text-xs text-[var(--admin-text-muted)]">{maskIssue}</p> : null}
      {msg ? <p role="status" className={`rounded-[var(--admin-radius-md)] px-3 py-2 text-xs ${msg.tone === "ok" ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}>{msg.text}</p> : null}
      {fluxState ? <p className="text-xs text-[var(--admin-text-muted)]">{fluxState}</p> : null}

      {results.length > 1 ? (
        <div className="grid grid-cols-3 gap-1">
          {results.map((r, i) => (
            <button key={r.url} type="button" onClick={() => setPicked(i)} className={`overflow-hidden rounded border ${i === picked ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]" : "border-[var(--admin-border)]"}`}>
              <img src={r.url} alt={`Option ${i + 1}`} className="block w-full" />
            </button>
          ))}
        </div>
      ) : null}
      {result ? (
        <div className="space-y-2">
          {source && def.needsSource ? <BeforeAfter before={source} after={result.url} transparent={result.transparent} /> : <img src={result.url} alt="AI result" className="max-h-56 rounded border border-[var(--admin-border)]" />}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="save" size="sm" onClick={useHere}>{source && def.needsSource ? "Use it here" : "Add to the canvas"}</Button>
            <Button type="button" variant="neutral" size="sm" onClick={() => setResults([])}>Discard</Button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-[var(--admin-text-muted)]">No people who look under 21, no smoking or use, no cartoons, no health claims (WAC 314-55-155). A safety note is added to every ask; the monthly AI budget applies.</p>
    </section>
  );
}
