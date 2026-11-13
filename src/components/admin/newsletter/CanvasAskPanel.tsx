"use client";

/**
 * D243 E-5 (SOP-22 G-125): Ask the canvas.
 *
 * Owner (D243): "I should be able to ask it a question and it does the thing I
 * need on the canvas, by visually inspecting the canvas and then doing the
 * request." Decision 4: it proposes first, then Apply, with Undo.
 *
 * 1. The email HTML is drawn in a hidden same-origin frame (no scripts) and
 *    turned into a JPEG with modern-screenshot.
 * 2. The picture + the sections go to askCanvasAction (vision model).
 * 3. The answer and the proposed steps are listed; untick any step.
 * 4. Apply: the section steps are applied as ONE undoable change; picture
 *    steps then run one by one with the E-4 picture tools, and each result is
 *    swapped in as its own undoable change.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Textarea } from "@/components/admin/ui";
import { newBlockId, type CanvasBlock, type CanvasDoc } from "@/lib/cms/newsletter-canvas-core";
import type { ImageEngine } from "@/lib/cms/newsletter-ai-core";
import { pickEngine, pictureTargets, swapPicture } from "@/lib/cms/newsletter-picture-core";
import { applyAskOps, ASK_EXAMPLES, ASK_MAX, type AskOp } from "@/lib/cms/newsletter-ask-core";
import { askCanvasAction, askCanvasAppliedAction } from "@/app/admin/newsletter/canvas/ask-actions";
import { aiPictureToolAction } from "@/app/admin/newsletter/canvas/picture-actions";
import { aiFluxPollAction } from "@/app/admin/newsletter/canvas/ai-actions";

type Api = { doc: CanvasDoc; setDoc: (d: CanvasDoc) => void; selected: CanvasBlock | null; update: (b: CanvasBlock) => void; commit?: (d: CanvasDoc) => void; html?: string };
type Plan = { reply: string; ops: AskOp[]; lines: string[]; dropped: string[]; heads: string[]; model: string };
type PictureStep = Extract<AskOp, { kind: "picture" }>;

const SHOT_WIDTH = 640;
const FLUX_POLL_MS = 4000;
const FLUX_MAX_POLLS = 75;

/** Draw the email in a hidden frame and return a JPEG data URL. */
async function shootEmail(html: string): Promise<string> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${SHOT_WIDTH}px;height:2000px;border:0;`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((res) => {
      frame.onload = () => res();
      frame.srcdoc = html;
    });
    const body = frame.contentDocument?.body;
    if (!body) throw new Error("The preview could not be drawn.");
    await new Promise((r) => setTimeout(r, 400));
    const height = Math.min(6000, Math.max(400, body.scrollHeight));
    frame.style.height = `${height}px`;
    const { domToJpeg } = await import("modern-screenshot");
    return await domToJpeg(body, { width: SHOT_WIDTH, height, scale: 1, quality: 0.72, backgroundColor: "#000000", timeout: 20000 });
  } finally {
    frame.remove();
  }
}

export function CanvasAskPanel({ postId, engines, api }: { postId: string; engines: ImageEngine[]; api: Api }) {
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [on, setOn] = useState<boolean[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [work, setWork] = useState<string | null>(null);
  const docRef = useRef(api.doc);
  const alive = useRef(true);
  useEffect(() => {
    docRef.current = api.doc;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const save = (d: CanvasDoc) => {
    docRef.current = d;
    if (api.commit) api.commit(d);
    else api.setDoc(d);
  };
  const busy = pending || work !== null;

  const send = () =>
    start(async () => {
      setMsg(null);
      setPlan(null);
      if (!api.html) return setMsg({ tone: "err", text: "The preview is not ready yet." });
      let shot = "";
      try {
        setWork("Looking at the email…");
        shot = await shootEmail(api.html);
      } catch (e) {
        setWork(null);
        return setMsg({ tone: "err", text: e instanceof Error ? e.message : "The preview could not be drawn." });
      }
      setWork("Thinking…");
      const r = await askCanvasAction(postId, { ask, doc: api.doc, shot });
      setWork(null);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      setPlan({ reply: r.reply, ops: r.ops, lines: r.lines, dropped: r.dropped, heads: r.issues.map((i) => i.text), model: r.model });
      setOn(r.ops.map(() => true));
    });

  const pollFlux = async (pollingUrl: string, prompt: string): Promise<string | null> => {
    for (let n = 0; n < FLUX_MAX_POLLS && alive.current; n++) {
      await new Promise((res) => setTimeout(res, FLUX_POLL_MS));
      const r = await aiFluxPollAction(postId, pollingUrl, prompt);
      if (r.state === "pending") continue;
      return r.state === "ready" ? r.url : null;
    }
    return null;
  };

  const runPicture = async (p: PictureStep): Promise<boolean> => {
    const block = p.id ? docRef.current.blocks.find((b) => b.id === p.id) ?? null : null;
    const source = block ? pictureTargets(block)[0]?.url ?? null : null;
    const engine = pickEngine(p.tool, null, engines);
    if (!engine) return false;
    const r = await aiPictureToolAction(postId, {
      tool: p.tool,
      engine,
      sourceUrl: p.tool === "generate" ? null : source,
      ask: p.ask,
      colour: p.colour,
      look: p.look,
      aspect: "wide",
      count: 1,
      extend: { side: "all", percent: 50, shape: p.shape || (p.tool === "extend" ? "banner" : null) },
    });
    if (!r.ok) {
      setMsg({ tone: "err", text: `Picture step: ${r.error}` });
      return false;
    }
    const url = r.kind === "flux" ? await pollFlux(r.pollingUrl, r.prompt) : r.results[0]?.url ?? null;
    if (!url || !alive.current) return false;
    const d = docRef.current;
    const now = p.id ? d.blocks.find((b) => b.id === p.id) ?? null : null;
    if (now && source && p.tool !== "generate") {
      const b = swapPicture(now, source, url);
      save({ ...d, blocks: d.blocks.map((x) => (x.id === b.id ? b : x)) });
    } else {
      const i = now ? d.blocks.findIndex((x) => x.id === now.id) + 1 : d.blocks.length;
      const img: CanvasBlock = { id: newBlockId("image"), type: "image", src: url, alt: p.ask.slice(0, 200), href: "", width: 600, caption: "" };
      save({ ...d, blocks: [...d.blocks.slice(0, i), img, ...d.blocks.slice(i)] });
    }
    return true;
  };

  const apply = () => {
    if (!plan) return;
    const chosen = plan.ops.filter((_, i) => on[i]);
    const r = applyAskOps(docRef.current, chosen, (seed) => newBlockId(seed));
    if (r.applied) save(r.doc);
    setPlan(null);
    const pics = r.pictures;
    setMsg({ tone: "ok", text: `${r.applied} change${r.applied === 1 ? "" : "s"} applied${pics.length ? `; ${pics.length} picture step${pics.length === 1 ? "" : "s"} running` : ""}. Undo brings the old version back. Press Save to keep it.` });
    void (async () => {
      let made = 0;
      for (let n = 0; n < pics.length && alive.current; n++) {
        setWork(`Picture step ${n + 1} of ${pics.length}…`);
        if (await runPicture(pics[n])) made++;
      }
      setWork(null);
      if (pics.length && alive.current) setMsg({ tone: made === pics.length ? "ok" : "err", text: `${r.applied} change${r.applied === 1 ? "" : "s"} applied; ${made} of ${pics.length} picture step${pics.length === 1 ? "" : "s"} done (new Media files; originals kept). Undo goes back one step at a time. Press Save to keep it.` });
      void askCanvasAppliedAction(postId, { ask, applied: r.applied, pictures: made, skipped: r.skipped.length });
    })();
  };

  return (
    <section className="space-y-2" data-testid="ask-canvas">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Ask the canvas</h3>
        <Badge tone="neutral">looks at the preview</Badge>
      </div>
      <p className="text-xs text-[var(--admin-text-muted)]">Say what you want done, or ask a question. The AI looks at the email and suggests steps; nothing changes until you press Apply, and Undo brings it back.</p>
      <Textarea value={ask} onChange={(e) => setAsk(e.target.value.slice(0, ASK_MAX))} rows={3} placeholder="e.g. Make the headline punchier and give the deals a gold background" data-testid="ask-canvas-input" />
      <div className="flex flex-wrap gap-1">
        {ASK_EXAMPLES.map((x) => (
          <button key={x} type="button" className="rounded border border-[var(--admin-border)] px-2 py-0.5 text-[11px] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]" onClick={() => setAsk(x)} disabled={busy}>
            {x}
          </button>
        ))}
      </div>
      <Button type="button" size="sm" onClick={send} disabled={busy || !ask.trim()} data-testid="ask-canvas-send">
        {work ?? (pending ? "Working…" : "Ask")}
      </Button>
      {plan ? (
        <div className="space-y-2 rounded border border-[var(--admin-border)] p-2" data-testid="ask-canvas-plan">
          {plan.reply ? <p className="text-sm">{plan.reply}</p> : null}
          {plan.ops.length ? (
            <ul className="space-y-1">
              {plan.lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={on[i] ?? false} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} aria-label={`Step ${i + 1}`} />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--admin-text-muted)]">No changes suggested.</p>
          )}
          {plan.heads.length ? <p className="text-xs text-[var(--admin-gold)]">Heads-up: {plan.heads.join(" ")}</p> : null}
          {plan.dropped.length ? <p className="text-[11px] text-[var(--admin-text-faint)]">Left out (not allowed or not found): {plan.dropped.join("; ")}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="confirm" onClick={apply} disabled={busy || !on.some(Boolean)} data-testid="ask-canvas-apply">Apply</Button>
            <Button type="button" size="sm" variant="neutral" onClick={() => setPlan(null)} disabled={busy}>Dismiss</Button>
            <span className="ml-auto self-center text-[11px] text-[var(--admin-text-faint)]">{plan.model}</span>
          </div>
        </div>
      ) : null}
      {msg ? <p className={`text-xs ${msg.tone === "err" ? "text-[var(--admin-danger,#f87171)]" : "text-[var(--admin-text-muted)]"}`} role="status">{msg.text}</p> : null}
      <p className="text-[11px] text-[var(--admin-text-faint)]">The header, footer, the four warnings and unsubscribe are fixed; the AI cannot change them. Its words are checked against the cannabis ad rules (WAC 314-55-155) before they are shown.</p>
    </section>
  );
}
