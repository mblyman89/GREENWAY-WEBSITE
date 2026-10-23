/**
 * src/lib/inventory/cultivera-survivorship-core.ts   (R74 S14, pure)
 *
 * Owner, round 2 answer 3 (verbatim in the roadmap): "Manifest wins on name,
 * type, cost; Cultivera wins on category, quantity."
 *
 * A product on a manifest rebuilt from the Cultivera export has two witnesses:
 *   - the vendor's own manifest line for its barcode: the Cultivera transfer
 *     file (WCIA JSON, kept per transfer by R50 S3b) or the vendor's emailed
 *     manifest (R74 S10 stored its line facts per barcode in the manifest's
 *     lineage, raw_payload.line_facts);
 *   - Cultivera's export (what the import wrote on the lot and the draft).
 *
 * Field-level survivorship (the MDM golden-record rule), decided here:
 *   name, type, cost   -> the manifest line, when it says something usable
 *                         (a non-blank name / type, a whole non-negative cost
 *                         in cents). Blank on the manifest = Cultivera keeps it.
 *   category, quantity -> Cultivera, always. Nothing here can write either.
 *   a person's value   -> always kept (mergeDraftAttachedFacts keeps "human").
 *   two lines for one barcode that disagree -> neither is used (never guess).
 *
 * Each manifest value lands as an attached fact with source "manifest" (so the
 * onboarding row can say where every field came from, and the fact history
 * records it) and on the onboarding row's own column (name / inventory_type /
 * unit_cost_minor_units), so approving it refreshes the live card with the
 * manifest's name and type. Stock is never touched: the lot keeps Cultivera's
 * values, quantity and cost (the cost on the lot is the accounting figure).
 *
 * Pure: no I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */
import { DRAFT_FACT_COLUMNS, mergeDraftAttachedFacts, type LandedDraftFact } from "@/lib/catalog/attach-facts-core";

/** Fact keys the manifest decides, and the onboarding-row column each one fills. */
export const MANIFEST_WINS = [
  { field: "product_name", column: "name", label: "Name" },
  { field: "inventory_type", column: "inventory_type", label: "Type" },
  { field: "unit_cost", column: "unit_cost_minor_units", label: "Cost" },
] as const;
export type ManifestField = (typeof MANIFEST_WINS)[number]["field"];

/** What Cultivera decides, always (shown on the row; never written from a manifest). */
export const CULTIVERA_WINS = [
  { key: "category", label: "Category" },
  { key: "quantity", label: "Quantity" },
] as const;

export const SURVIVORSHIP_EVENT = "cultivera_manifest_survivorship";

/** One manifest line's facts for a barcode (money in cents). */
export type LineFacts = { productName: string | null; inventoryType: string | null; unitCostCents: number | null };

/** The witness a manifest's lines came from. */
export type LineSource = "transfer_file" | "emailed_manifest";

export const LINE_SOURCE_LABEL: Record<LineSource, string> = {
  transfer_file: "the vendor's Cultivera transfer file",
  emailed_manifest: "the vendor's emailed manifest",
};

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
export const barcodeKey = (v: unknown): string => clean(v).toUpperCase();

function factsOf(productName: unknown, inventoryType: unknown, unitCostCents: unknown): LineFacts {
  return { productName: clean(productName) || null, inventoryType: clean(inventoryType) || null, unitCostCents: cents(unitCostCents) };
}
const sameFacts = (a: LineFacts, b: LineFacts) =>
  a.productName === b.productName && a.inventoryType === b.inventoryType && a.unitCostCents === b.unitCostCents;
const emptyFacts = (f: LineFacts) => f.productName === null && f.inventoryType === null && f.unitCostCents === null;

export type LineIndex = { byBarcode: Map<string, LineFacts>; ambiguous: Set<string> };

/**
 * The emailed manifest's per-barcode facts (raw_payload.line_facts, written by
 * cultivera-mail-apply-core: {productName, inventoryType, unitCostCents, qty}).
 * Anything that is not that shape is skipped, never coerced.
 */
export function lineIndexFromEmailPayload(lineFacts: unknown): LineIndex {
  const out: LineIndex = { byBarcode: new Map(), ambiguous: new Set() };
  if (!lineFacts || typeof lineFacts !== "object" || Array.isArray(lineFacts)) return out;
  for (const [bc, raw] of Object.entries(lineFacts as Record<string, unknown>)) {
    const k = barcodeKey(bc);
    if (!k || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const f = factsOf(r.productName, r.inventoryType, r.unitCostCents);
    if (emptyFacts(f)) continue;
    out.byBarcode.set(k, f);
  }
  return out;
}

/**
 * A parsed transfer file's lines by barcode (lot_code = WCIA inventory_id).
 * A barcode on two lines that do not say the same thing is AMBIGUOUS: neither
 * line is used (never guess which one is right).
 */
export function lineIndexFromParsedLines(
  lines: readonly { lot_code: string | null; product_name: string | null; inventory_type: string | null; unit_cost_minor_units: number | null }[],
): LineIndex {
  const out: LineIndex = { byBarcode: new Map(), ambiguous: new Set() };
  for (const l of lines) {
    const k = barcodeKey(l.lot_code);
    if (!k || out.ambiguous.has(k)) continue;
    const f = factsOf(l.product_name, l.inventory_type, l.unit_cost_minor_units);
    const prev = out.byBarcode.get(k);
    if (!prev) {
      out.byBarcode.set(k, f);
      continue;
    }
    if (!sameFacts(prev, f)) {
      out.byBarcode.delete(k);
      out.ambiguous.add(k);
    }
  }
  for (const [k, f] of out.byBarcode) if (emptyFacts(f)) out.byBarcode.delete(k);
  return out;
}

/** A lot's line: its lot_code and its CCRS barcode both count; two different answers = ambiguous. */
export type LotLine = { kind: "line"; facts: LineFacts } | { kind: "none" } | { kind: "ambiguous" };

export function lineForLot(index: LineIndex, lot: { lot_code?: unknown; ccrs_inventory_external_id?: unknown }): LotLine {
  const keys = Array.from(new Set([barcodeKey(lot.lot_code), barcodeKey(lot.ccrs_inventory_external_id)].filter(Boolean)));
  if (keys.some((k) => index.ambiguous.has(k))) return { kind: "ambiguous" };
  const hits = keys.map((k) => index.byBarcode.get(k)).filter((f): f is LineFacts => !!f);
  if (hits.length === 0) return { kind: "none" };
  if (hits.some((h) => !sameFacts(h, hits[0]))) return { kind: "ambiguous" };
  return { kind: "line", facts: hits[0] };
}

/** The facts a manifest line lands (only what it actually says). */
export function landedFromLine(line: LineFacts): LandedDraftFact[] {
  const out: LandedDraftFact[] = [];
  if (line.productName) out.push({ field: "product_name", value: line.productName, source: "manifest", confidence: null });
  if (line.inventoryType) out.push({ field: "inventory_type", value: line.inventoryType, source: "manifest", confidence: null });
  if (line.unitCostCents !== null) out.push({ field: "unit_cost", value: line.unitCostCents, source: "manifest", confidence: null });
  return out;
}

export type SurvivorDraft = {
  name: string | null;
  inventory_type: string | null;
  unit_cost_minor_units: number | null;
  facts: unknown;
  provenance: unknown;
};

export type SurvivorshipPatch = {
  /** The row update (fact columns + the manifest-decided columns), or null = nothing to write. */
  patch: Record<string, unknown> | null;
  /** Fields that took the manifest's value. */
  written: ManifestField[];
  /** Fields a person set: kept. */
  keptHuman: ManifestField[];
  /** Manifest-decided columns whose value really changed (Cultivera said something else). */
  changed: { field: ManifestField; from: unknown; to: unknown }[];
};

/**
 * The onboarding-row update for one product. Re-running is a no-op: a field
 * already holding the manifest's value from the manifest writes nothing.
 * Category and quantity are not inputs, so they cannot be written.
 */
export function planSurvivorship(draft: SurvivorDraft, line: LineFacts | null, at: string, by: string | null): SurvivorshipPatch {
  const none: SurvivorshipPatch = { patch: null, written: [], keptHuman: [], changed: [] };
  if (!line) return none;
  const facts = draft.facts && typeof draft.facts === "object" && !Array.isArray(draft.facts) ? (draft.facts as Record<string, unknown>) : {};
  const col = (field: ManifestField) => MANIFEST_WINS.find((m) => m.field === field)!.column;
  const landed = landedFromLine(line).filter((l) => {
    const cur = facts[l.field] as { value?: unknown; source?: unknown } | undefined;
    const columnValue = (draft as unknown as Record<string, unknown>)[col(l.field as ManifestField)];
    return !(cur && cur.source === "manifest" && cur.value === l.value && columnValue === l.value);
  });
  if (landed.length === 0) return none;
  const merged = mergeDraftAttachedFacts({ existingFacts: draft.facts, existingProvenance: draft.provenance, landed, at, by, urls: [] });
  const keptHuman = merged.keptHuman.filter((f): f is ManifestField => MANIFEST_WINS.some((m) => m.field === f));
  if (!merged.patch) return { ...none, keptHuman };
  const patch: Record<string, unknown> = { ...merged.patch };
  const written: ManifestField[] = [];
  const changed: SurvivorshipPatch["changed"] = [];
  for (const f of merged.written) {
    const m = MANIFEST_WINS.find((x) => x.field === f);
    if (!m) continue;
    const to = landed.find((l) => l.field === f)!.value;
    const from = (draft as unknown as Record<string, unknown>)[m.column] ?? null;
    patch[m.column] = to;
    written.push(m.field);
    if (from !== to) changed.push({ field: m.field, from, to });
  }
  return { patch, written, keptHuman, changed };
}

/** Where each field on a rebuilt product came from, for the onboarding row. */
export type FieldSource = { label: string; source: string; manifest: boolean };

export function fieldSourcesView(attached: unknown): FieldSource[] {
  const facts = attached && typeof attached === "object" && !Array.isArray(attached) ? (attached as Record<string, unknown>) : {};
  const out: FieldSource[] = [];
  for (const m of MANIFEST_WINS) {
    const f = facts[m.field] as { source?: unknown } | undefined;
    if (f && f.source === "manifest") out.push({ label: m.label, source: "vendor's manifest", manifest: true });
    else if (f && f.source === "human") out.push({ label: m.label, source: "set by a person", manifest: false });
    else out.push({ label: m.label, source: "Cultivera (no manifest line)", manifest: false });
  }
  for (const c of CULTIVERA_WINS) out.push({ label: c.label, source: "Cultivera", manifest: false });
  return out;
}

export function fieldSourcesLine(attached: unknown): string {
  return fieldSourcesView(attached)
    .map((s) => `${s.label}: ${s.source}`)
    .join(" \u00b7 ");
}

export type SurvivorshipRun = {
  source: LineSource | null;
  /** Products whose row took at least one manifest value. */
  updated: number;
  /** Products with a manifest line that already matched (nothing to write). */
  unchanged: number;
  /** Products on the manifest with no line for their barcode. */
  noLine: number;
  /** Products whose barcode is on two disagreeing lines (left as Cultivera's). */
  ambiguous: number;
  /** Fields a person set (kept). */
  keptHuman: number;
  /** Per-field count of real changes. */
  changedByField: Record<ManifestField, number>;
  errors: string[];
};

export function emptySurvivorshipRun(source: LineSource | null): SurvivorshipRun {
  return { source, updated: 0, unchanged: 0, noLine: 0, ambiguous: 0, keptHuman: 0, changedByField: { product_name: 0, inventory_type: 0, unit_cost: 0 }, errors: [] };
}

/** One sentence for the timeline; "" when there was nothing to say. */
export function survivorshipNote(r: SurvivorshipRun): string {
  if (!r.source) return "";
  const total = r.updated + r.unchanged + r.noLine + r.ambiguous;
  if (total === 0 && r.errors.length === 0) return "";
  const ch = r.changedByField;
  const parts = [
    `${r.updated} product${r.updated === 1 ? "" : "s"} took the name, type and cost from ${LINE_SOURCE_LABEL[r.source]}`,
    ch.product_name + ch.inventory_type + ch.unit_cost > 0
      ? `changed from Cultivera's: ${ch.product_name} name${ch.product_name === 1 ? "" : "s"}, ${ch.inventory_type} type${ch.inventory_type === 1 ? "" : "s"}, ${ch.unit_cost} cost${ch.unit_cost === 1 ? "" : "s"}`
      : "",
    r.unchanged > 0 ? `${r.unchanged} already matched` : "",
    r.noLine > 0 ? `${r.noLine} not on the manifest (Cultivera's kept)` : "",
    r.ambiguous > 0 ? `${r.ambiguous} on two lines that disagree (Cultivera's kept, not guessed)` : "",
    r.keptHuman > 0 ? `${r.keptHuman} value${r.keptHuman === 1 ? "" : "s"} a person set kept` : "",
  ].filter(Boolean);
  const err = r.errors.length > 0 ? ` Problems: ${r.errors.slice(0, 3).join("; ")}.` : "";
  return `Manifest wins on name, type and cost; Cultivera keeps category and quantity: ${parts.join(", ")}. Stock was not changed.${err}`;
}

// --- Self-tests -----------------------------------------------------------------------

export function __runCultiveraSurvivorshipCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: unknown, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  \u2717 cultivera-survivorship-core: ${name}`);
    }
  };
  const AT = "2026-10-25T12:00:00.000Z";
  const [FACTS, PROV] = DRAFT_FACT_COLUMNS;

  // 1. email payload
  const e = lineIndexFromEmailPayload({
    " ab12 ": { productName: " Fire  OG 3.5g ", inventoryType: "Usable Marijuana", unitCostCents: 1234, qty: 5 },
    C3: { productName: "", inventoryType: null, unitCostCents: null, qty: 1 },
    D4: "nope",
    E5: { productName: "X", inventoryType: "T", unitCostCents: 12.5 },
    F6: { productName: "Y", inventoryType: "T", unitCostCents: -1 },
  });
  ok(e.byBarcode.get("AB12")?.productName === "Fire OG 3.5g", "email: barcode trimmed + upper, name spaces collapsed");
  ok(e.byBarcode.get("AB12")?.unitCostCents === 1234, "email: cost in cents carried");
  ok(!e.byBarcode.has("C3"), "email: an empty line is skipped");
  ok(!e.byBarcode.has("D4"), "email: a non-object line is skipped");
  ok(e.byBarcode.get("E5")?.unitCostCents === null, "email: a fractional cost is not coerced");
  ok(e.byBarcode.get("F6")?.unitCostCents === null, "email: a negative cost is not used");
  ok(lineIndexFromEmailPayload(null).byBarcode.size === 0 && lineIndexFromEmailPayload([1]).byBarcode.size === 0, "email: bad payload = nothing");

  // 2. parsed lines
  const L = (bc: string | null, name: string | null, type: string | null, cost: number | null) => ({ lot_code: bc, product_name: name, inventory_type: type, unit_cost_minor_units: cost });
  const p = lineIndexFromParsedLines([L("A", "Blue Dream", "Usable Marijuana", 500), L("A", "Blue Dream", "Usable Marijuana", 500), L("B", "One", "UM", 1), L("b ", "Two", "UM", 1), L("B", "One", "UM", 1), L(null, "x", "y", 1), L("Z", null, null, null)]);
  ok(p.byBarcode.get("A")?.unitCostCents === 500, "lines: a repeated identical line is fine");
  ok(!p.byBarcode.has("B") && p.ambiguous.has("B"), "lines: two disagreeing lines = ambiguous, neither used");
  ok(p.byBarcode.size === 1, "lines: no barcode / empty line dropped");
  const lf = lineForLot(p, { lot_code: " a ", ccrs_inventory_external_id: null });
  ok(lf.kind === "line" && lf.facts.unitCostCents === 500, "lot: lot_code matched case-blind");
  ok(lineForLot(p, { lot_code: null, ccrs_inventory_external_id: "A" }).kind === "line", "lot: CCRS barcode matched");
  ok(lineForLot(p, { lot_code: "B" }).kind === "ambiguous", "lot: an ambiguous barcode is ambiguous");
  ok(lineForLot(p, { lot_code: "Q" }).kind === "none" && lineForLot(p, {}).kind === "none", "lot: no line = none");
  const two = lineIndexFromParsedLines([L("A", "One", "UM", 1), L("C", "Two", "UM", 1)]);
  ok(lineForLot(two, { lot_code: "A", ccrs_inventory_external_id: "C" }).kind === "ambiguous", "lot: its two barcodes on different lines = ambiguous");

  // 3. plan
  const draft: SurvivorDraft = { name: "BLUE DREAM 3.5G CV", inventory_type: "Usable Marijuana", unit_cost_minor_units: 450, facts: null, provenance: null };
  const line: LineFacts = { productName: "Blue Dream 3.5g", inventoryType: "Usable Marijuana", unitCostCents: 500 };
  const a = planSurvivorship(draft, line, AT, "u1");
  ok(a.patch !== null && a.patch.name === "Blue Dream 3.5g" && a.patch.unit_cost_minor_units === 500 && a.patch.inventory_type === "Usable Marijuana", "plan: manifest wins on name, type, cost");
  ok(a.written.join() === "product_name,inventory_type,unit_cost", "plan: all three written");
  ok(a.changed.map((c) => c.field).join() === "product_name,unit_cost", "plan: only real differences counted as changes");
  ok(a.changed.find((c) => c.field === "unit_cost")?.from === 450, "plan: change keeps Cultivera's old value");
  const fa = (a.patch?.[FACTS] ?? {}) as Record<string, { source: string; value: unknown }>;
  ok(fa.product_name?.source === "manifest" && fa.unit_cost?.value === 500, "plan: facts land with source manifest");
  ok(!("category" in (a.patch ?? {})) && !("received_qty" in (a.patch ?? {})) && !("on_hand_qty" in (a.patch ?? {})), "plan: never writes category or quantity");
  const again = planSurvivorship({ name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", unit_cost_minor_units: 500, facts: a.patch?.[FACTS], provenance: a.patch?.[PROV] }, line, AT, "u1");
  ok(again.patch === null && again.written.length === 0, "plan: re-run is a no-op");
  const drifted = planSurvivorship({ name: "Edited elsewhere", inventory_type: "Usable Marijuana", unit_cost_minor_units: 500, facts: a.patch?.[FACTS], provenance: a.patch?.[PROV] }, line, AT, "u1");
  ok(drifted.patch?.name === "Blue Dream 3.5g" && drifted.written.join() === "product_name", "plan: a column that drifted from its manifest fact is put back");
  const human = planSurvivorship({ ...draft, facts: { product_name: { value: "My Name", source: "human", confidence: null, at: AT } } }, line, AT, "u1");
  ok(human.keptHuman.join() === "product_name" && human.patch?.name === undefined && human.patch?.unit_cost_minor_units === 500, "plan: a person's name is kept, the rest still lands");
  const partial = planSurvivorship(draft, { productName: null, inventoryType: null, unitCostCents: 700 }, AT, null);
  ok(partial.written.join() === "unit_cost" && partial.patch?.name === undefined, "plan: a blank manifest name leaves Cultivera's");
  ok(planSurvivorship(draft, null, AT, null).patch === null, "plan: no line = nothing");
  const zero = planSurvivorship(draft, { productName: null, inventoryType: null, unitCostCents: 0 }, AT, null);
  ok(zero.patch?.unit_cost_minor_units === 0, "plan: a zero cost on the manifest is a real value");

  // 4. view + note
  const v = fieldSourcesView(a.patch?.[FACTS]);
  ok(v.length === 5 && v.slice(0, 3).every((s) => s.manifest) && v[3].source === "Cultivera" && v[4].label === "Quantity", "view: three from the manifest, category + quantity Cultivera");
  ok(fieldSourcesView(null)[0].source === "Cultivera (no manifest line)", "view: nothing attached = Cultivera");
  ok(fieldSourcesView({ product_name: { source: "human" } })[0].source === "set by a person", "view: a person's value");
  ok(fieldSourcesLine(null).includes("Category: Cultivera") && fieldSourcesLine(null).includes(" \u00b7 "), "line joins");
  const run = emptySurvivorshipRun("emailed_manifest");
  ok(survivorshipNote(run) === "", "note: nothing = empty");
  ok(survivorshipNote(emptySurvivorshipRun(null)) === "", "note: no source = empty");
  run.updated = 2;
  run.changedByField.product_name = 1;
  run.noLine = 1;
  run.ambiguous = 1;
  run.keptHuman = 1;
  const n = survivorshipNote(run);
  ok(n.includes("2 products took") && n.includes("emailed manifest") && n.includes("1 name,") && n.includes("not guessed") && n.includes("Stock was not changed"), "note words");
  ok(MANIFEST_WINS.map((m) => m.column).join() === "name,inventory_type,unit_cost_minor_units", "the three columns");
  ok(CULTIVERA_WINS.map((c) => c.key).join() === "category,quantity", "Cultivera's two");
  return { passed, failed };
}
