/**
 * src/lib/media/media-review-core.ts   (D221 M3)
 *
 * The review queue's decisions, as a PURE function so the rules are pinned.
 *
 * A picture lands in the queue (review_state = 'needs_review') when:
 *   - 0352 step h: it was filed as a vendor / brand LOGO but its file name
 *     looks like a product photo (the "misclassified logo" rule); or
 *   - the M4 describe pass doubted it: the model saw a product where the file
 *     says logo (or the reverse), a different brand on the package, copy the
 *     compliance lint blocked, or low confidence.
 *
 * A person decides, one click each:
 *   - "accept"     it is right as filed. review_state ok, note cleared.
 *   - "product"    the misclassified-logo fix: it IS a product photo. Its
 *                  purpose becomes "product" and role "product"; a logo slot
 *                  never points at it (the queue refuses this while a vendor
 *                  or brand still uses it as the logo - change that first).
 *   - "logo"       the reverse: it IS a logo. Role "logo"; purpose
 *                  vendor-logo, unless it already is a logo purpose.
 *   - "reject"     not usable. review_state rejected; an AUTO-published picture
 *                  goes back to draft (a person-published one is left alone).
 *                  Nothing is deleted (standing rule) and the describe pass
 *                  never reopens a rejected picture.
 * "Fix" is a link to the picture's own page, not a decision.
 * Every decision stamps reviewed_by / reviewed_at (0353).
 */

export const REVIEW_DECISIONS = ["accept", "product", "logo", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type ReviewRow = {
  id: string;
  status: string | null;
  usage_type: string | null;
  role: string | null;
  review_state: string | null;
  publish_reason: string | null;
  field_provenance?: Record<string, unknown> | null;
};

export type ReviewVerdict =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

export function parseReviewDecision(raw: unknown): ReviewDecision | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return (REVIEW_DECISIONS as readonly string[]).includes(s) ? (s as ReviewDecision) : null;
}

const LOGO_PURPOSES = new Set(["vendor-logo", "brand-logo", "logo"]);

/** The row update for a decision. PURE. `usedAsLogo` = a vendor/brand logo slot points at it. */
export function reviewPatch(
  row: ReviewRow,
  decision: ReviewDecision,
  actorId: string | null,
  nowIso: string,
  usedAsLogo: boolean,
): ReviewVerdict {
  if (row.review_state !== "needs_review" && !(decision === "accept" && row.review_state === "rejected")) {
    return { ok: false, error: "This picture is not waiting for review any more." };
  }
  const stamp = { reviewed_by: actorId, reviewed_at: nowIso };
  const prov = { ...((row.field_provenance as Record<string, unknown> | null) ?? {}) };
  switch (decision) {
    case "accept":
      return { ok: true, patch: { review_state: "ok", review_note: null, ...stamp } };
    case "product": {
      if (usedAsLogo) {
        return { ok: false, error: "A vendor or brand still uses this picture as its logo. Pick a different logo there first." };
      }
      prov.usage_type = "human";
      prov.role = "human";
      return { ok: true, patch: { review_state: "ok", review_note: null, usage_type: "product", role: "product", field_provenance: prov, ...stamp } };
    }
    case "logo": {
      prov.role = "human";
      const patch: Record<string, unknown> = { review_state: "ok", review_note: null, role: "logo", ...stamp };
      if (!LOGO_PURPOSES.has(String(row.usage_type ?? ""))) {
        patch.usage_type = "vendor-logo";
        prov.usage_type = "human";
      }
      patch.field_provenance = prov;
      return { ok: true, patch };
    }
    case "reject": {
      const patch: Record<string, unknown> = { review_state: "rejected", ...stamp };
      if (row.status === "published" && row.publish_reason === "vendor-source-auto") {
        patch.status = "draft";
        patch.publish_reason = null;
      }
      return { ok: true, patch };
    }
  }
}

/** Plain label for the note chip. PURE. */
export function reviewReasonKind(note: string | null | undefined): "logo-vs-product" | "brand" | "copy" | "confidence" | "other" {
  const n = String(note ?? "").toLowerCase();
  if (/looks like a product photo|looks like a logo|filed as a logo|filed as a product/.test(n)) return "logo-vs-product";
  if (/brand/.test(n)) return "brand";
  if (/lint|blocked|compliance|wording/.test(n)) return "copy";
  if (/confiden|unsure|not sure/.test(n)) return "confidence";
  return "other";
}

// ---------------------------------------------------------------------------
export function __runMediaReviewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("media-review-core FAIL:", m);
    }
  };
  const now = "2026-11-10T12:00:00.000Z";
  const base: ReviewRow = { id: "a", status: "published", usage_type: "vendor-logo", role: "product", review_state: "needs_review", publish_reason: "vendor-source-auto", field_provenance: { platform: "derived" } };

  ok(parseReviewDecision("Accept") === "accept", "decision parse is case-insensitive");
  ok(parseReviewDecision("delete") === null, "unknown decision refused (nothing deletes)");
  ok(parseReviewDecision("") === null, "empty decision refused");

  const acc = reviewPatch(base, "accept", "u1", now, false);
  ok(acc.ok && acc.patch.review_state === "ok" && acc.patch.review_note === null, "accept clears the flag");
  ok(acc.ok && acc.patch.reviewed_by === "u1" && acc.patch.reviewed_at === now, "accept stamps reviewer");
  ok(acc.ok && !("usage_type" in acc.patch) && !("status" in acc.patch), "accept changes nothing else");

  const prod = reviewPatch(base, "product", "u1", now, false);
  ok(prod.ok && prod.patch.usage_type === "product" && prod.patch.role === "product", "product fix re-files the picture");
  ok(prod.ok && (prod.patch.field_provenance as Record<string, unknown>).role === "human", "product fix marks the role human");
  ok(prod.ok && (prod.patch.field_provenance as Record<string, unknown>).platform === "derived", "provenance of other fields kept");
  const prodUsed = reviewPatch(base, "product", "u1", now, true);
  ok(!prodUsed.ok && /logo/.test(prodUsed.error), "product fix refused while a logo slot uses it");

  const logo = reviewPatch({ ...base, usage_type: "product" }, "logo", "u1", now, false);
  ok(logo.ok && logo.patch.role === "logo" && logo.patch.usage_type === "vendor-logo", "logo fix re-files a product as a vendor logo");
  const logo2 = reviewPatch({ ...base, usage_type: "brand-logo" }, "logo", "u1", now, false);
  ok(logo2.ok && !("usage_type" in logo2.patch) && logo2.patch.role === "logo", "logo fix keeps an existing logo purpose");

  const rej = reviewPatch(base, "reject", "u1", now, false);
  ok(rej.ok && rej.patch.review_state === "rejected" && rej.patch.status === "draft", "reject un-publishes an AUTO-published picture");
  const rejHuman = reviewPatch({ ...base, publish_reason: "manual" }, "reject", "u1", now, false);
  ok(rejHuman.ok && !("status" in rejHuman.patch), "reject leaves a person-published picture published");
  ok(rej.ok && !("deleted" in rej.patch) && rej.patch.status !== "archived", "reject never deletes or archives");

  const done = reviewPatch({ ...base, review_state: "ok" }, "reject", "u1", now, false);
  ok(!done.ok, "a decided picture is not decided twice");
  const undo = reviewPatch({ ...base, review_state: "rejected" }, "accept", "u1", now, false);
  ok(undo.ok && undo.patch.review_state === "ok", "a rejected picture can be accepted back (reversible)");
  const rejAgain = reviewPatch({ ...base, review_state: "rejected" }, "reject", "u1", now, false);
  ok(!rejAgain.ok, "only accept may reopen a rejected picture");

  ok(reviewReasonKind("Filed as a logo, but the file name looks like a product photo.") === "logo-vs-product", "0352 note kind");
  ok(reviewReasonKind("The package shows the brand Other Co.") === "brand", "brand note kind");
  ok(reviewReasonKind("Low confidence (0.3).") === "confidence", "confidence note kind");
  ok(reviewReasonKind(null) === "other", "null note kind");
  return { passed, failed };
}
