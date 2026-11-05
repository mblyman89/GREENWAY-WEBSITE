/**
 * D177 S6 — saved store label designs + the print history (pure).
 *
 * Owner: "enterprise grade, easy to use." Two things make a label tool feel
 * enterprise-grade at a counter:
 *   1. The store's designs are SAVED once and picked by name ("Glass 2.25×1.25
 *      price tag", "Re-barcode 2×1 QR") on every device, with one default per
 *      kind — not rebuilt by hand on each iPad / PC.
 *   2. Every print is RECORDED: who printed which labels, for which items, with
 *      what code, on what stock. When a re-barcoded jar won't ring up, the
 *      history says exactly what was printed for it.
 *
 * This core validates everything that crosses into the database (migration
 * 0342_label_studio.sql) and everything read back out of it. Rows coming back
 * are untrusted: a template is re-sanitised with sanitizeTemplate, a stock the
 * printer can't feed is replaced — never trusted to render.
 */
import { checkStockFit, printerById, stockById } from "@/lib/printing/label-stock-core";
import {
  defaultTemplate,
  sanitizeTemplate,
  type LabelSubject,
  type LabelTemplate,
  type SubjectKind,
} from "@/lib/printing/label-layout-core";
import { defaultStockId, MAX_COPIES_PER_ITEM, MAX_LABELS_PER_JOB } from "@/lib/printing/label-studio-core";

const SAMPLE_LOT: LabelSubject = {
  kind: "lot",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Blue Dream 3.5g — Lot 6034772160010001",
  values: { product: "Blue Dream 3.5g", lot_code: "6034772160010001" },
  codes: [{ source: "lot_code", value: "6034772160010001", readiness: { severity: "ok", text: "Rings up" } }],
  defaultCode: "lot_code",
};
const SAMPLE_NC: LabelSubject = {
  kind: "nc",
  id: "22222222-2222-4222-8222-222222222222",
  title: "Glass Bong — BONG-0001",
  values: { product: "Glass Bong", price: "$49.99", sku: "BONG-0001" },
  codes: [{ source: "sku", value: "BONG-0001", readiness: { severity: "ok", text: "Rings up" } }],
  defaultCode: "sku",
};

// ── Limits (mirrored by CHECK constraints in 0342) ──────────────────────────

export const TEMPLATE_NAME_MAX = 60;
export const MAX_TEMPLATES_PER_KIND = 50;
export const PRINT_LOG_MAX_ITEMS = 1000;
export const CODE_VALUE_MAX = 120;
export const CONTEXT_MAX = 200;
export const HISTORY_LIMIT = 10;

export const KIND_LABEL: Record<SubjectKind, string> = { lot: "Cannabis lots", nc: "Other inventory" };

const KINDS: readonly SubjectKind[] = ["lot", "nc"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_TOKEN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isKind(v: unknown): v is SubjectKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Collapse whitespace and strip control characters. */
function clean(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// ── Template names ──────────────────────────────────────────────────────────

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * A design name staff will pick from a list. Required, ≤ 60 characters, and
 * not the same (case-insensitive) as another live design of the same kind.
 */
export function checkTemplateName(raw: unknown, existing: readonly { id: string; name: string }[], selfId: string | null = null): NameCheck {
  const name = clean(raw, TEMPLATE_NAME_MAX + 1);
  if (!name) return { ok: false, error: "Give the design a name, e.g. “Glass price tag 2.25×1.25”." };
  if (name.length > TEMPLATE_NAME_MAX) return { ok: false, error: `Keep the name to ${TEMPLATE_NAME_MAX} characters or fewer.` };
  const lower = name.toLowerCase();
  if (existing.some((t) => t.id !== selfId && t.name.trim().toLowerCase() === lower)) {
    return { ok: false, error: `There is already a design called “${name}”. Pick another name, or update that one.` };
  }
  return { ok: true, name };
}

// ── Saved designs ───────────────────────────────────────────────────────────

export type SavedTemplate = {
  id: string;
  kind: SubjectKind;
  name: string;
  printerId: string;
  stockId: string;
  template: LabelTemplate;
  isDefault: boolean;
  updatedAt: string | null;
};

/**
 * Read a label_templates row back. Untrusted: an unknown kind or id drops the
 * row (null); an unknown printer becomes the Rollo; a stock id that no longer
 * parses becomes the kind default; the template is re-sanitised against the
 * kind default so a stale field list can never crash the renderer.
 */
export function savedTemplateFromRow(row: Record<string, unknown>, sample: LabelSubject): SavedTemplate | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!UUID_RE.test(id) || !isKind(row.kind) || row.kind !== sample.kind) return null;
  const name = clean(row.name, TEMPLATE_NAME_MAX);
  if (!name) return null;
  const printer = printerById(typeof row.printer_id === "string" ? row.printer_id : null);
  const stock = stockById(typeof row.stock_id === "string" ? row.stock_id : null) ?? stockById(defaultStockId(row.kind))!;
  const template = sanitizeTemplate(row.template, defaultTemplate(sample, stock));
  return {
    id,
    kind: row.kind,
    name,
    printerId: printer.id,
    stockId: stock.id,
    template,
    isDefault: row.is_default === true,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Defaults first, then by name. */
export function sortSavedTemplates(list: readonly SavedTemplate[]): SavedTemplate[] {
  return [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export type TemplateWrite = {
  kind: SubjectKind;
  name: string;
  printer_id: string;
  stock_id: string;
  template: LabelTemplate;
};

export type TemplateWriteCheck = { ok: true; row: TemplateWrite } | { ok: false; error: string };

/**
 * Validate a design before it is saved. The printer must be one we know, the
 * stock must parse (catalogue or a valid custom size) AND be feedable by that
 * printer — a saved design must never open in a blocked state.
 */
export function checkTemplateWrite(
  input: { kind: unknown; name: unknown; printerId: unknown; stockId: unknown; template: unknown },
  existing: readonly { id: string; name: string }[],
  sample: LabelSubject | null,
  selfId: string | null = null,
): TemplateWriteCheck {
  if (!isKind(input.kind)) return { ok: false, error: "Unknown label kind." };
  const nm = checkTemplateName(input.name, existing, selfId);
  if (!nm.ok) return nm;
  if (!selfId && existing.length >= MAX_TEMPLATES_PER_KIND) {
    return { ok: false, error: `The store already has ${MAX_TEMPLATES_PER_KIND} saved designs for ${KIND_LABEL[input.kind].toLowerCase()}. Remove one you no longer use first.` };
  }
  const printerId = typeof input.printerId === "string" && ID_TOKEN.test(input.printerId) ? input.printerId : "";
  const printer = printerById(printerId);
  if (printer.id !== printerId) return { ok: false, error: "Pick a printer from the list before saving." };
  const stockId = typeof input.stockId === "string" && ID_TOKEN.test(input.stockId) ? input.stockId : "";
  const stock = stockById(stockId);
  if (!stock) return { ok: false, error: "That label size isn't recognised. Pick a size from the list or enter a custom size." };
  const fit = checkStockFit(stock, printer);
  if (fit.severity === "block") return { ok: false, error: `The ${printer.name} can't feed this label: ${fit.messages[0]?.text ?? "size out of range"}` };
  const base = sample && sample.kind === input.kind ? defaultTemplate(sample, stock) : null;
  if (!base) return { ok: false, error: "Open the design on an item of the same kind to save it." };
  const template = sanitizeTemplate(input.template, base);
  return { ok: true, row: { kind: input.kind, name: nm.name, printer_id: printer.id, stock_id: stock.id, template } };
}

/**
 * A stand-in subject for validating a design on the server (defaultTemplate
 * only reads kind + defaultCode). The kind's own primary code: a lot's lot
 * code, an item's store SKU.
 */
export function sampleSubjectFor(kind: SubjectKind): LabelSubject {
  return kind === "lot" ? SAMPLE_LOT : SAMPLE_NC;
}

// ── Print history ───────────────────────────────────────────────────────────

export type PrintLogInput = {
  kind: unknown;
  printerId: unknown;
  stockId: unknown;
  template: unknown;
  items: unknown;
  totalLabels: unknown;
  context?: unknown;
  templateId?: unknown;
};

export type PrintLogItem = { subjectId: string; copies: number; codeSource: string | null; codeValue: string | null };

export type PrintLogRow = {
  kind: SubjectKind;
  printer_id: string;
  stock_id: string;
  symbology: string;
  total_labels: number;
  item_count: number;
  subject_ids: string[];
  items: PrintLogItem[];
  template: Record<string, unknown>;
  template_id: string | null;
  context: string | null;
};

export type PrintLogCheck = { ok: true; row: PrintLogRow } | { ok: false; error: string };

/**
 * Build the print-history row from what the browser says it printed. Never
 * trusted: ids must be UUIDs, copies are re-clamped, the total is RECOMPUTED
 * from the items (a client-sent total is only cross-checked), code values are
 * cut to 120 chars. A job of 0 or > 1,000 labels is refused, as the studio
 * itself refuses to print it.
 */
export function buildPrintLogRow(input: PrintLogInput): PrintLogCheck {
  if (!isKind(input.kind)) return { ok: false, error: "Unknown label kind." };
  const printerId = typeof input.printerId === "string" && ID_TOKEN.test(input.printerId) ? input.printerId : null;
  const stockId = typeof input.stockId === "string" && ID_TOKEN.test(input.stockId) ? input.stockId : null;
  if (!printerId || !stockId) return { ok: false, error: "The printer or label size was missing." };
  if (!Array.isArray(input.items) || input.items.length === 0) return { ok: false, error: "Nothing was printed." };
  if (input.items.length > PRINT_LOG_MAX_ITEMS) return { ok: false, error: `A print job can name at most ${PRINT_LOG_MAX_ITEMS} items.` };

  const items: PrintLogItem[] = [];
  for (const raw of input.items) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const subjectId = typeof r.subjectId === "string" ? r.subjectId.trim().toLowerCase() : "";
    if (!UUID_RE.test(subjectId)) return { ok: false, error: "A printed item had no valid id." };
    const n = typeof r.copies === "number" ? r.copies : Number(r.copies);
    const copies = Number.isFinite(n) ? Math.max(0, Math.min(MAX_COPIES_PER_ITEM, Math.trunc(n))) : 0;
    if (copies === 0) continue;
    const codeSource = typeof r.codeSource === "string" && /^[a-z_]{1,20}$/.test(r.codeSource) ? r.codeSource : null;
    const codeValue = clean(r.codeValue, CODE_VALUE_MAX) || null;
    items.push({ subjectId, copies, codeSource, codeValue });
  }
  const total = items.reduce((s, i) => s + i.copies, 0);
  if (total === 0) return { ok: false, error: "Nothing was printed." };
  if (total > MAX_LABELS_PER_JOB) return { ok: false, error: `A print job is at most ${MAX_LABELS_PER_JOB} labels.` };
  const claimed = typeof input.totalLabels === "number" ? input.totalLabels : Number(input.totalLabels);
  if (Number.isFinite(claimed) && Math.trunc(claimed) !== total) {
    return { ok: false, error: `The label count didn't add up (${Math.trunc(claimed)} vs ${total}).` };
  }

  const t = (input.template && typeof input.template === "object" ? input.template : {}) as Record<string, unknown>;
  const symbology = typeof t.symbology === "string" && /^[a-z0-9_]{1,20}$/.test(t.symbology) ? t.symbology : "unknown";
  const template: Record<string, unknown> = {
    symbology,
    codeSource: typeof t.codeSource === "string" ? t.codeSource.slice(0, 20) : null,
    placement: typeof t.placement === "string" ? t.placement.slice(0, 20) : null,
    fields: Array.isArray(t.fields) ? t.fields.filter((f): f is string => typeof f === "string").slice(0, 40).map((f) => f.slice(0, 30)) : [],
    density: typeof t.density === "string" ? t.density.slice(0, 20) : null,
    showCodeText: t.showCodeText === true,
  };
  const templateId = typeof input.templateId === "string" && UUID_RE.test(input.templateId) ? input.templateId.toLowerCase() : null;
  const context = clean(input.context, CONTEXT_MAX) || null;
  return {
    ok: true,
    row: {
      kind: input.kind,
      printer_id: printerId,
      stock_id: stockId,
      symbology,
      total_labels: total,
      item_count: items.length,
      subject_ids: [...new Set(items.map((i) => i.subjectId))],
      items,
      template,
      template_id: templateId,
      context,
    },
  };
}

export type PrintHistoryEntry = {
  id: string;
  printedAt: string;
  who: string;
  totalLabels: number;
  itemCount: number;
  stockId: string;
  symbology: string;
  /** Copies + code for the subject the page is about (null for a batch view). */
  forSubject: { copies: number; codeValue: string | null } | null;
};

/** A print_log row for display. Untrusted; a malformed row is dropped. */
export function historyEntryFromRow(row: Record<string, unknown>, subjectId: string | null): PrintHistoryEntry | null {
  const id = typeof row.id === "string" ? row.id : "";
  const printedAt = typeof row.printed_at === "string" ? row.printed_at : "";
  if (!id || !printedAt) return null;
  const items = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : [];
  const mine = subjectId ? items.find((i) => i && typeof i === "object" && String(i.subjectId ?? "").toLowerCase() === subjectId.toLowerCase()) : null;
  return {
    id,
    printedAt,
    who: clean(row.printed_by_email, 120) || "Staff",
    totalLabels: Math.max(0, Math.trunc(Number(row.total_labels) || 0)),
    itemCount: Math.max(0, Math.trunc(Number(row.item_count) || 0)),
    stockId: typeof row.stock_id === "string" ? row.stock_id : "",
    symbology: typeof row.symbology === "string" ? row.symbology : "",
    forSubject: mine ? { copies: Math.max(0, Math.trunc(Number(mine.copies) || 0)), codeValue: typeof mine.codeValue === "string" ? mine.codeValue : null } : null,
  };
}

/** Plain-language meaning of a failed saved-designs / history call. */
export function savedErrorText(code: string | null | undefined, message: string | null | undefined, what: "designs" | "history"): string {
  const c = code ?? "";
  if (c === "42P01" || c === "PGRST205" || c === "42883" || c === "PGRST202" || c === "42703") {
    return `Saved ${what === "designs" ? "designs" : "print history"} need migration 0342_label_studio.sql (docs/MIGRATIONS_TO_RUN.md). Printing still works.`;
  }
  if (c === "42501") return `The database refused the server (permission denied, 42501). Re-run 0342_label_studio.sql — it carries the grants.`;
  if (c === "23505") return what === "designs" ? "Another design already uses that name (or is already the default). Reload and try again." : "That print was already recorded.";
  const m = clean(message, 160);
  return `Couldn't ${what === "designs" ? "save the design" : "record the print"}${c ? ` (${c})` : ""}${m ? `: ${m}` : ""}.`;
}

/** Is this code "the 0342 tables/functions aren't there yet"? (UI shows a hint, not an error.) */
export function isLabelStudioMigrationMissing(code: string | null | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "42883" || code === "PGRST202";
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runLabelSavedTests(
  samples: { lot: LabelSubject; nc: LabelSubject } = { lot: SAMPLE_LOT, nc: SAMPLE_NC },
): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error(`label-saved-core self-test failed: ${msg}`);
    }
  };
  const U1 = "11111111-2222-3333-4444-555555555555";
  const U2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  // Names.
  ok(checkTemplateName("  Glass   tag ", []).ok && (checkTemplateName("  Glass   tag ", []) as { name: string }).name === "Glass tag", "name trimmed + collapsed");
  ok(!checkTemplateName("", []).ok && !checkTemplateName("   ", []).ok && !checkTemplateName(42, []).ok, "name required");
  ok(!checkTemplateName("x".repeat(61), []).ok && checkTemplateName("x".repeat(60), []).ok, "name ≤ 60");
  ok(!checkTemplateName("glass TAG", [{ id: U1, name: "Glass tag" }]).ok, "duplicate name refused (case-insensitive)");
  ok(checkTemplateName("Glass tag", [{ id: U1, name: "Glass tag" }], U1).ok, "renaming itself is fine");
  ok(clean("a\u0000b\nc", 10) === "a b c", "control chars stripped");

  // Template write.
  const goodLot = { kind: "lot", name: "Re-barcode 2x1 QR", printerId: "rollo-x1040", stockId: "rollo-2x1", template: { symbology: "qr", fields: ["product"] } };
  const w1 = checkTemplateWrite(goodLot, [], samples.lot);
  ok(w1.ok && w1.row.stock_id === "rollo-2x1" && w1.row.template.symbology === "qr" && w1.row.template.fields.join() === "product", "valid lot design");
  ok(!checkTemplateWrite({ ...goodLot, kind: "plant" }, [], samples.lot).ok, "unknown kind refused");
  ok(!checkTemplateWrite({ ...goodLot, printerId: "nope" }, [], samples.lot).ok, "unknown printer refused");
  ok(!checkTemplateWrite({ ...goodLot, stockId: "zzz" }, [], samples.lot).ok, "unknown stock refused");
  ok(!checkTemplateWrite({ ...goodLot, stockId: "dymo-30333" }, [], samples.lot).ok, "stock Rollo can't feed refused");
  ok(checkTemplateWrite({ ...goodLot, stockId: "custom-2.5x1.5" }, [], samples.lot).ok, "custom size accepted");
  ok(!checkTemplateWrite(goodLot, [], samples.nc).ok, "sample of wrong kind refused");
  const many = Array.from({ length: MAX_TEMPLATES_PER_KIND }, (_, i) => ({ id: `id-${i}`, name: `T${i}` }));
  ok(!checkTemplateWrite(goodLot, many, samples.lot).ok && checkTemplateWrite(goodLot, many, samples.lot, "id-3").ok, "per-kind cap on create only");
  const w2 = checkTemplateWrite({ ...goodLot, template: { symbology: "bogus", fields: ["product", "thc", "product"], customText: "<b>" } }, [], samples.lot);
  ok(w2.ok && w2.row.template.symbology !== ("bogus" as string) && !w2.row.template.fields.includes("thc" as never) && w2.row.template.fields.length === 1, "template sanitised on write");

  // Read back.
  const r1 = savedTemplateFromRow({ id: U1, kind: "lot", name: "A", printer_id: "rollo-x1040", stock_id: "rollo-2x1", template: { symbology: "qr" }, is_default: true }, samples.lot);
  ok(!!r1 && r1.isDefault && r1.template.symbology === "qr" && r1.stockId === "rollo-2x1", "row read back");
  ok(savedTemplateFromRow({ id: "x", kind: "lot", name: "A" }, samples.lot) === null, "bad id dropped");
  ok(savedTemplateFromRow({ id: U1, kind: "nc", name: "A" }, samples.lot) === null, "kind mismatch dropped");
  ok(savedTemplateFromRow({ id: U1, kind: "lot", name: " " }, samples.lot) === null, "blank name dropped");
  const r2 = savedTemplateFromRow({ id: U1, kind: "lot", name: "B", printer_id: "gone", stock_id: "gone", template: "junk" }, samples.lot);
  ok(!!r2 && r2.printerId === "rollo-x1040" && r2.stockId === "rollo-4x6" && Array.isArray(r2.template.fields), "stale printer/stock/template repaired");
  const sorted = sortSavedTemplates([
    { ...r1!, id: U2, name: "zeta", isDefault: false },
    { ...r1!, id: U1, name: "Alpha", isDefault: false },
    { ...r1!, id: "d", name: "mid", isDefault: true },
  ]);
  ok(sorted[0].name === "mid" && sorted[1].name === "Alpha" && sorted[2].name === "zeta", "default first, then name");

  // Print log.
  const base: PrintLogInput = {
    kind: "lot",
    printerId: "rollo-x1040",
    stockId: "rollo-2x1",
    template: { symbology: "qr", codeSource: "lot_code", fields: ["product"], placement: "left" },
    items: [{ subjectId: U1.toUpperCase(), copies: 3, codeSource: "lot_code", codeValue: "6034A" }, { subjectId: U2, copies: 2, codeSource: null, codeValue: null }],
    totalLabels: 5,
    context: "Manifest 123",
  };
  const p1 = buildPrintLogRow(base);
  ok(p1.ok && p1.row.total_labels === 5 && p1.row.item_count === 2 && p1.row.items[0].subjectId === U1 && p1.row.symbology === "qr", "log row built");
  ok(p1.ok && p1.row.subject_ids.length === 2 && p1.row.subject_ids[0] === U1, "subject ids for lookups");
  ok(!buildPrintLogRow({ ...base, totalLabels: 9 }).ok, "claimed total must match");
  ok(buildPrintLogRow({ ...base, totalLabels: undefined }).ok, "total optional (recomputed)");
  ok(!buildPrintLogRow({ ...base, items: [] }).ok && !buildPrintLogRow({ ...base, items: "x" }).ok, "nothing printed refused");
  ok(!buildPrintLogRow({ ...base, items: [{ subjectId: "not-a-uuid", copies: 1 }], totalLabels: 1 }).ok, "bad subject id refused");
  ok(!buildPrintLogRow({ ...base, items: [{ subjectId: U1, copies: 0 }], totalLabels: 0 }).ok, "zero-copy job refused");
  const big = buildPrintLogRow({ ...base, items: [{ subjectId: U1, copies: 99999 }], totalLabels: undefined });
  ok(big.ok && big.row.total_labels === MAX_COPIES_PER_ITEM, "copies re-clamped");
  const over = Array.from({ length: 3 }, (_, i) => ({ subjectId: `00000000-0000-0000-0000-00000000000${i}`, copies: 500 }));
  ok(!buildPrintLogRow({ ...base, items: over, totalLabels: undefined }).ok, "> 1000 labels refused");
  ok(!buildPrintLogRow({ ...base, kind: "x" }).ok && !buildPrintLogRow({ ...base, printerId: "" }).ok && !buildPrintLogRow({ ...base, stockId: "a b" }).ok, "kind/printer/stock required");
  const long = buildPrintLogRow({ ...base, items: [{ subjectId: U1, copies: 1, codeValue: "9".repeat(500) }], totalLabels: 1, context: "c".repeat(999), templateId: "nope" });
  ok(long.ok && long.row.items[0].codeValue!.length === CODE_VALUE_MAX && long.row.context!.length === CONTEXT_MAX && long.row.template_id === null, "values cut, bad template id dropped");
  ok(buildPrintLogRow({ ...base, templateId: U2.toUpperCase() }).ok && (buildPrintLogRow({ ...base, templateId: U2 }) as { row: PrintLogRow }).row.template_id === U2, "template id kept");

  // History.
  const h = historyEntryFromRow({ id: "h1", printed_at: "2026-11-05T10:00:00Z", printed_by_email: "a@b.c", total_labels: 5, item_count: 2, stock_id: "rollo-2x1", symbology: "qr", items: p1.ok ? p1.row.items : [] }, U1);
  ok(!!h && h.forSubject?.copies === 3 && h.forSubject.codeValue === "6034A" && h.who === "a@b.c", "history entry for subject");
  ok(historyEntryFromRow({ id: "h1" }, null) === null && historyEntryFromRow({ id: "h", printed_at: "t", items: "x" }, U1)?.forSubject === null, "history defensive");

  // Errors.
  ok(/0342_label_studio\.sql/.test(savedErrorText("42P01", "", "designs")) && /Printing still works/.test(savedErrorText("PGRST205", "", "history")), "missing → migration hint");
  ok(/42501/.test(savedErrorText("42501", "", "designs")) && /already uses that name/.test(savedErrorText("23505", "", "designs")), "permission + duplicate");
  ok(/Couldn't record the print \(57014\): slow/.test(savedErrorText("57014", "slow", "history")), "other error");
  ok(sampleSubjectFor("lot").defaultCode === "lot_code" && sampleSubjectFor("nc").defaultCode === "sku", "server sample subjects");
  ok(isLabelStudioMigrationMissing("PGRST202") && !isLabelStudioMigrationMissing("42501") && !isLabelStudioMigrationMissing(null), "migration-missing detector");

  return { passed, failed };
}
