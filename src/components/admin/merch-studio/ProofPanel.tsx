"use client";

/**
 * R71 S3 - "Proof & Export" tab. What a prepress desk hands the printer:
 *
 *  - One print file per Printful file type, previewed exactly as exported
 *    (trimmed, transparent, true inches), with DPI, pixel size, position and
 *    distances from the collar / brim.
 *  - Download: a ZIP with every 300-DPI transparent sRGB PNG + README + a
 *    printable proof sheet + the design JSON (a backup of the design).
 *  - Printable proof sheet (opens in a new tab, print to PDF or paper).
 *  - Photo mockups from Printful's mockup generator (when connected).
 *  - Sample checklist (ticks saved per design on this device).
 *  - The exact Printful order-item JSON Slice 4 will send.
 */
import { useEffect, useState } from "react";
import { colorsFor, getBlank, PRINTFUL_SNAPSHOT_DATE } from "@/lib/merch-studio/garment-catalog-core";
import { checkSides, type MerchDesign } from "@/lib/merch-studio/merch-design-core";
import {
  exportReadme, mockupTaskBody, planPrintFiles, printfulItemDraft, proofRows, proofSheetHtml, sampleChecklist, zipStore, slug, SEMI_ALPHA_WARN,
  MOCKUP_MAX_COLORS, type PrintFilePlan, type AlphaStats,
} from "@/lib/merch-studio/print-export-core";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { IssueList } from "./IssueList";
import { loadDesigns } from "./merch-assets";
import { assetDataUrls, downloadBytes, PrintFileSvg, putSignedMerchFile, renderPlanPng, standaloneSvg, type RenderedFile } from "./print-export";
import { createMockupTaskAction, getMockupTaskAction, startPrintFileUploadsAction } from "@/app/admin/merch-studio/proof-actions";
import type { Issue } from "@/lib/merch-studio/print-rules-core";

const CURRENT_KEY = "gw-merch-current-design";
const SELLER = "Greenway Merchandising LLC (dba Greenway Glass & Goods)";
const btn = "rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs font-bold disabled:opacity-40";
const enc = (s: string) => new TextEncoder().encode(s);
const sampleKey = (id: string) => `gw-merch-sample-${id}`;

function boot(): { list: MerchDesign[]; id: string } {
  const list = loadDesigns();
  let id: string | null = null;
  try { id = window.localStorage.getItem(CURRENT_KEY); } catch { /* blocked */ }
  return { list, id: list.find((d) => d.id === id)?.id ?? list[0]?.id ?? "" };
}
function loadTicks(id: string): Record<string, boolean> {
  try { return JSON.parse(window.localStorage.getItem(sampleKey(id)) ?? "{}") as Record<string, boolean>; } catch { return {}; }
}

type Mock = { placement: string; variantIds: number[]; url: string; extra: { title: string; url: string }[] };

export function ProofPanel() {
  const [init] = useState(boot);
  const [list] = useState(init.list);
  const [designId, setDesignId] = useState(init.id);
  const design = list.find((d) => d.id === designId) ?? null;
  const blank = design ? getBlank(design.blankId) : undefined;

  const [urls, setUrls] = useState<{ id: string; urls: Record<string, string>; missing: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [alpha, setAlpha] = useState<Record<string, AlphaStats>>({});
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => (init.id ? loadTicks(init.id) : {}));
  const [mockColors, setMockColors] = useState<string[]>([]);
  const [mocks, setMocks] = useState<Mock[]>([]);
  const [showJson, setShowJson] = useState(false);

  // Artwork as data: URLs (async; state set in the promise, never synchronously in the effect body).
  useEffect(() => {
    if (!design) return;
    let cancelled = false;
    assetDataUrls(design).then((r) => { if (!cancelled) setUrls({ id: design.id, ...r }); }).catch(() => { if (!cancelled) setUrls({ id: design.id, urls: {}, missing: [] }); });
    return () => { cancelled = true; };
  }, [design]);
  const artUrls = urls && design && urls.id === design.id ? urls.urls : null;
  const missingArt = urls && design && urls.id === design.id ? urls.missing : [];

  // Plain derivations: the React Compiler memoizes these (no manual useMemo, per repo lint rules).
  const planned = design ? planPrintFiles(design) : { plans: [] as PrintFilePlan[], issues: [] as Issue[] };
  const sideChecks = design ? checkSides(design) : [];
  const rows = design ? proofRows(design) : [];
  const checklist = design ? sampleChecklist(design) : [];
  const allIssues: Issue[] = [...planned.issues, ...planned.plans.flatMap((p) => p.issues), ...sideChecks.flatMap((c) => c.issues.map((i) => ({ ...i, title: `${c.placement.label}: ${i.title}` })))];
  const blockers = allIssues.filter((i) => i.level === "blocker" && !(design?.ack ?? []).includes(i.id));
  const colors = blank ? colorsFor(blank) : [];
  const colorName = colors.find((c) => c[1] === design?.colorHex)?.[0] ?? design?.colorHex ?? "";
  const pickedMockColors = mockColors.length ? mockColors : colorName ? [colorName] : [];

  const pick = (id: string) => { setDesignId(id); setTicks(loadTicks(id)); setAlpha({}); setMocks([]); setMockColors([]); setMsg(null); };
  const tick = (id: string, v: boolean) => {
    if (!design) return;
    const next = { ...ticks, [id]: v };
    setTicks(next);
    try { window.localStorage.setItem(sampleKey(design.id), JSON.stringify(next)); } catch { /* quota */ }
  };

  const renderAll = async (): Promise<RenderedFile[]> => {
    if (!artUrls) throw new Error("Artwork is still loading - try again in a second.");
    const out: RenderedFile[] = [];
    for (const p of planned.plans) {
      setBusy(`Rendering ${p.filename} (${p.pxW} x ${p.pxH} px)...`);
      out.push(await renderPlanPng(p, artUrls));
    }
    setAlpha(Object.fromEntries(out.map((r) => [r.plan.key, r.alpha])));
    return out;
  };
  const guard = (): boolean => {
    if (!design || !planned.plans.length) { setMsg({ tone: "bad", text: "This design has no artwork to export yet." }); return false; }
    if (missingArt.length) { setMsg({ tone: "bad", text: `${missingArt.length} uploaded image(s) aren't in this browser (they were added on another device or site data was cleared). Re-upload them in Design first.` }); return false; }
    if (blockers.length && !window.confirm(`This design still has ${blockers.length} blocker(s). Printful may reject or misprint it. Export anyway (for review only)?`)) return false;
    return true;
  };
  const proofHtml = async (): Promise<string> => {
    if (!design || !artUrls) return "";
    const svgs: Record<string, string> = {};
    for (const p of planned.plans) svgs[p.key] = (await standaloneSvg(<PrintFileSvg plan={p} urls={artUrls} uid="pf" />)).svg;
    return proofSheetHtml(design, svgs, { generatedAt: new Date().toLocaleString("en-US"), snapshotDate: PRINTFUL_SNAPSHOT_DATE, colorName, seller: SELLER });
  };

  const downloadZip = async () => {
    if (!guard() || !design) return;
    setMsg(null);
    try {
      const files = await renderAll();
      setBusy("Building the proof sheet...");
      const html = await proofHtml();
      const zip = zipStore([
        ...files.map((f) => ({ name: f.plan.filename, data: f.png })),
        { name: "README.txt", data: enc(exportReadme(design, planned.plans, PRINTFUL_SNAPSHOT_DATE)) },
        { name: "proof-sheet.html", data: enc(html) },
        { name: "design.json", data: enc(JSON.stringify(design, null, 2)) },
      ], new Date());
      downloadBytes(`${slug(design.name)}-print-files${blockers.length ? "-NOT-PRINT-READY" : ""}.zip`, zip, "application/zip");
      const warn = files.flatMap((f) => f.warnings);
      setMsg({ tone: warn.length ? "bad" : "ok", text: warn.length ? warn.join(" ") : `Downloaded ${files.length} print file(s) + README + proof sheet + design backup.` });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Export failed." });
    } finally { setBusy(null); }
  };
  const downloadOne = async (p: PrintFilePlan) => {
    if (!artUrls) return;
    setMsg(null);
    try {
      setBusy(`Rendering ${p.filename}...`);
      const f = await renderPlanPng(p, artUrls);
      setAlpha((a) => ({ ...a, [p.key]: f.alpha }));
      downloadBytes(p.filename, f.png, "image/png");
    } catch (e) { setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Render failed." }); } finally { setBusy(null); }
  };
  const openProof = async () => {
    if (!design || !artUrls) return;
    try {
      setBusy("Building the proof sheet...");
      const html = await proofHtml();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const w = window.open(url, "_blank", "noopener");
      if (!w) downloadBytes(`${slug(design.name)}-proof.html`, html, "text/html");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { setBusy(null); }
  };

  const makeMockups = async () => {
    if (!guard() || !design || !blank) return;
    setMsg(null); setMocks([]);
    try {
      const files = await renderAll();
      setBusy("Uploading print files to private storage...");
      const start = await startPrintFileUploadsAction({ designId: design.id, files: files.map((f) => ({ fileKey: f.plan.key })) });
      if (!start.ok) throw new Error(start.error);
      const keyFor: Record<string, string> = {};
      for (const u of start.uploads) {
        const f = files.find((x) => x.plan.key === u.fileKey)!;
        await putSignedMerchFile(supabaseUrl, supabaseAnonKey, start.bucket, u.key, u.token, f.png);
        keyFor[u.fileKey] = u.key;
      }
      const body = mockupTaskBody(blank, planned.plans, keyFor, pickedMockColors);
      if (!body) throw new Error("Pick at least one colour Printful makes for this garment.");
      setBusy("Asking Printful for mockups...");
      const task = await createMockupTaskAction({ blankId: blank.id, variantIds: body.variant_ids, files: body.files.map((f) => ({ placement: f.placement, key: f.image_url, position: f.position })), productOptions: body.product_options });
      if (!task.ok) throw new Error(task.error);
      for (let i = 0; i < 40; i += 1) {
        setBusy(`Printful is generating mockups... (${(i + 1) * 4}s)`);
        await new Promise((r) => window.setTimeout(r, 4000));
        const poll = await getMockupTaskAction(task.taskKey);
        if (!poll.ok) throw new Error(poll.error);
        if (poll.status === "failed") throw new Error(`Printful couldn't make mockups: ${poll.error ?? "unknown reason"}`);
        if (poll.status === "completed") { setMocks(poll.mockups); setMsg({ tone: "ok", text: `${poll.mockups.length} mockup(s) ready. Printful's mockup links are temporary - save the ones you want to keep.` }); return; }
      }
      throw new Error("Printful is still working after 160 seconds. Try again in a minute.");
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Mockups failed." });
    } finally { setBusy(null); }
  };

  if (!design || !blank) {
    return <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-4 text-sm text-white/70">No saved designs on this device yet. Make one in the Design tab - it autosaves - then come back here to proof and export it.</p>;
  }
  const item = printfulItemDraft(blank, planned.plans, Object.fromEntries(planned.plans.map((p) => [p.key, `https://<private-storage>/${p.filename}`])));
  const done = checklist.filter((c) => ticks[c.id]).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-white/70">Design
          <select className="ml-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-sm text-white" value={design.id} onChange={(e) => pick(e.target.value)}>
            {list.map((d) => <option key={d.id} value={d.id}>{d.name} - {getBlank(d.blankId)?.model}</option>)}
          </select>
        </label>
        <span className="flex items-center gap-1 text-xs text-white/60"><span className="inline-block h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: design.colorHex }} />{blank.brand} {blank.model} - {colorName}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${blockers.length ? "bg-[var(--admin-danger)]/25 text-red-200" : "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"}`}>{blockers.length ? `${blockers.length} blocker(s) - not print-ready` : "Print-ready"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-[var(--admin-accent)] text-black`} disabled={!!busy || !artUrls || !planned.plans.length} onClick={downloadZip}>Download print files (.zip)</button>
          <button type="button" className={`${btn} bg-white/10 text-white`} disabled={!!busy || !artUrls || !planned.plans.length} onClick={openProof}>Open proof sheet</button>
        </div>
      </div>
      {busy ? <p role="status" className="text-xs text-[var(--admin-gold)]">{busy}</p> : null}
      {msg ? <p role="status" className={`rounded-[var(--admin-radius-sm)] border p-2 text-xs ${msg.tone === "ok" ? "border-[var(--admin-accent)]/50 text-white/85" : "border-[var(--admin-danger)]/60 text-red-200"}`}>{msg.text}</p> : null}
      {missingArt.length ? <p className="text-xs text-red-200">{missingArt.length} uploaded image(s) for this design aren&apos;t stored in this browser. Re-upload them in Design before exporting.</p> : null}

      <section>
        <h3 className="mb-2 text-sm font-bold text-white">Print files ({planned.plans.length}) - exactly what Printful receives</h3>
        {planned.plans.length === 0 ? <p className="text-sm text-white/60">No artwork yet.</p> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {planned.plans.map((p, i) => {
            const r = rows[i]; const a = alpha[p.key];
            return (
              <figure key={p.key} className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex aspect-square items-center justify-center rounded p-2" style={{ background: "repeating-conic-gradient(#d4d4d4 0% 25%, #fff 0% 50%) 50% / 14px 14px" }} title="Transparent background (checkerboard)">
                    {artUrls ? <PrintFileSvg plan={p} urls={artUrls} uid={`a${i}`} className="h-full w-full" /> : null}
                  </div>
                  <div className="flex aspect-square items-center justify-center rounded p-2" style={{ background: design.colorHex }} title={`On ${colorName}`}>
                    {artUrls ? <PrintFileSvg plan={p} urls={artUrls} uid={`b${i}`} className="h-full w-full" /> : null}
                  </div>
                </div>
                <figcaption className="mt-2 space-y-0.5 text-xs text-white/75">
                  <p className="font-semibold text-white">{r?.placements} <span className="font-normal text-white/55">- {r?.method}</span></p>
                  <p>Art {r?.artIn} - {r?.px} px @ {p.dpi} DPI</p>
                  <p>{r?.fromTop}; {r?.fromCenter}</p>
                  <p className="text-white/50">Printful &quot;{p.fileType}&quot; area {p.area.widthIn}&quot; x {p.area.heightIn}&quot; - {p.filename}</p>
                  {r?.threads ? <p>Threads: {r.threads}</p> : null}
                  {a ? <p className={a.semiShare > SEMI_ALPHA_WARN && p.method !== "embroidery" ? "text-[var(--admin-gold)]" : "text-white/50"}>Rendered: {Math.round(a.semiShare * 100)}% of inked pixels semi-transparent{a.semiShare > SEMI_ALPHA_WARN && p.method !== "embroidery" ? " - gradients/shadows/feathered edges may print with gaps on DTG" : " (normal edge smoothing)"}</p> : null}
                  <button type="button" className="mt-1 rounded bg-white/10 px-2 py-0.5 text-white/85 hover:bg-white/20 disabled:opacity-40" disabled={!!busy || !artUrls} onClick={() => downloadOne(p)}>Download this PNG</button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold text-white">Checks</h3>
        <IssueList issues={allIssues} />
      </section>

      <section className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
        <h3 className="text-sm font-bold text-white">Photo mockups (Printful)</h3>
        <p className="mb-2 text-xs text-white/60">Uploads the print files to private storage and asks Printful&apos;s mockup generator for real product photos. Needs PRINTFUL_API_TOKEN and migration 0281. Up to {MOCKUP_MAX_COLORS} colours per run; Printful allows 2 runs a minute for a new store.</p>
        <div className="mb-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {colors.map(([n, hex]) => {
            const on = pickedMockColors.includes(n);
            return (
              <button key={n} type="button" aria-pressed={on} title={n} onClick={() => setMockColors((cur) => { const base = cur.length ? cur : pickedMockColors; return on ? base.filter((x) => x !== n) : base.length >= MOCKUP_MAX_COLORS ? base : [...base, n]; })}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] ${on ? "border-[var(--admin-accent)] text-white" : "border-white/15 text-white/60"}`}>
                <span className="inline-block h-3 w-3 rounded-full border border-white/30" style={{ background: hex }} />{n}
              </button>
            );
          })}
        </div>
        <button type="button" className={`${btn} bg-white/10 text-white`} disabled={!!busy || !artUrls || !planned.plans.length} onClick={makeMockups}>Generate mockups ({pickedMockColors.length} colour{pickedMockColors.length === 1 ? "" : "s"})</button>
        {mocks.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {mocks.flatMap((m) => [{ title: m.placement, url: m.url }, ...m.extra]).map((m, i) => (
              <a key={`${m.url}-${i}`} href={m.url} target="_blank" rel="noreferrer" className="block rounded border border-[var(--admin-border)] p-1 text-center text-[0.7rem] text-white/60">
                {/* eslint-disable-next-line @next/next/no-img-element -- temporary Printful CDN URL, not a site asset */}
                <img src={m.url} alt={`Printful mockup - ${m.title}`} className="w-full rounded" loading="lazy" />
                {m.title}
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
        <h3 className="text-sm font-bold text-white">Sample checklist <span className="font-normal text-white/55">({done}/{checklist.length})</span></h3>
        <p className="mb-2 text-xs text-white/60">Order one sample before you list it (Printful gives 20% off samples). Tick each item as you inspect the real garment - ticks are saved for this design on this device.</p>
        <ul className="space-y-1.5">
          {checklist.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-2 text-sm text-white/85">
                <input type="checkbox" className="mt-1" checked={!!ticks[c.id]} onChange={(e) => tick(c.id, e.target.checked)} />
                <span>{c.label}<br /><span className="text-xs text-white/50">{c.why}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <button type="button" className="text-xs text-white/60 underline" onClick={() => setShowJson((v) => !v)} aria-expanded={showJson}>{showJson ? "Hide" : "Show"} the Printful order item this design becomes (for Slice 4)</button>
        {showJson ? <pre className="mt-2 max-h-80 overflow-auto rounded bg-black/40 p-2 text-[0.7rem] text-white/80">{JSON.stringify({ variant_id: "<chosen colour + size>", quantity: 1, ...item }, null, 2)}</pre> : null}
      </section>
    </div>
  );
}
