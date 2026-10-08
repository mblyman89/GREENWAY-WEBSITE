/**
 * src/lib/pos/intake-version-copy-core.ts  (S01 — persist the publish outcome
 * on every intake version and humanise its notes)
 *
 * PURE. Turns an intake-origin `menu_versions` row (import_id NULL, built by
 * src/lib/pos/intake-menu-staging.ts) into plain-English copy the owner can
 * act on: which delivery it came from, what happened to it, and — only when
 * something is actually waiting — the one thing to do next.
 *
 * WHERE THE TRUTH LIVES (read this before changing anything):
 *
 *   1. `menu_versions.status` + `published_at` are the SOURCE OF TRUTH for
 *      "is it live?". The `publish_menu_version` RPC sets them atomically, for
 *      the automatic publish AND for a manual Publish click. The manual
 *      publish action never touches summary_json, so any copy that trusted a
 *      stored "published" flag would drift the moment a held draft was
 *      published by hand.
 *   2. `summary_json.publish_outcome` records only what the status columns
 *      CANNOT: the staging module's intent and, if it failed, why.
 *        - "held_for_fact_review"   written at insert (Rule 3.1 hold)
 *        - "auto_publish_attempted" written at insert (normal path)
 *        - "held_for_cutover"       written at insert (S18): a real one-time
 *                                   Cultivera upload was staged-but-unpublished,
 *                                   so this update waits (cutover-guard-core)
 *        - "auto_publish_failed"    one update, ONLY on the rare RPC failure,
 *                                   carrying the error message
 *      The success path therefore costs ZERO extra writes: a row whose
 *      outcome says "attempted" and whose status is "published" was published
 *      automatically. A row that says "attempted" but is still "staged" never
 *      finished (the process died between insert and RPC) — the copy says
 *      exactly that and nothing more (never guess).
 *   3. `summary_json.manifest` = {id, number, vendor, received_at,
 *      transfer_date} so the owner sees "From Vendor · manifest 123 ·
 *      received Sep 26" instead of a UUID.
 *   4. The held products + reasons are NOT duplicated into the row: the
 *      planner diagnostics are already persisted in summary_json.diagnostics
 *      (code "fact_extraction_review", context {productName, reasons[]}),
 *      so they are derived here from one copy of the data.
 *
 * Rows written before S01 have none of these keys. Every function degrades
 * to wording that is true without them (no crash, no invented outcome).
 *
 * No fs, no network, no Supabase: the pages and the staging module call it
 * with plain data, and the embedded self-tests run in the pure runner.
 */

// ---------------------------------------------------------------------------
// Vocabulary (the persisted shape)
// ---------------------------------------------------------------------------

export const PUBLISH_OUTCOMES = [
  "held_for_fact_review",
  "auto_publish_attempted",
  "auto_publish_failed",
  "held_for_cutover",
] as const;
export type PublishOutcomeState = (typeof PUBLISH_OUTCOMES)[number];

export type PersistedPublishOutcome = {
  state: PublishOutcomeState;
  /** ISO time the outcome was decided (insert time, or failure time). */
  at: string;
  /** Present only on auto_publish_failed; trimmed to ERROR_MAX chars. */
  error?: string;
  /** Present only on held_for_fact_review: how many products were flagged. */
  held_count?: number;
  /**
   * R27-1: present only when the update went ahead WITHOUT some flagged
   * products (each kept off the menu until its facts are set).
   */
  withheld_count?: number;
};

export type PersistedManifestHeader = {
  id: string;
  number: string | null;
  vendor: string | null;
  /** inbound_manifests.received_at (timestamptz ISO) when known. */
  received_at: string | null;
  /** inbound_manifests.transfer_date (YYYY-MM-DD) fallback. */
  transfer_date: string | null;
};

/** Longest error message persisted into summary_json (keeps the row small). */
export const ERROR_MAX = 300;
/** How many held products the copy names before summarising the rest. */
export const HELD_NAMED_MAX = 3;

const STORE_TZ = "America/Los_Angeles";

// ---------------------------------------------------------------------------
// Writer helpers (used by intake-menu-staging.ts)
// ---------------------------------------------------------------------------

/** Trim + collapse whitespace; null for empty/non-string. */
function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

/**
 * Build the manifest header persisted into summary_json.manifest from the
 * inbound_manifests row (named columns only). Unknown/blank fields are null.
 */
export function buildManifestHeader(
  manifestId: string,
  row: {
    manifest_number?: unknown;
    vendor_label?: unknown;
    received_at?: unknown;
    transfer_date?: unknown;
  } | null,
): PersistedManifestHeader {
  return {
    id: manifestId,
    number: clean(row?.manifest_number),
    vendor: clean(row?.vendor_label),
    received_at: clean(row?.received_at),
    transfer_date: clean(row?.transfer_date),
  };
}

/**
 * The outcome written at insert time. A fact hold wins over a cutover hold
 * (the facts need a human either way, and the S15/S16 queue already routes
 * that); a cutover hold (S18) wins over an auto-publish attempt.
 */
export function initialPublishOutcome(
  heldCount: number,
  atIso: string,
  opts: { cutover?: boolean; withheld?: number } = {},
): PersistedPublishOutcome {
  if (heldCount > 0) return { state: "held_for_fact_review", at: atIso, held_count: heldCount };
  const w = typeof opts.withheld === "number" && Number.isFinite(opts.withheld) && opts.withheld > 0 ? Math.floor(opts.withheld) : 0;
  const withheld = w > 0 ? { withheld_count: w } : {};
  if (opts.cutover === true) return { state: "held_for_cutover", at: atIso, ...withheld };
  return { state: "auto_publish_attempted", at: atIso, ...withheld };
}

/** The outcome written after an RPC failure (message trimmed, never empty). */
export function failedPublishOutcome(error: unknown, atIso: string): PersistedPublishOutcome {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const msg = clean(raw) ?? "no error message was returned";
  return {
    state: "auto_publish_failed",
    at: atIso,
    error: msg.length > ERROR_MAX ? `${msg.slice(0, ERROR_MAX - 1)}…` : msg,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sep 26" in the store's wall clock; a bare YYYY-MM-DD is read as-is. */
export function formatShortDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (ymd) {
    // A calendar date (transfer_date) has no time zone — do NOT shift it.
    const d = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12));
    return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  }
  const d = validDate(iso);
  if (!d) return null;
  return d.toLocaleDateString("en-US", { timeZone: STORE_TZ, month: "short", day: "numeric" });
}

/** "Sep 26, 2:14 PM" in the store's wall clock. */
export function formatShortMoment(iso: string | null | undefined): string | null {
  const d = validDate(iso);
  if (!d) return null;
  return d.toLocaleString("en-US", {
    timeZone: STORE_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Reading summary_json defensively (old rows, hand-edited rows, junk)
// ---------------------------------------------------------------------------

type Diagnostic = { severity?: unknown; code?: unknown; message?: unknown; context?: unknown };

export type ParsedIntakeSummary = {
  origin: string | null;
  manifestId: string | null;
  carried: number;
  added: number;
  merged: number;
  manifest: PersistedManifestHeader | null;
  outcome: PersistedPublishOutcome | null;
  diagnostics: Diagnostic[];
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseIntakeSummary(summaryJson: unknown): ParsedIntakeSummary {
  const s = isObj(summaryJson) ? summaryJson : {};
  let manifest: PersistedManifestHeader | null = null;
  if (isObj(s.manifest) && typeof s.manifest.id === "string") {
    manifest = buildManifestHeader(s.manifest.id, {
      manifest_number: s.manifest.number,
      vendor_label: s.manifest.vendor,
      received_at: s.manifest.received_at,
      transfer_date: s.manifest.transfer_date,
    });
  }
  let outcome: PersistedPublishOutcome | null = null;
  if (
    isObj(s.publish_outcome) &&
    typeof s.publish_outcome.state === "string" &&
    (PUBLISH_OUTCOMES as readonly string[]).includes(s.publish_outcome.state)
  ) {
    const o = s.publish_outcome;
    outcome = {
      state: o.state as PublishOutcomeState,
      at: typeof o.at === "string" ? o.at : "",
      ...(typeof o.error === "string" ? { error: o.error } : {}),
      ...(typeof o.held_count === "number" ? { held_count: num(o.held_count) } : {}),
      ...(typeof o.withheld_count === "number" && num(o.withheld_count) > 0 ? { withheld_count: num(o.withheld_count) } : {}),
    };
  }
  return {
    origin: typeof s.origin === "string" ? s.origin : null,
    manifestId: typeof s.manifest_id === "string" ? s.manifest_id : null,
    carried: num(s.carried),
    added: num(s.added),
    merged: num(s.merged),
    manifest,
    outcome,
    diagnostics: Array.isArray(s.diagnostics) ? (s.diagnostics as Diagnostic[]) : [],
  };
}

export type HeldProduct = { name: string; reasons: string[] };

/** Products the fact engine flagged (derived from the persisted diagnostics). */
export function heldProductsFrom(diagnostics: Diagnostic[]): HeldProduct[] {
  const out: HeldProduct[] = [];
  for (const d of diagnostics) {
    if (!isObj(d) || d.code !== "fact_extraction_review") continue;
    const ctx = isObj(d.context) ? d.context : {};
    const name =
      clean(ctx.displayName) ?? clean(ctx.productName) ?? "A product (name not recorded)";
    const reasons = Array.isArray(ctx.reasons)
      ? (ctx.reasons.map(clean).filter(Boolean) as string[])
      : [];
    if (reasons.length === 0) {
      const m = clean(d.message);
      if (m) reasons.push(m);
    }
    out.push({ name, reasons });
  }
  return out;
}

/**
 * R27: the products a PUBLISHED update kept off the menu alone (their flags
 * carry context.withheld = true, fact-withhold-core markWithheld), with the
 * draft each one is fixed on. A flag answered since then is no longer a
 * fact_extraction_review diagnostic on a newer re-stage; on THIS stored row
 * it stays listed - the caller decides freshness (the newest version wins).
 */
export type WithheldProduct = HeldProduct & { draftId: string | null; key: string | null };

export function withheldProductsFrom(diagnostics: Diagnostic[]): WithheldProduct[] {
  const out: WithheldProduct[] = [];
  for (const d of diagnostics) {
    if (!isObj(d) || d.code !== "fact_extraction_review") continue;
    const ctx = isObj(d.context) ? d.context : {};
    if (ctx.withheld !== true) continue;
    const [p] = heldProductsFrom([d]);
    out.push({ ...p, draftId: clean(ctx.draft_id), key: clean(ctx.pos_product_key) });
  }
  return out;
}

/**
 * R27: every product currently kept off the menu, across deliveries. Only the
 * NEWEST intake version of each delivery counts (a re-stage after a fix
 * supersedes the older copy, so a product whose facts were set drops off this
 * list by itself); archived rows count too, because another delivery's
 * publish archives a version without settling its products.
 */
export type KeptOffProduct = WithheldProduct & { manifestId: string; versionId: string; source: string | null };

export function keptOffFromVersions(
  versions: readonly { id: string; import_id: string | null; created_at: string | null; summary_json: unknown }[],
): KeptOffProduct[] {
  const newest = new Map<string, { id: string; at: number; summary: unknown }>();
  for (const v of versions) {
    if (!v || v.import_id !== null) continue;
    const parsed = parseIntakeSummary(v.summary_json);
    const m = (parsed.manifest?.id ?? parsed.manifestId ?? "").toLowerCase();
    if (!m) continue;
    const at = Date.parse(String(v.created_at ?? ""));
    if (Number.isNaN(at)) continue;
    const prev = newest.get(m);
    if (!prev || at > prev.at) newest.set(m, { id: v.id, at, summary: v.summary_json });
  }
  const out: KeptOffProduct[] = [];
  for (const [m, v] of newest) {
    const parsed = parseIntakeSummary(v.summary);
    for (const p of withheldProductsFrom(parsed.diagnostics)) {
      out.push({ ...p, manifestId: m, versionId: v.id, source: describeSource(parsed.manifest) });
    }
  }
  return out;
}

/**
 * R27: "Publish the ready products" on a WHOLE-delivery fact hold (an update
 * held before R27, or held because nothing else was new at the time). Only a
 * staged, receiving-origin, fact-held version with a recorded delivery is
 * eligible - the action re-stages THAT delivery, which now withholds just the
 * flagged products.
 */
export function publishReadyEligible(v: {
  status: string | null;
  import_id: string | null;
  summary_json: unknown;
}): string | null {
  if (!v || v.status !== "staged" || v.import_id !== null) return null;
  const parsed = parseIntakeSummary(v.summary_json);
  if (parsed.outcome?.state !== "held_for_fact_review") return null;
  const m = (parsed.manifest?.id ?? parsed.manifestId ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m) ? m : null;
}

/** The Publish page notice after "Publish the ready products". */
export function publishReadyNote(outcome: {
  staged: boolean;
  published: boolean;
  reason?: string;
  withheld?: number;
} | null): string {
  if (!outcome) return "Nothing changed \u2014 the delivery could not be rebuilt. Try again.";
  const kept = outcome.withheld ?? 0;
  if (outcome.published) {
    return kept > 0
      ? `Published. ${plural(kept, "product stays", "products stay")} off the menu and the register until ${kept === 1 ? "its" : "their"} facts are set on Product Onboarding; everything else from this delivery is live.`
      : "Published. Every product on this delivery is live.";
  }
  if (outcome.reason === "held-for-fact-review") {
    return "Still waiting: every new product on this delivery has a fact that needs a second look, so there is nothing else to publish yet. Set the facts on Product Onboarding.";
  }
  if (outcome.reason === "held-for-cutover") return "Rebuilt \u2014 it is now waiting only for the one-time Cultivera menu to be published first.";
  if (!outcome.staged) return "Nothing new to publish from this delivery \u2014 its products are already live.";
  return "Rebuilt, but the automatic publish didn\u2019t finish. Press Publish on the update below.";
}

/** Count of approved drafts already on the menu under their POS card. */
export function supersededCountFrom(diagnostics: Diagnostic[]): number {
  return diagnostics.filter((d) => isObj(d) && d.code === "draft_superseded_by_pos").length;
}

// ---------------------------------------------------------------------------
// Copy builders
// ---------------------------------------------------------------------------

/**
 * "From Acme Farms · manifest 1234 · received Sep 26" — the delivery the
 * version came from. Null when no manifest header was persisted (old rows).
 */
export function describeSource(manifest: PersistedManifestHeader | null): string | null {
  if (!manifest) return null;
  const parts: string[] = [];
  parts.push(`From ${manifest.vendor ?? "an unnamed vendor"}`);
  if (manifest.number) parts.push(`manifest ${manifest.number}`);
  // Only say "received" when we truly know the receive time; a transfer date
  // is the vendor's ship date and is labelled as such (never guess).
  const received = formatShortDay(manifest.received_at);
  const transfer = formatShortDay(manifest.transfer_date);
  if (received) parts.push(`received ${received}`);
  else if (transfer) parts.push(`transfer dated ${transfer}`);
  return parts.join(" · ");
}

/** "3 new products, 1 restock, 412 live items carried" (zero parts omitted except carried). */
export function describeCounts(p: { added: number; merged: number; carried: number }): string {
  const parts: string[] = [];
  if (p.added > 0) parts.push(plural(p.added, "new product", "new products"));
  if (p.merged > 0) parts.push(plural(p.merged, "restock", "restocks"));
  if (parts.length === 0) parts.push("no new products");
  parts.push(`${plural(p.carried, "live item", "live items")} carried`);
  return parts.join(", ");
}

/**
 * The humanised `menu_versions.notes` written at insert. Replaces the old
 * "Auto-carried from accepted manifest <uuid>: …" line.
 */
export function buildIntakeVersionNotes(p: {
  manifest: PersistedManifestHeader;
  added: number;
  merged: number;
  carried: number;
}): string {
  return `${describeSource(p.manifest)}: ${describeCounts(p)}.`;
}

export type IntakeVersionTone = "live" | "waiting" | "failed" | "archived" | "unknown";

export type IntakeVersionDescription = {
  tone: IntakeVersionTone;
  /** One line: what happened. */
  headline: string;
  /** Optional second line: why / what it names. */
  detail: string | null;
  /** The one thing to do — only when something is actually waiting. */
  action: string | null;
  /** "From Vendor · manifest N · received Mon D" (null on old rows). */
  source: string | null;
  /** "3 new products, 1 restock, 412 live items carried". */
  counts: string;
  /** Flagged products (may be empty). */
  held: HeldProduct[];
  /** Approved drafts already on the menu under their POS card. */
  superseded: number;
};

export type IntakeVersionInput = {
  status: string;
  published_at: string | null;
  created_at: string;
  summary_json: unknown;
};

function heldDetail(held: HeldProduct[], fallbackCount: number): string | null {
  if (held.length === 0) {
    return fallbackCount > 0
      ? `${plural(fallbackCount, "product was", "products were")} flagged; the details are on the review page.`
      : null;
  }
  const named = held.slice(0, HELD_NAMED_MAX).map((h) =>
    h.reasons[0] ? `${h.name} — ${h.reasons[0]}` : h.name,
  );
  const rest = held.length - named.length;
  return named.join("; ") + (rest > 0 ? `; and ${rest} more` : "");
}

export function describeIntakeVersion(v: IntakeVersionInput): IntakeVersionDescription {
  const s = parseIntakeSummary(v.summary_json);
  const held = heldProductsFrom(s.diagnostics);
  const base = {
    source: describeSource(s.manifest),
    counts: describeCounts(s),
    held,
    superseded: supersededCountFrom(s.diagnostics),
  };
  const when = formatShortMoment(v.published_at);
  const whenPart = when ? ` · ${when}` : "";
  const state = s.outcome?.state ?? null;
  const heldCount = s.outcome?.held_count ?? held.length;

  if (v.status === "published") {
    if (state === "auto_publish_attempted") {
      // R27: say plainly when products were kept off this update alone.
      const kept = s.outcome?.withheld_count ?? withheldProductsFrom(s.diagnostics).length;
      if (kept > 0) {
        const names = withheldProductsFrom(s.diagnostics).slice(0, HELD_NAMED_MAX).map((p) => p.name);
        return {
          ...base,
          tone: "live",
          headline: `Published automatically${whenPart} \u00b7 ${plural(kept, "product", "products")} kept off until ${kept === 1 ? "its" : "their"} facts are set`,
          detail: names.length > 0 ? `Kept off the menu and the register: ${names.join("; ")}${kept > names.length ? `; and ${kept - names.length} more` : ""}.` : null,
          action: "Set the facts on Product Onboarding \u2192 Approved; each product goes live by itself.",
        };
      }
      return { ...base, tone: "live", headline: `Published automatically${whenPart}`, detail: null, action: null };
    }
    if (state === "held_for_fact_review") {
      return {
        ...base,
        tone: "live",
        headline: `Published after review${whenPart}`,
        detail: `Held first because ${plural(heldCount, "product needed", "products needed")} a second look; someone checked and pressed Publish.`,
        action: null,
      };
    }
    if (state === "held_for_cutover") {
      return {
        ...base,
        tone: "live",
        headline: `Published by hand${whenPart}`,
        detail: "It waited for the one-time Cultivera menu to go live first.",
        action: null,
      };
    }
    if (state === "auto_publish_failed") {
      return {
        ...base,
        tone: "live",
        headline: `Published by hand${whenPart}`,
        detail: "The automatic publish didn't finish, so someone pressed Publish.",
        action: null,
      };
    }
    return { ...base, tone: "live", headline: `Live${whenPart}`, detail: null, action: null };
  }

  if (v.status === "archived") {
    return {
      ...base,
      tone: "archived",
      headline: v.published_at
        ? `Was live${whenPart}; replaced by a newer menu`
        : "Replaced by a newer menu update before it was published",
      detail: v.published_at ? null : "Nothing to do — a newer update already carries these products.",
      action: null,
    };
  }

  if (v.status === "staged") {
    if (state === "held_for_fact_review") {
      return {
        ...base,
        tone: "waiting",
        headline: `Waiting: ${plural(heldCount, "fact needs", "facts need")} a second look`,
        detail: heldDetail(held, heldCount),
        action: "Check the flagged facts, then press Publish.",
      };
    }
    if (state === "held_for_cutover") {
      return {
        ...base,
        tone: "waiting",
        headline: "Waiting: publish the Cultivera menu first",
        detail:
          "Your one-time Cultivera menu is uploaded but not published yet. Publish it under Menu Imports first \u2014 then every receiving update publishes itself on top of it.",
        action: "Publish the Cultivera upload under Menu Imports; this update rebuilds itself on top of it.",
      };
    }
    if (state === "auto_publish_failed") {
      return {
        ...base,
        tone: "failed",
        headline: "Automatic publish didn't finish",
        detail: `The system said: ${s.outcome?.error ?? "no error message was returned"}`,
        action: "Press Publish to try again.",
      };
    }
    if (state === "auto_publish_attempted") {
      return {
        ...base,
        tone: "failed",
        headline: "Automatic publish didn't finish",
        detail: "It was started but never confirmed, and no error was recorded.",
        action: "Press Publish to put it live.",
      };
    }
    // Pre-S01 row: no recorded outcome. Say only what is certain.
    return {
      ...base,
      tone: "waiting",
      headline: "Waiting for a Publish click",
      detail:
        held.length > 0
          ? `Flagged for a second look: ${heldDetail(held, held.length)}`
          : "This update was staged before the reason was recorded.",
      action: "Review it, then press Publish.",
    };
  }

  return {
    ...base,
    tone: "unknown",
    headline: `Status: ${clean(v.status) ?? "unknown"}`,
    detail: null,
    action: null,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run by scripts/compliance/run-pure-selftests.ts and
// tests/compliance/intake-version-copy-core.test.ts)
// ---------------------------------------------------------------------------

export function __runIntakeVersionCopyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      throw new Error(`intake-version-copy-core self-test failed: ${label}`);
    }
  };

  const M = buildManifestHeader("m-1", {
    manifest_number: " 0012345 ",
    vendor_label: "Acme   Farms",
    received_at: "2026-09-26T21:14:00Z",
    transfer_date: "2026-09-25",
  });
  ok(M.number === "0012345" && M.vendor === "Acme Farms", "header trims + collapses");
  ok(buildManifestHeader("m", null).vendor === null, "null row -> nulls");
  ok(buildManifestHeader("m", { vendor_label: "   " }).vendor === null, "blank -> null");

  // Pacific wall clock: 21:14Z on Sep 26 is 2:14 PM PDT Sep 26.
  ok(formatShortDay("2026-09-26T21:14:00Z") === "Sep 26", "short day pacific");
  ok(formatShortDay("2026-09-27T05:30:00Z") === "Sep 26", "late-night UTC is still Sep 26 in WA");
  ok(formatShortDay("2026-09-25") === "Sep 25", "bare date not shifted");
  ok(formatShortDay("garbage") === null && formatShortDay(null) === null, "bad date -> null");
  ok((formatShortMoment("2026-09-26T21:14:00Z") ?? "").includes("2:14"), "moment 2:14 PM");

  ok(
    describeSource(M) === "From Acme Farms · manifest 0012345 · received Sep 26",
    "source line full",
  );
  ok(
    describeSource(buildManifestHeader("m", { transfer_date: "2026-09-25" })) ===
      "From an unnamed vendor · transfer dated Sep 25",
    "source falls back to transfer date, honest label",
  );
  ok(describeSource(null) === null, "no header -> null");

  ok(describeCounts({ added: 3, merged: 1, carried: 412 }) === "3 new products, 1 restock, 412 live items carried", "counts");
  ok(describeCounts({ added: 1, merged: 0, carried: 1 }) === "1 new product, 1 live item carried", "singulars");
  ok(describeCounts({ added: 0, merged: 0, carried: 5 }) === "no new products, 5 live items carried", "nothing new");

  const notes = buildIntakeVersionNotes({ manifest: M, added: 3, merged: 1, carried: 412 });
  ok(notes === "From Acme Farms · manifest 0012345 · received Sep 26: 3 new products, 1 restock, 412 live items carried.", "notes");
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(notes), "notes carry no uuid");

  const t = "2026-09-26T21:14:00Z";
  ok(initialPublishOutcome(0, t).state === "auto_publish_attempted", "no flags -> attempted");
  const h = initialPublishOutcome(2, t);
  ok(h.state === "held_for_fact_review" && h.held_count === 2, "flags -> held with count");
  const f = failedPublishOutcome(new Error("  permission   denied "), t);
  ok(f.state === "auto_publish_failed" && f.error === "permission denied", "failed trims");
  ok(failedPublishOutcome("x".repeat(1000), t).error!.length === ERROR_MAX, "error capped");
  ok(failedPublishOutcome(undefined, t).error === "no error message was returned", "empty error honest");

  const flag = (name: string, reasons: string[]) => ({
    severity: "warning",
    code: "fact_extraction_review",
    message: reasons[0] ?? "Extraction needs review.",
    context: { productName: name, displayName: name, reasons },
  });
  const diags = [
    flag("Gummies 100mg", ["Pack count is not written in the product name."]),
    { severity: "info", code: "draft_superseded_by_pos", message: "x" },
    { severity: "info", code: "draft_injected", message: "y" },
  ];
  const summary = (outcome: unknown, extra: Record<string, unknown> = {}) => ({
    origin: "intake",
    manifest_id: "m-1",
    carried: 412,
    added: 3,
    merged: 1,
    diagnostics: diags,
    manifest: M,
    publish_outcome: outcome,
    ...extra,
  });
  const row = (status: string, outcome: unknown, published_at: string | null = null) => ({
    status,
    published_at,
    created_at: t,
    summary_json: summary(outcome),
  });

  const p = parseIntakeSummary(summary(h));
  ok(p.outcome?.state === "held_for_fact_review" && p.manifest?.vendor === "Acme Farms", "parse round-trip");
  ok(parseIntakeSummary(summary({ state: "made_up" })).outcome === null, "unknown state rejected");
  ok(parseIntakeSummary(null).carried === 0 && parseIntakeSummary("junk").diagnostics.length === 0, "junk safe");
  ok(parseIntakeSummary({ carried: -4, added: "3" }).carried === 0, "negative/str counts -> 0");

  const hp = heldProductsFrom(diags);
  ok(hp.length === 1 && hp[0].name === "Gummies 100mg", "held derived");
  ok(heldProductsFrom([{ code: "fact_extraction_review", message: "m only" }])[0].reasons[0] === "m only", "reason falls back to message");
  ok(heldProductsFrom([{ code: "fact_extraction_review" }])[0].name === "A product (name not recorded)", "nameless honest");
  ok(supersededCountFrom(diags) === 1, "superseded counted");

  // Published + attempted -> automatic.
  const d1 = describeIntakeVersion(row("published", initialPublishOutcome(0, t), t));
  ok(d1.tone === "live" && d1.headline.startsWith("Published automatically") && d1.headline.includes("2:14"), "auto published");
  ok(d1.action === null, "live has no action");
  ok(d1.source === "From Acme Farms · manifest 0012345 · received Sep 26", "source on description");
  ok(d1.superseded === 1, "superseded on description");

  // Held then published by hand (manual publish never writes summary_json).
  const d2 = describeIntakeVersion(row("published", h, t));
  ok(d2.headline.startsWith("Published after review"), "held -> published after review");

  // Failed then published by hand.
  ok(describeIntakeVersion(row("published", f, t)).headline.startsWith("Published by hand"), "failed -> by hand");

  // Held + still staged.
  const d3 = describeIntakeVersion(row("staged", h));
  ok(d3.tone === "waiting" && d3.headline === "Waiting: 2 facts need a second look", "held waiting headline");
  ok((d3.detail ?? "").includes("Gummies 100mg — Pack count"), "held names product + reason");
  ok(d3.action === "Check the flagged facts, then press Publish.", "held action");
  ok(describeIntakeVersion(row("staged", initialPublishOutcome(1, t))).headline === "Waiting: 1 fact needs a second look", "singular held");

  // Failed + staged shows the real error.
  const d4 = describeIntakeVersion(row("staged", f));
  ok(d4.tone === "failed" && (d4.detail ?? "").includes("permission denied"), "failed shows error");
  ok(d4.action === "Press Publish to try again.", "failed action");

  // Attempted but still staged: never invent a reason.
  const d5 = describeIntakeVersion(row("staged", initialPublishOutcome(0, t)));
  ok(d5.tone === "failed" && (d5.detail ?? "").includes("no error was recorded"), "attempted+staged honest");

  // Archived.
  ok(describeIntakeVersion(row("archived", h, null)).headline.startsWith("Replaced by a newer menu update"), "archived never live");
  ok(describeIntakeVersion(row("archived", h, t)).headline.startsWith("Was live"), "archived was live");

  // Pre-S01 rows degrade (no manifest, no outcome).
  const legacy = { status: "staged", published_at: null, created_at: t, summary_json: { origin: "intake", carried: 4, added: 1, merged: 0, diagnostics: diags } };
  const d6 = describeIntakeVersion(legacy);
  ok(d6.source === null && d6.headline === "Waiting for a Publish click", "legacy staged degrades");
  ok((d6.detail ?? "").startsWith("Flagged for a second look: Gummies"), "legacy lists flags without claiming cause");
  const d7 = describeIntakeVersion({ ...legacy, summary_json: { origin: "intake" } });
  ok((d7.detail ?? "").includes("before the reason was recorded"), "legacy no flags honest");
  ok(describeIntakeVersion({ ...legacy, status: "published", published_at: t }).headline.startsWith("Live"), "legacy live");
  ok(describeIntakeVersion({ ...legacy, summary_json: null }).counts === "no new products, 0 live items carried", "null summary safe");
  ok(describeIntakeVersion({ ...legacy, status: "weird" }).tone === "unknown", "unknown status");

  // Many held: names HELD_NAMED_MAX then summarises.
  const many = Array.from({ length: 5 }, (_, i) => flag(`P${i}`, [`r${i}`]));
  const d8 = describeIntakeVersion({ status: "staged", published_at: null, created_at: t, summary_json: { diagnostics: many, publish_outcome: initialPublishOutcome(5, t) } });
  ok((d8.detail ?? "").endsWith("; and 2 more") && !(d8.detail ?? "").includes("P3"), "caps named held");

  // S18: cutover hold.
  const cut = initialPublishOutcome(0, t, { cutover: true });
  ok(cut.state === "held_for_cutover" && cut.held_count === undefined, "cutover -> held_for_cutover");
  ok(initialPublishOutcome(2, t, { cutover: true }).state === "held_for_fact_review", "fact hold wins over cutover");
  ok(initialPublishOutcome(0, t, {}).state === "auto_publish_attempted", "no cutover -> attempted");
  ok(parseIntakeSummary({ publish_outcome: cut }).outcome?.state === "held_for_cutover", "cutover parses");
  const c1 = describeIntakeVersion(row("staged", cut));
  ok(c1.tone === "waiting" && c1.headline === "Waiting: publish the Cultivera menu first", "cutover staged copy");
  ok((c1.detail ?? "").startsWith("Your one-time Cultivera menu is uploaded but not published yet."), "S18.4 copy on the card");
  ok(describeIntakeVersion(row("published", cut, t)).headline.startsWith("Published by hand"), "cutover published copy");

  // R27: published with products kept off alone.
  const wo = initialPublishOutcome(0, t, { withheld: 2 });
  ok(wo.state === "auto_publish_attempted" && wo.withheld_count === 2, "withheld count persisted on auto publish");
  ok(initialPublishOutcome(0, t, { withheld: 0 }).withheld_count === undefined, "zero withheld not written");
  ok(initialPublishOutcome(0, t, { withheld: Number.NaN }).withheld_count === undefined, "NaN withheld not written");
  ok(initialPublishOutcome(0, t, { withheld: 2.7 }).withheld_count === 2, "withheld floored");
  ok(initialPublishOutcome(0, t, { cutover: true, withheld: 1 }).withheld_count === 1, "withheld kept on a cutover hold");
  ok(initialPublishOutcome(3, t, { withheld: 1 }).withheld_count === undefined, "a whole-delivery hold has no withheld count");
  ok(parseIntakeSummary({ publish_outcome: wo }).outcome?.withheld_count === 2, "withheld count parses");
  ok(parseIntakeSummary({ publish_outcome: { state: "auto_publish_attempted", at: t, withheld_count: -1 } }).outcome?.withheld_count === undefined, "negative ignored");
  const wflag = (name: string, draft: string) => ({ severity: "warning", code: "fact_extraction_review", message: "m", context: { displayName: name, draft_id: draft, pos_product_key: `K-${draft}`, reasons: ["r"], withheld: true } });
  const wDiags = [wflag("Honeydew", "d1"), wflag("Raspberry", "d2"), flag("NotWithheld", ["r"])];
  const wp = withheldProductsFrom(wDiags as Diagnostic[]);
  ok(wp.length === 2 && wp[0].name === "Honeydew" && wp[0].draftId === "d1" && wp[0].key === "K-d1", "withheld products listed with draft + key");
  const dw = describeIntakeVersion({ status: "published", published_at: t, created_at: t, summary_json: { diagnostics: wDiags, publish_outcome: wo } });
  ok(dw.tone === "live" && dw.headline.includes("2 products kept off until their facts are set"), "published-with-withheld headline: " + dw.headline);
  ok((dw.detail ?? "").includes("Honeydew; Raspberry"), "names the withheld products");
  ok((dw.action ?? "").includes("Product Onboarding"), "says where to fix");
  const dw1 = describeIntakeVersion({ status: "published", published_at: t, created_at: t, summary_json: { diagnostics: [wflag("Honeydew", "d1")], publish_outcome: initialPublishOutcome(0, t, { withheld: 1 }) } });
  ok(dw1.headline.includes("1 product kept off until its facts are set"), "singular withheld");
  ok(describeIntakeVersion(row("published", initialPublishOutcome(0, t), t)).action === null, "nothing withheld -> plain published");
  const MX = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const MY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ver = (id: string, m: string, at: string, diagnostics: unknown[], import_id: string | null = null) => ({
    id, import_id, created_at: at, summary_json: { manifest_id: m, diagnostics, publish_outcome: wo },
  });
  const ko = keptOffFromVersions([
    ver("old", MX, "2026-03-01T00:00:00Z", [wflag("Stale", "d9")]),
    ver("new", MX.toUpperCase(), "2026-03-02T00:00:00Z", [wflag("Honeydew", "d1")]),
    ver("y", MY, "2026-03-01T00:00:00Z", [wflag("Sour", "d3"), flag("Held", ["r"])]),
    ver("pos", MY, "2026-03-05T00:00:00Z", [wflag("Pos", "d4")], "imp-1"),
    ver("bad", MY, "garbage", [wflag("Bad", "d5")]),
  ]);
  ok(ko.map((k) => `${k.versionId}:${k.name}`).sort().join(",") === "new:Honeydew,y:Sour", "kept off = newest intake version per delivery: " + JSON.stringify(ko.map((k) => k.name)));
  ok(ko.find((k) => k.name === "Honeydew")?.manifestId === MX, "manifest lower-cased");
  ok(keptOffFromVersions([ver("fixed", MX, "2026-03-03T00:00:00Z", []), ver("new", MX, "2026-03-02T00:00:00Z", [wflag("Honeydew", "d1")])]).length === 0, "a newer re-stage without the flag clears it");
  const heldV = { status: "staged", import_id: null, summary_json: { manifest_id: MX, publish_outcome: h } };
  ok(publishReadyEligible(heldV) === MX, "held staged receiving version eligible");
  ok(publishReadyEligible({ ...heldV, status: "published" }) === null, "published not eligible");
  ok(publishReadyEligible({ ...heldV, import_id: "imp" }) === null, "POS import not eligible");
  ok(publishReadyEligible({ ...heldV, summary_json: { manifest_id: MX, publish_outcome: f } }) === null, "a failed publish is not a fact hold");
  ok(publishReadyEligible({ ...heldV, summary_json: { manifest_id: "junk", publish_outcome: h } }) === null, "junk manifest refused");
  ok(publishReadyNote({ staged: true, published: true, withheld: 3 }).startsWith("Published. 3 products stay off"), "ready note partial");
  ok(publishReadyNote({ staged: true, published: true, withheld: 1 }).includes("1 product stays off the menu and the register until its facts"), "ready note singular");
  ok(publishReadyNote({ staged: true, published: true }) === "Published. Every product on this delivery is live.", "ready note all");
  ok(publishReadyNote({ staged: true, published: false, reason: "held-for-fact-review" }).startsWith("Still waiting"), "ready note still held");
  ok(publishReadyNote({ staged: false, published: false, reason: "no-new-items" }).startsWith("Nothing new"), "ready note nothing new");
  ok(publishReadyNote({ staged: true, published: false }).includes("didn\u2019t finish"), "ready note publish failed");
  ok(publishReadyNote(null).startsWith("Nothing changed"), "ready note null");

  return { passed, failed };
}
