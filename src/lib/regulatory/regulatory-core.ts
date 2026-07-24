/**
 * src/lib/regulatory/regulatory-core.ts  (SLICE 37)
 *
 * PURE deterministic layer for Regulatory Watch — no I/O, no `server-only`,
 * unit-testable with tsx and wired into scripts/compliance/run-pure-selftests.ts.
 *
 * The AI analyst (regulatory-analyst.ts) REFINES what this layer extracts;
 * it never replaces it. Citations, stages, and dates shown in the UI come from
 * here, so nothing on screen is hallucinated.
 *
 * What it knows (verified against live sources during SLICE 37 research):
 *  - GovDelivery widget feed: content.govdelivery.com/accounts/WALCB/widgets/
 *    WALCB_WIDGET_1/0.json returns `GDWidgets[0].update([{subject, pub_date,
 *    href}, ...])` — JSONP, not bare JSON. Bulletin hrefs look like
 *    https://content.govdelivery.com/bulletins/gd/WALCB-41ea476?wgt_ref=...
 *  - Citations in LCB bulletins: WAC 314-55-XXX, RCW 69.50.XXX, WSR 26-14-119,
 *    bill numbers (EHB 2681, ESSB 5403, ESB 5206, 2SHB 1701, ...).
 *  - Rulemaking stages (chapter 34.05 RCW): CR-101 preproposal, CR-102
 *    proposal (hearing + comment; 180 days to adopt), CR-103 adoption
 *    (typically effective 31 days after filing), CR-103E emergency (effective
 *    immediately, 120 days), CR-105 expedited (45-day objection window).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type WidgetItem = {
  /** Bulletin subject line. */
  subject: string;
  /** Original pub_date string (e.g. "07/01/2026 04:03 PM PDT"). */
  pubDate: string;
  /** ISO 8601 timestamp parsed from pubDate (null if unparseable). */
  publishedAt: string | null;
  /** Canonical bulletin URL (tracking query stripped). */
  href: string;
  /** Stable dedupe id, e.g. "WALCB-41ea476" (falls back to the URL). */
  externalId: string;
};

export type Citation = {
  kind: "wac" | "rcw" | "wsr" | "bill";
  /** Normalized cite text, e.g. "WAC 314-55-155", "WSR 26-14-119", "EHB 2681". */
  cite: string;
  /** Deep link into the official source (app.leg.wa.gov). Null for WSR. */
  url: string | null;
};

export type RulemakingStage =
  | "cr101"
  | "cr102"
  | "cr103"
  | "cr103e"
  | "cr105"
  | "petition"
  | "enforcement"
  | "policy"
  | "legislation"
  | "info"
  | "unknown";

export type ExtractedDate = {
  kind: "comment_deadline" | "hearing" | "effective" | "mentioned";
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Short context snippet around the date. */
  note: string;
};

export type Extraction = {
  citations: Citation[];
  stage: RulemakingStage;
  dates: ExtractedDate[];
  /** True when the text looks cannabis-relevant (worth spending AI budget on). */
  cannabisRelevant: boolean;
};

// ── GovDelivery widget feed (JSONP) ─────────────────────────────────────────

/**
 * Parse the GovDelivery widget payload. Accepts the raw JSONP text
 * (`GDWidgets[0].update([...])`) or a bare JSON array string.
 */
export function parseGovDeliveryWidget(raw: string): WidgetItem[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  // Unwrap `Anything.update([ ... ])` → the array literal. NOTE: a bare
  // indexOf("[") would hit the bracket in `GDWidgets[0]`, so prefer the
  // call-open `([` and fall back to the first bracket for bare-JSON input.
  const call = text.indexOf("([");
  const start = call >= 0 ? call + 1 : text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: WidgetItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const subject = typeof rec.subject === "string" ? rec.subject.trim() : "";
    const pubDate = typeof rec.pub_date === "string" ? rec.pub_date.trim() : "";
    const rawHref = typeof rec.href === "string" ? rec.href.trim() : "";
    if (!subject || !rawHref) continue;
    const href = stripTracking(rawHref);
    out.push({
      subject,
      pubDate,
      publishedAt: parseGovDeliveryDate(pubDate),
      href,
      externalId: bulletinIdFromUrl(href) ?? href,
    });
  }
  return out;
}

/** Strip GovDelivery tracking query params, keep the canonical bulletin URL. */
export function stripTracking(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

/** "WALCB-41ea476" from a bulletin URL, or null. */
export function bulletinIdFromUrl(url: string): string | null {
  // Handles both "/bulletins/gd/WALCB-41ea476" and "/accounts/WALCB/bulletins/41ea476".
  const m = /\/bulletins\/(?:gd\/)?([A-Z]*-?[0-9a-f]+)/i.exec(url ?? "");
  return m ? m[1].toUpperCase() : null;
}

/** Parse "07/01/2026 04:03 PM PDT" → ISO 8601 (UTC). Null if unparseable. */
export function parseGovDeliveryDate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*(PDT|PST)?/i.exec(
    (s ?? "").trim(),
  );
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min, ampm, tz] = m;
  let hour = parseInt(hh, 10) % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  // PDT = UTC-7, PST = UTC-8; default to PDT when the zone is omitted.
  const offset = (tz ?? "PDT").toUpperCase() === "PST" ? 8 : 7;
  const utc = Date.UTC(
    parseInt(yyyy, 10),
    parseInt(mm, 10) - 1,
    parseInt(dd, 10),
    hour + offset,
    parseInt(min, 10),
  );
  if (!Number.isFinite(utc)) return null;
  return new Date(utc).toISOString();
}

// ── Citation extraction ──────────────────────────────────────────────────────

const WAC_RE = /\bWAC\s+(\d{2,3}-\d{2,3}[A-Z]?(?:-\d{2,4}[A-Z]?)?)/gi;
const RCW_RE = /\bRCW\s+(\d{1,2}[A-Z]?\.\d{1,3}[A-Z]?(?:\.\d{1,4})?)/gi;
// Also catch "chapter 34.05 RCW" phrasing.
const RCW_CHAPTER_RE = /\bchapter\s+(\d{1,2}[A-Z]?\.\d{1,3}[A-Z]?)\s+RCW\b/gi;
const WSR_RE = /\bWSR\s+(\d{2}-\d{2}-\d{3})/gi;
// Bill styles: HB/SB with E/S/2S/3S prefixes (EHB 2681, ESSB 5403, 2SHB 1701).
const BILL_RE = /\b((?:2|3)?(?:E)?(?:S{0,2})(?:HB|SB))\s+(\d{4})\b/g;

/** Deep link into the official source for a citation. PURE. */
export function linkForCitation(kind: Citation["kind"], cite: string): string | null {
  const num = cite.replace(/^(WAC|RCW|WSR)\s+/i, "").trim();
  if (kind === "wac") return `https://app.leg.wa.gov/WAC/default.aspx?cite=${num}`;
  if (kind === "rcw") return `https://app.leg.wa.gov/RCW/default.aspx?cite=${num}`;
  if (kind === "bill") {
    const m = /(\d{4})$/.exec(cite);
    return m ? `https://app.leg.wa.gov/billsummary/?BillNumber=${m[1]}` : null;
  }
  return null; // WSR filings are PDFs hosted per-issue; no stable deep link.
}

/** Extract every legal citation from bulletin text. Deduped, order-preserving. */
export function extractCitations(text: string): Citation[] {
  const src = text ?? "";
  const out: Citation[] = [];
  const seen = new Set<string>();
  const push = (kind: Citation["kind"], cite: string) => {
    const key = `${kind}:${cite}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, cite, url: linkForCitation(kind, cite) });
  };
  for (const m of src.matchAll(WAC_RE)) push("wac", `WAC ${m[1]}`);
  for (const m of src.matchAll(RCW_RE)) push("rcw", `RCW ${m[1]}`);
  for (const m of src.matchAll(RCW_CHAPTER_RE)) push("rcw", `RCW ${m[1]}`);
  for (const m of src.matchAll(WSR_RE)) push("wsr", `WSR ${m[1]}`);
  for (const m of src.matchAll(BILL_RE)) push("bill", `${m[1]} ${m[2]}`);
  return out;
}

// ── Stage classification ─────────────────────────────────────────────────────

/**
 * Classify the rulemaking stage from bulletin text. Checks the most specific
 * signals first (CR-103E emergency beats CR-103; explicit CR forms beat
 * keyword heuristics).
 */
export function classifyStage(text: string): RulemakingStage {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (/cr-?\s?103e\b/.test(t) || /emergency rule/.test(t)) return "cr103e";
  if (/cr-?\s?105\b/.test(t) || /expedited rule/.test(t)) return "cr105";
  if (/cr-?\s?103\b/.test(t) || /permanent rules?\b/.test(t) || /final rules? filed/.test(t) || /rules? adopt/.test(t)) return "cr103";
  if (/cr-?\s?102\b/.test(t) || /proposed rule\s?making/.test(t) || /proposed rules?\b/.test(t) || /public hearing/.test(t)) return "cr102";
  if (/cr-?\s?101\b/.test(t) || /preproposal/.test(t) || /statement of inquiry/.test(t)) return "cr101";
  if (/petition for rule/.test(t)) return "petition";
  if (/enforcement bulletin|bulletin \d{2}-\d{2}/.test(t)) return "enforcement";
  if (/interim policy|policy statement|interpretive statement/.test(t)) return "policy";
  if (/\b(house bill|senate bill|session law|legislature|signed into law)\b/.test(t)) return "legislation";
  return "info";
}

/** Human labels for stages (used by the page + AI prompt). */
export const STAGE_LABELS: Record<RulemakingStage, string> = {
  cr101: "CR-101 — Preproposal (earliest signal; informal comments open)",
  cr102: "CR-102 — Proposed rules (hearing + formal comment window)",
  cr103: "CR-103 — Adopted (typically effective 31 days after filing)",
  cr103e: "CR-103E — EMERGENCY rules (effective immediately, 120 days)",
  cr105: "CR-105 — Expedited (45-day objection window, no hearing)",
  petition: "Petition for rulemaking",
  enforcement: "Enforcement bulletin",
  policy: "Interim / interpretive policy",
  legislation: "Legislation (session law feeding future rulemaking)",
  info: "Informational",
  unknown: "Unknown",
};

/** How much runway each stage usually gives (drives urgency in the UI). */
export function stageUrgency(stage: RulemakingStage): "low" | "medium" | "high" | "critical" {
  switch (stage) {
    case "cr103e":
      return "critical";
    case "cr103":
    case "cr105":
      return "high";
    case "cr102":
      return "medium";
    default:
      return "low";
  }
}

// ── Date extraction ──────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const LONG_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through Date.UTC to reject calendar-impossible dates
  // ("February 30" would silently roll over to March 2 otherwise).
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function classifyDateContext(context: string): ExtractedDate["kind"] {
  const c = context.toLowerCase();
  if (/comment|written comments|submit .*by|deadline/.test(c)) return "comment_deadline";
  if (/hearing/.test(c)) return "hearing";
  if (/effective/.test(c)) return "effective";
  return "mentioned";
}

/**
 * Extract long-form dates ("July 3, 2026") with their SENTENCE as context so
 * the UI can put comment deadlines and effective dates on the timeline.
 * Classification uses the containing sentence (not a raw character window) so
 * a neighboring sentence's keywords cannot bleed in. Deduped on (kind, date).
 */
export function extractDates(text: string): ExtractedDate[] {
  const src = text ?? "";
  const out: ExtractedDate[] = [];
  const seen = new Set<string>();
  for (const m of src.matchAll(LONG_DATE_RE)) {
    const month = MONTHS[m[1].toLowerCase()];
    const iso = toIso(parseInt(m[3], 10), month, parseInt(m[2], 10));
    if (!iso) continue;
    const at = m.index ?? 0;
    // Containing sentence: from the previous terminator to the next one.
    const before = src.slice(0, at);
    const sentStart = Math.max(
      before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "),
      before.lastIndexOf("\n"),
    );
    const afterIdx = src.indexOf(".", at + m[0].length);
    const sentEnd = afterIdx >= 0 ? afterIdx + 1 : src.length;
    const sentence = src
      .slice(sentStart + 1, sentEnd)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    const kind = classifyDateContext(sentence);
    const key = `${kind}:${iso}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, date: iso, note: sentence });
  }
  return out;
}

// ── Cannabis relevance (AI budget gate) ──────────────────────────────────────

const CANNABIS_TERMS =
  /\b(cannabis|marijuana|thc|cbd|i-?502|retail(er)? licen[cs]e|ccrs|traceability|314-55|69\.50|69\.51a|budtender|dispensar)/i;

/** Is this item worth spending AI budget on? PURE keyword gate. */
export function isCannabisRelevant(text: string): boolean {
  return CANNABIS_TERMS.test(text ?? "");
}

// ── One-call extraction ──────────────────────────────────────────────────────

/** Run the whole deterministic pass over a bulletin's title + body. */
export function extractAll(title: string, body: string): Extraction {
  const combined = `${title ?? ""}\n${body ?? ""}`;
  return {
    citations: extractCitations(combined),
    stage: classifyStage(combined),
    dates: extractDates(combined),
    cannabisRelevant: isCannabisRelevant(combined),
  };
}

// ── Self-tests (wired into scripts/compliance/run-pure-selftests.ts) ─────────

export function __runRegulatoryCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  FAIL regulatory-core: ${label}`);
    }
  };

  // Widget feed parsing — real JSONP shape observed live.
  const jsonp =
    'GDWidgets[0].update([{"subject":"LCB Action: Cannabis Rulemaking – License Fees","pub_date":"07/01/2026 04:03 PM PDT","href":"https://content.govdelivery.com/bulletins/gd/WALCB-41ea476?wgt_ref=WALCB_WIDGET_1"},{"subject":"WSLCB JOB OPPORTUNITIES","pub_date":"06/15/2026 10:49 AM PDT","href":"https://content.govdelivery.com/bulletins/gd/WALCB-41c209a?wgt_ref=WALCB_WIDGET_1"}])';
  const items = parseGovDeliveryWidget(jsonp);
  ok(items.length === 2, "widget JSONP parsed (2 items)");
  ok(items[0]?.externalId === "WALCB-41EA476", "bulletin id extracted + uppercased");
  ok(items[0]?.href === "https://content.govdelivery.com/bulletins/gd/WALCB-41ea476", "tracking query stripped");
  ok(items[0]?.publishedAt === "2026-07-01T23:03:00.000Z", "PDT pub_date → correct UTC ISO");
  ok(parseGovDeliveryWidget("") .length === 0, "empty widget text → no items");
  ok(parseGovDeliveryWidget("not json at [ all").length === 0, "garbage widget text → no items");
  ok(parseGovDeliveryDate("01/15/2026 09:00 AM PST") === "2026-01-15T17:00:00.000Z", "PST offset (UTC-8) applied");
  ok(parseGovDeliveryDate("bogus") === null, "unparseable date → null");
  ok(bulletinIdFromUrl("https://content.govdelivery.com/accounts/WALCB/bulletins/41ea476") === "41EA476", "account-style bulletin URL id");

  // Citations — real bulletin sentence (EHB 2681 CR-103, July 1, 2026).
  const bulletin =
    "The Board approved amendments to WAC 314-55-075, WAC 314-55-077, and WAC 314-55-079 " +
    "necessary to align rules with statutory license fee increases under EHB 2681. " +
    "CR-103 filed as WSR 26-14-119 on July 1, 2026. These final rules are effective immediately. " +
    "Rulemaking is governed by chapter 34.05 RCW and RCW 69.50.342.";
  const cites = extractCitations(bulletin);
  ok(cites.filter((c) => c.kind === "wac").length === 3, "three WAC cites extracted");
  ok(cites.some((c) => c.cite === "WSR 26-14-119"), "WSR number extracted");
  ok(cites.some((c) => c.cite === "EHB 2681"), "bill number extracted");
  ok(cites.some((c) => c.cite === "RCW 34.05"), "chapter-style RCW extracted");
  ok(cites.some((c) => c.cite === "RCW 69.50.342"), "full RCW cite extracted");
  ok(
    cites.find((c) => c.cite === "WAC 314-55-075")?.url === "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-075",
    "WAC deep link built",
  );
  ok(
    cites.find((c) => c.cite === "EHB 2681")?.url === "https://app.leg.wa.gov/billsummary/?BillNumber=2681",
    "bill deep link built",
  );
  ok(extractCitations(bulletin + " " + bulletin).length === cites.length, "citations deduped");
  ok(extractCitations("ESSB 5403 and 2SHB 1701").length === 2, "prefixed bill styles (ESSB, 2SHB) extracted");

  // Stage classification — most specific wins.
  ok(classifyStage("The Board approved a CR-103 (Permanent Rules)") === "cr103", "CR-103 detected");
  ok(classifyStage("CR-103E emergency rule filed today") === "cr103e", "CR-103E beats CR-103");
  ok(classifyStage("approved a CR-102 (Proposed Rule Making) with a public hearing") === "cr102", "CR-102 detected");
  ok(classifyStage("filed a CR-101 Preproposal Statement of Inquiry") === "cr101", "CR-101 detected");
  ok(classifyStage("adopted expedited rules under CR-105") === "cr105", "CR-105 detected");
  ok(classifyStage("The Board received a petition for rulemaking to amend WAC 314-55-570") === "petition", "petition detected");
  ok(classifyStage("Enforcement Bulletin 26-01: Industry Update on Minimum Orders") === "enforcement", "enforcement bulletin detected");
  ok(classifyStage("the agency issued an interim policy on sampling") === "policy", "interim policy detected");
  ok(classifyStage("the House Bill was signed into law by the Governor") === "legislation", "legislation detected");
  ok(classifyStage("CCRS maintenance window this weekend") === "info", "non-rulemaking → info");
  ok(classifyStage("") === "unknown", "empty text → unknown");
  ok(stageUrgency("cr103e") === "critical", "emergency = critical urgency");
  ok(stageUrgency("cr103") === "high", "adopted = high urgency");
  ok(stageUrgency("cr102") === "medium", "proposed = medium urgency");
  ok(stageUrgency("cr101") === "low", "preproposal = low urgency");

  // Date extraction with context classification.
  const dated =
    "There is a public comment period open until August 12, 2026. " +
    "A public hearing is scheduled for July 22, 2026. " +
    "The rules are effective July 3, 2026. The bill passed on April 1, 2026.";
  const dates = extractDates(dated);
  ok(dates.length === 4, "four dates extracted");
  ok(dates.some((d) => d.kind === "comment_deadline" && d.date === "2026-08-12"), "comment deadline classified");
  ok(dates.some((d) => d.kind === "hearing" && d.date === "2026-07-22"), "hearing date classified");
  ok(dates.some((d) => d.kind === "effective" && d.date === "2026-07-03"), "effective date classified");
  ok(dates.some((d) => d.kind === "mentioned" && d.date === "2026-04-01"), "plain mention classified");
  ok(extractDates("February 31, 2026 is impossible").length === 0, "calendar-impossible dates rejected (Feb 31 never rolls over to March)");
  ok(extractDates("no dates here").length === 0, "no dates → empty");

  // Cannabis relevance gate.
  ok(isCannabisRelevant("Cannabis Retail Advertising rules under WAC 314-55-155"), "cannabis terms detected");
  ok(isCannabisRelevant("amendments to chapter 314-55 WAC"), "chapter 314-55 detected");
  ok(!isCannabisRelevant("MAST alcohol server training update for taverns"), "alcohol-only bulletin filtered out");

  // extractAll ties it together.
  const all = extractAll("LCB Action: Cannabis Rulemaking – License Fees", bulletin);
  ok(all.stage === "cr103", "extractAll stage");
  ok(all.cannabisRelevant, "extractAll relevance");
  ok(all.citations.length === cites.length, "extractAll citations");

  if (fail > 0) throw new Error(`regulatory-core self-tests: ${fail} failure(s)`);
  console.log(`regulatory-core: ${pass} passed, ${fail} failed`);
}
