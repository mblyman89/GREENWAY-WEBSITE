/**
 * src/lib/atm/pai-discovery.ts — ATM/PAI Slice A-2c-3 (PURE)
 *
 * The no-F12 way to learn each PAI report's REAL date-filter column name.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * PAI's date filter is `F_[Column name]=[value]`, where "Column name" is that
 * report's REAL column name (case-sensitive, report-specific). We CONFIRMED
 * this from PAI's official SDK/wiki (gopai/reporting-sdk + gopai/paireportsclient):
 *
 *   1) The Data API (`Query.event`, body `query=<SQL>`) lists every report the
 *      user can see:  `SELECT * FROM ReportConfigs r ORDER BY r.Name`
 *      → rows of { ReportGUID, ExternalName, Name }.
 *   2) The ReportConfig endpoint (`ReportConfigManagement.event`, verb
 *      FIND_CONFIG, header Accept: application/json, param GUID=<guid>) returns
 *      that report's REAL columns:
 *        ReportConfig { fields[]: { type, readonly, name, data{...} } }
 *      PAI's own example client prints `field.name` under the header
 *      "Column Name" — those names are EXACTLY what go into `F_<name>=...`.
 *
 * So the real filter column name is DISCOVERABLE programmatically — no browser
 * F12 inspection. This module holds the PURE (no-I/O) helpers: build the query,
 * parse the JSON PAI returns, match our three reports to their config rows, and
 * pick the DATE column per report. The server-only I/O (login → runQuery →
 * FIND_CONFIG → logout) lives in pai-client.ts and only orchestrates these.
 *
 * ── STANDING RULES honored ──────────────────────────────────────────────────
 *   • NEVER GUESS — matching is tolerant + TRANSPARENT: we return ALL candidate
 *     column names and flag confidence, so a wrong pick can't happen silently.
 *   • Pure + fully self-tested (run via scripts/compliance/run-pure-selftests.ts).
 */

import type { PaiReportKind } from "./pai-endpoints";
import { parseCsv } from "./atm-core";

// ---------------------------------------------------------------------------
// 1) The Data-API query that lists every report config (name + GUID).
// ---------------------------------------------------------------------------

/**
 * The exact SQL the PAI Data API expects to enumerate the reports this user can
 * see. Matches PAI's own example client (ReportIdentifierRetriever.findAllConfigs):
 *   SELECT * FROM ReportConfigs r ORDER BY r.Name
 * Sent as the `query` form field to Query.event.
 */
export const PAI_LIST_CONFIGS_QUERY = "SELECT * FROM ReportConfigs r ORDER BY r.Name";

/** One report-config identity row as returned by the Data API. */
export type PaiReportConfigId = {
  reportGuid: string;
  externalName: string;
  name: string;
};

/**
 * Parse the Data-API response for `SELECT * FROM ReportConfigs`. PAI returns a
 * JSON array of objects with PascalCase keys (ReportGUID, ExternalName, Name).
 * We accept a few key spellings defensively (the API has used both PascalCase
 * and the occasional camelCase in examples) WITHOUT inventing data: a row with
 * no usable GUID is dropped. Returns [] on any parse failure (never throws).
 */
export function parseReportConfigIds(rawJson: string): PaiReportConfigId[] {
  const text = (rawJson ?? "").trim();
  if (text === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : // Some endpoints wrap the array (e.g. { results: [...] } / { data: [...] }).
      isRecord(parsed) && Array.isArray((parsed as Record<string, unknown>).results)
      ? ((parsed as Record<string, unknown>).results as unknown[])
      : isRecord(parsed) && Array.isArray((parsed as Record<string, unknown>).data)
        ? ((parsed as Record<string, unknown>).data as unknown[])
        : [];
  const out: PaiReportConfigId[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const reportGuid = pickString(item, ["ReportGUID", "reportGUID", "ReportGuid", "reportGuid", "GUID", "guid"]);
    const externalName = pickString(item, ["ExternalName", "externalName"]);
    const name = pickString(item, ["Name", "name"]);
    if (reportGuid === "") continue; // no GUID ⇒ unusable, drop it (never guess one)
    out.push({ reportGuid, externalName, name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2) Match our three reports to their config rows (tolerant + transparent).
// ---------------------------------------------------------------------------

/**
 * Human-facing report titles as they appear in Michael's PAI portal (CONFIRMED
 * from PAI_PORTAL_REFERENCE — the browser <title> and dropdown labels). Used to
 * MATCH a report kind to its ReportConfigs row by name. We match on normalized
 * substrings (case/space-insensitive) and return ALL candidates so a wrong pick
 * is impossible to make silently.
 */
export const PAI_REPORT_TITLE_HINTS: Record<PaiReportKind, string[]> = {
  cashLoad: ["atm cash load", "cash load"],
  simpleSummary: ["simple summary", "terminal trx data", "terminal transaction"],
  fundsMovement: ["funds movement", "bank deposit"],
};

/**
 * The COLUMNS each report's verified mapper needs (atm-core.ts). Used to rank
 * probe candidates by WHICH REPORT ACTUALLY FITS — not merely which returned
 * the most rows. This matters because a report family can contain several
 * look-alikes at different granularity (e.g. a raw per-transaction "Trx Data"
 * report returns MORE rows than the daily "Simple Summary" our mapper expects).
 * Rewarding row count alone would auto-pick the wrong grain; matching the
 * mapper's required columns is EVIDENCE of the right report, not a guess.
 *
 * Tokens are normalized (lowercase, spaces removed) fragments matched against
 * each candidate's normalized column labels. Kept in sync with the pickColumn
 * lists in mapCashLoadCsv / mapSimpleSummaryCsv / mapFundsMovementCsv.
 */
export const PAI_REPORT_COLUMN_TOKENS: Record<PaiReportKind, string[]> = {
  cashLoad: ["terminal", "trxtime", "cashload"],
  simpleSummary: ["terminal", "settlementdate", "totaltrxs", "surch", "settlement"],
  fundsMovement: ["settlementtype", "amount", "settlementdate", "acct"],
};

/**
 * How many of a kind's expected mapper columns appear in a probed CSV's header.
 * PURE. Case/space-insensitive substring match (so "Total Trxs" matches token
 * "totaltrxs", "Surcharge" matches "surch", etc.). Never throws.
 */
export function countExpectedColumns(kind: PaiReportKind, columns: string[]): number {
  const norm = columns.map((c) => normalizeName(c).replace(/\s+/g, ""));
  const tokens = PAI_REPORT_COLUMN_TOKENS[kind];
  let hits = 0;
  for (const t of tokens) {
    if (norm.some((c) => c.includes(t))) hits += 1;
  }
  return hits;
}

/** Lowercase + collapse whitespace for tolerant, non-guessing comparison. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type PaiConfigMatch = {
  kind: PaiReportKind;
  /** All config rows whose Name/ExternalName matched a title hint for this kind. */
  candidates: PaiReportConfigId[];
  /** The single best candidate when EXACTLY one matched; null otherwise. */
  best: PaiReportConfigId | null;
  /** True only when exactly one candidate matched (safe to auto-use). */
  confident: boolean;
  /** True when `best` came from Michael's saved selection (not the fuzzy hints). */
  fromSelection?: boolean;
};

/**
 * Michael's saved per-kind report choice: the EXACT report Name he confirmed
 * (matched to a config row by GUID when available, else by exact Name). Stored
 * in report_config.reportSelection, keyed by PaiReportKind. Optional; when a
 * kind has a selection we HONOR it instead of guessing from the fuzzy hints.
 */
export type PaiReportSelection = {
  /** The report's ReportGUID (preferred — stable even if two names collide). */
  reportGuid?: string;
  /** The exact report Name Michael confirmed (fallback when GUID isn't stored). */
  name?: string;
};

/**
 * Resolve Michael's typed report choice (an exact report Name and/or GUID) to a
 * concrete config row, then produce the `reportSelection[kind]` value to SAVE —
 * always preferring the resolved GUID (stable even when two reports share a
 * name). Returns { ok:false } WITHOUT guessing when the chosen name/guid doesn't
 * match exactly one row (0 rows, or >1 rows with no GUID to disambiguate). PURE.
 */
export function resolveReportChoice(
  rows: PaiReportConfigId[],
  choice: { reportGuid?: string; name?: string },
): { ok: true; selection: PaiReportSelection; row: PaiReportConfigId } | { ok: false; error: string } {
  const guid = (choice.reportGuid ?? "").trim();
  const name = (choice.name ?? "").trim();
  if (!guid && !name) return { ok: false, error: "No report was chosen." };

  if (guid) {
    const byGuid = rows.filter((r) => r.reportGuid.trim() === guid);
    if (byGuid.length === 1) {
      return { ok: true, selection: { reportGuid: byGuid[0].reportGuid, name: byGuid[0].name }, row: byGuid[0] };
    }
    if (byGuid.length === 0) return { ok: false, error: "That report ID wasn’t in PAI’s current list." };
  }

  const want = normalizeName(name);
  const byName = rows.filter((r) => normalizeName(r.name) === want || normalizeName(r.externalName) === want);
  if (byName.length === 1) {
    return { ok: true, selection: { reportGuid: byName[0].reportGuid, name: byName[0].name }, row: byName[0] };
  }
  if (byName.length === 0) return { ok: false, error: "That report name wasn’t found in PAI’s current list." };
  return {
    ok: false,
    error: `That name matches ${byName.length} reports. I need the exact report ID to be sure — I won’t guess.`,
  };
}

/** One saved probe candidate the page can render as a one-click pick option. */
export type PaiProbePick = {
  reportGuid: string;
  name: string;
  label: string;
  rowCount: number;
  hasData: boolean;
};

/** A kind's most-recent probe result, persisted so the page can offer picks. */
export type PaiLastProbe = {
  at: string;
  candidates: PaiProbePick[];
  winnerGuid: string | null;
};

/**
 * Parse report_config.lastProbe into a typed, per-kind map of the last probe's
 * ranked candidates. PURE, null-safe. Drops malformed entries (never invents a
 * GUID). The page uses this to render a radio list so Michael picks a report by
 * one click instead of typing an ID.
 */
export function parseLastProbe(raw: unknown): Partial<Record<PaiReportKind, PaiLastProbe>> {
  const out: Partial<Record<PaiReportKind, PaiLastProbe>> = {};
  if (!isRecord(raw)) return out;
  for (const kind of ["cashLoad", "simpleSummary", "fundsMovement"] as const) {
    const entry = raw[kind];
    if (!isRecord(entry) || !Array.isArray(entry.candidates)) continue;
    const candidates: PaiProbePick[] = [];
    for (const c of entry.candidates) {
      if (!isRecord(c)) continue;
      const reportGuid = typeof c.reportGuid === "string" ? c.reportGuid.trim() : "";
      if (reportGuid === "") continue; // never invent a GUID
      candidates.push({
        reportGuid,
        name: typeof c.name === "string" ? c.name : "",
        label: typeof c.label === "string" && c.label.trim() !== "" ? c.label : reportGuid,
        rowCount: typeof c.rowCount === "number" && Number.isFinite(c.rowCount) ? c.rowCount : 0,
        hasData: c.hasData === true,
      });
    }
    if (candidates.length === 0) continue;
    out[kind] = {
      at: typeof entry.at === "string" ? entry.at : "",
      candidates,
      winnerGuid: typeof entry.winnerGuid === "string" ? entry.winnerGuid : null,
    };
  }
  return out;
}

/** Parse report_config.reportSelection into a typed, per-kind map. PURE, null-safe. */
export function parseReportSelection(raw: unknown): Partial<Record<PaiReportKind, PaiReportSelection>> {
  const out: Partial<Record<PaiReportKind, PaiReportSelection>> = {};
  if (!isRecord(raw)) return out;
  for (const kind of ["cashLoad", "simpleSummary", "fundsMovement"] as const) {
    const sel = raw[kind];
    if (!isRecord(sel)) continue;
    const guid = typeof sel.reportGuid === "string" ? sel.reportGuid.trim() : "";
    const name = typeof sel.name === "string" ? sel.name.trim() : "";
    if (guid || name) out[kind] = { ...(guid ? { reportGuid: guid } : {}), ...(name ? { name } : {}) };
  }
  return out;
}

/**
 * Match one report kind to its config row(s).
 *
 * PRECEDENCE (never guess):
 *   1) If Michael saved a `selection` for this kind, use it — match the row by
 *      GUID first (exact), then by exact normalized Name. A resolved selection
 *      is CONFIDENT (fromSelection=true), even if several rows share a name.
 *   2) Otherwise fall back to the fuzzy title hints; confident ONLY when exactly
 *      one row matches, so we never auto-pick from ambiguity.
 */
export function matchReportConfig(
  kind: PaiReportKind,
  rows: PaiReportConfigId[],
  selection?: PaiReportSelection | null,
): PaiConfigMatch {
  // 1) Honor an explicit saved selection.
  if (selection && (selection.reportGuid || selection.name)) {
    let chosen: PaiReportConfigId | undefined;
    if (selection.reportGuid) {
      chosen = rows.find((r) => r.reportGuid.trim() === selection.reportGuid!.trim());
    }
    if (!chosen && selection.name) {
      const want = normalizeName(selection.name);
      chosen = rows.find((r) => normalizeName(r.name) === want || normalizeName(r.externalName) === want);
    }
    if (chosen) {
      return { kind, candidates: [chosen], best: chosen, confident: true, fromSelection: true };
    }
    // Selection didn't resolve (report renamed/removed) → fall through to hints,
    // but do NOT silently pretend it matched.
  }

  // 2) Fuzzy hint match.
  const hints = PAI_REPORT_TITLE_HINTS[kind];
  const candidates = rows.filter((r) => {
    const hay = `${normalizeName(r.name)} ${normalizeName(r.externalName)}`;
    return hints.some((h) => hay.includes(normalizeName(h)));
  });
  const confident = candidates.length === 1;
  return { kind, candidates, best: confident ? candidates[0] : null, confident, fromSelection: false };
}

// ---------------------------------------------------------------------------
// 3) Parse a ReportConfig (FIND_CONFIG) and pick the DATE filter column.
// ---------------------------------------------------------------------------

/** One field (column) of a report, as returned by FIND_CONFIG. */
export type PaiReportField = {
  name: string;
  type: string;
  readonly: boolean;
};

/**
 * Parse the FIND_CONFIG JSON into a flat list of fields. The SDK's ReportConfig
 * is `{ fields: [ { type, readonly, name, data{...} } ] }`. PAI wraps a
 * successful body such that it contains "SuccessResponse"; we tolerate a couple
 * of shapes (top-level `fields`, or nested under a success wrapper) WITHOUT
 * inventing anything. Returns [] on any failure (never throws).
 */
export function parseReportFields(rawJson: string): PaiReportField[] {
  const text = (rawJson ?? "").trim();
  if (text === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const fieldsArr = findFieldsArray(parsed);
  if (!fieldsArr) return [];
  const out: PaiReportField[] = [];
  for (const f of fieldsArr) {
    if (!isRecord(f)) continue;
    const name = pickString(f, ["name", "Name"]);
    if (name === "") continue;
    const type = pickString(f, ["type", "Type"]);
    const readonly = pickBool(f, ["readonly", "readOnly", "ReadOnly"]);
    out.push({ name, type, readonly });
  }
  return out;
}

/**
 * The CSV date-column each report is keyed on (CONFIRMED from Michael's portal /
 * PAI_PORTAL_REFERENCE): Cash Load → "Trx Time"; the settlement reports →
 * "Settlement Date". Used to recognize the DATE field among a report's columns.
 */
export const PAI_EXPECTED_DATE_COLUMN: Record<PaiReportKind, string> = {
  cashLoad: "Trx Time",
  simpleSummary: "Settlement Date",
  fundsMovement: "Settlement Date",
};

/** Tokens that reliably indicate a date/time column name across PAI reports. */
const DATE_NAME_TOKENS = ["date", "time", "day", "settlement", "posted", "post"];
/** Field `type` strings PAI uses for date filters (lowercased for compare). */
const DATE_TYPE_TOKENS = ["date", "datetime", "time"];

export type PaiDateFieldPick = {
  /** The chosen date column name (e.g. "Settlement Date"), or "" if none found. */
  fieldName: string;
  /** The `F_<name>` filter key to send (spaces preserved — PAI expects the real name). */
  filterKey: string;
  /** How the pick was made — for an honest, auditable report to Michael. */
  reason: "expected-column" | "by-type" | "by-name-token" | "none";
  /** Every date-ish column we saw, so Michael can confirm we picked the right one. */
  dateCandidates: string[];
  /** True only when we found a single, unambiguous date column. */
  confident: boolean;
};

/**
 * Pick the DATE filter column for a report from its parsed fields. Strategy,
 * most-authoritative first (never guesses beyond the evidence):
 *   1) EXACT match to the report's expected CSV date column (e.g. "Settlement
 *      Date") — highest confidence.
 *   2) A field whose `type` is a date/time type — if exactly one, use it.
 *   3) A field whose NAME contains a date token (date/time/day/settlement/…)
 *      — if exactly one, use it.
 * Returns the pick + ALL date-ish candidates + a `confident` flag so an
 * ambiguous report is reported, not guessed.
 */
export function pickDateField(kind: PaiReportKind, fields: PaiReportField[]): PaiDateFieldPick {
  const expected = PAI_EXPECTED_DATE_COLUMN[kind];
  const expectedNorm = normalizeName(expected);

  // 1) Exact expected column (case/space-insensitive) — the strongest signal.
  const exact = fields.find((f) => normalizeName(f.name) === expectedNorm);
  if (exact) return pick(exact.name, "expected-column", fields, true);

  // Gather date-ish candidates for the weaker strategies + transparency.
  const byType = fields.filter((f) => DATE_TYPE_TOKENS.includes(normalizeName(f.type)));
  const byName = fields.filter((f) => {
    const n = normalizeName(f.name);
    return DATE_NAME_TOKENS.some((t) => n.includes(t));
  });

  // 2) A single date-typed field.
  if (byType.length === 1) return pick(byType[0].name, "by-type", fields, true);

  // 3) A single name-token date field.
  if (byName.length === 1) return pick(byName[0].name, "by-name-token", fields, true);

  // Ambiguous or none: report every date-ish candidate, pick nothing confidently.
  const candidates = uniq([...byType, ...byName].map((f) => f.name));
  return {
    fieldName: "",
    filterKey: "",
    reason: "none",
    dateCandidates: candidates,
    confident: false,
  };
}

function pick(
  name: string,
  reason: PaiDateFieldPick["reason"],
  fields: PaiReportField[],
  confident: boolean,
): PaiDateFieldPick {
  const candidates = uniq(
    fields
      .filter((f) => {
        const n = normalizeName(f.name);
        return DATE_TYPE_TOKENS.includes(normalizeName(f.type)) || DATE_NAME_TOKENS.some((t) => n.includes(t));
      })
      .map((f) => f.name),
  );
  if (!candidates.includes(name)) candidates.unshift(name);
  return { fieldName: name, filterKey: `F_${name}`, reason, dateCandidates: candidates, confident };
}

// ---------------------------------------------------------------------------
// 4) The overall discovery result shape + a human-readable summary.
// ---------------------------------------------------------------------------

export type PaiReportDiscovery = {
  kind: PaiReportKind;
  /** The matched config row (null when unmatched / ambiguous). */
  matched: PaiReportConfigId | null;
  /** Every config row that matched this kind's title hints (transparency). */
  configCandidates: PaiReportConfigId[];
  /** The date-field pick from that config's fields (empty when no config). */
  datePick: PaiDateFieldPick;
  /** A short human note (why we did/didn't get a confident answer). */
  note: string;
};

/** Label per report kind for messages (mirrors atm-report-diagnostics). */
export const PAI_DISCOVERY_LABEL: Record<PaiReportKind, string> = {
  cashLoad: "Cash Loads",
  simpleSummary: "Simple Summary",
  fundsMovement: "Bank Deposits",
};

/**
 * Build the per-report discovery from the enumerated config rows + a resolver
 * that returns a report's parsed fields for a GUID (the I/O is injected so this
 * stays pure & testable). For each kind: match its config row, then pick its
 * date field. `getFieldsForGuid` returns [] when the report couldn't be read.
 */
export function buildDiscovery(
  kind: PaiReportKind,
  allConfigs: PaiReportConfigId[],
  fieldsByGuid: Map<string, PaiReportField[]>,
  selection?: PaiReportSelection | null,
): PaiReportDiscovery {
  const match = matchReportConfig(kind, allConfigs, selection);
  const label = PAI_DISCOVERY_LABEL[kind];

  if (match.candidates.length === 0) {
    return {
      kind,
      matched: null,
      configCandidates: [],
      datePick: { fieldName: "", filterKey: "", reason: "none", dateCandidates: [], confident: false },
      note: `Couldn’t find the “${label}” report in your PAI account’s report list.`,
    };
  }
  if (!match.confident) {
    return {
      kind,
      matched: null,
      configCandidates: match.candidates,
      datePick: { fieldName: "", filterKey: "", reason: "none", dateCandidates: [], confident: false },
      note: `Found ${match.candidates.length} reports that could be “${label}”. I won’t guess — pick one and I’ll use it.`,
    };
  }

  const guid = match.best!.reportGuid;
  const fields = fieldsByGuid.get(guid) ?? [];
  if (fields.length === 0) {
    return {
      kind,
      matched: match.best,
      configCandidates: match.candidates,
      datePick: { fieldName: "", filterKey: "", reason: "none", dateCandidates: [], confident: false },
      note: `Matched the “${label}” report but PAI didn’t return its column list.`,
    };
  }

  const datePick = pickDateField(kind, fields);
  const note = datePick.confident
    ? `“${label}” date column = “${datePick.fieldName}” → filter key ${datePick.filterKey}.`
    : datePick.dateCandidates.length > 0
      ? `“${label}”: more than one date-looking column (${datePick.dateCandidates.join(", ")}). I won’t guess — tell me which one.`
      : `“${label}”: no date column found in its config.`;

  return { kind, matched: match.best, configCandidates: match.candidates, datePick, note };
}

/**
 * Turn the three discoveries into the per-report `dateFieldName` override object
 * consumed by resolvePaiDateFieldName (pai-endpoints.ts). ONLY confident picks
 * are included — an ambiguous/failed report is left out so we never write a
 * guessed field name. Returns {} when nothing was confidently discovered.
 */
export function toDateFieldOverride(discoveries: PaiReportDiscovery[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of discoveries) {
    if (d.datePick.confident && d.datePick.filterKey !== "") {
      out[d.kind] = d.datePick.filterKey;
    }
  }
  return out;
}

/**
 * Deep-merge freshly discovered per-report date-field overrides INTO whatever
 * report_config.dateFieldName already holds, WITHOUT clobbering existing keys.
 *
 * Why this exists: mergeAtmReportConfig() is a SHALLOW top-level merge, so
 * passing `{ dateFieldName: newOverride }` would REPLACE the whole
 * dateFieldName object and lose a previously-confirmed report. This helper
 * produces the correct combined object to save. New values win for the keys
 * they cover (a re-discovery may legitimately correct a stale name); untouched
 * keys are preserved. A legacy plain-STRING dateFieldName (a single override
 * applied to every report) is preserved under the reserved "*" key so it is
 * not silently dropped. Pure (no I/O) so it is fully unit-tested.
 */
export function mergeDateFieldOverride(
  existing: unknown,
  discovered: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof existing === "string") {
    const s = existing.trim();
    if (s !== "") out["*"] = s;
  } else if (existing && typeof existing === "object") {
    for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
    }
  }
  for (const [k, v] of Object.entries(discovered)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5) PROBE analysis — "try it and see what data comes back" (no guessing).
// ---------------------------------------------------------------------------

/**
 * What we learned by actually downloading ONE candidate report's CSV with a
 * small window. This is EVIDENCE, not a guess: a candidate that returns data
 * rows (and has a date-looking column) is a real match; one that errors or
 * returns zero rows is not.
 */
export type PaiProbeSummary = {
  /** True when the CSV parsed and had at least one DATA row (beyond the header). */
  hasData: boolean;
  /** Number of data rows (header excluded). 0 when empty/unparseable. */
  rowCount: number;
  /** The header column labels, in order (empty when unreadable). */
  columns: string[];
  /** Columns whose label looks like a date/time column (for the date filter). */
  dateColumns: string[];
  /** A short, plain-English verdict for the ranked table. */
  note: string;
};

/**
 * Summarize a probe download of one candidate report. PURE — takes the raw CSV
 * text (or an error marker) and reports what came back. Never throws. An empty
 * or error CSV yields hasData:false with a clear note.
 */
export function summarizeProbeCsv(csv: string | null | undefined): PaiProbeSummary {
  const text = (csv ?? "").trim();
  if (text === "") {
    return { hasData: false, rowCount: 0, columns: [], dateColumns: [], note: "No data returned (empty response)." };
  }
  // A PAI error page is HTML, not CSV — detect it so we don't count it as data.
  const head = text.slice(0, 200).toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype") || head.includes("<body")) {
    return { hasData: false, rowCount: 0, columns: [], dateColumns: [], note: "PAI returned a web page, not a CSV (report not available this way)." };
  }
  const table = parseCsv(text);
  if (table.length === 0) {
    return { hasData: false, rowCount: 0, columns: [], dateColumns: [], note: "Response wasn’t a readable CSV." };
  }
  const columns = (table[0] ?? []).map((c) => c.trim()).filter((c) => c !== "");
  const rowCount = Math.max(0, table.length - 1);
  const dateColumns = columns.filter((c) => {
    const n = normalizeName(c);
    return DATE_NAME_TOKENS.some((t) => n.includes(t));
  });
  const hasData = rowCount > 0 && columns.length > 0;
  const note = hasData
    ? `Returned ${rowCount} row(s), ${columns.length} column(s)${dateColumns.length > 0 ? `, date column(s): ${dateColumns.join(", ")}` : " (no obvious date column)"}.`
    : columns.length > 0
      ? `Header only, 0 data rows (columns: ${columns.join(", ")}).`
      : "No usable columns found.";
  return { hasData, rowCount, columns, dateColumns, note };
}

/**
 * BASE rank for a probe result, kind-agnostic: has data AND a date column > has
 * data > header-only > empty/error. Ties keep their original order (stable).
 * PURE. Prefer scoreProbeForKind when a kind is known (column-fit aware).
 */
export function scoreProbe(s: PaiProbeSummary): number {
  if (s.hasData && s.dateColumns.length > 0) return 3;
  if (s.hasData) return 2;
  if (s.columns.length > 0) return 1;
  return 0;
}

/**
 * KIND-AWARE rank that answers "which candidate is the RIGHT report" — not just
 * which returned the most rows. PURE. Composition (higher is better):
 *   • +100 per expected mapper column present (dominant signal — the report
 *     whose columns fit the mapper is the correct one, regardless of row count).
 *   •  +10 if it returned data rows, +10 if it has a date column (so an empty
 *     but column-correct report still ranks, and a date column breaks ties).
 * Row count is deliberately NOT part of the score (only used as a final,
 * secondary tiebreak by the caller) so a raw per-transaction report can't beat
 * the daily summary just by being larger.
 */
export function scoreProbeForKind(kind: PaiReportKind, s: PaiProbeSummary): number {
  const colHits = countExpectedColumns(kind, s.columns);
  let score = colHits * 100;
  if (s.hasData) score += 10;
  if (s.dateColumns.length > 0) score += 10;
  return score;
}

/**
 * Human label for one candidate report row, preferring its ExternalName (what
 * Michael sees in the portal) and falling back to its internal Name. PURE.
 */
export function candidateLabel(row: PaiReportConfigId): string {
  const ext = (row.externalName ?? "").trim();
  const name = (row.name ?? "").trim();
  if (ext && name && ext.toLowerCase() !== name.toLowerCase()) return `${ext} (${name})`;
  return ext || name || row.reportGuid;
}

/**
 * A plain-English, multi-line summary of the discovery (for the UI + audit).
 * CRITICAL for the "no F12, no guessing" promise: when a report is AMBIGUOUS we
 * now LIST the actual candidate report names (numbered) right in the summary, so
 * Michael can read them on the page and tell us which one — instead of hunting
 * through the audit log. PURE.
 */
export function summarizeDiscovery(discoveries: PaiReportDiscovery[]): string {
  const lines: string[] = [];
  for (const d of discoveries) {
    lines.push(`• ${d.note}`);
    // Only list names when we could NOT confidently match a single report AND
    // there is more than one candidate (i.e. the ambiguous case Michael hit).
    if (!d.matched && d.configCandidates.length > 1) {
      d.configCandidates.forEach((c, i) => {
        lines.push(`    ${i + 1}. ${candidateLabel(c)}`);
      });
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// small internal helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true") return true;
      if (s === "false") return false;
    }
  }
  return false;
}

/** Recursively find the first array under a `fields`/`Fields` key. */
function findFieldsArray(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v; // already the array
  if (!isRecord(v)) return null;
  const direct = v.fields ?? (v as Record<string, unknown>).Fields;
  if (Array.isArray(direct)) return direct;
  // Look one level down (e.g. under a SuccessResponse / ReportConfig wrapper).
  for (const key of Object.keys(v)) {
    const nested = findFieldsArray(v[key]);
    if (nested) return nested;
  }
  return null;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

// ---------------------------------------------------------------------------
// Self-tests (pure — run via scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPaiDiscoveryTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[pai-discovery] ${msg}`);
  };

  // --- parseReportConfigIds --------------------------------------------------
  const idsJson = JSON.stringify([
    { ReportGUID: "G-CASH", ExternalName: "ATMCashLoad", Name: "ATM Cash Load Report" },
    { ReportGUID: "G-SS", ExternalName: "TerminalTrx", Name: "Simple Summary Report" },
    { ReportGUID: "G-FM", ExternalName: "FundsMovement", Name: "Funds Movement By Account By Day" },
  ]);
  const ids = parseReportConfigIds(idsJson);
  assert(ids.length === 3, "parseReportConfigIds returns three rows");
  assert(ids[0].reportGuid === "G-CASH" && ids[0].name === "ATM Cash Load Report", "row 0 parsed");
  // camelCase + wrapper tolerance.
  assert(parseReportConfigIds(JSON.stringify({ results: [{ reportGUID: "X", name: "Y" }] }))[0].reportGuid === "X", "wrapper+camel tolerated");
  // Rows without a GUID are dropped (never invented).
  assert(parseReportConfigIds(JSON.stringify([{ Name: "no guid" }])).length === 0, "no-GUID row dropped");
  assert(parseReportConfigIds("not json") .length === 0, "bad json → []");
  assert(parseReportConfigIds("").length === 0, "empty → []");

  // --- matchReportConfig -----------------------------------------------------
  const mCash = matchReportConfig("cashLoad", ids);
  assert(mCash.confident && mCash.best?.reportGuid === "G-CASH", "cashLoad matched confidently");
  const mFm = matchReportConfig("fundsMovement", ids);
  assert(mFm.confident && mFm.best?.reportGuid === "G-FM", "fundsMovement matched confidently");
  const mSs = matchReportConfig("simpleSummary", ids);
  assert(mSs.confident && mSs.best?.reportGuid === "G-SS", "simpleSummary matched confidently");
  // Ambiguity → not confident, both candidates returned.
  const dup = [
    { reportGuid: "A", externalName: "", name: "ATM Cash Load Report" },
    { reportGuid: "B", externalName: "", name: "ATM Cash Load Report (backup)" },
  ];
  const mDup = matchReportConfig("cashLoad", dup);
  assert(!mDup.confident && mDup.candidates.length === 2 && mDup.best === null, "ambiguous match → not confident");
  // No match → empty.
  assert(matchReportConfig("cashLoad", [{ reportGuid: "Z", externalName: "", name: "User Report" }]).candidates.length === 0, "no match → empty");

  // --- parseReportFields -----------------------------------------------------
  const cfgJson = JSON.stringify({
    SuccessResponse: true,
    fields: [
      { type: "text", readonly: false, name: "Terminal Number" },
      { type: "date", readonly: false, name: "Settlement Date" },
      { type: "money", readonly: true, name: "Surch" },
    ],
  });
  const fields = parseReportFields(cfgJson);
  assert(fields.length === 3, "parseReportFields returns three fields");
  assert(fields[1].name === "Settlement Date" && fields[1].type === "date", "date field parsed");
  // Top-level array form also works.
  assert(parseReportFields(JSON.stringify([{ name: "X", type: "date" }])).length === 1, "top-level fields array parsed");
  assert(parseReportFields("nope").length === 0, "bad json fields → []");

  // --- pickDateField ---------------------------------------------------------
  // 1) Exact expected column wins with highest confidence.
  const pSs = pickDateField("simpleSummary", fields);
  assert(pSs.confident && pSs.fieldName === "Settlement Date", "simpleSummary exact date col");
  assert(pSs.filterKey === "F_Settlement Date", "filterKey preserves the real name (spaces kept)");
  assert(pSs.reason === "expected-column", "reason = expected-column");

  // 2) by-type when expected name absent but exactly one date-typed field.
  const fmFields: PaiReportField[] = [
    { name: "Account", type: "text", readonly: false },
    { name: "Post Date", type: "date", readonly: false },
    { name: "Amount", type: "money", readonly: false },
  ];
  const pFm = pickDateField("fundsMovement", fmFields);
  assert(pFm.confident && pFm.fieldName === "Post Date" && pFm.filterKey === "F_Post Date", "fundsMovement by-type picks Post Date");
  assert(pFm.reason === "by-type", "reason = by-type");

  // 3) by-name-token when no date type but exactly one name-token field.
  const clFields: PaiReportField[] = [
    { name: "Terminal Number", type: "text", readonly: false },
    { name: "Trx Time", type: "text", readonly: false },
    { name: "Cash Load", type: "money", readonly: false },
  ];
  const pCl = pickDateField("cashLoad", clFields);
  assert(pCl.confident && pCl.fieldName === "Trx Time", "cashLoad exact expected col (Trx Time)");

  // Ambiguous: two date columns and none equals the expected → not confident.
  const ambig: PaiReportField[] = [
    { name: "Start Date", type: "date", readonly: false },
    { name: "End Date", type: "date", readonly: false },
  ];
  const pAmbig = pickDateField("fundsMovement", ambig);
  assert(!pAmbig.confident && pAmbig.fieldName === "" && pAmbig.dateCandidates.length === 2, "ambiguous dates → not confident, both listed");

  // None: no date-ish columns at all.
  const none = pickDateField("cashLoad", [{ name: "Amount", type: "money", readonly: false }]);
  assert(!none.confident && none.reason === "none" && none.dateCandidates.length === 0, "no date col → none");

  // --- buildDiscovery + toDateFieldOverride + summary -----------------------
  const fieldsByGuid = new Map<string, PaiReportField[]>([
    ["G-SS", fields],
    ["G-FM", fmFields],
    ["G-CASH", clFields],
  ]);
  const dSs = buildDiscovery("simpleSummary", ids, fieldsByGuid);
  assert(dSs.datePick.confident && dSs.datePick.filterKey === "F_Settlement Date", "buildDiscovery simpleSummary confident");
  const dFm = buildDiscovery("fundsMovement", ids, fieldsByGuid);
  assert(dFm.datePick.filterKey === "F_Post Date", "buildDiscovery fundsMovement → F_Post Date");
  const dCl = buildDiscovery("cashLoad", ids, fieldsByGuid);
  assert(dCl.datePick.filterKey === "F_Trx Time", "buildDiscovery cashLoad → F_Trx Time");

  const override = toDateFieldOverride([dSs, dFm, dCl]);
  assert(
    override.simpleSummary === "F_Settlement Date" &&
      override.fundsMovement === "F_Post Date" &&
      override.cashLoad === "F_Trx Time",
    "toDateFieldOverride includes all three confident picks",
  );

  // A non-confident discovery is EXCLUDED from the override (never write a guess).
  const dAmbig = buildDiscovery("fundsMovement", ids, new Map([["G-FM", ambig]]));
  assert(!dAmbig.datePick.confident, "ambiguous discovery not confident");
  assert(toDateFieldOverride([dAmbig]).fundsMovement === undefined, "ambiguous excluded from override");

  // Unmatched report → helpful note, no override entry.
  const dMissing = buildDiscovery("cashLoad", [{ reportGuid: "Z", externalName: "", name: "User Report" }], new Map());
  assert(dMissing.matched === null && dMissing.note.includes("Couldn’t find"), "missing report noted");

  assert(summarizeDiscovery([dSs]).startsWith("• "), "summary is bulleted");

  // --- candidateLabel + ambiguous summary LISTS the candidate names ----------
  assert(
    candidateLabel({ reportGuid: "g", externalName: "Bank Deposits", name: "FundsMovementByAcct" }) ===
      "Bank Deposits (FundsMovementByAcct)",
    "candidateLabel shows external + internal when they differ",
  );
  assert(
    candidateLabel({ reportGuid: "g", externalName: "", name: "Only Name" }) === "Only Name",
    "candidateLabel falls back to internal name",
  );
  assert(
    candidateLabel({ reportGuid: "GUID-X", externalName: "", name: "" }) === "GUID-X",
    "candidateLabel falls back to the GUID when nameless",
  );
  // Build an AMBIGUOUS discovery (2 candidates) and confirm the summary lists them numbered.
  const ambiguousRows: PaiReportConfigId[] = [
    { reportGuid: "G-A", externalName: "Bank Deposits Daily", name: "BankDepDaily" },
    { reportGuid: "G-B", externalName: "Bank Deposits Monthly", name: "BankDepMonthly" },
  ];
  const dAmbigList = buildDiscovery("fundsMovement", ambiguousRows, new Map());
  const ambigSummary = summarizeDiscovery([dAmbigList]);
  assert(!dAmbigList.matched && dAmbigList.configCandidates.length === 2, "ambiguous discovery keeps both candidates");
  assert(
    ambigSummary.includes("1. Bank Deposits Daily") && ambigSummary.includes("2. Bank Deposits Monthly"),
    "ambiguous summary LISTS the numbered candidate names (no audit-log hunting)",
  );
  // A confident single match must NOT dump a numbered list.
  assert(!summarizeDiscovery([dSs]).includes("    1. "), "confident summary does not list candidates");

  // --- resolveReportChoice (never guesses) -----------------------------------
  const choiceRows: PaiReportConfigId[] = [
    { reportGuid: "G-1", externalName: "Default Simple Summary Report", name: "Terminal Trx Data" },
    { reportGuid: "G-2", externalName: "Simple Summary Report w DCC", name: "Trx Data Report w DCC" },
    { reportGuid: "G-3", externalName: "", name: "Terminal Trx Data" }, // shares NAME with G-1's internal name
  ];
  // By GUID → exact one row, selection prefers the GUID.
  const byGuid = resolveReportChoice(choiceRows, { reportGuid: "G-2" });
  assert(byGuid.ok && byGuid.selection.reportGuid === "G-2" && byGuid.row.reportGuid === "G-2", "resolveReportChoice by GUID → exact row");
  // Unknown GUID → error, no guessing.
  assert(!resolveReportChoice(choiceRows, { reportGuid: "NOPE" }).ok, "resolveReportChoice unknown GUID → error");
  // By unique ExternalName → resolves, selection carries the row's GUID.
  const byExt = resolveReportChoice(choiceRows, { name: "Simple Summary Report w DCC" });
  assert(byExt.ok && byExt.selection.reportGuid === "G-2", "resolveReportChoice by unique external name → row's GUID");
  // Ambiguous name (matches G-1 internal + G-3 internal) with no GUID → error, never guesses.
  const ambigName = resolveReportChoice(choiceRows, { name: "Terminal Trx Data" });
  assert(!ambigName.ok && "error" in ambigName && ambigName.error.includes("2 reports"), "resolveReportChoice ambiguous name → error (no guess)");
  // Unknown name → error.
  assert(!resolveReportChoice(choiceRows, { name: "Does Not Exist" }).ok, "resolveReportChoice unknown name → error");
  // Nothing chosen → error.
  assert(!resolveReportChoice(choiceRows, {}).ok, "resolveReportChoice with no choice → error");

  // --- parseReportSelection (null-safe, typed) -------------------------------
  assert(Object.keys(parseReportSelection(null)).length === 0, "parseReportSelection(null) → {}");
  assert(Object.keys(parseReportSelection("x")).length === 0, "parseReportSelection(non-object) → {}");
  const sel = parseReportSelection({
    simpleSummary: { reportGuid: " G-2 ", name: " Trx " },
    fundsMovement: { name: "Funds Movement By Account By Day" },
    cashLoad: {}, // empty → dropped
    bogus: { reportGuid: "Z" }, // unknown kind → ignored
  });
  assert(sel.simpleSummary?.reportGuid === "G-2" && sel.simpleSummary?.name === "Trx", "parseReportSelection trims + keeps guid+name");
  assert(sel.fundsMovement?.name === "Funds Movement By Account By Day" && sel.fundsMovement?.reportGuid === undefined, "parseReportSelection name-only kept");
  assert(sel.cashLoad === undefined, "parseReportSelection drops empty selection");
  assert(!("bogus" in sel), "parseReportSelection ignores unknown kinds");

  // --- matchReportConfig honors a saved selection (never guesses) ------------
  // A saved GUID beats fuzzy ambiguity: dup rows share a name, but selection.reportGuid resolves ONE.
  const dupSel = matchReportConfig("cashLoad", dup, { reportGuid: "B" });
  assert(dupSel.confident && dupSel.fromSelection === true && dupSel.best?.reportGuid === "B", "matchReportConfig honors saved GUID over ambiguity");
  // A saved exact NAME resolves even when the fuzzy hints would be ambiguous.
  const dupSelName = matchReportConfig("cashLoad", dup, { name: "ATM Cash Load Report (backup)" });
  assert(dupSelName.confident && dupSelName.fromSelection === true && dupSelName.best?.reportGuid === "B", "matchReportConfig honors saved exact name");
  // A selection that does NOT resolve falls through to hints (does not fake a match).
  const staleSel = matchReportConfig("cashLoad", ids, { reportGuid: "GONE" });
  assert(staleSel.fromSelection !== true && staleSel.best?.reportGuid === "G-CASH", "matchReportConfig stale selection → falls back to hints");
  // No selection → same as before (fuzzy).
  assert(matchReportConfig("cashLoad", ids, null).fromSelection === false, "matchReportConfig no selection → fromSelection=false");

  // buildDiscovery threads the selection through (ambiguous rows become confident via GUID).
  const dSelected = buildDiscovery("cashLoad", dup, new Map([["B", clFields]]), { reportGuid: "B" });
  assert(dSelected.matched?.reportGuid === "B" && dSelected.datePick.confident, "buildDiscovery uses saved selection to resolve + read fields");

  // --- summarizeProbeCsv + scoreProbe (evidence, not guessing) ---------------
  // Real CSV with a date column → hasData + dateColumns + score 3.
  const goodCsv = "Terminal,Settlement Date,Amount\nHG26499,2024-03-01,1234\nHG26499,2024-03-02,999";
  const sGood = summarizeProbeCsv(goodCsv);
  assert(sGood.hasData && sGood.rowCount === 2 && sGood.columns.length === 3, "summarizeProbeCsv counts data rows + columns");
  assert(sGood.dateColumns.includes("Settlement Date"), "summarizeProbeCsv finds the date column");
  assert(scoreProbe(sGood) === 3, "scoreProbe data+date → 3");
  // CSV with data but no date column → score 2.
  const noDate = summarizeProbeCsv("Terminal,Amount\nHG26499,1234");
  assert(noDate.hasData && noDate.dateColumns.length === 0 && scoreProbe(noDate) === 2, "scoreProbe data, no date → 2");
  // Header only → score 1.
  const headerOnly = summarizeProbeCsv("Terminal,Amount");
  assert(!headerOnly.hasData && headerOnly.columns.length === 2 && scoreProbe(headerOnly) === 1, "scoreProbe header only → 1");
  // Empty response → score 0.
  const emptyProbe = summarizeProbeCsv("");
  assert(!emptyProbe.hasData && emptyProbe.rowCount === 0 && scoreProbe(emptyProbe) === 0, "scoreProbe empty → 0");
  // PAI HTML error page must NOT be counted as data.
  const htmlErr = summarizeProbeCsv("<!DOCTYPE html><html><body>Session expired</body></html>");
  assert(!htmlErr.hasData && htmlErr.note.includes("web page") && scoreProbe(htmlErr) === 0, "summarizeProbeCsv rejects HTML error page");

  // --- countExpectedColumns + scoreProbeForKind (fit, not size) -------------
  // Real daily Simple Summary header → matches Terminal/Settlement Date/Total Trxs/Surch/Settlement.
  const ssCols = ["Terminal", "Location", "Settlement Date", "Total Trxs", "WD Trxs", "Surcharge WDs", "Surch", "Settlement"];
  assert(countExpectedColumns("simpleSummary", ssCols) === 5, "simpleSummary daily header matches all 5 expected columns");
  // A raw per-transaction "Trx Data" header (more rows, different columns) fits FEWER expected cols.
  const trxCols = ["Terminal", "Trx Date", "Trx Time", "Card", "Amount", "Response"];
  assert(countExpectedColumns("simpleSummary", trxCols) < 5, "raw Trx Data header fits fewer expected simpleSummary columns");
  // Column-fit dominates row count: fewer-row summary must out-score bigger raw report.
  const summaryDaily: PaiProbeSummary = { hasData: true, rowCount: 65, columns: ssCols, dateColumns: ["Settlement Date"], note: "" };
  const summaryRaw: PaiProbeSummary = { hasData: true, rowCount: 235, columns: trxCols, dateColumns: ["Trx Date"], note: "" };
  assert(
    scoreProbeForKind("simpleSummary", summaryDaily) > scoreProbeForKind("simpleSummary", summaryRaw),
    "scoreProbeForKind: column-fit beats raw row count (daily summary > bigger raw report)",
  );
  // fundsMovement + cashLoad token checks.
  assert(countExpectedColumns("fundsMovement", ["Acct #", "Settlement Date", "Settlement Type", "Amount"]) === 4, "fundsMovement matches its 4 expected columns");
  assert(countExpectedColumns("cashLoad", ["Terminal Number", "Trx Time", "Cash Load", "Balance"]) === 3, "cashLoad matches its 3 expected columns");
  // Empty columns → zero hits, and an empty summary scores below any data+fit summary.
  assert(countExpectedColumns("simpleSummary", []) === 0, "no columns → zero expected hits");
  assert(scoreProbeForKind("simpleSummary", summaryDaily) > scoreProbeForKind("simpleSummary", { hasData: false, rowCount: 0, columns: [], dateColumns: [], note: "" }), "fitting summary out-scores empty");

  // --- parseLastProbe (null-safe, never invents a GUID) ---------------------
  assert(Object.keys(parseLastProbe(null)).length === 0, "parseLastProbe(null) → {}");
  assert(Object.keys(parseLastProbe("x")).length === 0, "parseLastProbe(non-object) → {}");
  const lp = parseLastProbe({
    simpleSummary: {
      at: "2024-03-01T00:00:00Z",
      winnerGuid: "G-2",
      candidates: [
        { reportGuid: " G-1 ", name: "A", label: "Report A", rowCount: 235, hasData: true },
        { reportGuid: "G-2", name: "B", label: "Report B", rowCount: 65, hasData: true },
        { name: "no guid", label: "dropped" }, // no GUID → dropped
      ],
    },
    fundsMovement: { candidates: [] }, // empty → dropped
    bogus: { candidates: [{ reportGuid: "Z" }] }, // unknown kind → ignored
  });
  assert(lp.simpleSummary?.candidates.length === 2, "parseLastProbe drops GUID-less candidates");
  assert(lp.simpleSummary?.candidates[0].reportGuid === "G-1", "parseLastProbe trims the GUID");
  assert(lp.simpleSummary?.winnerGuid === "G-2", "parseLastProbe keeps the winner GUID");
  assert(lp.fundsMovement === undefined, "parseLastProbe drops empty-candidate kinds");
  assert(!("bogus" in lp), "parseLastProbe ignores unknown kinds");

  // mergeDateFieldOverride: deep-merge new confirmations into what's saved,
  // NEVER clobbering existing keys (mergeAtmReportConfig is shallow at the top).
  // Nothing saved yet → result is exactly the discovered overrides.
  const mNew = mergeDateFieldOverride(null, { cashLoad: "F_Trx Time" });
  assert(mNew.cashLoad === "F_Trx Time" && Object.keys(mNew).length === 1, "merge into empty");
  // Existing per-report object + a new report → both kept.
  const mAdd = mergeDateFieldOverride({ fundsMovement: "F_Settlement Date" }, { cashLoad: "F_Trx Time" });
  assert(
    mAdd.fundsMovement === "F_Settlement Date" && mAdd.cashLoad === "F_Trx Time" && Object.keys(mAdd).length === 2,
    "merge keeps existing + adds new (no clobber)",
  );
  // A re-discovery for an existing key → the NEW (corrected) value wins.
  const mOverwrite = mergeDateFieldOverride({ cashLoad: "F_Old Name" }, { cashLoad: "F_Trx Time" });
  assert(mOverwrite.cashLoad === "F_Trx Time" && Object.keys(mOverwrite).length === 1, "new value wins on same key");
  // Legacy plain-STRING existing override → preserved under reserved "*" key.
  const mLegacy = mergeDateFieldOverride("F_Legacy", { cashLoad: "F_Trx Time" });
  assert(mLegacy["*"] === "F_Legacy" && mLegacy.cashLoad === "F_Trx Time", "legacy string preserved under '*'");
  // Blank/whitespace values are dropped from both sides (never save an empty name).
  const mBlank = mergeDateFieldOverride({ simpleSummary: "  " }, { cashLoad: "  ", fundsMovement: "F_Settlement Date" });
  assert(
    !("simpleSummary" in mBlank) && !("cashLoad" in mBlank) && mBlank.fundsMovement === "F_Settlement Date",
    "blank names are dropped on both sides",
  );
  // Values are trimmed on the way in.
  const mTrim = mergeDateFieldOverride({}, { cashLoad: "  F_Trx Time  " });
  assert(mTrim.cashLoad === "F_Trx Time", "discovered value is trimmed");

  console.log("pai-discovery: all self-tests passed");
}
