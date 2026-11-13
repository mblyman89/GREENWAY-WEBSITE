"use client";
/* eslint-disable @next/next/no-img-element -- previews of hosted AI pictures (any host), not page images */

/**
 * CanvasAiStudio — D238 N-8b (SOP-22 G-118).
 *
 * The AI side panel of the newsletter canvas ("like Canva's AI"):
 *   - Build with AI: drafts the headline, intro, notes, button, subject and
 *     preview text from THIS WEEK'S facts only. Cards stay fact-only.
 *   - Improve this section: rewrite the selected section (presets or your
 *     own ask). Review quotes are locked (the customer's own words).
 *   - Subject ideas: five subject + preview text pairs; click one to use it.
 *   - Picture studio: edit the selected picture or make a new one with GPT
 *     Image, Gemini (Nano Banana) or FLUX; Remove background; results are
 *     saved to Media as new files and the original is kept.
 * Nothing the AI writes is used if it fails the copy or compliance check;
 * every change lands in the canvas unsaved, so Undo is "reload" or edit.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Select, Textarea } from "@/components/admin/ui";
import { newBlockId, type CanvasBlock, type CanvasDoc } from "@/lib/cms/newsletter-canvas-core";
import {
  AI_ASK_MAX,
  ENGINE_LABEL,
  IMAGE_ASPECTS,
  IMAGE_EDIT_PRESETS,
  IMPROVE_PRESETS,
  type AiIssue,
  type ImageEngine,
} from "@/lib/cms/newsletter-ai-core";
import { NewsletterCanvasEditor } from "./NewsletterCanvasEditor";
import { aiBuildCanvasAction, aiFluxPollAction, aiImageAction, aiImproveBlockAction, aiSubjectIdeasAction } from "@/app/admin/newsletter/canvas/ai-actions";

type Api = { doc: CanvasDoc; setDoc: (d: CanvasDoc) => void; selected: CanvasBlock | null; update: (b: CanvasBlock) => void };

const FLUX_POLL_MS = 4000;
const FLUX_MAX_POLLS = 60;

function Issues({ issues }: { issues: AiIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-[var(--admin-text-muted)]">
      {issues.map((i, n) => (
        <li key={n}>
          <Badge tone={i.level === "must-fix" ? "danger" : "orange"}>{i.level === "must-fix" ? "Must fix" : "Heads-up"}</Badge> {i.text}
        </li>
      ))}
    </ul>
  );
}

export function CanvasAiStudio({ postId, aiConfigured, engines, api }: { postId: string; aiConfigured: boolean; engines: ImageEngine[]; api: Api }) {
  const { doc, setDoc, selected, update } = api;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [issues, setIssues] = useState<AiIssue[]>([]);
  const [buildAsk, setBuildAsk] = useState("");
  const [improveAsk, setImproveAsk] = useState("");
  const [ideas, setIdeas] = useState<{ subject: string; preheader: string; issues: AiIssue[] }[]>([]);
  const [engine, setEngine] = useState<ImageEngine>(engines[0] ?? "gpt");
  const [imgAsk, setImgAsk] = useState("");
  const [aspect, setAspect] = useState<string>("wide");
  const [removeBg, setRemoveBg] = useState(false);
  const [result, setResult] = useState<{ url: string; transparent: boolean } | null>(null);
  const [fluxState, setFluxState] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selectedImage = selected && selected.type === "image" && selected.src ? selected : null;
  const busy = pending || fluxState !== null;

  const build = () =>
    start(async () => {
      setMsg(null);
      const r = await aiBuildCanvasAction(postId, doc, buildAsk);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      setDoc(r.doc);
      setIssues(r.issues);
      setMsg({ tone: "ok", text: `Drafted with ${r.model}. Read it, change anything, then Save.${r.partial ? " Some of this week's data could not be loaded." : ""}` });
    });

  const improve = (askText: string) =>
    start(async () => {
      if (!selected) return setMsg({ tone: "err", text: "Pick a section on the left first." });
      setMsg(null);
      const r = await aiImproveBlockAction(postId, selected, askText);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      update(r.block);
      setIssues(r.issues);
      setMsg({ tone: "ok", text: `Rewrote: ${r.changed.join(", ")}. Not saved yet.` });
    });

  const subjects = () =>
    start(async () => {
      setMsg(null);
      const r = await aiSubjectIdeasAction(postId, doc);
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      setIdeas(r.ideas);
    });

  const placeResult = (url: string) => {
    if (selectedImage) {
      update({ ...selectedImage, src: url });
      return;
    }
    const i = selected ? doc.blocks.findIndex((x) => x.id === selected.id) + 1 : doc.blocks.length;
    const block: CanvasBlock = { id: newBlockId("image"), type: "image", src: url, alt: imgAsk.slice(0, 200), href: "", width: 600, caption: "" };
    const blocks = [...doc.blocks];
    blocks.splice(i, 0, block);
    setDoc({ ...doc, blocks });
  };

  const pollFlux = async (pollingUrl: string, prompt: string) => {
    for (let n = 0; n < FLUX_MAX_POLLS && alive.current; n++) {
      await new Promise((res) => setTimeout(res, FLUX_POLL_MS));
      const r = await aiFluxPollAction(postId, pollingUrl, prompt);
      if (!alive.current) return;
      if (r.state === "pending") {
        setFluxState(`FLUX is drawing${r.progress ? ` (${Math.round(r.progress * 100)}%)` : ""}…`);
        continue;
      }
      setFluxState(null);
      if (r.state === "failed") return setMsg({ tone: "err", text: `FLUX: ${r.error}` });
      setResult({ url: r.url, transparent: false });
      return setMsg({ tone: "ok", text: "FLUX picture saved to Media. Use it below." });
    }
    setFluxState(null);
    if (alive.current) setMsg({ tone: "err", text: "FLUX took too long. The picture may still appear in Media later." });
  };

  const picture = (forceNew: boolean) =>
    start(async () => {
      setMsg(null);
      setResult(null);
      const r = await aiImageAction(postId, { engine, ask: imgAsk, sourceUrl: forceNew || !selectedImage ? null : selectedImage.src, aspect, removeBackground: removeBg });
      if (!r.ok) return setMsg({ tone: "err", text: r.error });
      if (r.kind === "flux") {
        setFluxState("FLUX is drawing…");
        void pollFlux(r.pollingUrl, r.prompt);
        return;
      }
      setResult({ url: r.url, transparent: r.transparent });
      setMsg({ tone: "ok", text: `${ENGINE_LABEL[r.engine]} picture saved to Media${r.transparent ? " (see-through background)" : ""}. The original is kept.` });
    });

  return (
    <div className="mt-4 space-y-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--admin-text)]">AI studio</p>
        <Badge tone={aiConfigured ? "green" : "neutral"}>{aiConfigured ? "AI on" : "AI not set up"}</Badge>
      </div>
      {!aiConfigured ? <p className="text-xs text-[var(--admin-text-muted)]">Words need AI_API_KEY (or OPENAI_API_KEY) on the deployment.</p> : null}
      {msg ? <p role="status" className={`rounded-[var(--admin-radius-md)] px-3 py-2 text-xs ${msg.tone === "ok" ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}>{msg.text}</p> : null}
      {fluxState ? <p className="text-xs text-[var(--admin-text-muted)]">{fluxState}</p> : null}
      <Issues issues={issues} />

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Build with AI</p>
        <Textarea rows={2} maxLength={AI_ASK_MAX} value={buildAsk} onChange={(e) => setBuildAsk(e.target.value)} placeholder="e.g. Cozy fall feel, lead with the new vendor, invite people in for the weekend" />
        <Button type="button" variant="confirm" size="sm" onClick={build} disabled={busy || !aiConfigured}>Draft the newsletter</Button>
        <p className="text-xs text-[var(--admin-text-muted)]">Uses only this week&apos;s drops, deals, vendors and posts. Cards stay as the facts.</p>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Improve the selected section</p>
        <div className="flex flex-wrap gap-1">
          {IMPROVE_PRESETS.map((p) => (
            <Button key={p.key} type="button" variant="neutral" size="sm" onClick={() => improve(p.ask)} disabled={busy || !aiConfigured || !selected}>{p.label}</Button>
          ))}
        </div>
        <Textarea rows={2} maxLength={AI_ASK_MAX} value={improveAsk} onChange={(e) => setImproveAsk(e.target.value)} placeholder="Or ask your own: make the button text punchier" />
        <Button type="button" variant="neutral" size="sm" onClick={() => improve(improveAsk)} disabled={busy || !aiConfigured || !selected || !improveAsk.trim()}>Rewrite with my ask</Button>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Subject ideas</p>
        <Button type="button" variant="neutral" size="sm" onClick={subjects} disabled={busy || !aiConfigured}>Suggest 5 subjects</Button>
        {ideas.map((i, n) => (
          <button key={n} type="button" onClick={() => setDoc({ ...doc, subject: i.subject, preheader: i.preheader })} className="block w-full rounded border border-[var(--admin-border)] p-2 text-left text-xs hover:border-[var(--admin-accent)]">
            <span className="font-semibold text-[var(--admin-text)]">{i.subject}</span>
            <span className="block text-[var(--admin-text-muted)]">{i.preheader}</span>
            <Issues issues={i.issues} />
          </button>
        ))}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Picture studio</p>
        {engines.length === 0 ? (
          <p className="text-xs text-[var(--admin-text-muted)]">No picture AI is set up. GPT Image needs OPENAI_API_KEY; Gemini needs AI_GEMINI_API_KEY; FLUX is in Settings &gt; Integrations.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--admin-text-muted)]">{selectedImage ? "Editing the selected picture (a new copy is saved)." : "No picture selected: this makes a new picture and adds it below the selected section."}</p>
            <div className="flex flex-wrap gap-2">
              <Select value={engine} onChange={(e) => setEngine(e.target.value as ImageEngine)} aria-label="Picture AI">
                {engines.map((en) => (
                  <option key={en} value={en}>{ENGINE_LABEL[en]}</option>
                ))}
              </Select>
              {!selectedImage ? (
                <Select value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Shape">
                  {IMAGE_ASPECTS.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </Select>
              ) : null}
            </div>
            {selectedImage ? (
              <div className="flex flex-wrap gap-1">
                {IMAGE_EDIT_PRESETS.map((p) => (
                  <Button
                    key={p.key}
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => {
                      setImgAsk(p.ask);
                      setRemoveBg(p.key === "remove-bg");
                    }}
                    disabled={busy}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Textarea rows={3} maxLength={1500} value={imgAsk} onChange={(e) => setImgAsk(e.target.value)} placeholder={selectedImage ? "e.g. Put this jar on a wooden counter with warm light" : "e.g. A cozy autumn storefront banner with falling leaves, no people"} />
            <label className="flex items-center gap-2 text-xs text-[var(--admin-text)]">
              <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} className="h-4 w-4 accent-[var(--admin-accent)]" />
              Remove background {engine === "gemini" ? "(Gemini puts it on white)" : engine === "flux" ? "(not available on FLUX)" : "(see-through PNG)"}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="confirm" size="sm" onClick={() => picture(false)} disabled={busy || (!imgAsk.trim() && !removeBg)}>{selectedImage ? "Edit picture" : "Make picture"}</Button>
              {selectedImage ? <Button type="button" variant="neutral" size="sm" onClick={() => picture(true)} disabled={busy || !imgAsk.trim()}>Make a new one instead</Button> : null}
            </div>
            <p className="text-xs text-[var(--admin-text-muted)]">No people who look under 21, no smoking or use, no cartoons, no health claims. A safety note is added to every ask.</p>
          </>
        )}
        {result ? (
          <div className="space-y-2">
            <img src={result.url} alt="AI result" className={`max-h-48 rounded border border-[var(--admin-border)] ${result.transparent ? "bg-[repeating-conic-gradient(#ccc_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]" : ""}`} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="save"
                size="sm"
                onClick={() => {
                  placeResult(result.url);
                  setResult(null);
                  setMsg({ tone: "ok", text: "Picture placed. Run send check, then Save." });
                }}
              >
                {selectedImage ? "Use it here" : "Add to the canvas"}
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => setResult(null)}>Discard</Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Client wrapper so the server page can hand the studio to the editor's tool slot. */
export function NewsletterCanvasWithAi(props: Omit<Parameters<typeof NewsletterCanvasEditor>[0], "extraTools"> & { aiConfigured: boolean; engines: ImageEngine[] }) {
  const { aiConfigured, engines, ...rest } = props;
  return <NewsletterCanvasEditor {...rest} extraTools={(api) => <CanvasAiStudio postId={rest.postId} aiConfigured={aiConfigured} engines={engines} api={api} />} />;
}
