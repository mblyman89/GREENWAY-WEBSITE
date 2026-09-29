/**
 * src/lib/leafly/readback-proof-core.ts  (SLICE L-52)
 *
 * TURN A READ-BACK INTO EVIDENCE THE CERTIFICATION GATE CAN SEE.
 *
 * FIELD-REPORTED. Certification criterion 5 ("Data quality") on the Leafly
 * page showed NOT MET with:
 *
 *     the pushed menu has never been read back from Leafly and compared
 *
 * -- directly after the owner had pressed "Read the menu back from Leafly and
 * check it". It could never have said anything else. `page.tsx` passed
 * `reconcile: null` to the gate unconditionally, because the comparison lived
 * only in the button's browser state and vanished on the next page load. The
 * gate's own remedy ("work through the differences until a read-back comes
 * back clean, then re-check here") was advice that could not be followed to
 * completion: a clean read-back would still have shown NOT MET.
 *
 * THE FIX
 * -------
 * Every read-back already writes a `syndication_logs` row (mode "preview"),
 * and that action is the ONLY writer of preview rows for Leafly (grepped:
 * actions.ts `fetchLeaflyMenuReadbackAction` is the sole
 * `mode: "preview"` call site for the channel). The row's `payload` column was
 * `null`. It now carries a small VERDICT -- counts and labels only, never the
 * menu -- built here, and the page reads the newest verdict back through
 * `readReadbackProof` and hands it to the gate. No migration: the column is
 * already `jsonb`.
 *
 * WHAT COUNTS AS PROOF (every rule is tested below)
 * ------------------------------------------------
 *   - Leafly answered 200 and the menu parsed.
 *   - The comparison ran AFTER Leafly's documented ingest window (finding
 *     L-19). A premature comparison proves nothing either way.
 *   - The comparison was against WHAT WE ACTUALLY SENT (a logged full sync, or
 *     the sync-state rebuild). The labelled whole-feed fallback is not proof,
 *     and neither is "nothing to compare against".
 *   - It covered the whole menu (full scope). A targeted check examines only
 *     the handful of products that push sent.
 *   - Zero error-severity differences. Warnings (Leafly's own strain renames,
 *     brand matching) do not fail it; they are reported.
 *
 * A later push does NOT invalidate the proof. With automatic syncing on,
 * in-between updates may run every fifteen minutes; a rule that demanded a
 * read-back newer than the last push could never stay satisfied. What the
 * proof shows is that the pipeline which builds and sends the menu produced a
 * copy at Leafly identical to what it sent. The number of pushes since is
 * disclosed in the finding, so nothing is hidden.
 *
 * PURE: no I/O, no clock reads (the caller passes `at`).
 */

/** Marker so a verdict can never be confused with any other stored payload. */
export const READBACK_VERDICT_KIND = "leafly-readback-verdict";
export const READBACK_VERDICT_VERSION = 1;

export type ReadbackVerdictBaselineSource =
  | "targeted-push-log"
  | "full-sync-log"
  | "sync-state-rebuild"
  | "live-preview"
  | "none";

export type ReadbackVerdict = {
  kind: typeof READBACK_VERDICT_KIND;
  v: typeof READBACK_VERDICT_VERSION;
  /** Leafly answered 2xx and the body parsed as a menu. */
  httpOk: boolean;
  httpStatus: number;
  /** Did a comparison run at all? */
  compared: boolean;
  /** The reconciler's own verdict (zero errors). False when not compared. */
  reconcileOk: boolean;
  errorCount: number;
  warningCount: number;
  /** Distinct error codes, e.g. ["variant_missing"]. */
  errorCodes: string[];
  scope: "full" | "targeted" | null;
  baselineSource: ReadbackVerdictBaselineSource | null;
  comparedItemCount: number;
  sentItemCount: number;
  readbackItemCount: number;
  heldNotChecked: number;
  premature: boolean;
  /** ISO time of the read-back. */
  at: string;
};

/** The minimum of a read-back result this builder needs (structural). */
export type ReadbackVerdictInput = {
  ok: boolean;
  httpStatus: number;
  parseOk: boolean;
  readbackItemCount: number;
  reconcile: {
    ok: boolean;
    scope: "full" | "targeted";
    sentItemCount: number;
    comparedItemCount: number;
    heldNotChecked?: number;
    issues: readonly { severity: string; code: string }[];
  } | null;
  baseline: { source: ReadbackVerdictBaselineSource; scope: "full" | "targeted" } | null;
  premature: boolean;
  at: string;
};

/** Build the verdict stored on the read-back's log row. */
export function buildReadbackVerdict(input: ReadbackVerdictInput): ReadbackVerdict {
  const r = input.reconcile;
  const errors = r ? r.issues.filter((i) => i.severity === "error") : [];
  const warnings = r ? r.issues.filter((i) => i.severity === "warning") : [];
  const codes = Array.from(
    new Set(errors.map((i) => i.code.replace(/_truncated$/, ""))),
  ).sort();
  return {
    kind: READBACK_VERDICT_KIND,
    v: READBACK_VERDICT_VERSION,
    httpOk: input.ok && input.parseOk,
    httpStatus: input.httpStatus,
    compared: r !== null,
    reconcileOk: r !== null && r.ok,
    // `_truncated` markers are "and more" notes, not extra differences.
    errorCount: errors.filter((i) => !i.code.endsWith("_truncated")).length,
    warningCount: warnings.filter((i) => !i.code.endsWith("_truncated")).length,
    errorCodes: codes,
    scope: r ? r.scope : null,
    baselineSource: input.baseline?.source ?? null,
    comparedItemCount: r ? r.comparedItemCount : 0,
    sentItemCount: r ? r.sentItemCount : 0,
    readbackItemCount: input.readbackItemCount,
    heldNotChecked: r?.heldNotChecked ?? 0,
    premature: input.premature,
    at: input.at,
  };
}

/** Strictly parse a stored payload back into a verdict; null for anything else. */
export function parseReadbackVerdict(payload: unknown): ReadbackVerdict | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  if (o.kind !== READBACK_VERDICT_KIND || o.v !== READBACK_VERDICT_VERSION) return null;
  const bool = (k: string) => typeof o[k] === "boolean";
  const num = (k: string) => typeof o[k] === "number" && Number.isFinite(o[k] as number);
  if (!bool("httpOk") || !bool("compared") || !bool("reconcileOk") || !bool("premature")) return null;
  if (!num("httpStatus") || !num("errorCount") || !num("warningCount")) return null;
  if (!num("comparedItemCount") || !num("sentItemCount") || !num("readbackItemCount")) return null;
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return null;
  if (!Array.isArray(o.errorCodes) || !o.errorCodes.every((c) => typeof c === "string")) return null;
  const scope = o.scope === "full" || o.scope === "targeted" ? o.scope : null;
  const sources: ReadbackVerdictBaselineSource[] = [
    "targeted-push-log",
    "full-sync-log",
    "sync-state-rebuild",
    "live-preview",
    "none",
  ];
  const baselineSource = sources.includes(o.baselineSource as ReadbackVerdictBaselineSource)
    ? (o.baselineSource as ReadbackVerdictBaselineSource)
    : null;
  return {
    kind: READBACK_VERDICT_KIND,
    v: READBACK_VERDICT_VERSION,
    httpOk: o.httpOk as boolean,
    httpStatus: o.httpStatus as number,
    compared: o.compared as boolean,
    reconcileOk: o.reconcileOk as boolean,
    errorCount: o.errorCount as number,
    warningCount: o.warningCount as number,
    errorCodes: o.errorCodes as string[],
    scope,
    baselineSource,
    comparedItemCount: o.comparedItemCount as number,
    sentItemCount: o.sentItemCount as number,
    readbackItemCount: o.readbackItemCount as number,
    heldNotChecked: num("heldNotChecked") ? (o.heldNotChecked as number) : 0,
    premature: o.premature as boolean,
    at: o.at,
  };
}

/** A log row, structurally (same subset readback-baseline-core reads). */
export type ProofLogRow = {
  mode: string;
  status: string;
  payload: unknown;
  created_at?: string | null;
};

/**
 * What the certification gate is told.
 *
 *   status "none"     -- no read-back with a stored verdict exists yet.
 *   status "not_proof"-- the newest read-back cannot count (premature, wrong
 *                        baseline, targeted, Leafly error). `reason` says why
 *                        and `remedy` says what to press.
 *   status "dirty"    -- a valid comparison found differences.
 *   status "clean"    -- a valid, whole-menu comparison found none.
 */
export type ReadbackProof = {
  status: "none" | "not_proof" | "dirty" | "clean";
  verdict: ReadbackVerdict | null;
  /** Successful live pushes recorded after the read-back. Disclosure only. */
  pushesSince: number;
  /** One owner-facing sentence describing what was found. */
  finding: string;
  /** What to do next. Empty when clean. */
  remedy: string;
};

const CODE_WORDS: Record<string, string> = {
  variant_missing: "sizes missing at Leafly",
  missing_from_leafly: "products missing at Leafly",
  name_mismatch: "names that differ",
  image_dropped: "photos that did not take",
  thc_mismatch: "THC values that differ",
  cbd_mismatch: "CBD values that differ",
  thc_unit_mismatch: "THC units that differ",
  cbd_unit_mismatch: "CBD units that differ",
  medical_mismatch: "medical flags that differ",
  readback_unreadable: "a menu Leafly returned that could not be read",
};

function describeCodes(codes: readonly string[]): string {
  return codes.map((c) => CODE_WORDS[c] ?? c.replace(/_/g, " ")).join(", ");
}

/**
 * Read the newest stored verdict from the log and decide what it proves.
 *
 * @param rows Syndication log rows for the channel, NEWEST FIRST (the order
 *             `listSyndicationLogs` returns). Rows without a verdict (older
 *             builds wrote `payload: null`) are skipped, never guessed at.
 */
export function readReadbackProof(rows: readonly ProofLogRow[]): ReadbackProof {
  let verdict: ReadbackVerdict | null = null;
  let pushesSince = 0;
  for (const row of rows) {
    if (row.mode === "preview") {
      const v = parseReadbackVerdict(row.payload);
      if (v) {
        verdict = v;
        break;
      }
      continue;
    }
    if (row.mode === "live" && row.status === "ok") pushesSince += 1;
  }

  const readBackHow =
    "Press \u201cRead the menu back from Leafly and check it\u201d on this page at least 3 " +
    "minutes after the last push, then reload.";

  if (verdict === null) {
    return {
      status: "none",
      verdict: null,
      pushesSince: 0,
      finding:
        "the pushed menu has not been read back from Leafly and compared since this check " +
        "started recording results, so nobody has checked that what Leafly stored matches " +
        "what we sent",
      remedy: readBackHow,
    };
  }

  const since =
    pushesSince > 0 ? ` ${pushesSince} successful push(es) have been made since that check.` : "";

  if (!verdict.httpOk || !verdict.compared) {
    return {
      status: "not_proof",
      verdict,
      pushesSince,
      finding: verdict.httpOk
        ? "the last read-back could not be compared against anything we sent"
        : `the last read-back failed (Leafly answered HTTP ${verdict.httpStatus || "no response"})`,
      remedy: `Try again. ${readBackHow}`,
    };
  }
  if (verdict.premature) {
    return {
      status: "not_proof",
      verdict,
      pushesSince,
      finding:
        "the last read-back ran inside Leafly's ~2.5 minute processing window after a push, " +
        "so it cannot prove anything either way",
      remedy: readBackHow,
    };
  }
  if (verdict.baselineSource === "live-preview" || verdict.baselineSource === "none" || verdict.baselineSource === null) {
    return {
      status: "not_proof",
      verdict,
      pushesSince,
      finding:
        "the last read-back had no record of what was actually sent, so it compared against " +
        "the menu as it stands now, which is not proof",
      remedy:
        "Let one automatic sync run (or press \u201cSend my whole menu\u201d), wait 3 minutes, then " +
        "read the menu back again.",
    };
  }
  if (verdict.scope !== "full") {
    return {
      status: "not_proof",
      verdict,
      pushesSince,
      finding:
        "the last read-back checked only the few products a targeted push sent, not the " +
        "whole menu",
      remedy:
        "Let one automatic sync run (or press \u201cSend my whole menu\u201d), wait 3 minutes, then " +
        "read the menu back again.",
    };
  }
  if (!verdict.reconcileOk || verdict.errorCount > 0) {
    return {
      status: "dirty",
      verdict,
      pushesSince,
      finding:
        `the last read-back (${verdict.at}) found ${verdict.errorCount} difference(s) between ` +
        `what we sent and what Leafly stored` +
        (verdict.errorCodes.length > 0 ? ` (${describeCodes(verdict.errorCodes)})` : "") +
        `.${since}`,
      remedy:
        "Read the menu back and follow the fix written under each red item. A size missing " +
        "at Leafly on a product Leafly holds with no sizes is fixed by removing that " +
        "product with \u201cRemove products from Leafly\u201d and letting the next sync send it " +
        "again. Then wait 3 minutes and read back again.",
    };
  }
  if (verdict.comparedItemCount === 0) {
    return {
      status: "not_proof",
      verdict,
      pushesSince,
      finding: "the last read-back matched no products, so it proves nothing",
      remedy: readBackHow,
    };
  }
  const held =
    verdict.heldNotChecked > 0
      ? ` ${verdict.heldNotChecked} product(s) that had changed since they were last sent were left for the next sync.`
      : "";
  return {
    status: "clean",
    verdict,
    pushesSince,
    finding:
      `a read-back on ${verdict.at} compared ${verdict.comparedItemCount} product(s) against ` +
      `exactly what was sent and found no differences` +
      (verdict.warningCount > 0
        ? ` (${verdict.warningCount} informational note(s), such as Leafly renaming a strain)`
        : "") +
      `.${held}${since}`,
    remedy: "",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyReadbackProofTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[readback-proof] FAIL: ${name}`);
    }
  };

  const AT = "2026-09-27T18:00:00.000Z";
  const cleanInput: ReadbackVerdictInput = {
    ok: true,
    httpStatus: 200,
    parseOk: true,
    readbackItemCount: 753,
    reconcile: {
      ok: true,
      scope: "full",
      sentItemCount: 740,
      comparedItemCount: 740,
      heldNotChecked: 9,
      issues: [
        { severity: "warning", code: "name_strain_rewritten_by_leafly" },
        { severity: "info", code: "image_leafly_standin" },
      ],
    },
    baseline: { source: "sync-state-rebuild", scope: "full" },
    premature: false,
    at: AT,
  };
  const v = buildReadbackVerdict(cleanInput);
  check("verdict carries the marker", v.kind === READBACK_VERDICT_KIND && v.v === 1);
  check("verdict counts warnings, not infos", v.warningCount === 1);
  check("verdict counts zero errors", v.errorCount === 0);
  check("verdict records the baseline", v.baselineSource === "sync-state-rebuild");
  check("verdict records held-not-checked", v.heldNotChecked === 9);
  check("verdict round-trips through JSON", parseReadbackVerdict(JSON.parse(JSON.stringify(v)))?.at === AT);
  check("verdict holds no menu data", JSON.stringify(v).length < 800);

  // Truncation markers are not extra differences.
  const trunc = buildReadbackVerdict({
    ...cleanInput,
    reconcile: {
      ...cleanInput.reconcile!,
      ok: false,
      issues: [
        { severity: "error", code: "variant_missing" },
        { severity: "error", code: "variant_missing" },
        { severity: "error", code: "variant_missing_truncated" },
      ],
    },
  });
  check("truncation markers are not counted", trunc.errorCount === 2);
  check("codes are de-duplicated and de-suffixed", trunc.errorCodes.join() === "variant_missing");

  // Parser strictness.
  check("parse: null is not a verdict", parseReadbackVerdict(null) === null);
  check("parse: a push payload is not a verdict", parseReadbackVerdict({ items: [] }) === null);
  check("parse: wrong version is refused", parseReadbackVerdict({ ...v, v: 2 }) === null);
  check("parse: a bad date is refused", parseReadbackVerdict({ ...v, at: "yesterday" }) === null);
  check("parse: a missing count is refused", parseReadbackVerdict({ ...v, errorCount: undefined }) === null);

  const row = (verdict: unknown, created = AT): ProofLogRow => ({
    mode: "preview",
    status: "ok",
    payload: verdict,
    created_at: created,
  });
  const push: ProofLogRow = { mode: "live", status: "ok", payload: { automatic: "intraday_delta" } };

  // The field failure: no verdict anywhere.
  const none = readReadbackProof([push, row(null)]);
  check("a legacy read-back row (payload null) is not proof", none.status === "none");
  check("no verdict: remedy says which button to press", none.remedy.includes("Read the menu back"));
  check("no verdict: remedy says to wait", none.remedy.includes("3"));

  // Clean.
  const clean = readReadbackProof([row(v)]);
  check("a clean full comparison is proof", clean.status === "clean");
  check("clean has no remedy", clean.remedy === "");
  check("clean finding states what was compared", clean.finding.includes("740"));
  check("clean finding discloses the held remainder", clean.finding.includes("9 product"));

  // Pushes since are disclosed, not disqualifying.
  const later = readReadbackProof([push, push, row(v)]);
  check("a later push does not invalidate the proof", later.status === "clean");
  check("later pushes are counted", later.pushesSince === 2);
  check("later pushes are disclosed", later.finding.includes("2 successful push"));
  check(
    "failed or skipped pushes are not counted",
    readReadbackProof([{ mode: "live", status: "error", payload: null }, row(v)]).pushesSince === 0,
  );

  // The newest verdict wins, even if an older one was clean.
  const dirtyV = buildReadbackVerdict({
    ...cleanInput,
    reconcile: {
      ...cleanInput.reconcile!,
      ok: false,
      issues: [{ severity: "error", code: "variant_missing" }],
    },
  });
  const newestDirty = readReadbackProof([row(dirtyV), row(v)]);
  check("the newest verdict wins", newestDirty.status === "dirty");
  check("dirty names the difference in words", newestDirty.finding.includes("sizes missing at Leafly"));
  check("dirty remedy explains the empty-shell fix", newestDirty.remedy.includes("Remove products from Leafly"));
  check("a newer clean verdict clears an older dirty one", readReadbackProof([row(v), row(dirtyV)]).status === "clean");

  // Not proof.
  const prem = readReadbackProof([row({ ...v, premature: true })]);
  check("a premature comparison is not proof", prem.status === "not_proof");
  check("premature explains the window", prem.finding.includes("2.5 minute"));
  const lp = readReadbackProof([row({ ...v, baselineSource: "live-preview" })]);
  check("a live-preview comparison is not proof", lp.status === "not_proof");
  check("live-preview remedy asks for a sync first", lp.remedy.includes("automatic sync"));
  check("a no-baseline comparison is not proof", readReadbackProof([row({ ...v, baselineSource: "none" })]).status === "not_proof");
  check("a targeted comparison is not proof", readReadbackProof([row({ ...v, scope: "targeted", baselineSource: "targeted-push-log" })]).status === "not_proof");
  check("a Leafly error is not proof", readReadbackProof([row({ ...v, httpOk: false, httpStatus: 500 })]).status === "not_proof");
  check("an uncompared read-back is not proof", readReadbackProof([row({ ...v, compared: false, reconcileOk: false })]).status === "not_proof");
  check("zero compared items is not proof", readReadbackProof([row({ ...v, comparedItemCount: 0 })]).status === "not_proof");
  check(
    "a full-sync-log comparison is accepted",
    readReadbackProof([row({ ...v, baselineSource: "full-sync-log" })]).status === "clean",
  );

  // Every non-clean status has an actionable remedy.
  check(
    "every non-clean status carries a remedy",
    [none, prem, lp, newestDirty].every((p) => p.remedy.trim().length > 30),
  );

  return { passed, failed };
}
