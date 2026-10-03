/**
 * src/lib/catalog/approved-row-core.ts  (Round 23, item 5)
 *
 * PURE. The owner (round 23): "I cant see the expanded row after approving
 * a product in onboarding."
 *
 * WHY (verified in page.tsx, not assumed): the S41 detail row (What we know
 * | AI lookup | Approve) and its <details> toggle were rendered ONLY on the
 * review tab (`v2Row && view === "draft"`). Approving moves the product to
 * the Approved tab, where the row had no toggle and no detail row at all,
 * and the approve redirect did not say where the product went.
 *
 * THE FIX:
 *   1. the Approved tab rows open the same full-width detail row: the facts
 *      (with "Facts waiting for you" + Attach), the AI lookup, and an
 *      "Approved" zone with what was decided and where to finish;
 *   2. the "Approved" banner links straight to that product, opened, on the
 *      Approved tab (a deep link that pins it; S02 rules: a validated UUID
 *      only, never a raw parameter).
 *
 * No I/O. Embedded self-tests at the bottom (run-pure-selftests.ts).
 */

import { draftsHref, isUuid } from "./draft-deep-link-core";

export const APPROVED_TOGGLE_OPEN = "Show details";
export const APPROVED_TOGGLE_CLOSE = "Collapse";
export const APPROVED_ZONE_LEAD =
  "Approved - live on the website and sellable at the register. Attach any facts waiting in the AI lookup zone; finish photos and copy on Enrichment.";
export const APPROVED_BANNER_LINK_TEXT = "Open it on the Approved tab";

export interface ApprovedRowInput {
  priceMinorUnits: number | null | undefined;
  categoryLabel: string | null | undefined;
  strainLabel: string | null | undefined;
  houseType: string | null | undefined;
}

export interface ApprovedRowCopy {
  lead: string;
  /** [label, value] lines for what the approver decided ("" values dropped). */
  lines: [string, string][];
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export function approvedRowCopy(input: ApprovedRowInput): ApprovedRowCopy {
  const lines: [string, string][] = [];
  const p = input.priceMinorUnits;
  if (typeof p === "number" && Number.isFinite(p) && p > 0) lines.push(["Price", money(p)]);
  const c = String(input.categoryLabel ?? "").trim();
  if (c) lines.push(["Category", c]);
  const h = String(input.houseType ?? "").trim();
  if (h) lines.push(["Type", h]);
  const st = String(input.strainLabel ?? "").trim();
  if (st) lines.push(["Strain type", st]);
  return { lead: APPROVED_ZONE_LEAD, lines };
}

/**
 * The banner's deep link to the product just approved: the Approved tab,
 * pinned (so the row starts open), same delivery. null when the id is not a
 * canonical UUID (a forged ?approved_draft= is ignored, never queried).
 */
export function approvedBannerLink(draftId: unknown, manifestId: string | null | undefined): string | null {
  if (!isUuid(draftId)) return null;
  return draftsHref({ status: "approved", manifestId: manifestId ?? null, draftId });
}

export function __runApprovedRowCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL approved-row-core: " + msg);
    }
  };
  const full = approvedRowCopy({ priceMinorUnits: 2500, categoryLabel: "Flower", strainLabel: "Hybrid", houseType: " Indoor " });
  ok(full.lead === APPROVED_ZONE_LEAD, "lead");
  ok(full.lines.map((l) => l.join("=")).join("|") === "Price=$25.00|Category=Flower|Type=Indoor|Strain type=Hybrid", "lines: " + JSON.stringify(full.lines));
  ok(approvedRowCopy({ priceMinorUnits: null, categoryLabel: "", strainLabel: null, houseType: undefined }).lines.length === 0, "nothing decided -> no lines");
  ok(approvedRowCopy({ priceMinorUnits: 0, categoryLabel: null, strainLabel: null, houseType: null }).lines.length === 0, "zero price dropped");
  ok(approvedRowCopy({ priceMinorUnits: Number.NaN, categoryLabel: null, strainLabel: null, houseType: null }).lines.length === 0, "NaN price dropped");
  ok(approvedRowCopy({ priceMinorUnits: 1999, categoryLabel: null, strainLabel: null, houseType: null }).lines[0][1] === "$19.99", "cents formatting");
  const D = "11111111-2222-4333-8444-555555555555";
  const M = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const link = approvedBannerLink(D, M);
  ok(link === `/admin/inventory/drafts?status=approved&manifest=${M}&draft=${D}#draft-${D}`, "deep link: " + link);
  ok(approvedBannerLink(D, null) === `/admin/inventory/drafts?status=approved&draft=${D}#draft-${D}`, "no manifest");
  ok(approvedBannerLink("not-a-uuid", M) === null && approvedBannerLink(undefined, M) === null && approvedBannerLink([D], M) === null, "bad id -> null");
  ok(APPROVED_TOGGLE_OPEN === "Show details" && APPROVED_TOGGLE_CLOSE === "Collapse", "toggle copy");
  ok(APPROVED_BANNER_LINK_TEXT === "Open it on the Approved tab", "link copy");
  return { passed, failed };
}
