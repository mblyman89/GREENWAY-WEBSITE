/**
 * src/lib/inventory/coa-panel-core.ts
 *
 * R28 - what the lot page and the KB product page SHOW about a lab
 * certificate, and the small rules their buttons need. Pure (no I/O) and
 * self-tested on the real certificates in tests/fixtures/coa.
 *
 *   labCertificateView   the stored read (lab_results.coa_extract_json) as
 *                        rows: every cannabinoid (% and mg per serving), every
 *                        detected terpene (ppm), the serving weight, and every
 *                        cross-check with its outcome - nothing hidden
 *   coaFactsView         what the certificate gives THIS product (edibles):
 *                        the filled facts, the notes, the hold reasons
 *   lotFactRows          the facts on the lot right now and WHERE each came
 *                        from (certificate, name, a person...)
 *   safeFactReturnPath   the only pages a facts save may return to
 *   coaRereadCode / coaRereadCopy   the button's outcome banner
 */
import { CANNABINOID_LABELS, type CannabinoidKey } from "@/lib/inventory/wcia-lab-json-core";
import {
  coaProfile,
  deriveCoaDraftFacts,
  readStoredCoaExtract,
  type CoaDraftFacts,
  type CoaExtract,
} from "@/lib/inventory/coa-facts-core";
import type { CoaExtractRun } from "@/lib/inventory/coa-extract-core";
import { MINOR_FACT_KEYS, MINOR_FACT_TYPES, minorMgFromCompounds } from "@/lib/menu/cannabinoid-profile-core";
import { factResultCopy, parseFactResult } from "@/lib/pos/intake-fact-review-core";
import { parseServingLimitCodes, servingLimitBannerText } from "@/lib/compliance/serving-limit-warning-core";

export const LAB_CERT_ANCHOR = "lab-certificate";
export const PRODUCT_FACTS_ANCHOR = "product-facts";

export type CheckRow = { group: "Same certificate" | "PDF agrees with the lab JSON" | "The PDF's own sums"; what: string; ok: boolean; detail: string };

export type LabCertificateView =
  | { state: "no-lab" }
  | { state: "unread"; reason: string }
  | {
      state: "read";
      status: CoaExtract["status"];
      statusLabel: string;
      summary: string;
      extractedAt: string;
      readVia: string;
      jsonUrl: string | null;
      coaUrl: string | null;
      labSampleId: string | null;
      servingWeightG: number | null;
      amended: string | null;
      cannabinoids: { label: string; pct: number; mgPerServing: number | null }[];
      totals: { label: string; value: string }[];
      terpenes: { name: string; ppm: number }[];
      totalTerpenesPpm: number | null;
      checks: CheckRow[];
      failedChecks: number;
      /** Set when the documents do not describe one sample: nothing is used. */
      identityProblem: string | null;
      warnings: string[];
    };

const STATUS_LABEL: Record<CoaExtract["status"], string> = {
  ok: "Read and cross-checked",
  partial: "Partly read",
  failed: "Could not be read",
};

const VIA_LABEL: Record<string, string> = {
  llamaparse: "LlamaParse",
  unpdf: "the PDF's text layer",
  none: "nothing (the PDF was not read)",
};

function label(key: string): string {
  return (CANNABINOID_LABELS as Record<string, string>)[key] ?? key.toUpperCase();
}

/**
 * The stored read as rows. `migrated` false = the columns do not exist yet
 * (0252 not run); a lab row with no stored read is "unread" with the reason.
 */
export function labCertificateView(
  lab: { coa_extract_json?: unknown; coa_extract_status?: string | null; coa_url?: string | null; wcia_json_url?: string | null } | null,
  opts: { migrated: boolean } = { migrated: true },
): LabCertificateView {
  if (!lab) return { state: "no-lab" };
  if (!opts.migrated || !("coa_extract_json" in lab)) {
    return { state: "unread", reason: "The database is missing migration 0252 (lab certificate reading), so certificates are not read yet." };
  }
  const ex = readStoredCoaExtract(lab.coa_extract_json);
  if (!ex) {
    const links = lab.wcia_json_url || lab.coa_url;
    return {
      state: "unread",
      reason: links
        ? "This certificate has not been read yet. It is read when the delivery is finalized - or press Re-read lab certificate."
        : "This lab result carries no certificate link (no lab JSON, no COA PDF), so there is nothing to read.",
    };
  }
  const profile = coaProfile(ex);
  const checks: CheckRow[] = [
    ...ex.identity.map((c) => ({ group: "Same certificate" as const, ...c })),
    ...ex.agreement.map((c) => ({ group: "PDF agrees with the lab JSON" as const, ...c })),
    ...(ex.pdf?.checks ?? []).map((c) => ({ group: "The PDF's own sums" as const, ...c })),
  ];
  const badId = ex.identity.filter((c) => !c.ok);
  // Every cannabinoid: the profile when the documents agree on identity,
  // else the raw PDF / JSON rows are NOT shown as facts (identity failed).
  const cannabinoids = profile
    ? profile.cannabinoids.map((c) => ({ label: label(c.key), pct: c.pct, mgPerServing: c.mgPerServing }))
    : [];
  const totals: { label: string; value: string }[] = [];
  if (profile) {
    const s = ex.pdf?.summary;
    const jt = ex.json?.totals ?? {};
    const pct = (j: number | undefined, p: number | null | undefined) => (j !== undefined ? j : p ?? null);
    const thc = pct(jt["total-thc"], s?.totalThcPct);
    const cbd = pct(jt["total-cbd"], s?.totalCbdPct);
    const all = pct(jt["total-cannabinoids"], s?.totalCannabinoidsPct);
    const mg = (v: number | null | undefined) => (v !== null && v !== undefined ? ` (${v} mg per serving)` : "");
    if (thc !== null) totals.push({ label: "Total THC", value: `${thc}%${mg(s?.totalThcMgPerServing)}` });
    if (cbd !== null) totals.push({ label: "Total CBD", value: `${cbd}%${mg(s?.totalCbdMgPerServing)}` });
    if (all !== null) totals.push({ label: "Total cannabinoids", value: `${all}%` });
  }
  return {
    state: "read",
    status: ex.status,
    statusLabel: STATUS_LABEL[ex.status],
    summary: ex.summary,
    extractedAt: ex.extractedAt,
    readVia: VIA_LABEL[ex.pdfVia ?? "none"] ?? String(ex.pdfVia),
    jsonUrl: ex.jsonUrl,
    coaUrl: ex.coaUrl,
    labSampleId: ex.pdf?.labSampleId ?? ex.json?.labResultId ?? null,
    servingWeightG: profile ? ex.pdf?.servingWeightG ?? null : null,
    amended: ex.pdf?.amended ? ex.pdf.amendmentText ?? "The lab amended this certificate." : null,
    cannabinoids,
    totals,
    terpenes: profile?.terpenes ?? [],
    totalTerpenesPpm: profile?.totalTerpenesPpm ?? null,
    checks,
    failedChecks: checks.filter((c) => !c.ok).length,
    identityProblem: badId.length > 0 ? `The documents do not describe the same sample (${badId.map((c) => c.detail).join("; ")}). Nothing from them is used.` : null,
    warnings: ex.pdf?.warnings ?? [],
  };
}

export type CoaFactsView =
  | { state: "not-dosed" }
  | { state: "none"; reason: string }
  | {
      state: "facts";
      held: boolean;
      rows: { label: string; value: string; how: string }[];
      reasons: string[];
      notes: string[];
    };

/** What the certificate gives THIS product (mg-dosed products only). */
export function coaFactsView(
  lab: { coa_extract_json?: unknown; total_thc_pct?: number | null; total_cbd_pct?: number | null; cbd_pct?: number | null } | null,
  product: { name: string | null; inventoryType: string | null },
): CoaFactsView {
  const ex = lab ? readStoredCoaExtract(lab.coa_extract_json) : null;
  const f: CoaDraftFacts = deriveCoaDraftFacts(ex, {
    name: product.name ?? "",
    inventoryType: product.inventoryType,
    transferTotalThcPct: lab?.total_thc_pct ?? null,
    transferCbdPct: lab?.total_cbd_pct ?? lab?.cbd_pct ?? null,
  });
  if (!f.usable && f.reasons.length === 0) return { state: "not-dosed" };
  if (!f.usable) return { state: "none", reason: f.reasons.join(" ") };
  const rows: { label: string; value: string; how: string }[] = [];
  if (f.servingWeightG !== null) rows.push({ label: "Serving weight", value: `${f.servingWeightG} g`, how: "printed on the COA" });
  if (f.thcMgPerServing) rows.push({ label: "THC per serving", value: `${f.thcMgPerServing.value} mg`, how: f.thcMgPerServing.note });
  if (f.servingsPerPack !== null) rows.push({ label: "Servings per pack", value: String(f.servingsPerPack), how: "pack count written in the name" });
  if (f.packageThcMg) rows.push({ label: "THC per package", value: `${f.packageThcMg.value} mg`, how: f.packageThcMg.note });
  if (f.cbdNotDetected) rows.push({ label: "CBD", value: "not detected", how: "the COA reports CBD below its limit of quantitation" });
  else {
    if (f.cbdMgPerServing) rows.push({ label: "CBD per serving", value: `${f.cbdMgPerServing.value} mg`, how: f.cbdMgPerServing.note });
    if (f.packageCbdMg) rows.push({ label: "CBD per package", value: `${f.packageCbdMg.value} mg`, how: f.packageCbdMg.note });
  }
  for (const m of f.minors) {
    rows.push({
      label: `${m.cannabinoid} per package`,
      value: m.packageMg !== null ? `${m.packageMg} mg` : "-",
      how: `${m.mgPerServing} mg per serving on the COA`,
    });
  }
  return { state: "facts", held: f.reasons.length > 0, rows, reasons: f.reasons, notes: f.notes };
}

/** The facts on the lot (golden record) and where each came from. */
export const FACT_SOURCE_LABEL: Record<string, string> = {
  coa: "lab certificate",
  name: "product name",
  column: "transfer potency column",
  "name+column": "product name + potency column",
  "name-internal": "product name",
  reviewer: "set by a person",
  human: "set by a person",
};

export function lotFactRows(lot: Record<string, unknown>): { label: string; value: string; source: string }[] {
  const prov =
    lot.fact_provenance && typeof lot.fact_provenance === "object" && !Array.isArray(lot.fact_provenance)
      ? (lot.fact_provenance as Record<string, unknown>)
      : {};
  const cols: [string, string, string][] = [
    ["servings_per_pack", "Servings per pack", ""],
    ["mg_per_serving", "Mg per serving", " mg"],
    ["package_thc_mg", "THC per package", " mg"],
    ["package_cbd_mg", "CBD per package", " mg"],
    ["ratio_label", "Ratio", ""],
    ["net_weight_grams", "Net weight", " g"],
    ["net_volume_ml", "Net volume", " ml"],
  ];
  const out: { label: string; value: string; source: string }[] = [];
  for (const [col, lab, unit] of cols) {
    const v = lot[col];
    if (v === null || v === undefined || v === "") continue;
    const p = typeof prov[col] === "string" ? (prov[col] as string) : "";
    out.push({ label: lab, value: `${v}${unit}`, source: p ? FACT_SOURCE_LABEL[p] ?? p : "not recorded" });
  }
  // R29: CBG / CBN / CBC package mg (inventory_lots.minor_cannabinoids_json,
  // mg rows only - never a % row) sit right after THC / CBD, with the
  // array's provenance.
  const minors = minorMgFromCompounds(lot.minor_cannabinoids_json);
  const mp = typeof prov.minor_cannabinoids_json === "string" ? (prov.minor_cannabinoids_json as string) : "";
  const minorRows = MINOR_FACT_KEYS.flatMap((k) => {
    const mg = minors[k];
    if (mg === null) return [];
    return [{ label: `${MINOR_FACT_TYPES[k].toUpperCase()} per package`, value: `${mg} mg`, source: mp ? FACT_SOURCE_LABEL[mp] ?? mp : "not recorded" }];
  });
  if (minorRows.length === 0) return out;
  // After the last THC/CBD-per-package row (or the servings rows when neither is set).
  const order = ["Servings per pack", "Mg per serving", "THC per package", "CBD per package"];
  let at = 0;
  out.forEach((r, i) => {
    if (order.includes(r.label)) at = i + 1;
  });
  out.splice(at, 0, ...minorRows);
  return out;
}

export type LotDraftRow = {
  id: string;
  manifest_id: string | null;
  pos_product_key: string | null;
  status: string | null;
  updated_at: string | null;
  name?: string | null;
  inventory_type?: string | null;
  /** R35: the shelf a person chose at onboarding (0141) - narrows the WAC 314-55-095 warning. */
  chosen_website_category?: string | null;
};

/**
 * The Product Onboarding draft whose saved facts the lot / KB page edits.
 * Only a draft that can carry facts (a delivery + a lot key) and is not
 * dismissed; approved first (it is the one on the menu), then the newest.
 * null = the panel says why it cannot save, never writes to a guess.
 */
export function pickLotDraft(rows: readonly LotDraftRow[]): LotDraftRow | null {
  const usable = rows.filter((r) => r.manifest_id && r.pos_product_key && r.status !== "dismissed");
  if (usable.length === 0) return null;
  const rank = (r: LotDraftRow) => (r.status === "approved" ? 0 : 1);
  return [...usable].sort((a, b) => rank(a) - rank(b) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RETURN_RE = new RegExp(`^/admin/(?:inventory|knowledge-base/products)/${UUID}$`, "i");

/**
 * The only pages a facts save (or a re-read) may return to: a lot page or a
 * KB product page, by id. Anything else (another path, a query, a full URL,
 * //host) is refused - the form is never trusted.
 */
export function safeFactReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return RETURN_RE.test(s) ? s : null;
}

export type CoaRereadCode = "ok" | "partial" | "failed" | "unmigrated" | "nolab" | "error";
export const COA_REREAD_CODES: readonly CoaRereadCode[] = ["ok", "partial", "failed", "unmigrated", "nolab", "error"];

export function coaRereadCode(run: CoaExtractRun): CoaRereadCode {
  if (!run.migrated) return "unmigrated";
  if (run.errors.some((e) => e === "this lot has no lab result")) return "nolab";
  // Most cautious outcome first: one bad read is never reported as "ok".
  if (run.failed > 0) return "failed";
  if (run.partial > 0) return "partial";
  if (run.ok > 0) return "ok";
  return "error";
}

export function parseCoaRereadCode(raw: unknown): CoaRereadCode | null {
  return typeof raw === "string" && (COA_REREAD_CODES as readonly string[]).includes(raw) ? (raw as CoaRereadCode) : null;
}

export function coaRereadCopy(code: CoaRereadCode, restaged: boolean): string {
  const then = restaged ? " The delivery's menu update was rebuilt with what it says." : "";
  switch (code) {
    case "ok":
      return "The lab certificate was read again and every check agrees." + then;
    case "partial":
      return "The lab certificate was read again, but only partly - see what it did and did not give below." + then;
    case "failed":
      return "The lab certificate could not be read - the reasons are below. Set the facts by hand if the lab cannot be reached.";
    case "unmigrated":
      return "Lab certificates cannot be read yet: the database is missing migration 0252 (lab certificate reading).";
    case "nolab":
      return "This lot has no lab result attached, so there is no certificate to read.";
    case "error":
      return "Reading the lab certificate failed. Try again in a minute.";
  }
}

export type PanelBanner = { text: string; tone: "ok" | "warn" | "bad" };

/** The ?coa=...&restaged=1 banner on the lot page (unknown codes: none). */
export function coaRereadBanner(rawCode: unknown, rawRestaged: unknown): PanelBanner | null {
  const code = parseCoaRereadCode(rawCode);
  if (!code) return null;
  const tone: PanelBanner["tone"] = code === "ok" ? "ok" : code === "partial" || code === "nolab" ? "warn" : "bad";
  // coaRereadCopy itself never claims a rebuild for a failed read.
  return { text: coaRereadCopy(code, rawRestaged === "1"), tone };
}

/**
 * The ?fact=... banner after a facts save from the lot / KB page. R35: a
 * successful save over a WAC 314-55-095 limit (?fact_warn=codes) adds the
 * fixed warning wording and turns the banner red - never free URL text.
 */
export function factSaveBanner(rawCode: unknown, rawMsg: unknown, rawWarn?: unknown): PanelBanner | null {
  const code = parseFactResult(rawCode);
  if (!code) return null;
  const tone: PanelBanner["tone"] = code === "published" ? "ok" : code === "error" || code === "migration" ? "bad" : "warn";
  const text = factResultCopy(code, typeof rawMsg === "string" ? rawMsg : null);
  const warn = code === "error" || code === "migration" ? null : servingLimitBannerText(parseServingLimitCodes(rawWarn));
  return warn ? { text: `${text} ${warn}`, tone: "bad" } : { text, tone };
}

const CANNABINOID_KEYS_FOR_TESTS: CannabinoidKey[] = ["d9-thc", "cbd", "cbg", "cbc"];

export function __runCoaPanelCoreTests(fixtures: Record<string, string>, makeExtract: (i: number, text: "unpdf" | "layout") => CoaExtract): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL coa-panel-core: " + msg);
    }
  };
  const transfer = JSON.parse(fixtures["transfer"]) as {
    inventory_transfer_items: { product_name: string; inventory_type: string; lab_result_data: { potency?: { type: string; value: number }[] } }[];
  };
  const items = transfer.inventory_transfer_items;
  const pot = (i: number, t: string) => items[i].lab_result_data.potency?.find((p) => p.type === t)?.value ?? null;
  const stored = (i: number, text: "unpdf" | "layout" = "unpdf") => JSON.parse(JSON.stringify(makeExtract(i, text)));

  // ---- labCertificateView ----
  ok(labCertificateView(null).state === "no-lab", "no lab row");
  const um = labCertificateView({ coa_url: "x" }, { migrated: true });
  ok(um.state === "unread" && um.reason.includes("0252"), "columns absent -> says 0252");
  const um2 = labCertificateView({ coa_extract_json: null, coa_url: "https://certs.conflabs.com/full/x.pdf" }, { migrated: false });
  ok(um2.state === "unread" && um2.reason.includes("0252"), "migrated false -> says 0252");
  const ur = labCertificateView({ coa_extract_json: null, coa_url: "https://certs.conflabs.com/full/x.pdf", wcia_json_url: null });
  ok(ur.state === "unread" && ur.reason.includes("not been read yet"), "has links, not read yet");
  const nl = labCertificateView({ coa_extract_json: null, coa_url: null, wcia_json_url: null });
  ok(nl.state === "unread" && nl.reason.includes("no certificate link"), "no links -> nothing to read");
  const junk = labCertificateView({ coa_extract_json: { version: 99 } });
  ok(junk.state === "unread", "unknown stored version is not shown as a read");

  const v12 = labCertificateView({ coa_extract_json: stored(12), coa_url: "u" });
  ok(v12.state === "read", "item 12 read");
  if (v12.state === "read") {
    ok(v12.status === "ok" && v12.statusLabel === "Read and cross-checked", "status label");
    ok(v12.servingWeightG === 4.54, "serving weight 4.54 g: " + v12.servingWeightG);
    ok(v12.readVia === "the PDF's text layer", "read via: " + v12.readVia);
    ok(v12.identityProblem === null && v12.failedChecks === 0, "no failed checks: " + v12.failedChecks);
    const keys = v12.cannabinoids.map((c) => c.label);
    ok(CANNABINOID_KEYS_FOR_TESTS.every((k) => keys.includes(label(k))), "item 12 cannabinoids listed: " + keys.join(","));
    const thc = v12.cannabinoids.find((c) => c.label === "Delta-9 THC");
    ok(thc?.mgPerServing === 5.5, "d9-THC mg per serving 5.5: " + thc?.mgPerServing);
    ok(v12.totals.some((t) => t.label === "Total THC" && t.value.includes("5.5 mg per serving")), "total THC row: " + JSON.stringify(v12.totals));
    // The lab JSON's exact figure wins over the PDF's rounded one (0.12).
    ok(v12.totals.find((t) => t.label === "Total THC")?.value === "0.1206% (5.5 mg per serving)", "total THC prefers the JSON figure");
    ok(v12.totals.find((t) => t.label === "Total CBD")?.value === "0.2219% (10 mg per serving)", "total CBD prefers the JSON figure");
    ok(v12.totals.find((t) => t.label === "Total cannabinoids")?.value === "0.77%", "total cannabinoids from the PDF when the JSON has none");
    ok(v12.checks.some((c) => c.group === "Same certificate") && v12.checks.some((c) => c.group === "PDF agrees with the lab JSON"), "both check groups shown");
    ok(v12.amended !== null, "item 12 is an amended certificate (shown)");
    ok(v12.labSampleId !== null && /^WA-\d{6}-\d{3}$/.test(v12.labSampleId), "lab sample id: " + v12.labSampleId);
  }
  const v00 = labCertificateView({ coa_extract_json: stored(0), coa_url: "u" });
  ok(v00.state === "read" && v00.terpenes.length > 5 && v00.terpenes[0].ppm >= v00.terpenes[1].ppm, "item 00 terpenes strongest first");
  ok(v00.state === "read" && v00.totalTerpenesPpm !== null, "item 00 total terpenes");
  ok(v00.state === "read" && v00.servingWeightG === null, "flower has no serving weight");

  // A PDF of another sample: identity fails, nothing is shown as a fact.
  const wrong = makeExtract(12, "unpdf");
  const bad = { ...wrong, identity: wrong.identity.map((c, i) => (i === 0 ? { ...c, ok: false, detail: "JSON coa X; transfer coa Y" } : c)), status: "partial" as const };
  const vb = labCertificateView({ coa_extract_json: JSON.parse(JSON.stringify(bad)) });
  ok(vb.state === "read" && vb.identityProblem !== null && vb.identityProblem.includes("JSON coa X") && vb.cannabinoids.length === 0 && vb.terpenes.length === 0 && vb.totals.length === 0, "identity failure -> no figures shown, reason shown");
  ok(vb.state === "read" && vb.servingWeightG === null, "identity failure -> no serving weight");
  ok(vb.state === "read" && vb.failedChecks >= 1 && vb.checks.some((c) => !c.ok && c.group === "Same certificate"), "identity failure counted and shown as a failed check");

  // GGL text layer: partial + the reason in the summary.
  const v01 = labCertificateView({ coa_extract_json: stored(1, "unpdf") });
  ok(v01.state === "read" && v01.status === "partial" && v01.statusLabel === "Partly read", "GGL text layer -> partly read");

  // ---- coaFactsView ----
  const lab12 = { coa_extract_json: stored(12), total_thc_pct: pot(12, "total-thc"), total_cbd_pct: pot(12, "total-cbd"), cbd_pct: null };
  const f12 = coaFactsView(lab12, { name: items[12].product_name, inventoryType: items[12].inventory_type });
  ok(f12.state === "facts" && !f12.held, "item 12 facts, not held");
  if (f12.state === "facts") {
    const row = (l: string) => f12.rows.find((r) => r.label === l)?.value;
    ok(row("THC per package") === "55 mg" && row("Servings per pack") === "10" && row("Serving weight") === "4.54 g", "item 12 rows: " + JSON.stringify(f12.rows));
    ok(row("CBD per package") === "100 mg" && row("CBG per package") === "100 mg" && row("CBC per package") === "95 mg", "item 12 CBD/minors");
    ok(f12.notes.some((n) => n.includes("ratio is nominal")), "ratio note shown");
  }
  const f13 = coaFactsView({ coa_extract_json: stored(13), total_thc_pct: pot(13, "total-thc"), total_cbd_pct: pot(13, "total-cbd"), cbd_pct: null }, { name: items[13].product_name, inventoryType: items[13].inventory_type });
  ok(f13.state === "facts" && f13.held && f13.reasons.some((r) => r.includes("100 mg")), "item 13 held by the 100 mg package limit");
  ok(f13.state === "facts" && f13.rows.some((r) => r.label === "CBD" && r.value === "not detected"), "item 13 CBD not detected row");
  // No lab JSON: the transfer CBD percent (total_cbd_pct, else cbd_pct) is the second figure.
  const e12 = makeExtract(12, "unpdf");
  const pdfOnly = JSON.parse(JSON.stringify({ ...e12, json: null, agreement: [] }));
  const cbdHow = (l: { total_cbd_pct: number | null; cbd_pct: number | null }) => {
    const v = coaFactsView({ coa_extract_json: pdfOnly, total_thc_pct: pot(12, "total-thc"), ...l }, { name: items[12].product_name, inventoryType: items[12].inventory_type });
    return v.state === "facts" ? v.rows.find((r) => r.label === "CBD per serving")?.how ?? "" : "";
  };
  ok(cbdHow({ total_cbd_pct: 0.2219, cbd_pct: null }).includes("0.2219%"), "PDF only: total_cbd_pct confirms CBD");
  ok(cbdHow({ total_cbd_pct: null, cbd_pct: 0.2219 }).includes("0.2219%"), "PDF only: cbd_pct fallback confirms CBD");
  ok(cbdHow({ total_cbd_pct: null, cbd_pct: null }).includes("no second figure"), "PDF only, no transfer CBD -> unconfirmed");
  ok(coaFactsView(lab12, { name: items[0].product_name, inventoryType: "Usable Marijuana" }).state === "not-dosed", "flower -> not dosed");
  const fn = coaFactsView(null, { name: items[12].product_name, inventoryType: "Solid Edible" });
  ok(fn.state === "none" && fn.reason.includes("not been read"), "edible with no read -> says so");
  const fb = coaFactsView({ coa_extract_json: JSON.parse(JSON.stringify(bad)), total_thc_pct: 0.12, total_cbd_pct: null, cbd_pct: null }, { name: items[12].product_name, inventoryType: "Solid Edible" });
  ok(fb.state === "none" && fb.reason.includes("do not describe the same sample"), "identity failure -> no facts");

  // ---- lotFactRows ----
  const rows = lotFactRows({ servings_per_pack: 10, package_thc_mg: 55, mg_per_serving: null, ratio_label: "", net_weight_grams: 50, fact_provenance: { servings_per_pack: "name", package_thc_mg: "coa", net_weight_grams: "reviewer" } });
  ok(rows.length === 3, "nulls and blanks skipped: " + rows.length);
  ok(rows[0].label === "Servings per pack" && rows[0].source === "product name", "name provenance");
  ok(rows[1].value === "55 mg" && rows[1].source === "lab certificate", "coa provenance");
  ok(rows[2].source === "set by a person", "reviewer provenance");
  ok(lotFactRows({ package_thc_mg: 5, fact_provenance: "junk" })[0].source === "not recorded", "bad provenance -> not recorded");
  ok(lotFactRows({ package_thc_mg: 5, fact_provenance: { package_thc_mg: "weird" } })[0].source === "weird", "unknown provenance shown as stored");
  {
    const mr = lotFactRows({
      servings_per_pack: 10, package_thc_mg: 55, package_cbd_mg: 100, ratio_label: "2:2:2:1 CBG:CBC:CBD:THC", net_weight_grams: 50,
      minor_cannabinoids_json: [{ type: "cbc", value: "95", unit: "mg" }, { type: "cbg", value: "100", unit: "mg" }, { type: "cbn", value: "0.4", unit: "%" }],
      fact_provenance: { minor_cannabinoids_json: "coa" },
    });
    const labels = mr.map((r) => r.label).join("|");
    ok(labels === "Servings per pack|THC per package|CBD per package|CBG per package|CBC per package|Ratio|Net weight", "R29: minors after CBD, fixed CBG/CBN/CBC order, % rows ignored: " + labels);
    ok(mr[3].value === "100 mg" && mr[3].source === "lab certificate" && mr[4].value === "95 mg", "R29: minor values + provenance");
    const only = lotFactRows({ minor_cannabinoids_json: [{ type: "cbn", value: "50", unit: "mg" }] });
    ok(only.length === 1 && only[0].label === "CBN per package" && only[0].source === "not recorded", "R29: minor alone, provenance not recorded");
    ok(lotFactRows({ minor_cannabinoids_json: "junk" }).length === 0 && lotFactRows({ minor_cannabinoids_json: [] }).length === 0, "R29: junk / empty minors -> nothing");
  }

  // ---- pickLotDraft ----
  const dr = (id: string, status: string, updated: string, m: string | null = "m1", k: string | null = "k1"): LotDraftRow => ({ id, manifest_id: m, pos_product_key: k, status, updated_at: updated });
  ok(pickLotDraft([]) === null, "no drafts -> null");
  ok(pickLotDraft([dr("a", "draft", "2026-01-02"), dr("b", "approved", "2026-01-01")])?.id === "b", "approved wins over a newer draft");
  ok(pickLotDraft([dr("a", "draft", "2026-01-01"), dr("b", "draft", "2026-01-03")])?.id === "b", "newest among equals");
  ok(pickLotDraft([dr("a", "approved", "2026-01-01"), dr("b", "approved", "2026-01-05")])?.id === "b", "newest approved");
  ok(pickLotDraft([dr("a", "dismissed", "2026-01-09")]) === null, "a dismissed draft is never edited");
  ok(pickLotDraft([dr("a", "approved", "2026-01-09", null), dr("b", "approved", "2026-01-09", "m", null)]) === null, "no delivery or no lot key -> cannot carry facts");
  ok(pickLotDraft([dr("a", "approved", "2026-01-09", null), dr("c", "draft", "2026-01-01")])?.id === "c", "the unusable approved one is skipped");

  // ---- safeFactReturnPath ----
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  ok(safeFactReturnPath(`/admin/inventory/${id}`) === `/admin/inventory/${id}`, "lot page allowed");
  ok(safeFactReturnPath(` /admin/knowledge-base/products/${id.toUpperCase()} `) === `/admin/knowledge-base/products/${id.toUpperCase()}`, "KB page allowed (trimmed)");
  for (const badPath of [
    `/admin/inventory/${id}?x=1`,
    `/admin/inventory/${id}#coa`,
    `//evil.example/admin/inventory/${id}`,
    `https://evil.example/admin/inventory/${id}`,
    `/admin/inventory/not-a-uuid`,
    `/admin/inventory/${id}/../../settings`,
    `/admin/settings`,
    `/admin/settings/${id}`,
    `/admin/inventory/drafts/${id}`,
    `/admin/knowledge-base/products`,
    "",
  ]) ok(safeFactReturnPath(badPath) === null, "refused " + badPath);
  ok(safeFactReturnPath(null) === null && safeFactReturnPath(42) === null, "non-strings refused");

  // ---- reread codes ----
  const base: CoaExtractRun = { migrated: true, pending: 1, deferred: 0, read: 1, ok: 0, partial: 0, failed: 0, kbFilled: 0, errors: [] };
  ok(coaRereadCode({ ...base, ok: 1 }) === "ok", "ok");
  ok(coaRereadCode({ ...base, partial: 1 }) === "partial", "partial");
  ok(coaRereadCode({ ...base, failed: 1 }) === "failed", "failed");
  ok(coaRereadCode({ ...base, migrated: false }) === "unmigrated", "unmigrated");
  ok(coaRereadCode({ ...base, read: 0, pending: 0, errors: ["this lot has no lab result"] }) === "nolab", "nolab");
  ok(coaRereadCode({ ...base, read: 0, errors: ["update failed"] }) === "error", "write error");
  ok(coaRereadCode({ ...base, read: 0 }) === "error", "nothing happened -> error, never ok");
  ok(coaRereadCode({ ...base, read: 2, ok: 1, partial: 1 }) === "partial", "mixed ok+partial -> partial (never claims all agree)");
  ok(coaRereadCode({ ...base, read: 2, partial: 1, failed: 1 }) === "failed", "mixed partial+failed -> failed");
  ok(coaRereadCode({ ...base, ok: 1, errors: ["kb fill: x"] }) === "ok", "a side error after a good read keeps ok");
  ok(parseCoaRereadCode("ok") === "ok" && parseCoaRereadCode("evil") === null && parseCoaRereadCode(undefined) === null, "parse codes");
  for (const c of COA_REREAD_CODES) ok(coaRereadCopy(c, false).length > 20, "copy for " + c);
  ok(coaRereadCopy("ok", true).includes("rebuilt") && !coaRereadCopy("ok", false).includes("rebuilt"), "restage sentence only when restaged");
  ok(!coaRereadCopy("failed", true).includes("rebuilt"), "a failed read never claims a rebuild");
  ok(coaRereadBanner(undefined, undefined) === null && coaRereadBanner("<script>", "1") === null, "no / unknown code -> no banner");
  const bOk = coaRereadBanner("ok", "1");
  ok(bOk?.tone === "ok" && bOk.text.includes("rebuilt"), "ok + restaged banner");
  ok(coaRereadBanner("ok", "0")?.text.includes("rebuilt") === false, "restaged must be exactly 1");
  ok(coaRereadBanner("partial", undefined)?.tone === "warn" && coaRereadBanner("nolab", undefined)?.tone === "warn", "partial / nolab warn");
  ok(coaRereadBanner("failed", "1")?.tone === "bad" && !coaRereadBanner("failed", "1")!.text.includes("rebuilt"), "failed is bad, never rebuilt");
  ok(coaRereadBanner("unmigrated", undefined)?.tone === "bad" && coaRereadBanner("error", undefined)?.tone === "bad", "unmigrated / error bad");
  ok(factSaveBanner(undefined, undefined) === null && factSaveBanner("nope", "x") === null, "no / unknown fact code -> no banner");
  ok(factSaveBanner("published", undefined)?.tone === "ok", "published -> ok");
  ok(factSaveBanner("error", "  the lot was not updated ")?.text === "the lot was not updated" && factSaveBanner("error", null)?.tone === "bad", "error shows the message");
  ok(factSaveBanner("migration", undefined)?.tone === "bad" && factSaveBanner("held", undefined)?.tone === "warn" && factSaveBanner("saved", undefined)?.tone === "warn", "migration bad; held/saved warn");
  // R35: WAC 314-55-095 save-with-warning banner (codes only, fixed words).
  const warned = factSaveBanner("published", undefined, "serving_over_limit");
  ok(warned?.tone === "bad" && (warned?.text ?? "").includes("WAC 314-55-095(1)(a)") && (warned?.text ?? "").startsWith("Saved"), "R35: over-limit save -> red banner citing (1)(a)");
  ok(factSaveBanner("published", undefined, "<b>hi</b>")?.tone === "ok" && factSaveBanner("error", "x", "package_over_limit")?.text === "x", "R35: junk codes ignored; an error never claims a save");

  return { passed, failed };
}
