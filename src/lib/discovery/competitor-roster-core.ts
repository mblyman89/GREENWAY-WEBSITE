/**
 * src/lib/discovery/competitor-roster-core.ts
 *
 * PURE validation + normalization for the OWNER-MANAGED competitor roster.
 *
 * Owner request (recorded verbatim, standing rule 1):
 *   "I have the a list of competitors, is their a way for me to give the system
 *    a competitor specifically like I did to get the curated list, baked into
 *    the back office, so we don't have to make code edits to find other
 *    specific retailers and producer processors? I think that would be
 *    fantastic!"
 *
 * Until now the roster lived ONLY as a hardcoded SQL seed in migration
 * 0080_discovery_competitors.sql. Adding a store meant editing SQL. This core
 * is the guard layer for a back-office CRUD screen so the owner maintains it
 * himself.
 *
 * WHY A `kind` COLUMN EXISTS
 * --------------------------
 * The owner wants to track producer/processors too, not just retailers. The
 * CCRS Licensee table carries NO license-type / privilege / tier column
 * (verified against the real header in
 * tests/compliance/fixtures/ccrs-zip-fixture.ts and every template in
 * docs/ccrs-templates/ - zero hits for licensetype/privilege). So the system
 * CANNOT derive whether a license is a retailer or a producer/processor. The
 * human declares it. That declaration is the roster's `kind`.
 *
 * This matters beyond labelling: area benchmarks are RETAIL price comparisons.
 * Folding a producer/processor's wholesale-side rows into a retail area median
 * would silently corrupt the benchmark. `kind` keeps the two populations
 * separate - see `retailRoster()` / `supplyRoster()`.
 *
 * NEVER GUESS (standing rule 2): a value we cannot verify is REJECTED with a
 * precise message for the human, never coerced into something plausible.
 *
 * GROUNDED FORMAT RULES
 * ---------------------
 * - LicenseNumber is `Numeric(6)` per docs/ccrs-data-model.md:33 ("Numeric(6)
 *   (labs are 10 digits)"). The seeded roster confirms leading zeros are real
 *   ('081400' = GREEN TIKI CANNABIS), so it is TEXT, never a number.
 * - Only ONE row may be `is_self` (Greenway, 413541). Two "self" rows would
 *   make every "us vs them" comparison ambiguous.
 *
 * PURE: no imports beyond types, no I/O. Exercised directly by the compliance
 * suite (tests/compliance/competitor-roster-core.test.ts).
 */
import type { DiscoveryCompetitorArea } from "@/lib/discovery/types";

/**
 * What the licensee IS, as declared by a human. CCRS cannot tell us.
 *
 * - `retailer`          - a storefront we compete with for the same customer.
 *                         Belongs in retail price benchmarks.
 * - `producer_processor` - grows/makes product and sells it wholesale. Belongs
 *                         in supply-side analysis, NEVER in a retail median.
 * - `unknown`           - on the roster but not yet classified. Counted, but
 *                         deliberately excluded from BOTH typed views so an
 *                         unclassified row can never quietly skew a number.
 */
export type CompetitorKind = "retailer" | "producer_processor" | "unknown";

export const COMPETITOR_KINDS: readonly CompetitorKind[] = [
  "retailer",
  "producer_processor",
  "unknown",
] as const;

export const COMPETITOR_KIND_LABELS: Record<CompetitorKind, string> = {
  retailer: "Retailer",
  producer_processor: "Producer / Processor",
  unknown: "Unclassified",
};

export const COMPETITOR_AREAS: readonly DiscoveryCompetitorArea[] = [
  "port_orchard",
  "bremerton",
  "silverdale",
  "tacoma",
  "key_peninsula",
  "kitsap_other",
  "other",
] as const;

/** Text-length clamps. Generous, but bounded so a paste-bomb cannot land. */
export const MAX_TRADENAME_LEN = 120;
export const MAX_CITY_LEN = 80;
export const MAX_COUNTY_LEN = 80;
export const MAX_NOTE_LEN = 500;

/** Raw form input - every field is whatever the browser sent. */
export type RosterFormInput = {
  license_number?: unknown;
  tradename?: unknown;
  city?: unknown;
  county?: unknown;
  area?: unknown;
  kind?: unknown;
  is_self?: unknown;
  is_active?: unknown;
  note?: unknown;
};

/** A validated row, safe to persist. */
export type RosterUpsert = {
  license_number: string;
  tradename: string;
  city: string | null;
  county: string | null;
  area: DiscoveryCompetitorArea;
  kind: CompetitorKind;
  is_self: boolean;
  is_active: boolean;
  note: string | null;
};

export type RosterValidation =
  | { ok: true; value: RosterUpsert; warnings: string[] }
  | { ok: false; errors: string[] };

/** Minimal shape this core needs from an existing roster row. */
export type RosterRowLike = {
  license_number: string;
  tradename?: string | null;
  kind?: string | null;
  is_self?: boolean | null;
  is_active?: boolean | null;
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Checkbox / form truthiness. HTML checkboxes post "on"; hidden inputs post
 * "1"/"0"/"true"/"false". Anything unrecognized is FALSE, never guessed true -
 * accidentally flagging a store as "self" would corrupt every comparison.
 */
export function parseFormBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = asText(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

/**
 * Normalize a WSLCB license number.
 *
 * Grounded in docs/ccrs-data-model.md:33 - `LicenseNumber` is Numeric(6), and
 * labs are 10 digits. Leading zeros are significant ('081400' is in the
 * verified seed), so we keep TEXT and never strip them.
 *
 * Returns null when the input cannot be a license number. We do NOT try to
 * repair it (rule 2) - a mistyped license silently "fixed" would attach a
 * competitor's sales to the wrong store.
 */
export function normalizeLicenseNumber(raw: unknown): string | null {
  const s = asText(raw).trim();
  if (!s) return null;
  // Cosmetic separators a human might paste from a spreadsheet are allowed,
  // but ONLY between digits. A leading "-" is a sign, not a separator: naively
  // stripping it turns "-413541" into a valid-looking license, which is the
  // silent repair rule 2 forbids. Shape-check BEFORE stripping.
  if (!/^\d+(?:[\s\-.]\d+)*$/.test(s)) return null;
  const cleaned = s.replace(/[\s\-.]/g, "");
  // 6 = standard licensee, 10 = lab. Anything else is not a license number.
  if (cleaned.length !== 6 && cleaned.length !== 10) return null;
  return cleaned;
}

/** Collapse internal whitespace and trim; returns "" for nothing. */
export function tidy(raw: unknown, maxLen: number): string {
  return asText(raw).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function isCompetitorKind(v: unknown): v is CompetitorKind {
  return typeof v === "string" && (COMPETITOR_KINDS as readonly string[]).includes(v);
}

export function isCompetitorArea(v: unknown): v is DiscoveryCompetitorArea {
  return typeof v === "string" && (COMPETITOR_AREAS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate one roster add/edit.
 *
 * `existing` is the current roster (used for cross-row rules that a single row
 * cannot see: duplicate license, second "self"). Pass the row being edited in
 * `editingLicense` so an edit doesn't collide with itself.
 *
 * Errors BLOCK the save. Warnings are surfaced to the human but allow it -
 * drafts-only thinking (rule 3): we flag, the human decides.
 */
export function validateRosterUpsert(
  input: RosterFormInput,
  existing: RosterRowLike[] = [],
  editingLicense?: string | null,
): RosterValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const license = normalizeLicenseNumber(input.license_number);
  if (!license) {
    const shown = asText(input.license_number).trim();
    errors.push(
      shown
        ? `"${shown}" is not a valid WSLCB license number. It must be 6 digits (or 10 for a lab).`
        : "License number is required.",
    );
  }

  const tradename = tidy(input.tradename, MAX_TRADENAME_LEN);
  if (!tradename) errors.push("Store / business name is required.");

  const areaRaw = asText(input.area).trim();
  if (areaRaw && !isCompetitorArea(areaRaw)) {
    errors.push(`"${areaRaw}" is not a known area.`);
  }
  const area: DiscoveryCompetitorArea = isCompetitorArea(areaRaw) ? areaRaw : "other";

  const kindRaw = asText(input.kind).trim();
  if (kindRaw && !isCompetitorKind(kindRaw)) {
    errors.push(`"${kindRaw}" is not a known licensee kind.`);
  }
  // Absent kind => "unknown". We do NOT default to "retailer": guessing that a
  // producer/processor is a retailer would poison the retail price benchmarks.
  const kind: CompetitorKind = isCompetitorKind(kindRaw) ? kindRaw : "unknown";
  if (kind === "unknown") {
    warnings.push(
      "No kind was chosen, so this licensee is saved as Unclassified. It will be listed, but left out of retail and supplier comparisons until you classify it.",
    );
  }

  const isSelf = parseFormBool(input.is_self);
  const isActive = input.is_active === undefined ? true : parseFormBool(input.is_active);

  // Cross-row rules.
  const editing = editingLicense ? normalizeLicenseNumber(editingLicense) : null;
  if (license) {
    const dupe = existing.find(
      (r) => r.license_number === license && r.license_number !== editing,
    );
    if (dupe) {
      errors.push(
        `License ${license} is already on the roster as "${dupe.tradename ?? "(unnamed)"}". Edit that entry instead of adding it twice.`,
      );
    }
  }

  if (isSelf) {
    const otherSelf = existing.find(
      (r) => r.is_self === true && r.license_number !== (editing ?? license),
    );
    if (otherSelf) {
      errors.push(
        `"${otherSelf.tradename ?? otherSelf.license_number}" is already marked as our own store. Only one entry can be Greenway.`,
      );
    }
    if (kind === "producer_processor") {
      errors.push("Our own store cannot be marked as a producer / processor.");
    }
    if (!isActive) {
      errors.push("Our own store cannot be deactivated.");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const city = tidy(input.city, MAX_CITY_LEN);
  const county = tidy(input.county, MAX_COUNTY_LEN);
  const note = tidy(input.note, MAX_NOTE_LEN);

  // Producer/processors have no storefront area; area is a RETAIL geography.
  // Keep whatever was chosen but tell the human it won't be used that way.
  if (kind === "producer_processor" && area !== "other") {
    warnings.push(
      "Area is used for retail neighborhood comparisons. It is recorded for this producer / processor but won't affect area benchmarks.",
    );
  }

  return {
    ok: true,
    warnings,
    value: {
      license_number: license as string,
      tradename,
      city: city || null,
      county: county || null,
      area,
      kind,
      is_self: isSelf,
      is_active: isActive,
      note: note || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Views over the roster
// ---------------------------------------------------------------------------

/** Read a row's kind defensively - legacy rows (pre-migration) have none. */
export function rowKind(row: RosterRowLike): CompetitorKind {
  return isCompetitorKind(row.kind) ? row.kind : "unknown";
}

/**
 * Licenses whose RETAIL behaviour we benchmark (storefront competitors).
 *
 * Excludes producer/processors and unclassified rows so a wholesale-only
 * licensee can never land in a retail price median.
 */
export function retailRoster<T extends RosterRowLike>(rows: T[]): T[] {
  return rows.filter((r) => r.is_active !== false && rowKind(r) === "retailer");
}

/** Licenses we watch on the SUPPLY side (producer/processors). */
export function supplyRoster<T extends RosterRowLike>(rows: T[]): T[] {
  return rows.filter((r) => r.is_active !== false && rowKind(r) === "producer_processor");
}

/**
 * Every active license the aggregator should TRACK, regardless of kind.
 *
 * The extractor assigns a limited number of tracked slots, so this is the list
 * that actually gets carried into the crunch. Deduped and sorted for a stable,
 * reproducible slot assignment run-to-run (the same roster must always produce
 * the same slots, or month-over-month comparisons drift).
 */
export function trackedLicenses(rows: RosterRowLike[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.is_active === false) continue;
    const lic = normalizeLicenseNumber(r.license_number);
    if (lic) seen.add(lic);
  }
  return [...seen].sort();
}

/** Roster health for the UI header. Counts, not opinions. */
export type RosterSummary = {
  total: number;
  active: number;
  inactive: number;
  retailers: number;
  producerProcessors: number;
  unclassified: number;
  selfCount: number;
};

export function summarizeRoster(rows: RosterRowLike[]): RosterSummary {
  let active = 0;
  let inactive = 0;
  let retailers = 0;
  let producerProcessors = 0;
  let unclassified = 0;
  let selfCount = 0;
  for (const r of rows) {
    const isActive = r.is_active !== false;
    if (isActive) active += 1;
    else inactive += 1;
    if (r.is_self === true) selfCount += 1;
    if (!isActive) continue;
    const k = rowKind(r);
    if (k === "retailer") retailers += 1;
    else if (k === "producer_processor") producerProcessors += 1;
    else unclassified += 1;
  }
  return {
    total: rows.length,
    active,
    inactive,
    retailers,
    producerProcessors,
    unclassified,
    selfCount,
  };
}
