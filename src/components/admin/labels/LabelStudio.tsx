"use client";

/**
 * D177 S4 — Label Studio.
 *
 * Owner: "I want a much fancier, far more professional label builder
 * experience. I need to be able to select from the various size labels, not
 * just rollo but any vendors sizes. I need to be able to switch between 1D and
 * 2D barcodes (qr codes) and the info I want on the label."
 *
 * One component serves a single lot, a single other-inventory item, or a
 * whole receiving manifest. All decisions (fit, sizing, scan readiness, job
 * limits) come from the pure cores — label-stock-core, label-barcode-core,
 * label-layout-core, label-studio-core — so what is previewed is exactly what
 * prints: the same SVG is used for both.
 *
 * Printing: the Rollo has no cloud API (docs/rollo-label-printing.md), so the
 * studio renders one page per label at the exact stock size into a portal on
 * <body>, injects matching @page CSS, and opens the browser print dialog.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Badge, type BadgeTone } from "@/components/admin/ui";
import { ConfirmDialog, useToast } from "@/components/admin/ux";
import {
  CUSTOM_MAX_IN,
  CUSTOM_MIN_IN,
  LABEL_STOCK,
  VENDOR_LABEL,
  checkStockFit,
  customStock,
  printerById,
  stockById,
  stockSizeText,
  type FitMessage,
  type FitSeverity,
  type LabelStock,
  type StockVendor,
} from "@/lib/printing/label-stock-core";
import { SYMBOLOGY_LABEL, availableSymbologies, type Symbology } from "@/lib/printing/label-barcode-core";
import {
  CODE_SOURCE_LABEL,
  CUSTOM_TEXT_MAX,
  defaultFields,
  defaultTemplate,
  fieldDef,
  fieldsFor,
  layoutLabel,
  layoutToSvg,
  type BarcodePlacement,
  type Density,
  type FieldId,
  type LabelSubject,
  type LabelTemplate,
  type SubjectKind,
} from "@/lib/printing/label-layout-core";
import {
  CUSTOM_RANGE_TEXT,
  MAX_COPIES_PER_ITEM,
  PRINTERS,
  PRINT_ROOT_CLASS,
  barcodeSpecText,
  clampCopies,
  parseInches,
  planPrintJob,
  prefsStorageKey,
  printCss,
  sanitizePrefs,
  svgAtSize,
  templateForSubject,
  type JobPlan,
  type StudioPrefs,
} from "@/lib/printing/label-studio-core";
import type { QrEcLevel } from "@/lib/printing/qr-core";

export type StudioItem = {
  subject: LabelSubject;
  /** Starting copies (1 for a reprint; e.g. received units for a manifest). */
  copies: number;
  /** Optional suggested copy count, e.g. units received. */
  suggestedCopies?: number | null;
};

export type PrintLogEntry = {
  kind: SubjectKind;
  printerId: string;
  stockId: string;
  template: LabelTemplate;
  items: Array<{ subjectId: string; copies: number; codeSource: string | null; codeValue: string | null }>;
  totalLabels: number;
};

export type LabelStudioProps = {
  kind: SubjectKind;
  items: StudioItem[];
  /** Heading context, e.g. "Manifest 2026-04-30 · Grow Op Farms". */
  contextLine?: string;
  /** Words for the "suggested copies" button (default "One per unit received"). */
  suggestLabel?: string;
  /** Optional server action that records the print (S6 audit log). */
  logPrint?: (entry: PrintLogEntry) => Promise<{ ok: boolean; error?: string }>;
};

// ── Small UI atoms ──────────────────────────────────────────────────────────

const SEV_TONE: Record<FitSeverity, BadgeTone> = { ok: "green", warn: "gold", block: "danger" };
const SEV_ICON: Record<FitSeverity, string> = { ok: "✓", warn: "!", block: "✕" };

function Panel({ title, step, children, aside }: { title: string; step: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--admin-text)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-[0.65rem] font-black text-[var(--admin-accent)]">
            {step}
          </span>
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[var(--admin-radius-md)] bg-[var(--admin-surface-2)] p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`admin-focus rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              on ? "bg-[var(--admin-accent)] text-black shadow" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Messages({ messages, hideOk = false }: { messages: FitMessage[]; hideOk?: boolean }) {
  const shown = messages.filter((m) => !hideOk || m.severity !== "ok");
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {shown.map((m, i) => (
        <li
          key={`${m.code}-${i}`}
          className={`flex gap-2 rounded-[var(--admin-radius-sm)] px-2.5 py-1.5 text-xs ${
            m.severity === "block"
              ? "bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
              : m.severity === "warn"
                ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"
          }`}
        >
          <span aria-hidden className="font-black">{SEV_ICON[m.severity]}</span>
          <span>{m.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tiny to-scale silhouette of a stock for the picker cards. */
function StockShape({ stock }: { stock: LabelStock }) {
  const max = 34;
  const k = max / Math.max(stock.acrossIn, stock.feedIn);
  const w = Math.max(6, stock.acrossIn * k);
  const h = Math.max(4, stock.feedIn * k);
  return (
    <span className="flex h-[36px] w-[36px] items-center justify-center" aria-hidden>
      <span
        className="block border border-[var(--admin-text-faint)] bg-white/90"
        style={{ width: w, height: h, borderRadius: stock.shape === "circle" ? "50%" : 3 }}
      />
    </span>
  );
}

// ── Preferences (per device) ───────────────────────────────────────────────

function readPrefs(kind: SubjectKind): unknown {
  try {
    const raw = window.localStorage.getItem(prefsStorageKey(kind));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePrefs(kind: SubjectKind, prefs: StudioPrefs) {
  try {
    window.localStorage.setItem(prefsStorageKey(kind), JSON.stringify(prefs));
  } catch {
    // Private mode / quota: settings just won't be remembered.
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const VENDOR_TABS: Array<StockVendor | "all"> = ["all", "rollo", "onlinelabels", "zebra", "dymo", "custom"];
const PLACEMENTS: Array<{ value: BarcodePlacement; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "bottom", label: "Below" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "none", label: "No code" },
];
const DENSITIES: Array<{ value: Density; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "regular", label: "Regular" },
  { value: "large", label: "Large" },
];
const QR_LEVELS: Array<{ value: QrEcLevel; label: string; title: string }> = [
  { value: "L", label: "L", title: "Smallest code, ~7% damage recovery" },
  { value: "M", label: "M", title: "Recommended, ~15% damage recovery" },
  { value: "Q", label: "Q", title: "~25% damage recovery" },
  { value: "H", label: "H", title: "Largest code, ~30% damage recovery" },
];

export function LabelStudio({ kind, items: initialItems, contextLine, suggestLabel = "One per unit received", logPrint }: LabelStudioProps) {
  const { toast } = useToast();
  const first = initialItems[0]?.subject ?? null;
  const batch = initialItems.length > 1;

  // Settings (printer / stock / template), restored per device after mount.
  const [prefs, setPrefs] = useState<StudioPrefs | null>(() => (first ? sanitizePrefs(null, first) : null));
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!first) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of localStorage after hydration (not available on the server)
    setPrefs(sanitizePrefs(readPrefs(kind), first));
    setRestored(true);
    // first.id is stable for the life of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => {
    if (restored && prefs) writePrefs(kind, prefs);
  }, [kind, prefs, restored]);

  const [copies, setCopies] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialItems.map((it) => [it.subject.id, clampCopies(it.copies)])),
  );
  const [previewId, setPreviewId] = useState<string | null>(first?.id ?? null);
  const [vendorTab, setVendorTab] = useState<StockVendor | "all">("all");
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [customCircle, setCustomCircle] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printing, setPrinting] = useState<JobPlan | null>(null);

  const printer = printerById(prefs?.printerId);
  const stock = stockById(prefs?.stockId) ?? LABEL_STOCK[0];
  const template = prefs?.template ?? null;

  const update = useCallback((patch: Partial<StudioPrefs>) => setPrefs((p) => (p ? { ...p, ...patch } : p)), []);
  /** A new size gets that size's recommended lines (barcode choices are kept). */
  const chooseStock = useCallback(
    (s: LabelStock) => setPrefs((p) => (p ? { ...p, stockId: s.id, template: { ...p.template, fields: defaultFields(kind, s) } } : p)),
    [kind],
  );
  const updateT = useCallback((patch: Partial<LabelTemplate>) => setPrefs((p) => (p ? { ...p, template: { ...p.template, ...patch } } : p)), []);

  const previewSubject = initialItems.find((it) => it.subject.id === previewId)?.subject ?? first;

  const layout = useMemo(() => {
    if (!previewSubject || !template) return null;
    return layoutLabel({ subject: previewSubject, stock, dpi: printer.dpi, template: templateForSubject(previewSubject, template) });
  }, [previewSubject, stock, printer.dpi, template]);
  const previewSvg = useMemo(() => (layout ? layoutToSvg(layout, { outline: true }) : ""), [layout]);

  const plan = useMemo(() => {
    if (!template) return null;
    return planPrintJob(
      initialItems.map((it) => ({ subject: it.subject, copies: copies[it.subject.id] ?? 0 })),
      stock,
      printer,
      template,
    );
  }, [initialItems, copies, stock, printer, template]);

  const stockFit = useMemo(() => checkStockFit(stock, printer), [stock, printer]);
  const pickerStock = useMemo(() => {
    const rankSev: Record<FitSeverity, number> = { ok: 0, warn: 1, block: 2 };
    return LABEL_STOCK.filter((s) => vendorTab === "all" || s.vendor === vendorTab)
      .map((s) => ({ stock: s, fit: checkStockFit(s, printer) }))
      .sort((a, b) => rankSev[a.fit.severity] - rankSev[b.fit.severity] || a.stock.acrossIn * a.stock.feedIn - b.stock.acrossIn * b.stock.feedIn);
  }, [vendorTab, printer]);

  // Print lifecycle: mount the portal, print once it's painted, unmount after.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener("afterprint", done);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  if (!first || !prefs || !template || !layout || !plan) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
        Nothing to label here.
      </div>
    );
  }

  const codeOptions = previewSubject?.codes ?? [];
  const activeCode = codeOptions.find((c) => c.source === templateForSubject(previewSubject!, template).codeSource) ?? null;
  const syms = activeCode ? availableSymbologies(activeCode.value) : [];
  const symOptions = (["code128", "qr", "upc_ean"] as Symbology[]).map((s) => ({
    value: s,
    label: s === "code128" ? "1D barcode" : s === "qr" ? "2D QR code" : "Retail UPC",
    disabled: !syms.includes(s) && !(s === template.symbology),
    title: !syms.includes(s) ? (s === "upc_ean" ? "Only for a real 8-, 12- or 13-digit UPC/EAN (check digit verified)." : "This value can't be encoded this way.") : SYMBOLOGY_LABEL[s],
  }));

  const allFields = fieldsFor(kind);
  const ordered: FieldId[] = [...template.fields.filter((f) => allFields.some((d) => d.id === f)), ...allFields.map((d) => d.id).filter((id) => !template.fields.includes(id))];
  const toggleField = (id: FieldId) =>
    updateT({ fields: template.fields.includes(id) ? template.fields.filter((f) => f !== id) : [...template.fields, id] });
  const moveField = (id: FieldId, dir: -1 | 1) => {
    const arr = [...template.fields];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    updateT({ fields: arr });
  };

  const applyCustom = () => {
    const w = parseInches(customW);
    const h = customCircle ? w : parseInches(customH);
    const r = customStock(w, h, customCircle ? "circle" : "rect");
    if (!r.ok) {
      setCustomError(r.error);
      return;
    }
    setCustomError(null);
    chooseStock(r.stock);
  };

  const resetRecommended = () => {
    setPrefs((p) => (p ? { ...p, template: defaultTemplate(first, stock) } : p));
    toast({ tone: "info", message: "Reset to the recommended layout for this size." });
  };

  const startPrint = () => {
    if (plan.severity === "block") return;
    if (plan.needsConfirm && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    setPrinting(plan);
    if (logPrint) {
      const entry: PrintLogEntry = {
        kind,
        printerId: printer.id,
        stockId: stock.id,
        template,
        totalLabels: plan.totalLabels,
        items: plan.items.map((p) => ({ subjectId: p.subjectId, copies: p.copies, codeSource: p.layout.code?.source ?? null, codeValue: p.layout.code?.value ?? null })),
      };
      void logPrint(entry).then((r) => {
        if (!r.ok) toast({ tone: "warning", message: `Printed, but the print history couldn't be saved${r.error ? `: ${r.error}` : "."}` });
      });
    }
  };

  const severity = plan.severity === "block" ? "block" : layout.severity === "block" ? "block" : plan.severity === "warn" || layout.severity === "warn" ? "warn" : "ok";
  const previewMaxPx = 420;
  const fitScale = Math.min(1, previewMaxPx / (stock.acrossIn * 96), 520 / (stock.feedIn * 96));
  const previewW = zoom === "actual" ? `${stock.acrossIn}in` : `${Math.round(stock.acrossIn * 96 * fitScale)}px`;
  const previewH = zoom === "actual" ? `${stock.feedIn}in` : `${Math.round(stock.feedIn * 96 * fitScale)}px`;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {kind === "lot" ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
              <strong className="font-bold">Put the sticker beside the producer&apos;s label, never over it.</strong> The producer&apos;s
              lot number, weight, THC/CBD and warnings must stay visible (WAC 314-55-105). This label only adds a barcode the register can scan.
            </div>
          ) : null}

          <Panel
            step={1}
            title="Printer & label size"
            aside={<Badge tone={SEV_TONE[stockFit.severity]}>{stockSizeText(stock)}</Badge>}
          >
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold text-[var(--admin-text-muted)]" htmlFor="ls-printer">
                Printer
              </label>
              <select
                id="ls-printer"
                value={printer.id}
                onChange={(e) => update({ printerId: e.target.value })}
                className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
              >
                {PRINTERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.dpi} dpi
                  </option>
                ))}
              </select>
              {printer.minAcrossIn != null ? (
                <span className="text-xs text-[var(--admin-text-faint)]">
                  Takes labels {printer.minAcrossIn}″–{printer.maxAcrossIn}″ wide · direct thermal
                </span>
              ) : null}
            </div>

            <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Label vendor">
              {VENDOR_TABS.map((v) => (
                <button
                  key={v}
                  role="tab"
                  type="button"
                  aria-selected={vendorTab === v}
                  onClick={() => setVendorTab(v)}
                  className={`admin-focus rounded-full px-3 py-1 text-xs font-semibold ${
                    vendorTab === v ? "bg-[var(--admin-text)] text-[var(--admin-bg,#000)]" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                  }`}
                >
                  {v === "all" ? "All vendors" : VENDOR_LABEL[v]}
                </button>
              ))}
            </div>

            {vendorTab === "custom" ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--admin-text-faint)]">
                  Measure one label on the roll (not the backing). Width is across the roll. Inches, {CUSTOM_RANGE_TEXT}; fractions like 2 1/4 work.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                    Width
                    <input
                      inputMode="decimal"
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      placeholder="2.25"
                      className="admin-focus w-24 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
                    />
                  </label>
                  {!customCircle ? (
                    <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                      Height
                      <input
                        inputMode="decimal"
                        value={customH}
                        onChange={(e) => setCustomH(e.target.value)}
                        placeholder="1.25"
                        className="admin-focus w-24 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
                      />
                    </label>
                  ) : null}
                  <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--admin-text-muted)]">
                    <input type="checkbox" checked={customCircle} onChange={(e) => setCustomCircle(e.target.checked)} />
                    Round label
                  </label>
                  <Button size="sm" variant="save" onClick={applyCustom}>
                    Use this size
                  </Button>
                </div>
                {customError ? <p className="text-xs text-[var(--admin-danger)]">{customError}</p> : null}
                <p className="text-[0.7rem] text-[var(--admin-text-faint)]">
                  Limits: {CUSTOM_MIN_IN}″ to {CUSTOM_MAX_IN}″ each way.
                </p>
              </div>
            ) : (
              <div className="grid max-h-[300px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                {pickerStock.map(({ stock: s, fit }) => {
                  const on = s.id === stock.id;
                  const blocked = fit.severity === "block";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={blocked}
                      onClick={() => chooseStock(s)}
                      title={fit.messages.map((m) => m.text).join("\n") || s.note || ""}
                      aria-pressed={on}
                      className={`admin-focus flex items-center gap-2 rounded-[var(--admin-radius-md)] border px-2.5 py-2 text-left transition ${
                        on
                          ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]"
                          : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] hover:border-[var(--admin-text-faint)]"
                      } ${blocked ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      <StockShape stock={s} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-[var(--admin-text)]">{stockSizeText(s)}</span>
                        <span className="block truncate text-[0.7rem] text-[var(--admin-text-faint)]">
                          {VENDOR_LABEL[s.vendor]} {s.partNumber !== "—" ? s.partNumber : ""} · {s.name}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 text-[0.65rem] font-black ${
                          fit.severity === "ok" ? "text-[var(--admin-accent)]" : fit.severity === "warn" ? "text-[var(--admin-gold)]" : "text-[var(--admin-danger)]"
                        }`}
                        aria-label={fit.severity === "ok" ? "Fits" : fit.severity === "warn" ? "Fits with a note" : "Won't fit this printer"}
                      >
                        {SEV_ICON[fit.severity]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {stockFit.messages.length > 0 ? (
              <div className="mt-3">
                <Messages messages={stockFit.messages} />
              </div>
            ) : null}
            {stock.sourceUrl ? (
              <p className="mt-2 text-[0.7rem] text-[var(--admin-text-faint)]">
                Size verified at{" "}
                <a href={stock.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-[var(--admin-accent)]">
                  {new URL(stock.sourceUrl).hostname.replace(/^www\./, "")}
                </a>
                {stock.labelsPerRoll ? ` · ${stock.labelsPerRoll.toLocaleString("en-US")} per roll` : ""}
                {stock.note ? ` · ${stock.note}` : ""}
              </p>
            ) : null}
          </Panel>

          <Panel step={2} title="Barcode">
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-[var(--admin-text-muted)]">Type</p>
                <Segmented label="Barcode type" value={template.symbology} options={symOptions} onChange={(v) => updateT({ symbology: v })} />
                <p className="mt-1.5 text-[0.7rem] text-[var(--admin-text-faint)]">
                  {template.symbology === "code128"
                    ? "Classic 1D bars — every register scanner reads it. Needs width; long codes need a wider label."
                    : template.symbology === "qr"
                      ? "Square 2D code — fits long codes on small labels and survives some damage. Needs a 2D (imager) scanner."
                      : "Re-print the manufacturer's own UPC/EAN exactly, for a torn or smudged retail barcode."}
                </p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-[var(--admin-text-muted)]">What the code contains</p>
                <div className="space-y-1.5" role="radiogroup" aria-label="Barcode value">
                  {codeOptions.map((c) => {
                    const on = activeCode?.source === c.source;
                    return (
                      <label
                        key={c.source}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-[var(--admin-radius-md)] border px-3 py-2 ${
                          on ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]" : "border-[var(--admin-border)] bg-[var(--admin-surface-2)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="ls-code"
                          className="mt-0.5"
                          checked={on}
                          onChange={() => {
                            const next = availableSymbologies(c.value);
                            updateT({ codeSource: c.source, symbology: next.includes(template.symbology) ? template.symbology : "code128" });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--admin-text)]">{CODE_SOURCE_LABEL[c.source]}</span>
                            <Badge tone={SEV_TONE[c.readiness.severity]}>
                              {c.readiness.severity === "ok" ? "Scans at register" : c.readiness.severity === "warn" ? "Check" : "Won't scan"}
                            </Badge>
                          </span>
                          <span className="block break-all font-mono text-xs text-[var(--admin-text-muted)]">{c.value}</span>
                          <span className="block text-[0.7rem] text-[var(--admin-text-faint)]">{c.readiness.text}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {batch ? (
                  <p className="mt-1.5 text-[0.7rem] text-[var(--admin-text-faint)]">
                    Applies to every item. Items without this value use their own best code.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-[var(--admin-text-muted)]">Position</p>
                  <Segmented label="Barcode position" value={template.placement} options={PLACEMENTS} onChange={(v) => updateT({ placement: v })} />
                </div>
                {template.symbology === "qr" ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-[var(--admin-text-muted)]">Damage recovery</p>
                    <Segmented label="QR error correction" value={template.qrLevel} options={QR_LEVELS} onChange={(v) => updateT({ qrLevel: v })} />
                  </div>
                ) : (
                  <label className="flex items-center gap-2 self-end pb-2 text-xs text-[var(--admin-text-muted)]">
                    <input type="checkbox" checked={template.showCodeText} onChange={(e) => updateT({ showCodeText: e.target.checked })} />
                    Print the digits under the bars
                  </label>
                )}
              </div>
            </div>
          </Panel>

          <Panel
            step={3}
            title="What's on the label"
            aside={
              <button type="button" onClick={resetRecommended} className="text-xs font-semibold text-[var(--admin-accent)] underline hover:brightness-110">
                Recommended for this size
              </button>
            }
          >
            <p className="mb-2 text-[0.7rem] text-[var(--admin-text-faint)]">
              Top to bottom. If it doesn&apos;t all fit, text shrinks first, then the lowest lines are left off — the barcode is never dropped.
              Potency is never printed here; it stays on the producer&apos;s label.
            </p>
            <ul className="divide-y divide-[var(--admin-border)] rounded-[var(--admin-radius-md)] border border-[var(--admin-border)]">
              {ordered.map((id) => {
                const def = fieldDef(id);
                const on = template.fields.includes(id);
                const idx = template.fields.indexOf(id);
                const value = id === "custom" ? template.customText : (previewSubject?.values[id] ?? "");
                const dropped = on && layout.messages.some((m) => m.code === "dropped" && m.text.includes(def.label));
                return (
                  <li key={id} className={`flex items-center gap-2 px-3 py-2 ${on ? "" : "opacity-70"}`}>
                    <input id={`ls-f-${id}`} type="checkbox" checked={on} onChange={() => toggleField(id)} />
                    <label htmlFor={`ls-f-${id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                        {def.label}
                        {dropped ? <Badge tone="gold">left off</Badge> : null}
                      </span>
                      <span className="block truncate text-[0.7rem] text-[var(--admin-text-faint)]">
                        {id === "custom" ? def.help : value ? (batch ? `${value} (varies by item)` : value) : "Blank for this item"}
                      </span>
                    </label>
                    {on ? (
                      <span className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          aria-label={`Move ${def.label} up`}
                          disabled={idx <= 0}
                          onClick={() => moveField(id, -1)}
                          className="admin-focus rounded px-1.5 text-xs text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-2)] disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${def.label} down`}
                          disabled={idx < 0 || idx >= template.fields.length - 1}
                          onClick={() => moveField(id, 1)}
                          className="admin-focus rounded px-1.5 text-xs text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-2)] disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {template.fields.includes("custom") ? (
              <label className="mt-3 flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                Custom note ({template.customText.length}/{CUSTOM_TEXT_MAX})
                <input
                  value={template.customText}
                  maxLength={CUSTOM_TEXT_MAX}
                  onChange={(e) => updateT({ customText: e.target.value })}
                  placeholder="e.g. Display only · Do not sell"
                  className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
                />
              </label>
            ) : null}
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-[var(--admin-text-muted)]">Text size</p>
              <Segmented label="Text size" value={template.density} options={DENSITIES} onChange={(v) => updateT({ density: v })} />
            </div>
          </Panel>

          <Panel step={4} title={batch ? `Copies · ${initialItems.length} items` : "Copies"}>
            {batch ? (
              <>
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className="rounded-full bg-[var(--admin-surface-2)] px-3 py-1 font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                    onClick={() => setCopies(Object.fromEntries(initialItems.map((it) => [it.subject.id, 1])))}
                  >
                    1 of each
                  </button>
                  {initialItems.some((it) => (it.suggestedCopies ?? 0) > 0) ? (
                    <button
                      type="button"
                      className="rounded-full bg-[var(--admin-surface-2)] px-3 py-1 font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                      onClick={() => setCopies(Object.fromEntries(initialItems.map((it) => [it.subject.id, clampCopies(it.suggestedCopies ?? 1)])))}
                    >
                      {suggestLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-full bg-[var(--admin-surface-2)] px-3 py-1 font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                    onClick={() => setCopies(Object.fromEntries(initialItems.map((it) => [it.subject.id, 0])))}
                  >
                    None
                  </button>
                </div>
                <ul className="max-h-[360px] divide-y divide-[var(--admin-border)] overflow-y-auto rounded-[var(--admin-radius-md)] border border-[var(--admin-border)]">
                  {initialItems.map((it) => {
                    const pl = plan.items.find((p) => p.subjectId === it.subject.id);
                    const ref = plan.refused.find((r) => r.subjectId === it.subject.id);
                    const sev: FitSeverity = ref ? "block" : pl ? pl.layout.severity : "ok";
                    const sel = previewSubject?.id === it.subject.id;
                    return (
                      <li key={it.subject.id} className={`flex items-center gap-3 px-3 py-2 ${sel ? "bg-[var(--admin-accent-soft)]" : ""}`}>
                        <button type="button" onClick={() => setPreviewId(it.subject.id)} className="min-w-0 flex-1 text-left" title="Preview this item">
                          <span className="flex items-center gap-2">
                            <span className={`text-[0.65rem] font-black ${sev === "ok" ? "text-[var(--admin-accent)]" : sev === "warn" ? "text-[var(--admin-gold)]" : "text-[var(--admin-danger)]"}`}>
                              {SEV_ICON[sev]}
                            </span>
                            <span className="truncate text-sm text-[var(--admin-text)]">{it.subject.title}</span>
                          </span>
                          {ref ? (
                            <span className="block text-[0.7rem] text-[var(--admin-danger)]">{ref.reason}</span>
                          ) : pl?.layout.code && pl.layout.code.readiness.severity !== "ok" ? (
                            <span className="block text-[0.7rem] text-[var(--admin-gold)]">{pl.layout.code.readiness.text}</span>
                          ) : null}
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={MAX_COPIES_PER_ITEM}
                          aria-label={`Copies of ${it.subject.title}`}
                          value={copies[it.subject.id] ?? 0}
                          onChange={(e) => setCopies((c) => ({ ...c, [it.subject.id]: clampCopies(e.target.value) }))}
                          className="admin-focus w-20 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-right text-sm text-[var(--admin-text)]"
                        />
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="One fewer"
                  onClick={() => setCopies((c) => ({ ...c, [first.id]: clampCopies((c[first.id] ?? 1) - 1) }))}
                  className="admin-focus h-9 w-9 rounded-full bg-[var(--admin-surface-2)] text-lg font-bold text-[var(--admin-text)]"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={MAX_COPIES_PER_ITEM}
                  aria-label="Copies"
                  value={copies[first.id] ?? 1}
                  onChange={(e) => setCopies({ [first.id]: clampCopies(e.target.value) })}
                  className="admin-focus w-20 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-center text-lg font-bold text-[var(--admin-text)]"
                />
                <button
                  type="button"
                  aria-label="One more"
                  onClick={() => setCopies((c) => ({ ...c, [first.id]: clampCopies((c[first.id] ?? 1) + 1) }))}
                  className="admin-focus h-9 w-9 rounded-full bg-[var(--admin-surface-2)] text-lg font-bold text-[var(--admin-text)]"
                >
                  +
                </button>
                {initialItems[0].suggestedCopies ? (
                  <button
                    type="button"
                    onClick={() => setCopies({ [first.id]: clampCopies(initialItems[0].suggestedCopies) })}
                    className="ml-2 text-xs font-semibold text-[var(--admin-accent)] underline"
                  >
                    One per unit ({initialItems[0].suggestedCopies})
                  </button>
                ) : null}
              </div>
            )}
          </Panel>
        </div>

        {/* ── Preview + print ─────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[var(--admin-text)]">Preview</h2>
                <p className="truncate text-[0.7rem] text-[var(--admin-text-faint)]">
                  {contextLine ? `${contextLine} · ` : ""}
                  {previewSubject?.title}
                </p>
              </div>
              <Segmented
                label="Preview size"
                value={zoom}
                options={[
                  { value: "fit", label: "Fit" },
                  { value: "actual", label: "Actual size" },
                ]}
                onChange={setZoom}
              />
            </div>

            <div
              className="flex min-h-[220px] items-center justify-center overflow-auto rounded-[var(--admin-radius-md)] p-5"
              style={{ backgroundColor: "#d4d4d8", backgroundImage: "radial-gradient(#a1a1aa 1px, transparent 1px)", backgroundSize: "14px 14px" }}
            >
              <div
                className="shrink-0 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.25)]"
                style={{ width: previewW, height: previewH, borderRadius: stock.shape === "circle" ? "50%" : 6 }}
                dangerouslySetInnerHTML={{ __html: svgAtSize(previewSvg, "100%", "100%") }}
              />
            </div>
            <p className="mt-2 text-center text-[0.7rem] text-[var(--admin-text-faint)]">
              {stockSizeText(stock)} · {printer.dpi} dpi · {barcodeSpecText(layout)}
              {zoom === "actual" ? " · on-screen size is approximate" : ""}
            </p>

            <div className="mt-3 space-y-2">
              <Messages messages={[...layout.messages.filter((m) => m.code !== "scan_readiness" || !batch), ...plan.messages.filter((m) => !stockFit.messages.some((s) => s.code === m.code))]} hideOk={false} />
            </div>

            <div className="mt-4 rounded-[var(--admin-radius-md)] bg-[var(--admin-surface-2)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-[var(--admin-text)]">
                    {plan.totalLabels.toLocaleString("en-US")} label{plan.totalLabels === 1 ? "" : "s"}
                  </p>
                  <p className="text-[0.7rem] text-[var(--admin-text-faint)]">
                    {plan.items.length} item{plan.items.length === 1 ? "" : "s"}
                    {plan.refused.length ? ` · ${plan.refused.length} skipped` : ""}
                  </p>
                </div>
                <Button variant="primary" size="md" disabled={severity === "block" || plan.totalLabels === 0} onClick={startPrint}>
                  🖨 Print
                </Button>
              </div>
              <details className="mt-2 text-[0.7rem] text-[var(--admin-text-muted)]">
                <summary className="cursor-pointer font-semibold">In the print dialog…</summary>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                  <li>Choose <strong>{printer.name}</strong>.</li>
                  <li>Paper size <strong>{stock.acrossIn}″ × {stock.feedIn}″</strong> (add it as a custom size once if it&apos;s not listed).</li>
                  <li>Margins <strong>None</strong>, scale <strong>100%</strong> — never “Fit to page”.</li>
                  <li>Turn off headers and footers.</li>
                </ol>
                {printer.note ? <p className="mt-1.5 text-[var(--admin-text-faint)]">{printer.note}</p> : null}
              </details>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Print ${plan.totalLabels.toLocaleString("en-US")} labels?`}
        description={`That's a lot of labels on ${stockSizeText(stock)} stock. Make sure there's enough on the roll before you start.`}
        confirmLabel="Print them"
        tone="warning"
        onConfirm={() => startPrint()}
        onCancel={() => setConfirmOpen(false)}
      />

      {printing && typeof document !== "undefined"
        ? createPortal(
            <div className={PRINT_ROOT_CLASS} aria-hidden>
              <style>{printCss(stock)}</style>
              {printing.items.flatMap((p) =>
                Array.from({ length: p.copies }, (_, i) => (
                  <div key={`${p.subjectId}-${i}`} className="gw-label-page" dangerouslySetInnerHTML={{ __html: p.svg }} />
                )),
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
