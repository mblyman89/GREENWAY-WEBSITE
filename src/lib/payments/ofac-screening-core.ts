/**
 * R41 S11: OFAC sanctions screening of every ACH payee (employees and vendors).
 *
 * WHY. The signed Timberland ACH agreement, section 3:
 *   "It shall be the responsibility of Company to obtain information regarding
 *    such OFAC enforced sanctions."
 *
 * NEVER BLOCKS A PAYMENT (owner decision, Round 12, verbatim): "Strict is fine
 * with me so long as it doesn't block me from paying my vendors and employees."
 * A possible match is a review item for the owner (page badge + email). Nothing
 * here is read by the payroll or vendor-payment builders.
 *
 * DATA. OFAC's own data files, never the search website (FAQ 287). The format
 * is OFAC's data specification (docs/authorities/ofac/ofac-dat-spec-2023-09-25.txt
 * and ofac-cons-dat-spec.txt), checked against the real files on 2026-10-15:
 * no header row, comma-delimited, `"` text quotes, `-0-` null (written `-0- `),
 * CR LF record ends, one 0x1A byte after the last record, ASCII only.
 * SDN.CSV and CONS_PRIM.CSV: 12 fields. ALT.CSV and CONS_ALT.CSV: 5 fields.
 * A file that does not look exactly like that is REFUSED (never guessed at).
 *
 * METHOD. OFAC FAQ 249 (how the Sanctions List Search score is calculated):
 * Jaro-Winkler on the full name, and each name part compared with Jaro-Winkler
 * and Soundex, "returns the higher of the two scores". OFAC does not publish
 * how it blends Soundex into a part score, so OUR blend is stated here and
 * tested: when two parts share a Soundex code the part score is lifted halfway
 * to 1 ((1 + jw) / 2). OFAC does not recommend a threshold (FAQ 250); OUR
 * threshold is MATCH_THRESHOLD below.
 *
 * WHAT IS NOT SCREENED, and why:
 *   - weak aliases (in the Remarks field): the data spec, "OFAC does not expect
 *     that persons will screen for weak AKAs";
 *   - vessel and aircraft records: a payee is a person or a business (FAQ 5:
 *     "you may receive an alert when an individual or entity has a similar name
 *     or alias to a vessel identified on one of OFAC's lists").
 *
 * REVIEWS. FAQ 5 step 3: "If after you review available information, you can
 * reasonably determine the match is not valid, then you may proceed with the
 * transaction or activity." The owner records each decision with a note (FAQ 5
 * step 6: keep "complete, accurate records"). A "not a match" decision covers a
 * later screen only when the payee, the name screened and every matched list
 * entry are the same as what was reviewed; anything new needs a new review. A
 * "true match" decision is never carried and never cleared.
 *
 * Pure: no I/O. All time comes in as a parameter.
 */

// ───────────────────────────────────────────────────────────── constants ──

/** The download location (OFAC technical notice of 05/16/2024). */
export const OFAC_EXPORT_BASE = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
/** The four files screened: the SDN list and the non-SDN Consolidated list, each with its aliases. */
export const OFAC_FILES = ["SDN.CSV", "ALT.CSV", "CONS_PRIM.CSV", "CONS_ALT.CSV"] as const;
export type OfacFile = (typeof OFAC_FILES)[number];
/** Required: the 2024 notice says requests without a User-Agent get a 403 (checked: they do). */
export const OFAC_USER_AGENT = "GreenwayMarijuana-ACH-OFAC-Screening/1.0";
/** Fields per record, from the data specifications. */
export const OFAC_FIELD_COUNT: Record<OfacFile, 12 | 5> = { "SDN.CSV": 12, "ALT.CSV": 5, "CONS_PRIM.CSV": 12, "CONS_ALT.CSV": 5 };

/**
 * OUR threshold (OFAC FAQ 250: "OFAC cannot make such a recommendation").
 * 0.85 on a 0..1 scale (85 on OFAC's 0..100 slider). Lower is stricter (more
 * possible matches to review). The owner asked for strict; review is cheap
 * and nothing is blocked.
 */
export const MATCH_THRESHOLD = 0.85;
/** Winkler's standard prefix scale and maximum prefix length. */
export const JW_PREFIX_SCALE = 0.1;
export const JW_MAX_PREFIX = 4;
/** At most this many list entries are kept per payee (highest scores first). */
export const MAX_MATCHES_KEPT = 10;
/** The page turns amber when the last successful screen is older than this. */
export const STALE_AFTER_DAYS = 3;

/**
 * Words dropped before matching (business-form words and articles). Kept short
 * and listed so a reviewer can see exactly what is ignored.
 */
export const IGNORED_WORDS: readonly string[] = ["LLC", "L L C", "INC", "INCORPORATED", "CO", "CORP", "CORPORATION", "LTD", "LIMITED", "COMPANY", "LLP", "LP", "PLLC", "PC", "THE", "DBA"];
const IGNORED = new Set(IGNORED_WORDS.filter((w) => !w.includes(" ")));

export const OFAC_QUOTES = {
  agreement3: "It shall be the responsibility of Company to obtain information regarding such OFAC enforced sanctions.",
  faq249:
    "The first technique involves using the Jaro-Winkler algorithm to compare the entire name string entered against full name strings of potential match entries on OFAC's sanctions lists. The second technique involves splitting the name string entered into multiple name parts (for example, John Doe would be split into two name parts). Each name part is then compared to name parts on all of OFAC's sanctions lists using the Jaro-Winkler and Soundex algorithms.",
  faq249Higher: "Sanctions List Search uses both techniques each time the search is run and returns the higher of the two scores in the Score column.",
  faq250: "OFAC cannot make such a recommendation because each search has its own unique set of facts surrounding it.",
  faq287: "It should not be utilized by automated systems that are configured to continually run searches through the tool.",
  faq5FalsePositives: "Many potential matches identified through screening are false positives.",
  faq5Proceed: "If after you review available information, you can reasonably determine the match is not valid, then you may proceed with the transaction or activity.",
  faq5Records:
    "Organizations should keep complete, accurate records detailing the steps taken to investigate the potential match and the information relied upon to ultimately determine whether the potential match was valid.",
  faq5Report: "If you block property or reject transactions or activity due to OFAC sanctions, you must report the action to OFAC within 10 business days",
  weakAka: "As a general\nmatter, though, OFAC does not expect that persons will screen for weak\nAKAs",
  userAgent: "Therefore, users will need to explicitly add the User-Agent value to their HTTP request headers to avoid receiving this 403 error.",
} as const;

// ──────────────────────────────────────────────────────────── file parse ──

export type ParseResult = { ok: true; records: (string | null)[][] } | { ok: false; error: string };

/** Bytes to text, refusing anything that is not ASCII (the spec: "ASCII text files"). */
export function decodeOfacAscii(bytes: Uint8Array, file: string): { ok: true; text: string } | { ok: false; error: string } {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 127) return { ok: false, error: `${file}: byte ${i + 1} is not ASCII. OFAC's data specification says the files are ASCII, so the format may have changed. Nothing was screened.` };
  }
  let s = "";
  const CH = 8192;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return { ok: true, text: s };
}

const EOF_MARK = "\x1a";

/**
 * Parse one OFAC CSV file to its records. Refuses: a missing end-of-file mark
 * (a cut-short download), a record with the wrong number of fields, a stray
 * quote, a bare CR or LF, an empty file.
 * Null (`-0-`, written with a trailing space) becomes null; quoted text is kept
 * exactly; unquoted text is trimmed.
 */
export function parseOfacCsv(text: string, fieldCount: 12 | 5, file: string): ParseResult {
  if (!text.endsWith(`\r\n${EOF_MARK}`)) {
    return { ok: false, error: `${file}: the file does not end with OFAC's end-of-file mark, so the download may be cut short. Nothing was screened.` };
  }
  const body = text.slice(0, -1);
  const records: (string | null)[][] = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    const rec: (string | null)[] = [];
    const recNo = records.length + 1;
    for (;;) {
      let value: string | null;
      if (body[i] === '"') {
        const close = body.indexOf('"', i + 1);
        if (close < 0) return { ok: false, error: `${file}: record ${recNo} has an unclosed quote.` };
        value = body.slice(i + 1, close);
        if (/[\r\n]/.test(value)) return { ok: false, error: `${file}: record ${recNo} has a line break inside quotes.` };
        i = close + 1;
        // only spaces may follow a closing quote before the delimiter
        while (body[i] === " ") i++;
      } else {
        let j = i;
        while (j < n && body[j] !== "," && body[j] !== "\r" && body[j] !== "\n") j++;
        const raw = body.slice(i, j);
        if (raw.includes('"')) return { ok: false, error: `${file}: record ${recNo} has a quote inside an unquoted field.` };
        const t = raw.trim();
        value = t === "-0-" ? null : t;
        i = j;
      }
      rec.push(value);
      if (body[i] === ",") {
        i++;
        continue;
      }
      if (body[i] === "\r" && body[i + 1] === "\n") {
        i += 2;
        break;
      }
      return { ok: false, error: `${file}: record ${recNo} does not end with CR LF.` };
    }
    if (rec.length !== fieldCount) {
      return { ok: false, error: `${file}: record ${recNo} has ${rec.length} fields; OFAC's data specification says ${fieldCount}. Nothing was screened.` };
    }
    records.push(rec);
  }
  if (records.length === 0) return { ok: false, error: `${file}: the file has no records.` };
  return { ok: true, records };
}

// ─────────────────────────────────────────────────────────── algorithms ──

/** Jaro similarity (0..1). Characters match within floor(max/2) - 1 positions. */
export function jaro(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aM = new Uint8Array(la);
  const bM = new Uint8Array(lb);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(lb - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bM[j] && a.charCodeAt(i) === b.charCodeAt(j)) {
        aM[i] = 1;
        bM[j] = 1;
        m++;
        break;
      }
    }
  }
  if (m === 0) return 0;
  let k = 0;
  let half = 0;
  for (let i = 0; i < la; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a.charCodeAt(i) !== b.charCodeAt(k)) half++;
    k++;
  }
  const t = half / 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}

/** Jaro-Winkler similarity: jaro + l * p * (1 - jaro), l = common prefix up to 4, p = 0.1. */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let l = 0;
  const max = Math.min(JW_MAX_PREFIX, a.length, b.length);
  while (l < max && a.charCodeAt(l) === b.charCodeAt(l)) l++;
  return j + l * JW_PREFIX_SCALE * (1 - j);
}

const SOUNDEX_CODE: Record<string, string> = {
  B: "1", F: "1", P: "1", V: "1",
  C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
  D: "3", T: "3",
  L: "4",
  M: "5", N: "5",
  R: "6",
};

/**
 * American Soundex as the National Archives describes it
 * (docs/authorities/ofac/nara-soundex-system.txt): first letter, then three
 * digits; same-code neighbours count once; a vowel between two same-code
 * letters codes both; H or W between them does not. Letters only; '' when the
 * part has no letter.
 */
export function soundex(part: string): string {
  const s = part.toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  let out = s[0];
  let prev = SOUNDEX_CODE[s[0]] ?? "";
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const ch = s[i];
    if (ch === "H" || ch === "W") continue;
    const code = SOUNDEX_CODE[ch];
    if (!code) {
      prev = ""; // A E I O U Y separate
      continue;
    }
    if (code !== prev) out += code;
    prev = code;
  }
  return out.padEnd(4, "0");
}

/** One name part against one list name part: Jaro-Winkler, lifted halfway to 1 when the Soundex codes agree (OUR blend). */
export function partScore(p: string, t: string, ps = soundex(p), ts = soundex(t)): number {
  const jw = jaroWinkler(p, t);
  return ps !== "" && ps === ts ? Math.max(jw, (1 + jw) / 2) : jw;
}

/** Upper case, accents off, anything not A-Z or 0-9 becomes a space. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** The name parts that are compared: ignored words and single letters dropped, unless that leaves nothing. */
export function nameParts(s: string): string[] {
  const all = normalizeName(s).split(" ").filter(Boolean);
  const kept = all.filter((w) => !IGNORED.has(w) && w.length > 1);
  return kept.length > 0 ? kept : all;
}

// ─────────────────────────────────────────────────────────────── index ──

export type OfacListName = "SDN" | "CONS";

export type IndexEntry = {
  /** `${list}:${ent_num}`. */
  key: string;
  list: OfacListName;
  entNum: string;
  /** The name as OFAC wrote it. */
  name: string;
  /** primary, aka, fka or nka. */
  kind: "primary" | "aka" | "fka" | "nka";
  sdnType: string | null;
  program: string | null;
  remarks: string | null;
  parts: string[];
  full: string;
};

export type OfacIndex = {
  entries: IndexEntry[];
  /** Unique name parts across the lists. */
  tokens: string[];
  tokenSoundex: string[];
  /** For each entry, the ids of its parts in `tokens`. */
  entryTokenIds: Int32Array[];
  counts: { sdn: number; alt: number; consPrim: number; consAlt: number; skippedVesselAircraft: number; screenedNames: number };
};

export type OfacRecords = Record<OfacFile, (string | null)[][]>;

/** Build the screening index. Refuses a record whose id or name is missing, or an unknown alias type. */
export function buildOfacIndex(r: OfacRecords): { ok: true; index: OfacIndex } | { ok: false; error: string } {
  const entries: IndexEntry[] = [];
  let skipped = 0;
  const primaries = new Map<string, { type: string | null; program: string | null; remarks: string | null; skip: boolean }>();
  const addPrimary = (file: "SDN.CSV" | "CONS_PRIM.CSV", list: OfacListName): string | null => {
    for (let i = 0; i < r[file].length; i++) {
      const rec = r[file][i];
      const ent = rec[0];
      const name = rec[1];
      if (!ent || !/^\d+$/.test(ent)) return `${file}: record ${i + 1} has no valid ent_num.`;
      if (!name) return `${file}: record ${i + 1} has no name.`;
      const type = rec[2];
      const skip = type === "vessel" || type === "aircraft";
      primaries.set(`${list}:${ent}`, { type, program: rec[3], remarks: rec[11], skip });
      if (skip) {
        skipped++;
        continue;
      }
      entries.push({ key: `${list}:${ent}`, list, entNum: ent, name, kind: "primary", sdnType: type, program: rec[3], remarks: rec[11], parts: nameParts(name), full: "" });
    }
    return null;
  };
  const addAlt = (file: "ALT.CSV" | "CONS_ALT.CSV", list: OfacListName): string | null => {
    for (let i = 0; i < r[file].length; i++) {
      const rec = r[file][i];
      const ent = rec[0];
      const kind = rec[2];
      const name = rec[3];
      if (!ent || !/^\d+$/.test(ent)) return `${file}: record ${i + 1} has no valid ent_num.`;
      if (kind !== "aka" && kind !== "fka" && kind !== "nka") return `${file}: record ${i + 1} has alias type "${kind ?? ""}"; the data specification allows aka, fka or nka.`;
      if (!name) return `${file}: record ${i + 1} has no alias name.`;
      const p = primaries.get(`${list}:${ent}`);
      if (p?.skip) {
        skipped++;
        continue;
      }
      entries.push({ key: `${list}:${ent}`, list, entNum: ent, name, kind, sdnType: p?.type ?? null, program: p?.program ?? null, remarks: p?.remarks ?? null, parts: nameParts(name), full: "" });
    }
    return null;
  };
  const err = addPrimary("SDN.CSV", "SDN") ?? addPrimary("CONS_PRIM.CSV", "CONS") ?? addAlt("ALT.CSV", "SDN") ?? addAlt("CONS_ALT.CSV", "CONS");
  if (err) return { ok: false, error: `${err} Nothing was screened.` };
  const tokenId = new Map<string, number>();
  const tokens: string[] = [];
  const entryTokenIds: Int32Array[] = [];
  for (const e of entries) {
    e.full = e.parts.join(" ");
    const ids = new Int32Array(e.parts.length);
    e.parts.forEach((p, k) => {
      let id = tokenId.get(p);
      if (id === undefined) {
        id = tokens.length;
        tokens.push(p);
        tokenId.set(p, id);
      }
      ids[k] = id;
    });
    entryTokenIds.push(ids);
  }
  return {
    ok: true,
    index: {
      entries,
      tokens,
      tokenSoundex: tokens.map((t) => soundex(t)),
      entryTokenIds,
      counts: { sdn: r["SDN.CSV"].length, alt: r["ALT.CSV"].length, consPrim: r["CONS_PRIM.CSV"].length, consAlt: r["CONS_ALT.CSV"].length, skippedVesselAircraft: skipped, screenedNames: entries.length },
    },
  };
}

// ──────────────────────────────────────────────────────────── screening ──

export type NameMatch = {
  key: string;
  list: OfacListName;
  entNum: string;
  listName: string;
  kind: IndexEntry["kind"];
  sdnType: string | null;
  program: string | null;
  remarks: string | null;
  /** 0..1, rounded to 4 places. */
  score: number;
  /** The payee name that matched. */
  screenedName: string;
};

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

/**
 * Screen one name. Score per list name = the higher of
 *   full:      Jaro-Winkler of the whole name (parts joined) against the list name;
 *   composite: the average, over the payee's name parts, of the best part score
 *              against the list name's parts.
 * A list name scoring at or above the threshold is a possible match. One list
 * entry (primary or alias) appears once, at its best score.
 */
export function screenName(index: OfacIndex, name: string, threshold = MATCH_THRESHOLD): NameMatch[] {
  const parts = nameParts(name);
  if (parts.length === 0) return [];
  const full = parts.join(" ");
  const T = index.tokens.length;
  const partScores: Float32Array[] = parts.map((p) => {
    const ps = soundex(p);
    const out = new Float32Array(T);
    for (let t = 0; t < T; t++) out[t] = partScore(p, index.tokens[t], ps, index.tokenSoundex[t]);
    return out;
  });
  const best = new Map<string, NameMatch>();
  for (let e = 0; e < index.entries.length; e++) {
    const ids = index.entryTokenIds[e];
    if (ids.length === 0) continue;
    let sum = 0;
    for (const ps of partScores) {
      let m = 0;
      for (let k = 0; k < ids.length; k++) if (ps[ids[k]] > m) m = ps[ids[k]];
      sum += m;
    }
    const composite = sum / parts.length;
    const entry = index.entries[e];
    const whole = jaroWinkler(full, entry.full);
    const score = Math.max(composite, whole);
    if (score + 1e-9 < threshold) continue;
    const prev = best.get(entry.key);
    if (prev && prev.score >= r4(score)) continue;
    best.set(entry.key, {
      key: entry.key,
      list: entry.list,
      entNum: entry.entNum,
      listName: entry.name,
      kind: entry.kind,
      sdnType: entry.sdnType,
      program: entry.program,
      remarks: entry.remarks ? entry.remarks.slice(0, 400) : null,
      score: r4(score),
      screenedName: name,
    });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

export type Payee = { payeeType: "employee" | "vendor"; payeeId: string; label: string; names: string[] };

export type PayeeResult = {
  payeeType: "employee" | "vendor";
  payeeId: string;
  label: string;
  namesScreened: string[];
  result: "clear" | "possible_match";
  topScore: number;
  matches: NameMatch[];
};

/** The distinct names to screen for one payee (blank and duplicate names, after normalizing, dropped). */
export function distinctNames(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = (n ?? "").replace(/\s+/g, " ").trim();
    const k = normalizeName(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.slice(0, 300));
  }
  return out;
}

/** Screen every payee. A payee with no screenable name is reported, never silently passed. */
export function screenPayees(index: OfacIndex, payees: readonly Payee[], threshold = MATCH_THRESHOLD): { results: PayeeResult[]; unscreenable: Payee[] } {
  const cache = new Map<string, NameMatch[]>();
  const results: PayeeResult[] = [];
  const unscreenable: Payee[] = [];
  for (const p of payees) {
    const names = distinctNames(p.names);
    if (names.length === 0) {
      unscreenable.push(p);
      continue;
    }
    const byKey = new Map<string, NameMatch>();
    for (const n of names) {
      const k = normalizeName(n);
      let ms = cache.get(k);
      if (!ms) {
        ms = screenName(index, n, threshold);
        cache.set(k, ms);
      }
      for (const m of ms) {
        const mm = { ...m, screenedName: n };
        const prev = byKey.get(m.key);
        if (!prev || mm.score > prev.score) byKey.set(m.key, mm);
      }
    }
    const matches = [...byKey.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, MAX_MATCHES_KEPT);
    results.push({
      payeeType: p.payeeType,
      payeeId: p.payeeId,
      label: p.label.slice(0, 300),
      namesScreened: names,
      result: matches.length > 0 ? "possible_match" : "clear",
      topScore: matches[0]?.score ?? 0,
      matches,
    });
  }
  return { results, unscreenable };
}

/** A stable fingerprint input for the payee set (the store hashes it): screening runs again when it changes. */
export function payeeSetText(payees: readonly Payee[]): string {
  return payees
    .map((p) => `${p.payeeType}:${p.payeeId}:${distinctNames(p.names).map(normalizeName).sort().join("|")}`)
    .sort()
    .join("\n");
}

// ──────────────────────────────────────────────────── download metadata ──

/**
 * OFAC's HEAD answer for SDN.CSV carries `Digest: sha-256<hex>` (seen 2026-10-15,
 * no "=" sign). Accept that form and the RFC 3230 `sha-256=<hex>` form; anything
 * else is "not recognised" (recorded, not guessed).
 */
export function parseOfacDigest(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^\s*sha-256=?([0-9a-fA-F]{64})\s*$/i.exec(header);
  return m ? m[1].toLowerCase() : null;
}

// ──────────────────────────────────────────────────────────── reviews ──

export type ReviewDecision = "not_a_match" | "true_match";
export const REVIEW_DECISIONS: readonly ReviewDecision[] = ["not_a_match", "true_match"];

export type StoredResult = {
  id: string;
  runId: string;
  payeeType: "employee" | "vendor";
  payeeId: string;
  label: string;
  namesScreened: string[];
  result: "clear" | "possible_match";
  topScore: number;
  matches: NameMatch[];
};

export type StoredReview = {
  id: string;
  resultId: string;
  payeeType: "employee" | "vendor";
  payeeId: string;
  decision: ReviewDecision;
  /** `${key}|${normalized screened name}` for every match that was reviewed. */
  matchKeys: string[];
  note: string;
  reviewedAt: string;
};

/** The key a review covers: the list entry AND the payee name that hit it. */
export function matchKey(m: Pick<NameMatch, "key" | "screenedName">): string {
  return `${m.key}|${normalizeName(m.screenedName)}`;
}

export type ResultStatus =
  | { status: "clear" }
  | { status: "needs_review" }
  | { status: "reviewed"; review: StoredReview }
  | { status: "covered"; review: StoredReview }
  | { status: "true_match"; review: StoredReview };

/**
 * Where a result stands. A review of THIS result decides it. Otherwise an
 * earlier "not a match" review of the same payee covers it only if every
 * current match key was in that review. A "true match" anywhere for the payee
 * keeps it red. Nothing clears by itself.
 */
export function resultStatus(r: StoredResult, reviews: readonly StoredReview[]): ResultStatus {
  const mine = reviews.filter((v) => v.payeeType === r.payeeType && v.payeeId === r.payeeId);
  const trueMatch = mine.find((v) => v.decision === "true_match");
  if (trueMatch) return { status: "true_match", review: trueMatch };
  if (r.result === "clear") return { status: "clear" };
  const own = mine.find((v) => v.resultId === r.id);
  if (own) return { status: "reviewed", review: own };
  const keys = r.matches.map(matchKey);
  const cover = mine
    .filter((v) => v.decision === "not_a_match")
    .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
    .find((v) => keys.every((k) => v.matchKeys.includes(k)));
  if (cover) return { status: "covered", review: cover };
  return { status: "needs_review" };
}

export type ReviewForm = { ok: true; resultId: string; decision: ReviewDecision; note: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The review form (the 0278 trigger checks the same again). */
export function checkReviewForm(get: (k: string) => string | null): ReviewForm {
  const resultId = (get("result_id") ?? "").trim();
  if (!UUID.test(resultId)) return { ok: false, error: "Pick the possible match to review." };
  const decision = (get("decision") ?? "").trim();
  if (decision !== "not_a_match" && decision !== "true_match") return { ok: false, error: "Choose: not a match, or a true match." };
  const note = (get("note") ?? "").replace(/\s+/g, " ").trim();
  if (note.length < 20) return { ok: false, error: "Write what you compared (at least 20 characters), for example the date of birth, country or business registration that does not match. OFAC asks for complete records of the review." };
  if (note.length > 2000) return { ok: false, error: "The note is too long (2,000 characters at most)." };
  if (/\d{7,}/.test(note)) return { ok: false, error: "The note has a run of 7 or more digits. Leave out account, routing, SSN and ID numbers." };
  return { ok: true, resultId, decision, note };
}

/** The 0278 error codes, in plain words. Unknown errors are never echoed (they may hold data). */
export function ofacDbErrorMessage(msg: string | null | undefined): string {
  const m = msg ?? "";
  if (/OFAC_APPEND_ONLY/.test(m)) return "Screening records are never changed or deleted.";
  if (/ACH_OWNER_ONLY/.test(m)) return "Only the owner records a screening review. Send it as a request for owner approval.";
  if (/OFAC_REVIEW_TARGET/.test(m)) return "That screening result is not a possible match, or it was not found.";
  if (/OFAC_REVIEW_NOTE/.test(m)) return "The note must be 20 to 2,000 characters with no run of 7 or more digits.";
  if (/duplicate key|ofac_reviews_once/i.test(m)) return "That possible match was already reviewed.";
  if (/ofac_screening_runs|ofac_screening_results|ofac_match_reviews|ofac_record_run/.test(m) && /does not exist|schema cache/i.test(m)) {
    return "Sanctions screening is not set up yet: apply migration 0278.";
  }
  return "The screening record could not be saved. Reload the page and try again.";
}

// ─────────────────────────────────────────────────────────────── words ──

export type RunSummary = {
  ranAt: string;
  payees: number;
  possibleMatches: number;
  needsReview: number;
  trueMatches: number;
  unscreenable: number;
  listLastModified: string | null;
  digestVerified: boolean;
};

/** The owner email after a run that needs attention (null when nothing does). */
export function screeningEmail(s: RunSummary, link: string): { subject: string; text: string } | null {
  if (s.needsReview === 0 && s.trueMatches === 0 && s.unscreenable === 0) return null;
  const bits: string[] = [];
  if (s.trueMatches > 0) bits.push(`${s.trueMatches} payee(s) you marked as a TRUE match`);
  if (s.needsReview > 0) bits.push(`${s.needsReview} possible match(es) to review`);
  if (s.unscreenable > 0) bits.push(`${s.unscreenable} payee(s) with no name to screen`);
  return {
    subject: `OFAC screening: ${bits.join(", ")}`,
    text:
      `The sanctions screen ran at ${s.ranAt} against OFAC's lists (last modified ${s.listLastModified ?? "unknown"}). ` +
      `${bits.join("; ")}. Nothing is blocked: payroll and vendor payments run as usual. ` +
      `Most possible matches are false positives (OFAC FAQ 5). Open the screening page, compare the details, and record your decision: ${link}`,
  };
}

/** The failure email (download or format problem). */
export function screeningFailedEmail(error: string, link: string): { subject: string; text: string } {
  return {
    subject: "OFAC screening could not run today",
    text: `The sanctions screen did not run: ${error} Payments are not affected. It will try again tomorrow; you can also press Screen now on ${link}.`,
  };
}

export function staleness(lastRanAt: string | null, now: Date): { stale: boolean; text: string } {
  if (!lastRanAt) return { stale: true, text: "No screening has run yet." };
  const days = Math.floor((now.getTime() - Date.parse(lastRanAt)) / 86400000);
  if (days >= STALE_AFTER_DAYS) return { stale: true, text: `The last successful screen was ${days} days ago. The daily check may be failing.` };
  return { stale: false, text: days === 0 ? "Screened today." : `Screened ${days} day(s) ago.` };
}

// ─────────────────────────────────────────────────────────── self-tests ──

export function __runOfacScreeningCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ofac-screening-core self-test FAILED: ${name}`);
    }
  };
  const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

  // Jaro / Jaro-Winkler. FAREMVIEL/FARMVILLE: Wikipedia's worked Jaro example
  // (8 matches, 1 transposition: (8/9 + 8/9 + 7/8) / 3). Other values
  // cross-checked against the jellyfish 1.2.1 Python library.
  ok(near(jaro("FAREMVIEL", "FARMVILLE"), (8 / 9 + 8 / 9 + 7 / 8) / 3), "jaro FAREMVIEL/FARMVILLE");
  ok(near(jaroWinkler("MARTHA", "MARHTA"), 0.961111, 1e-6), "jw MARTHA/MARHTA 0.961111");
  ok(near(jaro("MARTHA", "MARHTA"), 0.944444, 1e-6), "jaro MARTHA/MARHTA 0.944444");
  ok(near(jaroWinkler("DWAYNE", "DUANE"), 0.84, 1e-6), "jw DWAYNE/DUANE 0.84");
  ok(near(jaroWinkler("DIXON", "DICKSON"), 0.832381, 1e-6), "jw DIXON/DICKSON 0.832381");
  ok(near(jaroWinkler("JONATHON", "JONATHAN"), 0.95, 1e-6), "jw JONATHON/JONATHAN 0.95");
  ok(near(jaroWinkler("SHACKLEFORD", "SHACKELFORD"), 0.981818, 1e-6), "jw SHACKLEFORD/SHACKELFORD");
  ok(near(jaroWinkler("CRATE", "TRACE"), 0.733333, 1e-6), "jw CRATE/TRACE 0.733333 (no common prefix)");
  ok(jaroWinkler("ABC", "XYZ") === 0 && jaro("", "") === 0 && jaro("A", "") === 0, "no common characters, empty: 0");
  ok(jaroWinkler("SMITH", "SMITH") === 1, "identical: 1");
  ok(near(jaroWinkler("ABCDEFG", "ABCDEFX"), jaro("ABCDEFG", "ABCDEFX") + 4 * 0.1 * (1 - jaro("ABCDEFG", "ABCDEFX"))), "prefix capped at 4");

  // Soundex: every example on the National Archives page.
  const sx: [string, string][] = [["Washington", "W252"], ["Lee", "L000"], ["Gutierrez", "G362"], ["Pfister", "P236"], ["Jackson", "J250"], ["Tymczak", "T522"], ["Ashcraft", "A261"], ["VanDeusen", "V532"], ["Deusen", "D250"]];
  for (const [n, c] of sx) ok(soundex(n) === c, `soundex ${n} ${c}`);
  ok(soundex("Robert") === soundex("Rupert") && soundex("Robert") === "R163", "soundex Robert = Rupert = R163");
  ok(soundex("123") === "" && soundex("") === "", "soundex: no letters, empty code");
  ok(near(partScore("ROBERT", "RUPERT"), (1 + jaroWinkler("ROBERT", "RUPERT")) / 2), "part score lifted halfway when Soundex agrees");
  ok(partScore("SMITH", "JONES") === jaroWinkler("SMITH", "JONES"), "part score is plain JW when Soundex differs");

  // names
  ok(normalizeName("  José  O'Brien-Núñez, LLC ") === "JOSE O BRIEN NUNEZ LLC", "normalize: accents, punctuation");
  ok(nameParts("Green Valley Farms, LLC").join(" ") === "GREEN VALLEY FARMS", "parts: LLC dropped");
  ok(nameParts("The Company LLC").join(" ") === "THE COMPANY LLC", "parts: all ignored words, keep them all");
  ok(nameParts("John Q Public").join(" ") === "JOHN PUBLIC", "parts: single letters dropped");
  ok(distinctNames(["Acme LLC", "ACME, LLC", " ", null, "Acme Farms"]).join("|") === "Acme LLC|Acme Farms", "distinct names after normalizing");

  // CSV parser against the real file shape
  const SDN = '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \r\n306,"BANCO NACIONAL DE CUBA",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"a.k.a. \'BNC\'."\r\n\x1a';
  const p = parseOfacCsv(SDN, 12, "SDN.CSV");
  ok(p.ok && p.records.length === 2, "parse: two records");
  ok(p.ok && p.records[0][0] === "36" && p.records[0][1] === "AEROCARIBBEAN AIRLINES" && p.records[0][2] === null, "parse: id, quoted name, -0- null");
  ok(p.ok && p.records[1][11] === "a.k.a. 'BNC'.", "parse: remarks kept exactly");
  ok(p.ok && p.records.every((r) => r.length === 12), "parse: 12 fields");
  ok(!parseOfacCsv(SDN.slice(0, -1), 12, "SDN.CSV").ok, "refuse: no end-of-file mark");
  ok(!parseOfacCsv(SDN.slice(0, 60) + "\r\n\x1a", 12, "SDN.CSV").ok, "refuse: cut-short record");
  ok(!parseOfacCsv(SDN, 5, "ALT.CSV").ok, "refuse: wrong field count");
  ok(/fields; OFAC's data specification says 5/.test((parseOfacCsv(SDN, 5, "ALT.CSV") as { error: string }).error), "refusal names the spec");
  ok(!parseOfacCsv('1,"A,-0- \r\n\x1a', 3 as never, "X").ok, "refuse: unclosed quote");
  ok(!parseOfacCsv('1,A"B,-0- ,-0- ,-0- \r\n\x1a', 5, "ALT.CSV").ok, "refuse: stray quote");
  ok(!parseOfacCsv('1,2,"aka","X",-0- \n\x1a', 5, "ALT.CSV").ok, "refuse: LF without CR");
  ok(!parseOfacCsv("\x1a", 5, "ALT.CSV").ok && !parseOfacCsv("\r\n\x1a", 5, "ALT.CSV").ok, "refuse: empty");
  ok(parseOfacCsv('1,2,"aka","A, B",-0- \r\n\x1a', 5, "ALT.CSV").ok, "comma inside quotes is text");
  const enc = new TextEncoder();
  ok(decodeOfacAscii(enc.encode("ABC\x1a"), "X").ok, "ascii ok");
  ok(!decodeOfacAscii(enc.encode("Né"), "X").ok, "refuse: non-ASCII");

  // index + screening
  const rec = (s: string, n: 12 | 5) => {
    const r = parseOfacCsv(s, n, "t");
    if (!r.ok) throw new Error(r.error);
    return r.records;
  };
  const lists: OfacRecords = {
    "SDN.CSV": rec(
      '100,"PETROV, Oleg Vladimirovich","individual","RUSSIA-EO14024",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 01 Jan 1970."\r\n' +
        '200,"SARAH",-0- ,"IRAN",-0- ,-0- ,"Crude Oil Tanker",-0- ,-0- ,-0- ,-0- ,-0- \r\n'.replace('-0- ,"IRAN"', '"vessel","IRAN"') +
        '300,"BLUE SKY TRADING LLC",-0- ,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \r\n\x1a',
      12,
    ),
    "ALT.CSV": rec('100,1,"aka","PETROV, Oleg",-0- \r\n200,2,"fka","SARA",-0- \r\n\x1a', 5),
    "CONS_PRIM.CSV": rec('9,"ZHANG, Wei","individual","CMIC-EO13959",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \r\n\x1a', 12),
    "CONS_ALT.CSV": rec('9,5,"aka","CHANG WEI",-0- \r\n\x1a', 5),
  };
  const b = buildOfacIndex(lists);
  ok(b.ok, "index builds");
  if (b.ok) {
    const ix = b.index;
    ok(ix.counts.skippedVesselAircraft === 2 && ix.entries.every((e) => e.entNum !== "200"), "vessel and its alias skipped");
    ok(ix.counts.screenedNames === 5, "5 names screened (3 primaries, 2 aliases)");
    const m1 = screenName(ix, "Oleg Petrov");
    ok(m1.length === 1 && m1[0].key === "SDN:100" && m1[0].score === 1, "name order does not matter (name parts)");
    ok(m1[0]?.program === "RUSSIA-EO14024" && m1[0]?.remarks === "DOB 01 Jan 1970.", "match carries program and remarks for review");
    const m2 = screenName(ix, "Olek Petrof");
    ok(m2.length === 1 && m2[0].score >= MATCH_THRESHOLD && m2[0].score < 1, "misspelling still a possible match");
    ok(screenName(ix, "Sarah Johnson").length === 0, "vessel name never matches a person");
    ok(screenName(ix, "Green Valley Farms LLC").length === 0, "unrelated business: clear");
    const m3 = screenName(ix, "Blue Sky Trading Co");
    ok(m3.length === 1 && m3[0].score === 1, "business form words ignored (LLC vs Co)");
    const m4 = screenName(ix, "Wei Zhang");
    ok(m4.length === 1 && m4[0].list === "CONS" && m4[0].key === "CONS:9", "consolidated list screened, one entry once");
    ok(screenName(ix, "Wei Zhang", 1.01).length === 0, "threshold respected");
    ok(screenName(ix, "!!!").length === 0, "no name parts: no matches");
    const sp = screenPayees(ix, [
      { payeeType: "employee", payeeId: "e1", label: "Oleg P", names: ["Oleg Petrov"] },
      { payeeType: "vendor", payeeId: "v1", label: "Acme", names: ["Acme Farms LLC", "ACME FARMS, LLC"] },
      { payeeType: "vendor", payeeId: "v2", label: "No name", names: [" ", null as never] },
    ]);
    ok(sp.results.length === 2 && sp.unscreenable.length === 1 && sp.unscreenable[0].payeeId === "v2", "a payee with no name is reported, not passed");
    ok(sp.results[0].result === "possible_match" && sp.results[0].topScore === 1, "possible match result");
    ok(sp.results[1].result === "clear" && sp.results[1].namesScreened.length === 1, "clear result, duplicate name screened once");
    const bad = buildOfacIndex({ ...lists, "ALT.CSV": rec('100,1,"xyz","X",-0- \r\n\x1a', 5) });
    ok(!bad.ok && /aka, fka or nka/.test(bad.error), "refuse: unknown alias type");
    const bad2 = buildOfacIndex({ ...lists, "SDN.CSV": rec('A1,"X",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \r\n\x1a', 12) });
    ok(!bad2.ok && /ent_num/.test(bad2.error), "refuse: bad ent_num");
  }

  // digest + run decisions
  const hex = "0dee0d2de5e5a240e3e545741ee2903cfa3508666d2f2841d5d1ff2d59f0ce71";
  ok(parseOfacDigest(`sha-256${hex}`) === hex, "digest: OFAC's form (no =)");
  ok(parseOfacDigest(`SHA-256=${hex.toUpperCase()}`) === hex, "digest: RFC form");
  ok(parseOfacDigest("md5=abc") === null && parseOfacDigest(null) === null && parseOfacDigest(`sha-256${hex}0`) === null, "digest: anything else is not recognised");
  ok(payeeSetText([{ payeeType: "vendor", payeeId: "b", label: "", names: ["Y"] }, { payeeType: "vendor", payeeId: "a", label: "", names: ["x", "X"] }]) === "vendor:a:X\nvendor:b:Y", "payee set text sorted, normalized");

  // review status
  const m = (key: string, screenedName: string): NameMatch => ({ key, list: "SDN", entNum: key.split(":")[1], listName: "X", kind: "primary", sdnType: null, program: null, remarks: null, score: 0.9, screenedName });
  const res = (id: string, matches: NameMatch[]): StoredResult => ({ id, runId: "r", payeeType: "employee", payeeId: "e1", label: "E", namesScreened: ["Jo Doe"], result: matches.length ? "possible_match" : "clear", topScore: 0.9, matches });
  const rev = (resultId: string, decision: ReviewDecision, keys: string[], at = "2026-10-01T00:00:00Z"): StoredReview => ({ id: `v-${resultId}`, resultId, payeeType: "employee", payeeId: "e1", decision, matchKeys: keys, note: "compared DOB and country", reviewedAt: at });
  const r1 = res("r1", [m("SDN:1", "Jo Doe")]);
  ok(resultStatus(r1, []).status === "needs_review", "status: new possible match needs review");
  ok(resultStatus(res("c", []), []).status === "clear", "status: clear");
  ok(resultStatus(r1, [rev("r1", "not_a_match", ["SDN:1|JO DOE"])]).status === "reviewed", "status: reviewed itself");
  ok(resultStatus(res("r2", [m("SDN:1", "Jo Doe")]), [rev("r1", "not_a_match", ["SDN:1|JO DOE"])]).status === "covered", "status: same facts covered by the earlier review");
  ok(resultStatus(res("r2", [m("SDN:1", "Jo Doe"), m("SDN:2", "Jo Doe")]), [rev("r1", "not_a_match", ["SDN:1|JO DOE"])]).status === "needs_review", "status: a new list entry needs a new review");
  ok(resultStatus(res("r2", [m("SDN:1", "Joe Doe")]), [rev("r1", "not_a_match", ["SDN:1|JO DOE"])]).status === "needs_review", "status: a renamed payee needs a new review");
  ok(resultStatus(res("r2", [m("SDN:1", "Jo Doe")]), [{ ...rev("r1", "not_a_match", ["SDN:1|JO DOE"]), payeeId: "e2" }]).status === "needs_review", "status: another payee's review does not count");
  ok(resultStatus(res("c2", []), [rev("r1", "true_match", ["SDN:1|JO DOE"])]).status === "true_match", "status: a true match stays red even when a later screen is clear");
  ok(resultStatus(r1, [rev("r1", "not_a_match", ["SDN:1|JO DOE"]), rev("r0", "true_match", [])]).status === "true_match", "status: true match beats a later not-a-match");
  ok(matchKey({ key: "SDN:1", screenedName: "jo  doe," }) === "SDN:1|JO DOE", "match key normalizes the screened name");

  // review form
  const f = (o: Record<string, string>) => checkReviewForm((k) => o[k] ?? null);
  const id = "11111111-2222-4333-8444-555555555555";
  ok(f({ result_id: id, decision: "not_a_match", note: "Different date of birth and country; WA LLC since 2015" }).ok, "form ok");
  ok(!f({ result_id: "x", decision: "not_a_match", note: "Different date of birth and country" }).ok, "form: bad id");
  ok(!f({ result_id: id, decision: "maybe", note: "Different date of birth and country" }).ok, "form: bad decision");
  ok(!f({ result_id: id, decision: "true_match", note: "too short" }).ok, "form: note too short");
  ok(!f({ result_id: id, decision: "true_match", note: "x".repeat(2001) }).ok, "form: note too long");
  ok(!f({ result_id: id, decision: "not_a_match", note: "UBI 6041234567 does not match the listing" }).ok, "form: 7+ digit run refused");

  // words
  ok(/apply migration 0278/.test(ofacDbErrorMessage('relation "ofac_match_reviews" does not exist')), "db: missing table");
  ok(/already reviewed/.test(ofacDbErrorMessage("duplicate key value violates unique constraint ofac_reviews_once")), "db: once");
  ok(/Only the owner/.test(ofacDbErrorMessage("ACH_OWNER_ONLY: x")), "db: owner");
  ok(!/12345678/.test(ofacDbErrorMessage("boom 12345678")), "db: unknown never echoed");
  const sum: RunSummary = { ranAt: "2026-10-20 6:30 am", payees: 10, possibleMatches: 1, needsReview: 0, trueMatches: 0, unscreenable: 0, listLastModified: "x", digestVerified: true };
  ok(screeningEmail(sum, "L") === null, "email: nothing new to review, no email");
  ok(/1 possible match\(es\) to review/.test(screeningEmail({ ...sum, needsReview: 1 }, "L")?.subject ?? ""), "email: needs review");
  ok(/Nothing is blocked/.test(screeningEmail({ ...sum, needsReview: 1 }, "L")?.text ?? ""), "email: says nothing is blocked");
  ok(/TRUE match/.test(screeningEmail({ ...sum, trueMatches: 1 }, "L")?.subject ?? ""), "email: true match");
  ok(/no name to screen/.test(screeningEmail({ ...sum, unscreenable: 2 }, "L")?.subject ?? ""), "email: unscreenable");
  ok(/Payments are not affected/.test(screeningFailedEmail("x", "L").text), "failure email: payments not affected");
  const now = new Date("2026-10-20T13:30:00Z");
  ok(staleness(null, now).stale, "stale: never run");
  ok(!staleness("2026-10-18T13:31:00Z", now).stale && staleness("2026-10-17T13:30:00Z", now).stale, "stale: 3 days");
  ok(MATCH_THRESHOLD === 0.85 && STALE_AFTER_DAYS === 3, "constants");
  ok(OFAC_FILES.join(",") === "SDN.CSV,ALT.CSV,CONS_PRIM.CSV,CONS_ALT.CSV" && OFAC_FIELD_COUNT["SDN.CSV"] === 12 && OFAC_FIELD_COUNT["CONS_ALT.CSV"] === 5, "files and field counts");

  return { passed, failed };
}
