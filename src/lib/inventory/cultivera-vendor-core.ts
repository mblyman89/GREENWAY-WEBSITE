/**
 * src/lib/inventory/cultivera-vendor-core.ts   (R74 S11, round 7)
 *
 * Owner (round 7, verbatim): "i want to see the manifests in full in the
 * receiving table under the cultivera tab. i want to see the manifests in
 * onboarding, grouped or groupable by vendor. i want to see gemini telling me
 * it can lookup all products from a vendor. ... i want to see the onboard page
 * showing me all the mastering it is doing to the products. i want to see the
 * coas being attached and the facts from them getting attached to the
 * products."
 *
 * PURE. Everything the by-vendor views and the two by-vendor buttons decide:
 *
 *   sourceOfGroupKind      raw_payload.group_kind -> where the manifest came
 *                          from (Cultivera transfer / emailed manifest / the
 *                          ONE unmatched manifest / received-date group);
 *                          an unknown kind is "unknown", never guessed
 *   groupByVendor          rows -> one roll-up per vendor (manifests, lots,
 *                          not started / in review / done / unknown, products
 *                          waiting in review), vendors with work first
 *   rowsForVendor          the rows of ONE vendor (same key as the roll-up)
 *   pickVendorStartTargets which manifests "Start every manifest" works,
 *                          in a stable order after a resume cursor
 *   vendorStartNote        the one sentence after a by-vendor Start press
 *   vendorLookupNote       the one sentence after "Look up all products"
 *   masteringSummary       what onboarding has attached to a vendor's
 *                          products: knowledge-base links and facts by source
 *                          (lab certificate, Cultivera, Gemini, remembered,
 *                          a person), lots linked to a lab result
 *   masteringEventLabel    plain words for the timeline events onboarding
 *                          writes (so the activity feed reads like a log)
 *
 * Vendor identity is the vendor LABEL on the rebuilt manifest, compared with
 * the shared normalizeVendorKey (case, "&", apostrophes and spacing do not
 * split a vendor). A manifest with no vendor label is "Unknown vendor": it is
 * listed on its own and never merged into a named vendor.
 *
 * No I/O. Self-tests at the bottom (scripts/compliance/run-pure-selftests.ts).
 */
import { normalizeVendorKey } from "@/lib/inventory/vendor-resolve-core";
import type { CultiveraRowView } from "@/lib/inventory/cultivera-onboarding-core";

// --- 1. Where a rebuilt manifest came from -----------------------------------

export type CultiveraSource = "transfer" | "email" | "unmatched" | "received" | "unknown";

/**
 * raw_payload.group_kind values the rebuild writes:
 *   transfer                       the Cultivera transfer match (R50 S8 / R74)
 *   email                          a vendor's emailed manifest (R74 S10)
 *   unmatched                      the ONE CV-UNMATCHED manifest (R74 S10)
 *   session | day | undated        the received-date grouping (R50 S2)
 */
export function sourceOfGroupKind(kind: unknown): CultiveraSource {
  const k = typeof kind === "string" ? kind.trim() : "";
  if (k === "transfer") return "transfer";
  if (k === "email") return "email";
  if (k === "unmatched") return "unmatched";
  if (k === "session" || k === "day" || k === "undated") return "received";
  return "unknown";
}

export const SOURCE_LABEL: Record<CultiveraSource, string> = {
  transfer: "Cultivera transfer",
  email: "Emailed manifest",
  unmatched: "Unmatched stock",
  received: "Received-date group",
  unknown: "Not recorded",
};

export const SOURCE_HELP: Record<CultiveraSource, string> = {
  transfer: "Matched to the vendor's own Cultivera transfer (its WCIA file).",
  email: "Rebuilt from the vendor's manifest found in the stephen@ mailbox.",
  unmatched: "The one manifest holding every lot no transfer or email could place.",
  received: "Grouped by the day Cultivera received the lots (no transfer or email matched yet).",
  unknown: "This manifest does not say how it was rebuilt.",
};

export const SOURCE_FILTERS: readonly { value: CultiveraSource; label: string }[] = [
  { value: "transfer", label: SOURCE_LABEL.transfer },
  { value: "email", label: SOURCE_LABEL.email },
  { value: "unmatched", label: SOURCE_LABEL.unmatched },
  { value: "received", label: SOURCE_LABEL.received },
  { value: "unknown", label: SOURCE_LABEL.unknown },
];

/** A source filter value from the URL, or "" (any). */
export function parseSourceFilter(v: unknown): CultiveraSource | "" {
  const s = typeof v === "string" ? v.trim() : Array.isArray(v) && typeof v[0] === "string" ? v[0].trim() : "";
  return SOURCE_FILTERS.some((f) => f.value === s) ? (s as CultiveraSource) : "";
}

// --- 2. Vendor roll-up -------------------------------------------------------

export const UNKNOWN_VENDOR = "Unknown vendor";

/** The vendor key a row groups under. Blank / "Unknown vendor" -> "" (its own group). */
export function vendorKeyOf(label: unknown): string {
  const t = typeof label === "string" ? label.trim() : "";
  if (!t || t === UNKNOWN_VENDOR) return "";
  return normalizeVendorKey(t);
}

export type VendorRollup = {
  key: string;
  /** The label as first seen (A to Z of the labels seen, so stable). */
  vendor: string;
  manifests: number;
  lots: number;
  notStarted: number;
  inReview: number;
  done: number;
  unknown: number;
  /** Products waiting in review on this vendor's manifests (what Gemini can look up). */
  productsInReview: number;
  approved: number;
  /** Manifest ids, in the order the rows came. */
  ids: string[];
};

type RollupRow = Pick<CultiveraRowView, "id" | "vendor" | "lots" | "state" | "inReview" | "approved"> & {
  completion?: "complete" | "not_complete" | "unknown";
};

/**
 * One roll-up per vendor. `tallyRead=false` (the onboarding counts could not
 * be read) marks every manifest unknown and every count of products waiting
 * as 0 - the page then hides the lookup button rather than promise a number.
 * Order: vendors with manifests not done first (most not-done first), then
 * A to Z; the unknown-vendor group is always last.
 */
export function groupByVendor(rows: readonly RollupRow[], tallyRead = true): VendorRollup[] {
  const by = new Map<string, VendorRollup & { labels: string[] }>();
  for (const r of rows) {
    const key = vendorKeyOf(r.vendor);
    const label = key ? r.vendor.trim() : UNKNOWN_VENDOR;
    let g = by.get(key);
    if (!g) {
      g = { key, vendor: label, labels: [], manifests: 0, lots: 0, notStarted: 0, inReview: 0, done: 0, unknown: 0, productsInReview: 0, approved: 0, ids: [] };
      by.set(key, g);
    }
    if (!g.labels.includes(label)) g.labels.push(label);
    g.manifests += 1;
    g.lots += typeof r.lots === "number" && Number.isFinite(r.lots) && r.lots > 0 ? r.lots : 0;
    g.ids.push(r.id);
    const unknown = !tallyRead || r.completion === "unknown";
    if (unknown) g.unknown += 1;
    else if (r.state === "not_started") g.notStarted += 1;
    else if (r.state === "in_review") g.inReview += 1;
    else g.done += 1;
    if (!unknown) {
      g.productsInReview += Math.max(0, r.inReview | 0);
      g.approved += Math.max(0, r.approved | 0);
    }
  }
  const out: VendorRollup[] = [];
  for (const g of by.values()) {
    const labels = [...g.labels].sort((a, b) => a.localeCompare(b, "en-US", { sensitivity: "base" }));
    const { labels: _drop, ...rest } = g;
    void _drop;
    out.push({ ...rest, vendor: g.key ? labels[0] : UNKNOWN_VENDOR });
  }
  const open = (g: VendorRollup) => g.notStarted + g.inReview;
  return out.sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    const d = open(b) - open(a);
    if (d !== 0) return d;
    return a.vendor.localeCompare(b.vendor, "en-US", { sensitivity: "base" });
  });
}

/** The rows of one vendor (same key as groupByVendor). A blank wanted key = the unknown-vendor group. */
export function rowsForVendor<T extends { vendor: string }>(rows: readonly T[], vendor: string): T[] {
  const want = vendorKeyOf(vendor);
  return rows.filter((r) => vendorKeyOf(r.vendor) === want);
}

/** A vendor filter from the URL: trimmed, at most 120 characters, or "". */
export function parseVendorParam(v: unknown): string {
  const s = typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";
  return s.trim().slice(0, 120);
}

// --- 3. "Start every manifest from this vendor" -------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Time budget of one by-vendor Start press (the drafts page allows 300 s). */
export const VENDOR_START_BUDGET_MS = 200_000;
/** A Start runs the certificate read with a 60 s budget; never start one with less than this left. */
export const VENDOR_START_MIN_LEFT_MS = 75_000;
export const VENDOR_START_AUDIT = "cultivera_onboarding.vendor_started";
export const VENDOR_LOOKUP_AUDIT = "catalog_draft.vendor_lookup_enqueued";

/** A resume cursor (a manifest uuid, lower case) or null = from the start. */
export function parseVendorCursor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

export function vendorStartCanContinue(elapsedMs: number, budgetMs: number = VENDOR_START_BUDGET_MS): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return budgetMs - elapsedMs >= VENDOR_START_MIN_LEFT_MS;
}

/**
 * Which of a vendor's manifests one press works, in id order after `cursor`.
 * Default: the ones not started or still in review (Start is re-runnable and
 * picks up products and facts it missed). `includeDone` also re-runs the done
 * ones (a full refresh). Unknown state (counts unread) is never skipped as
 * "done" - it is worked, because Start is idempotent and that is the safe
 * side of not knowing.
 */
export function pickVendorStartTargets(
  rows: readonly { id: string; state: CultiveraRowView["state"]; known?: boolean }[],
  cursor: string | null,
  includeDone = false,
): string[] {
  const after = cursor ? cursor.toLowerCase() : null;
  return rows
    .filter((r) => UUID_RE.test(r.id))
    .filter((r) => includeDone || r.known === false || r.state !== "done")
    .map((r) => r.id.toLowerCase())
    .filter((id, i, all) => all.indexOf(id) === i)
    .sort()
    .filter((id) => after === null || id > after);
}

export type VendorStartRun = {
  vendor: string;
  planned: number;
  started: number;
  seeded: number;
  failed: number;
  errors: string[];
  /** Last manifest id finished (resume from here), or null when nothing ran. */
  next: string | null;
  done: boolean;
};

export function vendorStartNote(r: VendorStartRun): string {
  if (r.planned === 0) return `${r.vendor}: every manifest is already done. Nothing to start.`;
  const head = `${r.vendor}: started ${r.started} of ${r.planned} manifest${r.planned === 1 ? "" : "s"}, ${r.seeded} new onboarding row${r.seeded === 1 ? "" : "s"}`;
  const fail = r.failed > 0 ? `; ${r.failed} could not start (${r.errors.slice(0, 2).join("; ")})` : "";
  const tail = r.done ? ". All of this vendor's manifests have been run." : `. ${r.planned - r.started - r.failed} left: press Continue to keep going.`;
  return `${head}${fail}${tail}`;
}

// --- 4. "Look up all products from this vendor" -------------------------------

export type VendorLookupOutcome =
  | { kind: "created"; total: number; truncated: number }
  | { kind: "exists" }
  | { kind: "nothing" }
  | { kind: "error"; message: string };

export type VendorLookupRun = {
  vendor: string;
  manifests: number;
  created: number;
  queuedProducts: number;
  truncated: number;
  alreadyRunning: number;
  nothing: number;
  errors: string[];
};

export function tallyVendorLookup(vendor: string, outcomes: readonly VendorLookupOutcome[]): VendorLookupRun {
  const r: VendorLookupRun = { vendor, manifests: outcomes.length, created: 0, queuedProducts: 0, truncated: 0, alreadyRunning: 0, nothing: 0, errors: [] };
  for (const o of outcomes) {
    if (o.kind === "created") {
      r.created += 1;
      r.queuedProducts += Math.max(0, o.total | 0);
      r.truncated += Math.max(0, o.truncated | 0);
    } else if (o.kind === "exists") r.alreadyRunning += 1;
    else if (o.kind === "nothing") r.nothing += 1;
    else r.errors.push(o.message);
  }
  return r;
}

export function vendorLookupNote(r: VendorLookupRun): string {
  if (r.manifests === 0) return `${r.vendor}: no manifests to look up.`;
  const parts: string[] = [];
  if (r.created > 0)
    parts.push(`Gemini is looking up ${r.queuedProducts} product${r.queuedProducts === 1 ? "" : "s"} across ${r.created} manifest${r.created === 1 ? "" : "s"}`);
  if (r.alreadyRunning > 0) parts.push(`${r.alreadyRunning} manifest${r.alreadyRunning === 1 ? " was" : "s were"} already being looked up`);
  if (r.nothing > 0) parts.push(`${r.nothing} had nothing left to look up`);
  if (r.truncated > 0) parts.push(`${r.truncated} more wait for the next press (one manifest holds at most the batch limit)`);
  if (r.errors.length > 0) parts.push(`${r.errors.length} could not be queued (${r.errors.slice(0, 2).join("; ")})`);
  return `${r.vendor}: ${parts.join("; ") || "nothing was queued"}. Results land on each product as they finish (every minute, in the background); each answer is saved to the knowledge base for reuse.`;
}

// --- 5. Mastering summary ----------------------------------------------------

export type MasteringDraft = {
  status: unknown;
  kb_product_id: unknown;
  attached_facts: unknown;
};

export type MasteringSummary = {
  drafts: number;
  inReview: number;
  approved: number;
  dismissed: number;
  linkedToKb: number;
  /** Drafts with at least one fact from each source. */
  withCoa: number;
  withCultivera: number;
  withGemini: number;
  withRemembered: number;
  withKb: number;
  withHuman: number;
  /** Total facts attached, all sources. */
  facts: number;
  /** Facts per field (description, effects, terpenes, potency, ...), most first. */
  byField: { field: string; count: number }[];
};

export function masteringSummary(drafts: readonly MasteringDraft[]): MasteringSummary {
  const s: MasteringSummary = {
    drafts: 0,
    inReview: 0,
    approved: 0,
    dismissed: 0,
    linkedToKb: 0,
    withCoa: 0,
    withCultivera: 0,
    withGemini: 0,
    withRemembered: 0,
    withKb: 0,
    withHuman: 0,
    facts: 0,
    byField: [],
  };
  const fields = new Map<string, number>();
  for (const d of drafts) {
    s.drafts += 1;
    if (d.status === "draft") s.inReview += 1;
    else if (d.status === "approved") s.approved += 1;
    else if (d.status === "dismissed") s.dismissed += 1;
    if (typeof d.kb_product_id === "string" && d.kb_product_id) s.linkedToKb += 1;
    const f = d.attached_facts && typeof d.attached_facts === "object" && !Array.isArray(d.attached_facts) ? (d.attached_facts as Record<string, unknown>) : {};
    const sources = new Set<string>();
    for (const [field, v] of Object.entries(f)) {
      const src = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>).source : null;
      if (typeof src !== "string") continue;
      s.facts += 1;
      fields.set(field, (fields.get(field) ?? 0) + 1);
      sources.add(src);
    }
    if (sources.has("coa")) s.withCoa += 1;
    if (sources.has("cultivera")) s.withCultivera += 1;
    if (sources.has("gemini")) s.withGemini += 1;
    if (sources.has("remembered")) s.withRemembered += 1;
    if (sources.has("kb_published") || sources.has("kb_draft")) s.withKb += 1;
    if (sources.has("human")) s.withHuman += 1;
  }
  s.byField = [...fields.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
  return s;
}

export type LabCoverage = { lots: number; withLab: number; withCertificate: number };

/** "12 of 30 lots linked to a lab result, 9 with the certificate file kept". */
export function labCoverageLine(c: LabCoverage | null): string {
  if (!c) return "Lab links could not be read.";
  if (c.lots === 0) return "No lots on these manifests.";
  return `${c.withLab} of ${c.lots} lot${c.lots === 1 ? "" : "s"} linked to a lab result, ${c.withCertificate} with the certificate file kept.`;
}

/** Timeline event types onboarding writes, in plain words. Unknown types keep their own name. */
export const MASTERING_EVENT_LABEL: Record<string, string> = {
  cultivera_onboarding: "Onboarding run",
  cultivera_vendor_lab_results: "Vendor lab results attached",
  lab_facts_attach: "Facts from lab certificates",
  coa_extract: "Lab certificates read",
};
export const MASTERING_EVENT_TYPES: readonly string[] = Object.keys(MASTERING_EVENT_LABEL);

export function masteringEventLabel(type: unknown): string {
  const t = typeof type === "string" ? type : "";
  return MASTERING_EVENT_LABEL[t] ?? (t || "Event");
}

// --- 5b. Result banners of the two by-vendor buttons ---------------------------

export type VendorBannerTone = "good" | "warn" | "bad";
export type VendorBanner = { tone: VendorBannerTone; text: string };

const VENDOR_START_CODES = ["ok", "warn", "error"] as const;
const VENDOR_LOOKUP_CODES = ["ok", "warn", "nothing", "migration", "error"] as const;

/** Banner after "Start every manifest from <vendor>"; an unknown code shows nothing. */
export function vendorStartBanner(code: unknown, msg: unknown): VendorBanner | null {
  const c = typeof code === "string" ? code : "";
  if (!(VENDOR_START_CODES as readonly string[]).includes(c)) return null;
  const m = typeof msg === "string" ? msg.trim().slice(0, 700) : "";
  if (c === "error") return { tone: "bad", text: `Could not start this vendor's manifests: ${m || "unknown error"}. Nothing was changed on the menu.` };
  return { tone: c === "warn" ? "warn" : "good", text: m || "Done." };
}

/** Banner after "Look up all products from <vendor>"; an unknown code shows nothing. */
export function vendorLookupBanner(code: unknown, msg: unknown): VendorBanner | null {
  const c = typeof code === "string" ? code : "";
  if (!(VENDOR_LOOKUP_CODES as readonly string[]).includes(c)) return null;
  const m = typeof msg === "string" ? msg.trim().slice(0, 700) : "";
  if (c === "migration") return { tone: "bad", text: "The batch lookup tables are not set up yet (migration missing). Nothing was queued." };
  if (c === "error") return { tone: "bad", text: `Gemini lookups could not be queued: ${m || "unknown error"}.` };
  if (c === "nothing") return { tone: "warn", text: m || "Nothing to look up: start the vendor's manifests first, so their products are in review." };
  return { tone: c === "warn" ? "warn" : "good", text: m || "Queued." };
}

/** Plain words for an attached-fact source (the mastering panel). */
export const FACT_SOURCE_LABEL: Record<string, string> = {
  coa: "Lab certificate",
  cultivera: "Cultivera",
  gemini: "Gemini (web)",
  remembered: "Remembered (earlier lookups)",
  kb_published: "Knowledge base",
  kb_draft: "Knowledge base (draft)",
  human: "A person",
  manifest: "Manifest",
};

// --- 6. Self-tests -----------------------------------------------------------

export function __runCultiveraVendorCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL cultivera-vendor-core: " + m);
    }
  };

  // sources
  ok(sourceOfGroupKind("transfer") === "transfer", "transfer");
  ok(sourceOfGroupKind("email") === "email" && sourceOfGroupKind(" email ") === "email", "email (trimmed)");
  ok(sourceOfGroupKind("unmatched") === "unmatched", "unmatched");
  ok(["session", "day", "undated"].every((k) => sourceOfGroupKind(k) === "received"), "received-date kinds");
  ok(sourceOfGroupKind("Email") === "unknown" && sourceOfGroupKind(null) === "unknown" && sourceOfGroupKind(3) === "unknown", "unknown never guessed");
  ok(Object.keys(SOURCE_LABEL).length === 5 && SOURCE_FILTERS.length === 5, "five sources, five filters");
  ok(parseSourceFilter("email") === "email" && parseSourceFilter(["unmatched"]) === "unmatched", "source filter parse");
  ok(parseSourceFilter("EMAIL") === "" && parseSourceFilter("x") === "" && parseSourceFilter(undefined) === "", "bad source filter = any");

  // vendor keys
  ok(vendorKeyOf("  Ace & Co ") === vendorKeyOf("ace and co"), "& and case join");
  ok(vendorKeyOf("Seattle's Best") === vendorKeyOf("Seattles Best"), "apostrophe joins");
  ok(vendorKeyOf("") === "" && vendorKeyOf(UNKNOWN_VENDOR) === "" && vendorKeyOf(null) === "", "blank / unknown = own group");

  // roll-up
  const R = (id: string, vendor: string, state: CultiveraRowView["state"], lots: number | null, inReview = 0, approved = 0, completion?: "complete" | "not_complete" | "unknown") => ({
    id,
    vendor,
    state,
    lots,
    inReview,
    approved,
    completion,
  });
  const rows = [
    R("1", "Ace & Co", "not_started", 5),
    R("2", "ace and co", "in_review", 3, 4, 1),
    R("3", "Zed Farms", "done", 2, 0, 2),
    R("4", UNKNOWN_VENDOR, "not_started", 1),
    R("5", "Bee Gardens", "in_review", null, 7),
    R("6", "Ace & Co", "done", 10, 0, 3),
  ];
  const g = groupByVendor(rows);
  ok(g.length === 4, "four groups (Ace merged)");
  ok(g[0].key === vendorKeyOf("Ace & Co") && g[0].manifests === 3 && g[0].lots === 18, "Ace first (2 open), lots summed");
  ok(g[0].notStarted === 1 && g[0].inReview === 1 && g[0].done === 1 && g[0].productsInReview === 4 && g[0].approved === 4, "Ace counts");
  ok(g[0].vendor === "Ace & Co", "label = first A-Z label");
  ok(g[1].vendor === "Bee Gardens" && g[1].lots === 0 && g[1].productsInReview === 7, "Bee second; null lots = 0");
  ok(g[2].vendor === "Zed Farms" && g[2].done === 1, "Zed (nothing open) after");
  ok(g[3].key === "" && g[3].vendor === UNKNOWN_VENDOR, "unknown vendor last");
  ok(g[0].ids.join(",") === "1,2,6", "ids in row order");
  const gu = groupByVendor(rows, false);
  ok(gu.every((x) => x.unknown === x.manifests && x.productsInReview === 0), "tally unread: all unknown, no product count promised");
  const gc = groupByVendor([R("1", "A", "in_review", 1, 3, 0, "unknown")]);
  ok(gc[0].unknown === 1 && gc[0].inReview === 0 && gc[0].productsInReview === 0, "row-level unknown");
  ok(groupByVendor([]).length === 0, "empty");
  ok(rowsForVendor(rows, "ACE AND CO").map((r) => r.id).join(",") === "1,2,6", "rowsForVendor uses the same key");
  ok(rowsForVendor(rows, "").map((r) => r.id).join(",") === "4", "blank = unknown-vendor group");
  ok(parseVendorParam("  Ace  ") === "Ace" && parseVendorParam(["B"]) === "B" && parseVendorParam(5) === "" && parseVendorParam("x".repeat(200)).length === 120, "vendor param");

  // start targets
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const st = [
    { id: U(3), state: "done" as const },
    { id: U(1), state: "not_started" as const },
    { id: U(2).toUpperCase(), state: "in_review" as const },
    { id: "junk", state: "not_started" as const },
    { id: U(4), state: "done" as const, known: false },
    { id: U(1), state: "not_started" as const },
  ];
  ok(pickVendorStartTargets(st, null).join(",") === [U(1), U(2), U(4)].join(","), "not started + in review + unknown, id order, deduped, junk dropped");
  ok(pickVendorStartTargets(st, U(1)).join(",") === [U(2), U(4)].join(","), "after cursor");
  ok(pickVendorStartTargets(st, null, true).length === 4, "includeDone re-runs done");
  ok(pickVendorStartTargets(st, U(9)).length === 0, "cursor past the end");
  ok(parseVendorCursor(` ${U(5).toUpperCase()} `) === U(5) && parseVendorCursor("x") === null && parseVendorCursor(null) === null, "cursor parse");
  ok(vendorStartCanContinue(0) && vendorStartCanContinue(VENDOR_START_BUDGET_MS - VENDOR_START_MIN_LEFT_MS), "can continue at the edge");
  ok(!vendorStartCanContinue(VENDOR_START_BUDGET_MS - VENDOR_START_MIN_LEFT_MS + 1) && !vendorStartCanContinue(-1) && !vendorStartCanContinue(NaN), "stops before budget / junk");
  ok(VENDOR_START_BUDGET_MS < 300_000 && VENDOR_START_MIN_LEFT_MS > 60_000, "budget inside the page; room for the 60 s certificate read");

  const base: VendorStartRun = { vendor: "Ace", planned: 3, started: 3, seeded: 12, failed: 0, errors: [], next: U(3), done: true };
  ok(vendorStartNote(base) === "Ace: started 3 of 3 manifests, 12 new onboarding rows. All of this vendor's manifests have been run.", "start note done");
  ok(vendorStartNote({ ...base, started: 1, done: false }).endsWith("2 left: press Continue to keep going."), "start note continue");
  ok(vendorStartNote({ ...base, started: 2, failed: 1, errors: ["boom"] }).includes("1 could not start (boom)"), "start note failure");
  ok(vendorStartNote({ ...base, planned: 0, started: 0 }).includes("already done"), "nothing to start");
  ok(vendorStartNote({ ...base, planned: 1, started: 1, seeded: 1 }).includes("1 of 1 manifest, 1 new onboarding row."), "singular");

  // lookup tally
  const t = tallyVendorLookup("Ace", [
    { kind: "created", total: 40, truncated: 0 },
    { kind: "created", total: 1000, truncated: 12 },
    { kind: "exists" },
    { kind: "nothing" },
    { kind: "error", message: "db" },
  ]);
  ok(t.manifests === 5 && t.created === 2 && t.queuedProducts === 1040 && t.truncated === 12 && t.alreadyRunning === 1 && t.nothing === 1 && t.errors.join() === "db", "tally");
  const n = vendorLookupNote(t);
  ok(n.startsWith("Ace: Gemini is looking up 1040 products across 2 manifests"), "lookup note head");
  ok(n.includes("1 manifest was already being looked up") && n.includes("1 had nothing left") && n.includes("12 more wait") && n.includes("1 could not be queued (db)"), "lookup note parts");
  ok(n.includes("saved to the knowledge base"), "says it is saved for reuse");
  ok(vendorLookupNote(tallyVendorLookup("Ace", [])) === "Ace: no manifests to look up.", "no manifests");
  ok(vendorLookupNote(tallyVendorLookup("Ace", [{ kind: "nothing" }])).includes("1 had nothing left to look up"), "only nothing");

  // mastering
  const m = masteringSummary([
    { status: "draft", kb_product_id: "k1", attached_facts: { potency: { source: "coa" }, effects: { source: "gemini" }, description: { source: "gemini" } } },
    { status: "approved", kb_product_id: null, attached_facts: { potency: { source: "cultivera" }, terpenes: { source: "remembered" } } },
    { status: "dismissed", kb_product_id: "", attached_facts: { description: { source: "human" }, effects: { source: "kb_published" } } },
    { status: "draft", kb_product_id: null, attached_facts: null },
    { status: "draft", kb_product_id: null, attached_facts: { bad: "x", worse: { value: 1 } } },
  ]);
  ok(m.drafts === 5 && m.inReview === 3 && m.approved === 1 && m.dismissed === 1, "mastering statuses");
  ok(m.linkedToKb === 1, "kb link only a real id");
  ok(m.withCoa === 1 && m.withGemini === 1 && m.withCultivera === 1 && m.withRemembered === 1 && m.withHuman === 1 && m.withKb === 1, "per-source drafts");
  ok(m.facts === 7, "facts counted only with a source");
  ok(m.byField[0].field === "description" && m.byField[0].count === 2 && m.byField.map((f) => f.field).join(",") === "description,effects,potency,terpenes", "by field, most first then A-Z");
  ok(masteringSummary([]).drafts === 0 && masteringSummary([]).byField.length === 0, "empty mastering");
  ok(labCoverageLine({ lots: 30, withLab: 12, withCertificate: 9 }) === "12 of 30 lots linked to a lab result, 9 with the certificate file kept.", "lab line");
  ok(labCoverageLine(null).includes("could not be read") && labCoverageLine({ lots: 0, withLab: 0, withCertificate: 0 }).startsWith("No lots"), "lab line edge");
  ok(masteringEventLabel("lab_facts_attach") === "Facts from lab certificates" && masteringEventLabel("other") === "other" && masteringEventLabel(null) === "Event", "event labels");
  ok(MASTERING_EVENT_TYPES.includes("cultivera_onboarding") && MASTERING_EVENT_TYPES.includes("coa_extract"), "event types");

  // banners
  ok(vendorStartBanner("bogus", "x") === null && vendorStartBanner(undefined, "x") === null, "start banner: unknown code = none");
  ok(vendorStartBanner("ok", "Ace: started 2")?.tone === "good" && vendorStartBanner("ok", "Ace: started 2")?.text === "Ace: started 2", "start banner ok");
  ok(vendorStartBanner("warn", "m")?.tone === "warn", "start banner warn");
  ok(vendorStartBanner("error", "")?.tone === "bad" && vendorStartBanner("error", "")!.text.includes("unknown error"), "start banner error, no message");
  ok(vendorLookupBanner("migration", "x")?.tone === "bad" && vendorLookupBanner("migration", "x")!.text.includes("migration"), "lookup banner migration");
  ok(vendorLookupBanner("nothing", "")?.tone === "warn" && vendorLookupBanner("nothing", "")!.text.includes("start the vendor"), "lookup banner nothing default");
  ok(vendorLookupBanner("ok", "Gemini is looking up")?.tone === "good" && vendorLookupBanner("x", "y") === null, "lookup banner ok / unknown");
  ok(vendorLookupBanner("error", "boom")!.text.includes("boom") && vendorLookupBanner("warn", "w")?.tone === "warn", "lookup banner error / warn");
  ok(FACT_SOURCE_LABEL.coa === "Lab certificate" && FACT_SOURCE_LABEL.gemini.startsWith("Gemini"), "fact source labels");

  return { passed, failed };
}
