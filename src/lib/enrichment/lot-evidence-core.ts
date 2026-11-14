/**
 * src/lib/enrichment/lot-evidence-core.ts  (D244 R-2 - strain type + potency drafts)
 *
 * Owner (verbatim, round 2): "please also include the ai the ability to draft
 * strain type and potency from the lot/ coa, as well as any source available
 * to it to for making drafts." and, for on-hand: "so long as the system thinks
 * we have at least 1 lot in stock, we should consider that to be what I mean
 * by \"on-hand\"."
 *
 * PURE. Turns the product's lots (inventory_lots) and their lab certificates
 * (lab_results + the stored certificate read, coa_extract_json) into
 * evidence lines the all-fields prompt cites as [lot:N] / [coa:N]. Lots with
 * stock come first (the owner's on-hand rule), then newest. Each line states
 * only what the row says.
 *
 * Potency is a regulated label fact, so the model is NEVER trusted with a
 * number: checkPotencyDraft keeps a THC/CBD value only when it equals a
 * number the lab, the lot or the POS actually carries (same unit, within
 * rounding). A number nobody can point to is dropped before it is filed.
 *
 * Also here: the stored potency text ("THC 24.5% · CBD 0.08%"), its parser
 * (the same parser reads an edit typed on the bulk grid) and the ceilings.
 */

export type PotencyUnit = "%" | "mg";
export type PotencyReading = { value: number; unit: PotencyUnit };
export type PotencyPair = { thc: PotencyReading | null; cbd: PotencyReading | null };

/** Most lots offered to the prompt (in-stock first, then newest). */
export const MAX_EVIDENCE_LOTS = 3;
/** A drafted % must sit within this of an evidence number. */
export const PCT_TOLERANCE = 0.05;
/** A drafted mg must sit within this of an evidence number. */
export const MG_TOLERANCE = 0.5;
/** Hard ceilings (same idea as intake-potency-core). */
export const PCT_CEILING = 100;
export const MG_CEILING = 5000;

export type LotEvidenceCoa = {
  totalThcPct?: number | null;
  totalCbdPct?: number | null;
  terpenes?: string[];
};

export type LotEvidenceLab = {
  lab_name?: string | null;
  tested_on?: string | null;
  thc_pct?: number | null;
  cbd_pct?: number | null;
  total_thc_pct?: number | null;
  total_cbd_pct?: number | null;
  coa?: LotEvidenceCoa | null;
};

export type LotEvidenceLot = {
  id: string;
  lot_code?: string | null;
  strain_name?: string | null;
  strain_type?: string | null;
  on_hand_qty?: number | null;
  pos_thc?: number | null;
  pos_cbd?: number | null;
  pos_potency_unit?: string | null;
  package_thc_mg?: number | null;
  package_cbd_mg?: number | null;
  lab?: LotEvidenceLab | null;
};

export type LotEvidence = {
  lines: string[];
  ids: string[];
  /** Every THC / CBD number the evidence carries (for checkPotencyDraft). */
  numbers: { thc: PotencyReading[]; cbd: PotencyReading[] };
  /** How many offered lots have stock (the owner's on-hand rule). */
  inStock: number;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (n: number): string => String(Number(n.toFixed(2)));
const show = (r: PotencyReading): string => `${fmt(r.value)}${r.unit}`;

/** "%" unless the POS said mg. */
function posUnit(u: string | null | undefined): PotencyUnit {
  return String(u ?? "").trim().toLowerCase() === "mg" ? "mg" : "%";
}

/** A lot counts as on hand when it has at least one unit (owner rule). */
export function lotInStock(l: Pick<LotEvidenceLot, "on_hand_qty">): boolean {
  return (num(l.on_hand_qty) ?? 0) > 0;
}

/** In-stock lots first, original (newest-first) order kept inside each group. */
export function orderLotsForEvidence<T extends Pick<LotEvidenceLot, "on_hand_qty">>(lots: readonly T[]): T[] {
  return [...lots.filter(lotInStock), ...lots.filter((l) => !lotInStock(l))];
}

/** Build the [lot:N] / [coa:N] evidence. Never invents a value. */
export function buildLotEvidence(lots: readonly LotEvidenceLot[]): LotEvidence {
  const out: LotEvidence = { lines: [], ids: [], numbers: { thc: [], cbd: [] }, inStock: 0 };
  const push = (k: "thc" | "cbd", r: PotencyReading | null) => {
    if (r && r.value >= 0) out.numbers[k].push(r);
  };
  const picked = orderLotsForEvidence(lots).slice(0, MAX_EVIDENCE_LOTS);
  picked.forEach((l, i) => {
    const n = i + 1;
    const code = (l.lot_code ?? "").trim() || `#${n}`;
    const stock = lotInStock(l);
    if (stock) out.inStock += 1;
    const facts: string[] = [];
    const type = (l.strain_type ?? "").trim();
    if (type && type.toLowerCase() !== "unknown") facts.push(`strain type ${type}`);
    if ((l.strain_name ?? "").trim()) facts.push(`strain ${l.strain_name!.trim()}`);
    const unit = posUnit(l.pos_potency_unit);
    const pThc = num(l.pos_thc);
    const pCbd = num(l.pos_cbd);
    if (pThc !== null || pCbd !== null) {
      facts.push(
        `manifest potency ${[pThc !== null ? `THC ${fmt(pThc)}${unit}` : "", pCbd !== null ? `CBD ${fmt(pCbd)}${unit}` : ""].filter(Boolean).join(" ")}`,
      );
      push("thc", pThc !== null ? { value: pThc, unit } : null);
      push("cbd", pCbd !== null ? { value: pCbd, unit } : null);
    }
    const kThc = num(l.package_thc_mg);
    const kCbd = num(l.package_cbd_mg);
    if (kThc !== null) {
      facts.push(`package THC ${fmt(kThc)}mg`);
      push("thc", { value: kThc, unit: "mg" });
    }
    if (kCbd !== null) {
      facts.push(`package CBD ${fmt(kCbd)}mg`);
      push("cbd", { value: kCbd, unit: "mg" });
    }
    if (facts.length > 0) {
      out.ids.push(`lot:${n}`);
      out.lines.push(`[lot:${n}] Lot ${code} (${stock ? `in stock, ${fmt(num(l.on_hand_qty) ?? 0)} on hand` : "sold out"}): ${facts.join("; ")}`);
    }

    const lab = l.lab;
    if (!lab) return;
    const tThc = num(lab.total_thc_pct) ?? num(lab.coa?.totalThcPct ?? null);
    const tCbd = num(lab.total_cbd_pct) ?? num(lab.coa?.totalCbdPct ?? null);
    const labFacts: string[] = [];
    if (tThc !== null) labFacts.push(`total THC ${fmt(tThc)}%`);
    if (tCbd !== null) labFacts.push(`total CBD ${fmt(tCbd)}%`);
    for (const v of [tThc, num(lab.thc_pct), num(lab.coa?.totalThcPct ?? null)]) push("thc", v !== null ? { value: v, unit: "%" } : null);
    for (const v of [tCbd, num(lab.cbd_pct), num(lab.coa?.totalCbdPct ?? null)]) push("cbd", v !== null ? { value: v, unit: "%" } : null);
    const terps = (lab.coa?.terpenes ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 4);
    if (terps.length) labFacts.push(`top terpenes (lab-measured): ${terps.join(", ")}`);
    if (labFacts.length === 0) return;
    const who = [(lab.lab_name ?? "").trim(), (lab.tested_on ?? "").trim() ? `tested ${lab.tested_on!.trim().slice(0, 10)}` : ""].filter(Boolean).join(", ");
    out.ids.push(`coa:${n}`);
    out.lines.push(`[coa:${n}] Lab certificate for lot ${code}${who ? ` (${who})` : ""}: ${labFacts.join("; ")}`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Potency text: stored + edited form
// ---------------------------------------------------------------------------

/** "THC 24.5% · CBD 0.08%" ("" when neither). */
export function potencyText(p: PotencyPair): string {
  return [p.thc ? `THC ${show(p.thc)}` : "", p.cbd ? `CBD ${show(p.cbd)}` : ""].filter(Boolean).join(" · ");
}

/** One model / form string like "24.5%", "100 mg", "24.5" (defaults to %). */
export function parseReading(raw: unknown, defaultUnit: PotencyUnit = "%"): PotencyReading | null {
  const m = String(raw ?? "").trim().toLowerCase().match(/^([0-9]+(?:\.[0-9]+)?)\s*(%|mg)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] as PotencyUnit | undefined) ?? defaultUnit;
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === "%" && value > PCT_CEILING) return null;
  if (unit === "mg" && value > MG_CEILING) return null;
  return { value, unit };
}

/**
 * Read stored or typed potency text. Accepts "THC 24.5% · CBD 0.08%",
 * "THC: 24.5%, CBD: 1%", "thc 100mg". Error when nothing readable or a
 * number is over the ceiling.
 */
export function parsePotencyText(text: unknown): { ok: true; value: PotencyPair } | { ok: false; error: string } {
  const s = String(text ?? "");
  const out: PotencyPair = { thc: null, cbd: null };
  const re = /\b(thc|cbd)\b\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(%|mg)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const k = m[1]!.toLowerCase() as "thc" | "cbd";
    const r = parseReading(`${m[2]}${m[3]}`);
    if (!r) return { ok: false, error: `${k.toUpperCase()} ${m[2]}${m[3]} is over the limit (${PCT_CEILING}% / ${MG_CEILING}mg).` };
    if (!out[k]) out[k] = r;
  }
  if (!out.thc && !out.cbd) return { ok: false, error: 'Write the potency like "THC 24.5% · CBD 0.1%" (or mg for edibles).' };
  return { ok: true, value: out };
}

const near = (a: PotencyReading, b: PotencyReading): boolean =>
  a.unit === b.unit && Math.abs(a.value - b.value) <= (a.unit === "%" ? PCT_TOLERANCE : MG_TOLERANCE) + 1e-9;

/**
 * Keep only drafted numbers that match an evidence number. `dropped` names
 * each one that did not (for the input summary / flash).
 */
export function checkPotencyDraft(
  draft: { thc?: unknown; cbd?: unknown },
  numbers: LotEvidence["numbers"],
): { value: PotencyPair; dropped: string[] } {
  const value: PotencyPair = { thc: null, cbd: null };
  const dropped: string[] = [];
  for (const k of ["thc", "cbd"] as const) {
    const raw = String(draft[k] ?? "").trim();
    if (!raw) continue;
    const r = parseReading(raw);
    if (r && numbers[k].some((e) => near(r, e))) value[k] = r;
    else dropped.push(`${k.toUpperCase()} ${raw}`);
  }
  return { value, dropped };
}

/** POS "24.5%" / "100mg" text as evidence numbers. */
export function posPotencyNumbers(thc: string | null | undefined, cbd: string | null | undefined): LotEvidence["numbers"] {
  const t = parseReading(String(thc ?? "").replace(/\s+/g, ""));
  const c = parseReading(String(cbd ?? "").replace(/\s+/g, ""));
  return { thc: t ? [t] : [], cbd: c ? [c] : [] };
}

/** Card columns for an accepted potency (thc/cbd text + the totals JSON the card reads). */
export function potencyCardPatch(p: PotencyPair): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (p.thc) {
    patch.thc = show(p.thc);
    patch.total_thc_json = { type: "thc", value: fmt(p.thc.value), unit: p.thc.unit };
  }
  if (p.cbd) {
    patch.cbd = show(p.cbd);
    patch.total_cbd_json = { type: "cbd", value: fmt(p.cbd.value), unit: p.cbd.unit };
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLotEvidenceTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`lot-evidence-core FAIL: ${label}`);
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

  const sold: LotEvidenceLot = { id: "a", lot_code: "OLD", strain_type: "sativa", on_hand_qty: 0 };
  const live: LotEvidenceLot = {
    id: "b",
    lot_code: "L-22",
    strain_type: "indica-hybrid",
    strain_name: "Blue Dream",
    on_hand_qty: 12,
    pos_thc: 24.5,
    pos_cbd: 0.1,
    lab: { lab_name: "Confidence", tested_on: "2025-03-01T00:00:00Z", total_thc_pct: 24.51, total_cbd_pct: 0.08, coa: { terpenes: ["myrcene", "limonene"] } },
  };
  // ordering: owner on-hand rule
  eq(orderLotsForEvidence([sold, live]).map((l) => l.id), ["b", "a"], "in-stock first");
  ok(lotInStock({ on_hand_qty: 1 }) && !lotInStock({ on_hand_qty: 0 }) && !lotInStock({ on_hand_qty: null }), "on hand = at least 1");
  const ev = buildLotEvidence([sold, live]);
  eq(ev.ids, ["lot:1", "coa:1", "lot:2"], "ids in order");
  eq(ev.inStock, 1, "in stock count");
  ok(ev.lines[0]!.startsWith("[lot:1] Lot L-22 (in stock, 12 on hand): strain type indica-hybrid; strain Blue Dream; manifest potency THC 24.5% CBD 0.1%"), "lot line");
  eq(ev.lines[1], "[coa:1] Lab certificate for lot L-22 (Confidence, tested 2025-03-01): total THC 24.51%; total CBD 0.08%; top terpenes (lab-measured): myrcene, limonene", "coa line");
  ok(ev.lines[2]!.includes("(sold out)"), "sold-out lot labelled");
  eq(buildLotEvidence([]).ids, [], "no lots, no evidence");
  eq(buildLotEvidence([{ id: "x", on_hand_qty: 3 }]).ids, [], "a lot with no facts is not offered");
  eq(buildLotEvidence([{ id: "x", strain_type: "unknown" }]).ids, [], "unknown strain type is not a fact");
  eq(buildLotEvidence([{ id: "x", package_thc_mg: 100, pos_potency_unit: "mg" }]).numbers.thc, [{ value: 100, unit: "mg" }], "package mg number");
  eq(buildLotEvidence([1, 2, 3, 4].map((i) => ({ id: String(i), strain_type: "hybrid", on_hand_qty: i }))).ids.length, MAX_EVIDENCE_LOTS, "capped lots");

  // potency check: the model is never trusted with a number
  const c1 = checkPotencyDraft({ thc: "24.5%", cbd: "0.08%" }, ev.numbers);
  eq(potencyText(c1.value), "THC 24.5% · CBD 0.08%", "matching numbers kept");
  eq(c1.dropped, [], "nothing dropped");
  const c2 = checkPotencyDraft({ thc: "27%", cbd: "" }, ev.numbers);
  eq([c2.value.thc, c2.dropped], [null, ["THC 27%"]], "invented THC dropped");
  eq(checkPotencyDraft({ thc: "24.5mg" }, ev.numbers).dropped, ["THC 24.5mg"], "wrong unit dropped");
  ok(checkPotencyDraft({ thc: "24.55%" }, ev.numbers).value.thc !== null, "rounding tolerance");
  eq(checkPotencyDraft({ thc: "100mg" }, { thc: [{ value: 100.4, unit: "mg" }], cbd: [] }).dropped, [], "mg tolerance");

  // text round trip + edits
  eq(parsePotencyText("THC 24.5% · CBD 0.08%"), { ok: true, value: { thc: { value: 24.5, unit: "%" }, cbd: { value: 0.08, unit: "%" } } }, "parse stored");
  eq(parsePotencyText("thc: 100 mg, cbd=5mg").ok && potencyText((parsePotencyText("thc: 100 mg, cbd=5mg") as { value: PotencyPair }).value), "THC 100mg · CBD 5mg", "parse typed");
  ok(!parsePotencyText("very strong").ok, "unreadable refused");
  ok(!parsePotencyText("THC 140%").ok, "over 100% refused");
  eq(parseReading("24.5"), { value: 24.5, unit: "%" }, "bare number defaults to %");
  eq(parseReading("abc"), null, "junk reading");
  eq(posPotencyNumbers("24 %", null), { thc: [{ value: 24, unit: "%" }], cbd: [] }, "POS text numbers");
  eq(
    potencyCardPatch({ thc: { value: 100, unit: "mg" }, cbd: null }),
    { thc: "100mg", total_thc_json: { type: "thc", value: "100", unit: "mg" } },
    "card patch leaves cbd alone",
  );
  return { passed, failed };
}
