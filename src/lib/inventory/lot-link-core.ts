/**
 * src/lib/inventory/lot-link-core.ts   (S37 — Inventory fix-everything)
 *
 * The two narrow doors that fill a lot's missing links:
 *
 *   1. LINK A PRODUCT — set `inventory_lots.pos_product_key` on a lot that has
 *      none, to a key that really exists (a published menu card, a size on a
 *      published mastered card, or a Product Onboarding draft).
 *   2. ATTACH A LAB RESULT — set `inventory_lots.lab_result_id` on a lot that
 *      has none, to a lab result that was already imported.
 *
 * Bible S37 (verbatim goals): "sets pos_product_key ONLY when it is empty,
 * validates the key exists on the published menu or in Onboarding, requires
 * inventory.manage, and writes an audit event" and "pick an already-imported
 * lab result ... and attach it to the lot, audited."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT AN EDIT OF A LOCKED FIELD
 *
 * `LOCKED_LOT_FIELDS` (lot-edit-core.ts) stays exactly as it is. Neither door
 * can CHANGE a value: both fill a blank and refuse otherwise. The same rule is
 * enforced twice — here (so the owner gets a clear reason) and again in the
 * UPDATE's WHERE clause (store.ts), which is the compare-and-set that defeats
 * a second tab or a second person racing the same lot (Fowler, "Optimistic
 * Offline Lock"; PostgREST conditional PATCH). Re-pointing an existing key or
 * replacing a linked COA remains out of scope (bible S37.8).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT A COA CANDIDATE SHOWS, AND WHY NOTHING IS GUESSED
 *
 * A COA belongs to one harvest/production batch. This module never suggests a
 * lab result by similarity (same product, sibling lot, same vendor): two lots
 * of the same product can be different batches with different results. The
 * owner types the Lab test ID printed on the COA (`labtest_external_identifier`,
 * the identifier CCRS LabTest reporting uses) and is shown every imported lab
 * result carrying exactly that id. A FAILED result can be attached — it is a
 * true fact about the lot, and the activation gate (lot-activation-gate-core)
 * then keeps it off the floor; hiding it would be worse. An expired COA is
 * shown as expired: WAC 314-55-102 gives a COA a 12-month life from issuance
 * unless the product was already transferred to retail, so it is a warning the
 * owner must read, not a reason this module may decide on his behalf.
 *
 * PURE: no I/O, no clock (today is passed in). Registered in
 * scripts/compliance/run-pure-selftests.ts.
 */
import { parseProductKeyInput } from "@/lib/inventory/bulk-fill-core";

/** The lot page anchors these doors render under (fix links target them). */
export const PRODUCT_LINK_ANCHOR = "product-link";
export const COA_ANCHOR = "coa";

/** Suffix of an intake size id (`${lotKey}-onboarded`, variant-lot-core.ts). */
export const SIZE_ID_SUFFIX = "-onboarded";

/** Longest Lab test ID we will search for (CCRS ids are far shorter). */
export const MAX_LABTEST_ID = 200;

/** The lot facts both doors decide on. Mirrors real inventory_lots columns. */
export type LinkableLot = {
  status: string | null;
  pos_product_key: string | null;
  lab_result_id: string | null;
};

export type LinkRefusal =
  | "destroyed"
  | "key_already_set"
  | "coa_already_linked";

export function refusalMessage(r: LinkRefusal): string {
  switch (r) {
    case "destroyed":
      return "This lot is destroyed and out of inventory, so it cannot be linked.";
    case "key_already_set":
      return "This lot is already linked to a product. Linking only fills an empty key; it never re-points one.";
    case "coa_already_linked":
      return "This lot already has a lab result linked. Attaching only fills an empty link; it never replaces a COA.";
  }
}

function isDestroyed(lot: LinkableLot): boolean {
  return (lot.status ?? "").trim().toLowerCase() === "destroyed";
}

/**
 * True when the lot has no product key. The empty string counts as blank
 * (0023:96 allows it), exactly like bulk-fill-core `isBlank`. The store's
 * guarded UPDATE re-asserts the blank as `is null`, then `= ''`; a key of
 * only spaces passes this gate but matches neither guard, so the write
 * changes nothing and the owner is told the lot is already linked (safe:
 * never an overwrite).
 */
export function lotHasNoProductKey(lot: LinkableLot): boolean {
  return !(lot.pos_product_key ?? "").trim();
}

/** May the "Link this lot to a product" door open? First failure wins. */
export function productLinkEligibility(lot: LinkableLot): { ok: true } | { ok: false; reason: LinkRefusal } {
  if (isDestroyed(lot)) return { ok: false, reason: "destroyed" };
  if (!lotHasNoProductKey(lot)) return { ok: false, reason: "key_already_set" };
  return { ok: true };
}

/** May the "Attach a lab result" door open? First failure wins. */
export function coaLinkEligibility(lot: LinkableLot): { ok: true } | { ok: false; reason: LinkRefusal } {
  if (isDestroyed(lot)) return { ok: false, reason: "destroyed" };
  if (lot.lab_result_id != null && String(lot.lab_result_id).trim() !== "") {
    return { ok: false, reason: "coa_already_linked" };
  }
  return { ok: true };
}

/**
 * Parse the typed product key. Reuses the Bulk fill validator (trim, required,
 * length cap) so the two doors that write this column accept the same input,
 * then refuses a SIZE id: `K-onboarded` names one size on a mastered card,
 * never a lot key, and storing it would link the lot to nothing the register
 * aggregates under. The message names the key the owner most likely meant.
 */
export function parseLinkKeyInput(raw: string | null): { ok: true; value: string } | { ok: false; error: string } {
  const base = parseProductKeyInput(raw);
  if (!base.ok) return { ok: false, error: base.error };
  const v = String(base.value);
  if (v.endsWith(SIZE_ID_SUFFIX)) {
    const lotKey = v.slice(0, -SIZE_ID_SUFFIX.length).trim();
    return {
      ok: false,
      error: lotKey
        ? `"${v}" is the id of one size on a menu card, not a product key. Enter the product key "${lotKey}" instead.`
        : `"${v}" is not a product key.`,
    };
  }
  return { ok: true, value: v };
}

/** What the store found for a typed key. Each flag is a separate, real read. */
export type KeyEvidence = {
  /** A published menu_items row has source_item_id === key. */
  publishedCard: boolean;
  /** A published menu_variants row has source_variant_id === `${key}-onboarded`. */
  publishedSize: boolean;
  /** Statuses of catalog_product_drafts rows with pos_product_key === key. */
  draftStatuses: string[];
};

export type KeyResolution =
  | { ok: true; where: "published_card" | "published_size" | "onboarding_draft" | "onboarding_approved" }
  | { ok: false; error: string };

/**
 * Does the key resolve? Order = strongest evidence first: a published card is
 * what the register sells; a published size means a mastered card already
 * sells this lot key; an open or approved Onboarding draft is on its way to
 * the menu. A key that is only on DISMISSED drafts was rejected by a person
 * and is refused with that reason, not silently accepted.
 */
export function resolveKeyEvidence(e: KeyEvidence): KeyResolution {
  if (e.publishedCard) return { ok: true, where: "published_card" };
  if (e.publishedSize) return { ok: true, where: "published_size" };
  const statuses = new Set(e.draftStatuses.map((s) => (s ?? "").trim().toLowerCase()));
  if (statuses.has("draft")) return { ok: true, where: "onboarding_draft" };
  if (statuses.has("approved")) return { ok: true, where: "onboarding_approved" };
  if (statuses.has("dismissed")) {
    return {
      ok: false,
      error:
        "That product key is only on a dismissed Product Onboarding draft. Restore the draft in Product Onboarding first, then link the lot.",
    };
  }
  return {
    ok: false,
    error:
      "No published menu card, menu size or Product Onboarding draft uses that product key. Check the key, or onboard the product first.",
  };
}

/** Plain-English confirmation of where the key was found (saved banner + audit). */
export function resolutionLabel(where: Extract<KeyResolution, { ok: true }>["where"]): string {
  switch (where) {
    case "published_card":
      return "a card on the published menu";
    case "published_size":
      return "a size on a published menu card";
    case "onboarding_draft":
      return "a draft waiting in Product Onboarding";
    case "onboarding_approved":
      return "an approved Product Onboarding draft";
  }
}

/**
 * Plain-English provenance of an existing key (migration 0215 check
 * constraint: pos_import | owner_entered). Unknown/absent -> null, so the
 * page says nothing rather than inventing a source.
 */
export function keySourceLabel(source: unknown): string | null {
  if (source === "pos_import") return "from the POS import";
  if (source === "owner_entered") return "entered by hand";
  return null;
}

/** Parse the Lab test ID search box. Blank -> null (no search, no query). */
export function parseLabtestSearch(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (Array.isArray(raw)) return { ok: true, value: null };
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { ok: true, value: null };
  if (v.length > MAX_LABTEST_ID) {
    return { ok: false, error: `That Lab test ID is too long (max ${MAX_LABTEST_ID} characters).` };
  }
  return { ok: true, value: v };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse the chosen lab result id (a hidden field). Never trusted unvalidated. */
export function parseLabResultChoice(raw: string | null): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Choose a lab result to attach." };
  if (!UUID_RE.test(v)) return { ok: false, error: "That lab result id is not valid." };
  return { ok: true, value: v.toLowerCase() };
}

/** The lab_results columns a candidate row shows (named, never select *). */
export const COA_CANDIDATE_COLUMNS =
  "id, labtest_external_identifier, lab_name, tested_on, total_thc_pct, thc_pct, passed, coa_release_date, coa_expire_date, created_at";

export type CoaCandidateRow = {
  id: string;
  labtest_external_identifier: string | null;
  lab_name: string | null;
  tested_on: string | null;
  total_thc_pct: number | null;
  thc_pct: number | null;
  passed: boolean | null;
  coa_release_date: string | null;
  coa_expire_date: string | null;
  created_at: string | null;
};

export type CoaCandidateView = {
  id: string;
  title: string;
  facts: string[];
  result: "PASS" | "FAIL" | "not reported";
  warnings: string[];
  /** How many OTHER lots already carry this lab result (null = unknown). */
  linkedLots: number | null;
};

function fmtPct(n: number | null): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return `${Number(n).toFixed(1)}%`;
}

/**
 * One candidate as the owner reads it. `today` is a Pacific YYYY-MM-DD.
 * Unknowns are said plainly ("not reported"), never filled in.
 */
export function coaCandidateView(row: CoaCandidateRow, today: string, linkedLots: number | null): CoaCandidateView {
  const id = (row.labtest_external_identifier ?? "").trim();
  const lab = (row.lab_name ?? "").trim();
  const title = [id || "No Lab test ID", lab || null].filter(Boolean).join(" · ");
  const facts: string[] = [];
  facts.push(row.tested_on ? `Tested ${row.tested_on}` : "Test date not reported");
  const thc = fmtPct(row.total_thc_pct ?? row.thc_pct);
  facts.push(thc ? `Total THC ${thc}` : "THC not reported");
  if (row.coa_expire_date) facts.push(`COA expires ${row.coa_expire_date}`);
  const result: CoaCandidateView["result"] = row.passed == null ? "not reported" : row.passed ? "PASS" : "FAIL";
  const warnings: string[] = [];
  if (row.passed === false) {
    warnings.push("This lab result FAILED. Attaching it records the failure, and the lot cannot be activated for sale.");
  }
  if (row.coa_expire_date && row.coa_expire_date < today) {
    warnings.push(
      "This COA's expiry date has passed. Under WAC 314-55-102 a COA expires 12 months after issuance unless the product was already transferred to a retailer — check before selling.",
    );
  }
  if (linkedLots != null && linkedLots > 0) {
    warnings.push(
      `Already linked to ${linkedLots} other ${linkedLots === 1 ? "lot" : "lots"}. A COA covers one batch — attach it only if this lot is that batch.`,
    );
  }
  return { id: row.id, title, facts, result, warnings, linkedLots };
}

/** Newest test first; undated last; id as the stable tie-break. */
export function sortCoaCandidates(rows: readonly CoaCandidateRow[]): CoaCandidateRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.tested_on ?? "";
    const tb = b.tested_on ?? "";
    if (ta !== tb) {
      if (!ta) return 1;
      if (!tb) return -1;
      return ta < tb ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The search result sentence above the candidate list. */
export function coaSearchSummary(term: string, count: number): string {
  if (count === 0) {
    return `No imported lab result has the Lab test ID "${term}". Lab results are imported with a delivery in Receiving; check the ID on the COA.`;
  }
  return count === 1
    ? `1 imported lab result has the Lab test ID "${term}".`
    : `${count} imported lab results have the Lab test ID "${term}". Pick the one for this lot's batch.`;
}

/** A Product Onboarding draft created FROM this lot (catalog_product_drafts.lot_id). */
export type LotDraftHint = { pos_product_key: string | null; name: string | null; status: string | null };

/**
 * Keys the owner can link with one click: the open or approved Onboarding
 * drafts whose provenance column `lot_id` names THIS lot. That is evidence
 * (the draft was seeded from this very lot), not a similarity guess.
 * Blank keys and dismissed drafts are dropped; duplicates collapse.
 */
export function draftKeySuggestions(drafts: readonly LotDraftHint[]): { key: string; name: string; status: string }[] {
  const out: { key: string; name: string; status: string }[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const key = (d.pos_product_key ?? "").trim();
    const status = (d.status ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (status !== "draft" && status !== "approved") continue;
    if (key.endsWith(SIZE_ID_SUFFIX)) continue;
    seen.add(key);
    out.push({ key, name: (d.name ?? "").trim() || key, status });
  }
  return out;
}

/** The lot page href for a lot with a search term (encoded, anchored). */
export function coaSearchHref(lotId: string, term: string): string {
  return `/admin/inventory/${encodeURIComponent(lotId)}?coaSearch=${encodeURIComponent(term)}#${COA_ANCHOR}`;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runLotLinkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lot-link-core: " + msg);
    passed += 1;
  };
  const lot = (over: Partial<LinkableLot> = {}): LinkableLot => ({
    status: "active",
    pos_product_key: null,
    lab_result_id: null,
    ...over,
  });

  // Eligibility — product key
  ok(productLinkEligibility(lot()).ok, "blank key on an active lot may be linked");
  ok(productLinkEligibility(lot({ pos_product_key: "" })).ok, "empty-string key counts as blank");
  ok(productLinkEligibility(lot({ pos_product_key: "   " })).ok, "whitespace key counts as blank");
  const set = productLinkEligibility(lot({ pos_product_key: "K" }));
  ok(!set.ok && set.reason === "key_already_set", "an existing key is never re-pointed");
  const dead = productLinkEligibility(lot({ status: " Destroyed " }));
  ok(!dead.ok && dead.reason === "destroyed", "destroyed lots refused (case/space-insensitive)");
  const deadSet = productLinkEligibility(lot({ status: "destroyed", pos_product_key: "K" }));
  ok(!deadSet.ok && deadSet.reason === "destroyed", "destroyed is reported first");
  ok(productLinkEligibility(lot({ status: "quarantine" })).ok, "quarantined lots may be linked (linking is not activating)");

  // Eligibility — COA
  ok(coaLinkEligibility(lot()).ok, "no COA may be attached");
  const linked = coaLinkEligibility(lot({ lab_result_id: "x" }));
  ok(!linked.ok && linked.reason === "coa_already_linked", "a linked COA is never replaced");
  const deadCoa = coaLinkEligibility(lot({ status: "destroyed" }));
  ok(!deadCoa.ok && deadCoa.reason === "destroyed", "destroyed lots refused for COA");
  ok(/never re-points/.test(refusalMessage("key_already_set")), "key refusal says it never re-points");
  ok(/never replaces/.test(refusalMessage("coa_already_linked")), "COA refusal says it never replaces");
  ok(/destroyed/.test(refusalMessage("destroyed")), "destroyed refusal names the state");

  // Key parsing
  const p = parseLinkKeyInput("  SKU-9  ");
  ok(p.ok && p.value === "SKU-9", "key trimmed");
  const blank = parseLinkKeyInput("   ");
  ok(!blank.ok && /Enter a POS product key/.test(blank.error), "blank key refused (Bulk fill wording)");
  ok(!parseLinkKeyInput("x".repeat(201)).ok, "over-long key refused");
  ok(parseLinkKeyInput("x".repeat(200)).ok, "200 characters accepted (boundary)");
  const size = parseLinkKeyInput("LOT-7-onboarded");
  ok(!size.ok && size.error.includes('Enter the product key "LOT-7"'), "a size id is refused and the lot key named");
  const bare = parseLinkKeyInput("-onboarded");
  ok(!bare.ok && /not a product key/.test(bare.error), "a bare suffix is refused");
  ok(parseLinkKeyInput("onboarded-LOT").ok, "the suffix only matters at the end");

  // Key resolution
  const none: KeyEvidence = { publishedCard: false, publishedSize: false, draftStatuses: [] };
  const r0 = resolveKeyEvidence(none);
  ok(!r0.ok && /No published menu card/.test(r0.error), "unknown key refused");
  const rc = resolveKeyEvidence({ ...none, publishedCard: true, draftStatuses: ["dismissed"] });
  ok(rc.ok && rc.where === "published_card", "published card wins over a dismissed draft");
  const rs = resolveKeyEvidence({ ...none, publishedSize: true });
  ok(rs.ok && rs.where === "published_size", "a published size resolves");
  const rd = resolveKeyEvidence({ ...none, draftStatuses: ["approved", " Draft "] });
  ok(rd.ok && rd.where === "onboarding_draft", "an open draft resolves (normalized), ahead of approved");
  const ra = resolveKeyEvidence({ ...none, draftStatuses: ["approved"] });
  ok(ra.ok && ra.where === "onboarding_approved", "an approved draft resolves");
  const rx = resolveKeyEvidence({ ...none, draftStatuses: ["dismissed"] });
  ok(!rx.ok && /dismissed/.test(rx.error), "dismissed-only is refused with its reason");
  ok(resolutionLabel("published_card") === "a card on the published menu", "resolution label");
  ok(resolutionLabel("onboarding_approved").includes("approved"), "approved label");

  // Lab test search + choice
  const s0 = parseLabtestSearch("  ");
  ok(s0.ok && s0.value === null, "blank search -> no search");
  const s1 = parseLabtestSearch(" WA-LT-1 ");
  ok(s1.ok && s1.value === "WA-LT-1", "search trimmed");
  const s2 = parseLabtestSearch(["a", "b"]);
  ok(s2.ok && s2.value === null, "repeated param ignored");
  ok(!parseLabtestSearch("x".repeat(201)).ok, "over-long search refused");
  ok(parseLabtestSearch(undefined).ok, "missing param is fine");
  const U = "AAAAAAAA-1111-4111-8111-111111111111";
  const c1 = parseLabResultChoice(` ${U} `);
  ok(c1.ok && c1.value === U.toLowerCase(), "choice normalized to lower-case uuid");
  ok(!parseLabResultChoice("").ok, "missing choice refused");
  ok(!parseLabResultChoice("1; drop table").ok, "non-uuid refused");

  // Candidate view
  const row = (over: Partial<CoaCandidateRow> = {}): CoaCandidateRow => ({
    id: "lr-1",
    labtest_external_identifier: "LT-1",
    lab_name: "Confidence",
    tested_on: "2026-01-05",
    total_thc_pct: 24.25,
    thc_pct: null,
    passed: true,
    coa_release_date: "2026-01-06",
    coa_expire_date: "2027-01-06",
    created_at: "2026-01-06T00:00:00Z",
    ...over,
  });
  const v = coaCandidateView(row(), "2026-06-01", 0);
  ok(v.title === "LT-1 · Confidence", "title = id · lab");
  ok(v.facts.join("|") === "Tested 2026-01-05|Total THC 24.3%|COA expires 2027-01-06", "facts in order");
  ok(v.result === "PASS" && v.warnings.length === 0, "clean pass has no warnings");
  const unknown = coaCandidateView(row({ tested_on: null, total_thc_pct: null, passed: null, coa_expire_date: null, lab_name: null, labtest_external_identifier: null }), "2026-06-01", null);
  ok(unknown.title === "No Lab test ID", "missing id said plainly");
  ok(unknown.facts.join("|") === "Test date not reported|THC not reported", "unknowns never invented");
  ok(unknown.result === "not reported" && unknown.warnings.length === 0, "unknown result is not a failure");
  ok(coaCandidateView(row({ total_thc_pct: null, thc_pct: 18 }), "2026-06-01", 0).facts[1] === "Total THC 18.0%", "falls back to thc_pct");
  const failed = coaCandidateView(row({ passed: false }), "2026-06-01", 0);
  ok(failed.result === "FAIL" && /FAILED/.test(failed.warnings[0]), "failure warned, not hidden");
  const expired = coaCandidateView(row({ coa_expire_date: "2026-05-31" }), "2026-06-01", 0);
  ok(expired.warnings.some((w) => /WAC 314-55-102/.test(w)), "expired COA warned with the rule");
  ok(coaCandidateView(row({ coa_expire_date: "2026-06-01" }), "2026-06-01", 0).warnings.length === 0, "expiring today is not yet expired");
  const shared = coaCandidateView(row(), "2026-06-01", 2);
  ok(shared.warnings.some((w) => w.includes("2 other lots")), "sharing across lots warned (plural)");
  ok(coaCandidateView(row(), "2026-06-01", 1).warnings.some((w) => w.includes("1 other lot.")), "singular lot");

  // Sort
  const sorted = sortCoaCandidates([
    row({ id: "b", tested_on: null }),
    row({ id: "c", tested_on: "2026-01-01" }),
    row({ id: "a", tested_on: "2026-03-01" }),
    row({ id: "d", tested_on: "2026-01-01" }),
  ]);
  ok(sorted.map((r) => r.id).join(",") === "a,c,d,b", "newest first, undated last, id tie-break");

  // Summary
  ok(/No imported lab result/.test(coaSearchSummary("X", 0)), "zero results explained with where to import");
  ok(coaSearchSummary("X", 1) === '1 imported lab result has the Lab test ID "X".', "singular summary");
  ok(/Pick the one for this lot's batch/.test(coaSearchSummary("X", 3)), "plural summary asks to pick");

  // Draft suggestions
  const sug = draftKeySuggestions([
    { pos_product_key: " K1 ", name: "Blue Dream", status: "draft" },
    { pos_product_key: "K1", name: "dup", status: "approved" },
    { pos_product_key: "K2", name: null, status: "Approved" },
    { pos_product_key: "K3", name: "x", status: "dismissed" },
    { pos_product_key: "", name: "blank", status: "draft" },
    { pos_product_key: "K4-onboarded", name: "size", status: "draft" },
  ]);
  ok(sug.map((s) => s.key).join(",") === "K1,K2", "only open/approved, non-blank, non-size, de-duplicated");
  ok(sug[0].name === "Blue Dream" && sug[1].name === "K2", "name falls back to the key");

  // Key provenance
  ok(keySourceLabel("pos_import") === "from the POS import", "pos_import label");
  ok(keySourceLabel("owner_entered") === "entered by hand", "owner_entered label");
  ok(keySourceLabel(null) === null && keySourceLabel("manifest") === null, "unknown source says nothing");

  // Href
  ok(coaSearchHref("lot 1", "A&B") === "/admin/inventory/lot%201?coaSearch=A%26B#coa", "search href encoded + anchored");
  ok(PRODUCT_LINK_ANCHOR === "product-link" && COA_ANCHOR === "coa", "anchors pinned");

  return { passed, failed: 0 };
}
