/**
 * D244 E-2 — bulk publish / unpublish / archive for the enrichment worklist
 * (PURE, no I/O; client-safe).
 *
 * Owner (D244 request): "there are several products that have an image, but
 * are drafts" — only PUBLISHED enrichment reaches the public menu
 * (store.ts mergeForDisplay), so a draft with a photo shows nothing. This core
 * decides, for a set of selected cards, which ones a bulk status change will
 * actually touch and why the rest are skipped, and builds the pre-flight
 * summary the owner sees before pressing Publish.
 *
 * Publishing is still a person's click (AGENTS rule 3): nothing here runs on
 * its own.
 */

export type BulkStatus = "published" | "draft" | "archived";

/** Which selected cards a PUBLISH applies to (owner decision D244 Q2 is open). */
export type BulkPublishMode =
  /** Draft + photo (default — the owner's "image, but drafts" backlog). */
  | "photo"
  /** Draft + photo + a real description (not the placeholder sentence). */
  | "photo-copy"
  /** Every selected card that has its own enrichment record. */
  | "all";

/** The bulk bar's form id (checkboxes join it via the `form` attribute). */
export const BULK_FORM_ID = "bulk-status-form";

/** Most keys one press may change (keeps one request inside maxDuration). */
export const BULK_STATUS_MAX = 2000;

/** The subset of GapFlags this core needs. */
export type BulkRow = {
  posKey: string;
  hasImage: boolean;
  hasDescription: boolean;
  descriptionPlaceholder?: boolean;
  enrichmentStatus: string | null;
  /**
   * The card has its OWN product_enrichments row. false when there is none
   * (or the card is only served by the product's record, S20) — a status
   * change has nothing of its own to flip.
   */
  hasOwnRecord: boolean;
};

export type SkipReason = "no-record" | "already" | "no-photo" | "no-copy";

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  "no-record": "have no enrichment record of their own yet",
  already: "already had that status",
  "no-photo": "have no photo",
  "no-copy": "have no real description",
};

export function parseBulkStatus(raw: unknown): BulkStatus | null {
  return raw === "published" || raw === "draft" || raw === "archived" ? raw : null;
}

export function parseBulkPublishMode(raw: unknown): BulkPublishMode {
  return raw === "photo-copy" || raw === "all" ? raw : "photo";
}

/** "Ready to publish": a DRAFT with a photo (optionally also real copy). */
export function isReadyToPublish(
  r: Pick<BulkRow, "enrichmentStatus" | "hasImage" | "hasDescription">,
  requireCopy = false,
): boolean {
  return r.enrichmentStatus === "draft" && r.hasImage && (!requireCopy || r.hasDescription);
}

export type BulkPreflight = {
  total: number;
  /** draft + photo */
  ready: number;
  /** draft + photo + real description */
  readyWithCopy: number;
  /** of the ready ones, only the placeholder sentence / no copy */
  readyNoCopy: number;
  /** drafts without a photo */
  draftNoPhoto: number;
  noRecord: number;
  published: number;
};

export function bulkPreflight(rows: BulkRow[]): BulkPreflight {
  const out: BulkPreflight = { total: rows.length, ready: 0, readyWithCopy: 0, readyNoCopy: 0, draftNoPhoto: 0, noRecord: 0, published: 0 };
  for (const r of rows) {
    if (!r.hasOwnRecord) out.noRecord++;
    if (r.enrichmentStatus === "published") out.published++;
    if (isReadyToPublish(r)) {
      out.ready++;
      if (r.hasDescription) out.readyWithCopy++;
      else out.readyNoCopy++;
    } else if (r.enrichmentStatus === "draft" && !r.hasImage) out.draftNoPhoto++;
  }
  return out;
}

export type BulkPlan = {
  apply: string[];
  skipped: Partial<Record<SkipReason, number>>;
};

/** Decide which rows a bulk status change touches. Order of `rows` is kept. */
export function planBulkStatus(rows: BulkRow[], status: BulkStatus, mode: BulkPublishMode = "photo"): BulkPlan {
  const apply: string[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  const skip = (r: SkipReason) => {
    skipped[r] = (skipped[r] ?? 0) + 1;
  };
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.posKey)) continue;
    seen.add(r.posKey);
    if (!r.hasOwnRecord) {
      skip("no-record");
      continue;
    }
    if (r.enrichmentStatus === status) {
      skip("already");
      continue;
    }
    if (status === "published" && mode !== "all") {
      if (!r.hasImage) {
        skip("no-photo");
        continue;
      }
      if (mode === "photo-copy" && !r.hasDescription) {
        skip("no-copy");
        continue;
      }
    }
    apply.push(r.posKey);
  }
  return { apply, skipped };
}

/**
 * The keys a press refers to: the ticked boxes, or (scope "matching") every
 * key the page listed for the whole filter. Trimmed, de-duplicated, capped.
 */
export function resolveBulkKeys(
  ticked: unknown[],
  matchingRaw: unknown,
  scope: unknown,
  cap = BULK_STATUS_MAX,
): { keys: string[]; capped: boolean } {
  const src =
    scope === "matching" && typeof matchingRaw === "string"
      ? matchingRaw.split("\n")
      : ticked.map((k) => (typeof k === "string" ? k : ""));
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of src) {
    const k = raw.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
  }
  return { keys: keys.slice(0, cap), capped: keys.length > cap };
}

const VERB: Record<BulkStatus, string> = { published: "Published", draft: "Moved back to draft", archived: "Archived" };

/** One plain sentence for the ?ok= flash. */
export function bulkOutcomeMessage(
  status: BulkStatus,
  applied: number,
  skipped: Partial<Record<SkipReason, number>>,
  extra?: { capped?: boolean; cap?: number; writebackDone?: number; writebackLeft?: number },
): string {
  const parts: string[] = [`${VERB[status]} ${applied} product${applied === 1 ? "" : "s"}.`];
  const skips = (Object.keys(SKIP_REASON_LABEL) as SkipReason[])
    .filter((r) => (skipped[r] ?? 0) > 0)
    .map((r) => `${skipped[r]} ${SKIP_REASON_LABEL[r]}`);
  if (skips.length) parts.push(`Skipped: ${skips.join("; ")}.`);
  if (extra?.capped) parts.push(`Only the first ${extra.cap ?? BULK_STATUS_MAX} were handled; press again for the rest.`);
  if (status === "published" && applied > 0) {
    parts.push("They are live on the menu now.");
    if ((extra?.writebackLeft ?? 0) > 0) {
      parts.push(
        `Knowledge-base write-back ran for ${extra?.writebackDone ?? 0}; ${extra?.writebackLeft} ran out of time (they are live; their KB facts update on their next publish or accept).`,
      );
    }
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// D244 round 2 (R-1): publish on photo
// ---------------------------------------------------------------------------

/**
 * Owner (verbatim): "a product should be publish once it has a picture. the
 * other important details like description and facts can come later. the
 * menu looks terrible without product pictures, but with them, its a game
 * changer."
 *
 * After a PERSON attaches a photo: a draft that now has a photo goes live.
 * An archived card stays archived (someone retired it on purpose); a
 * published one is left alone; no photo = nothing to do. A photo that is
 * not yet public in the media library (an import still "rights pending
 * review") does not count - shoppers would see no picture. The env switch
 * ENRICH_PUBLISH_ON_PHOTO=off turns it off without a code change.
 */
export type PhotoPublishDecision = "publish" | "already-live" | "archived" | "no-photo" | "photo-not-public" | "off";

export function photoPublishDecision(
  r: { enrichmentStatus: string | null | undefined; hasImage: boolean; hasPublicImage?: boolean },
  switchRaw?: unknown,
): PhotoPublishDecision {
  if (typeof switchRaw === "string" && /^(off|false|0|no)$/i.test(switchRaw.trim())) return "off";
  if (!r.hasImage) return "no-photo";
  if (r.hasPublicImage === false) return "photo-not-public";
  if (r.enrichmentStatus === "published") return "already-live";
  if (r.enrichmentStatus === "archived") return "archived";
  return "publish";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runBulkPublishCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`bulk-publish-core FAIL: ${label}`);
    }
  };
  const row = (o: Partial<BulkRow> & { posKey: string }): BulkRow => ({
    hasImage: false,
    hasDescription: false,
    enrichmentStatus: null,
    hasOwnRecord: false,
    ...o,
  });
  const rows: BulkRow[] = [
    row({ posKey: "A", hasImage: true, hasDescription: true, enrichmentStatus: "draft", hasOwnRecord: true }),
    row({ posKey: "B", hasImage: true, hasDescription: false, descriptionPlaceholder: true, enrichmentStatus: "draft", hasOwnRecord: true }),
    row({ posKey: "C", hasImage: false, hasDescription: true, enrichmentStatus: "draft", hasOwnRecord: true }),
    row({ posKey: "D", hasImage: true, hasDescription: true, enrichmentStatus: "published", hasOwnRecord: true }),
    row({ posKey: "E" }),
  ];

  ok(parseBulkStatus("published") === "published", "status published");
  ok(parseBulkStatus("archived") === "archived", "status archived");
  ok(parseBulkStatus("draft") === "draft", "status draft");
  ok(parseBulkStatus("hidden") === null, "status junk → null");
  ok(parseBulkPublishMode("all") === "all", "mode all");
  ok(parseBulkPublishMode("photo-copy") === "photo-copy", "mode photo-copy");
  ok(parseBulkPublishMode(undefined) === "photo", "mode default photo");

  ok(isReadyToPublish(rows[0]!) && isReadyToPublish(rows[1]!), "draft+photo ready");
  ok(!isReadyToPublish(rows[1]!, true), "placeholder not ready with copy");
  ok(!isReadyToPublish(rows[2]!), "no photo not ready");
  ok(!isReadyToPublish(rows[3]!), "published not ready");
  ok(!isReadyToPublish(rows[4]!), "no record not ready");

  const pf = bulkPreflight(rows);
  ok(pf.total === 5, "pf total");
  ok(pf.ready === 2, "pf ready");
  ok(pf.readyWithCopy === 1, "pf readyWithCopy");
  ok(pf.readyNoCopy === 1, "pf readyNoCopy");
  ok(pf.draftNoPhoto === 1, "pf draftNoPhoto");
  ok(pf.noRecord === 1, "pf noRecord");
  ok(pf.published === 1, "pf published");

  const p1 = planBulkStatus(rows, "published");
  ok(p1.apply.join() === "A,B", "publish photo mode → A,B");
  ok(p1.skipped["no-photo"] === 1 && p1.skipped.already === 1 && p1.skipped["no-record"] === 1, "publish skips counted");
  const p2 = planBulkStatus(rows, "published", "photo-copy");
  ok(p2.apply.join() === "A" && p2.skipped["no-copy"] === 1, "photo-copy mode");
  const p3 = planBulkStatus(rows, "published", "all");
  ok(p3.apply.join() === "A,B,C", "all mode still needs own record");
  const p4 = planBulkStatus(rows, "draft");
  ok(p4.apply.join() === "D" && p4.skipped.already === 3, "unpublish only published");
  const p5 = planBulkStatus(rows, "archived");
  ok(p5.apply.length === 4 && p5.skipped["no-record"] === 1, "archive any own record");
  ok(planBulkStatus([rows[0]!, rows[0]!], "published").apply.length === 1, "dedupe keys");

  const r1 = resolveBulkKeys(["A", " B ", "A", "", 7], "X\nY", "selected");
  ok(r1.keys.join() === "A,B" && !r1.capped, "ticked keys trimmed/deduped");
  const r2 = resolveBulkKeys(["A"], "X\nY\n\nX", "matching");
  ok(r2.keys.join() === "X,Y", "matching keys from list");
  const r3 = resolveBulkKeys(["A", "B", "C"], "", "selected", 2);
  ok(r3.keys.length === 2 && r3.capped, "cap applies");
  ok(resolveBulkKeys([], 5, "matching").keys.length === 0, "non-string matching → none");

  const m1 = bulkOutcomeMessage("published", 2, { "no-photo": 1 });
  ok(m1.startsWith("Published 2 products.") && m1.includes("1 have no photo") && m1.includes("live on the menu"), "publish message");
  ok(bulkOutcomeMessage("draft", 1, {}) === "Moved back to draft 1 product.", "draft message singular");
  ok(bulkOutcomeMessage("published", 3, {}, { writebackDone: 1, writebackLeft: 2 }).includes("2 ran out of time"), "writeback leftover message");
  ok(bulkOutcomeMessage("archived", 0, {}, { capped: true, cap: 10 }).includes("first 10"), "capped message");
  // D244 round 2: publish on photo
  ok(photoPublishDecision({ enrichmentStatus: "draft", hasImage: true }) === "publish" && photoPublishDecision({ enrichmentStatus: null, hasImage: true }) === "publish", "draft + photo -> publish");
  ok(photoPublishDecision({ enrichmentStatus: "archived", hasImage: true }) === "archived" && photoPublishDecision({ enrichmentStatus: "published", hasImage: true }) === "already-live", "archived kept, live left alone");
  ok(photoPublishDecision({ enrichmentStatus: "draft", hasImage: false }) === "no-photo" && photoPublishDecision({ enrichmentStatus: "draft", hasImage: true }, " OFF ") === "off", "no photo; env switch off");
  ok(photoPublishDecision({ enrichmentStatus: "draft", hasImage: true, hasPublicImage: false }) === "photo-not-public", "a not-yet-public photo does not count");

  return { passed, failed };
}
