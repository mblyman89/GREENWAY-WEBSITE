// Leafly Menu Integration API v2.0 — THE READBACK CONTRACT (GET /{key}/menu).
//
// ###########################################################################
// # READ THIS BEFORE YOU TOUCH ANYTHING IN HERE.                            #
// #                                                                         #
// # This file describes what Leafly SENDS BACK. It is NOT the contract for  #
// # what we send. Those two are DIFFERENT SHAPES, and confusing them is a   #
// # mistake this repository has already made once, at a cost of eight       #
// # field-level defects.                                                    #
// #                                                                         #
// # Concretely: the readback calls the brand `brandName` and the strain     #
// # `strainName`. Those are findings L-06 and L-07 — the two field names    #
// # that would have made Leafly reject every single item with HTTP 400.     #
// # They are CORRECT here, on the way in. They are FATAL on the way out.    #
// #                                                                         #
// # So: do not "unify" this module with contract-core.ts. Do not read a     #
// # GET /menu response and "fix" payload-core.ts to match it. The direction #
// # of a field name is part of the field name.                              #
// #                                                                         #
// # `tests/compliance/leafly-readback.test.ts` asserts the two contracts    #
// # DISAGREE on exactly the fields they are supposed to disagree on. If you #
// # merge them, that test fails on purpose.                                 #
// ###########################################################################
//
// WHY THIS FILE EXISTS
// --------------------
// Slice L-4's job is menu sandbox certification. The roadmap asks for a getLeaflyMenu()
// wrapper (finding L-14) so the menu can be validated programmatically, as Leafly's own
// email suggests. But a wrapper that just hands back raw JSON is nearly worthless: the
// interesting question is not "what is on Leafly's side", it is "does what is on Leafly's
// side MATCH WHAT WE SENT". Slice L-2 established that a payload can be accepted and still
// be wrong; an HTTP 200 is not evidence of a correct menu. So this module does the
// comparison, and names the difference.
//
// GROUND TRUTH
// ------------
// docs/leafly-specs/schemas/v2-show.json  — the readback shape (vendored in slice L-4;
//   it was referenced by the OpenAPI document but never downloaded, see SOURCES.md)
// docs/leafly-specs/menu-integration-v2.openapi.json — the operation, its sandbox-only
//   restriction, and its response codes
//
// Leafly's own warning about this endpoint, quoted verbatim from the OpenAPI description:
//
//   "This method is only permitted in the sandbox environment; an HTTP 405 Method Not
//    Allowed response will be returned in other environments. The schema is subject to
//    change and this endpoint is provided only to aid in development. Solutions should
//    not rely on the availability of nor presented schema of this endpoint."
//
// That warning is why every function here FAILS SOFT on shape. If Leafly changes the
// readback schema, reconciliation must degrade into "I could not check this", never into a
// crash and never into a false "everything matches". A reconciler that reports success
// because it failed to parse is worse than no reconciler.
//
// This module is PURE — no network, no DB, no "server-only" — so the self-tests run in
// process and the mutation harness can reach it.

import {
  LEAFLY_FORBIDDEN_FIELD_ALIASES,
  LEAFLY_INVENTORY_LEVEL_CAP,
} from "./contract-core";
import type { LeaflyItem, LeaflyItemsPayload } from "./payload-core";
// FINDING L-21. The same function that WARNS about a size collision before the
// push EXPLAINS it after the read-back. One rule, two moments -- so the advice
// we give beforehand and the diagnosis we give afterwards cannot contradict
// each other.
import { explainMissingVariant } from "./variant-identity-core";

// ---------------------------------------------------------------------------
// The readback vocabulary
// ---------------------------------------------------------------------------

/**
 * Field names on a readback ITEM. Every one of these is `required` in
 * `v2-show.json` — the readback is far stricter about presence than the write schema,
 * which requires only id/type/name/variants.
 */
export const LEAFLY_READBACK_ITEM_FIELDS = {
  id: "id",
  brandName: "brandName",
  cbdContent: "cbdContent",
  cbdUnit: "cbdUnit",
  created: "created",
  description: "description",
  hidden: "hidden",
  imageUrl: "imageUrl",
  isReservable: "isReservable",
  isStaffPick: "isStaffPick",
  lastModified: "lastModified",
  name: "name",
  strainName: "strainName",
  thcContent: "thcContent",
  thcUnit: "thcUnit",
  type: "type",
  variants: "variants",
} as const;

/** Field names on a readback VARIANT. All seven are `required` in `v2-show.json`. */
export const LEAFLY_READBACK_VARIANT_FIELDS = {
  id: "id",
  inventoryLevel: "inventoryLevel",
  medical: "medical",
  packagePrice: "packagePrice",
  packageSize: "packageSize",
  packageUnit: "packageUnit",
  packageWeightGrams: "packageWeightGrams",
} as const;

/** The envelope: `{ result: [...], metadata: { totalCount } }`, both required. */
export const LEAFLY_READBACK_ENVELOPE_FIELDS = {
  result: "result",
  metadata: "metadata",
  totalCount: "totalCount",
} as const;

/**
 * Field names that mean the same THING on each side but are SPELLED DIFFERENTLY.
 *
 * This map is the whole reason the two contracts must stay apart, and it is deliberately
 * written as data so a test can assert it rather than a comment nobody reads.
 *
 * Key   = the name Leafly sends back (readback / "outbound" from Leafly).
 * Value = the name we must send (write / "inbound" to Leafly).
 */
export const LEAFLY_READBACK_TO_WRITE_NAMES: Readonly<Record<string, string>> = {
  brandName: "brand",
  strainName: "strain",
} as const;

/**
 * Readback fields that have NO counterpart in the write contract at all. Leafly owns
 * these; we cannot set them and must not attempt to reconcile them.
 *
 * `hidden` and `isStaffPick` are set by a human in Menu Manager. `created` and
 * `lastModified` are Leafly's own bookkeeping. Treating any of these as a mismatch would
 * mean reporting the owner's own Menu Manager edits as integration errors.
 */
export const LEAFLY_READBACK_ONLY_FIELDS = [
  "created",
  "hidden",
  "isStaffPick",
  "lastModified",
] as const;

// ---------------------------------------------------------------------------
// Correspondences we REFUSE to assert (rule 3: never silently invent a value)
// ---------------------------------------------------------------------------

/**
 * Two readback fields LOOK like they map onto write fields, and I am not willing to say
 * that they do, because "looks obvious" is exactly how L-06 and L-07 got written.
 *
 * Each entry records the suspicion, the evidence FOR it, and the specific missing fact
 * that stops it being a conclusion. `reconcileLeaflyMenu()` reports these as
 * `unverifiable`, never as `match` and never as `mismatch`. They are also the two open
 * questions for Leafly in the slice L-4 owner report.
 */
export const LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES = [
  {
    readbackField: "isReservable",
    suspectedWriteField: "availableForPickup",
    evidenceFor:
      "It is the only boolean in the readback that plausibly reflects pickup availability, " +
      "and availableForPickup is the only pickup flag in the write schema.",
    missingFact:
      'The string "reservable" appears NOWHERE else in any vendored Leafly spec — not in ' +
      "the Menu OpenAPI document, not in v2-items.json, not in the Order API spec. In " +
      "v2-show.json it carries no description field at all. Leafly has never written down " +
      "that these two are the same flag.",
    askLeafly:
      "Does isReservable in GET /menu reflect the availableForPickup we sent, or is it a " +
      "separate Leafly-side setting?",
  },
  {
    readbackField: "packagePrice",
    suspectedWriteField: "price",
    evidenceFor:
      "Both are integers and both are the only price on their side of the wire.",
    missingFact:
      'v2-show.json declares packagePrice as bare {"type":"integer"} with no description ' +
      "and no currency unit. The v2 WRITE price is documented as MINOR units (cents); the " +
      "v1 write price was documented as the MAJOR unit. The unit therefore genuinely " +
      "changed once already, and comparing 1200 with 12 as though the unit were known " +
      "would silently report every price as wrong (or every price as right).",
    askLeafly:
      "Is packagePrice in GET /menu in cents (matching the v2 write contract) or dollars?",
  },
] as const;

export type LeaflyUnverifiedCorrespondence =
  (typeof LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES)[number];

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

export type LeaflyReadbackVariant = {
  id: string;
  inventoryLevel: number | null;
  medical: boolean | null;
  packagePrice: number | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageWeightGrams: number | null;
};

export type LeaflyReadbackItem = {
  id: string;
  name: string | null;
  type: string | null;
  brandName: string | null;
  strainName: string | null;
  description: string | null;
  imageUrl: string | null;
  hidden: boolean | null;
  isReservable: boolean | null;
  isStaffPick: boolean | null;
  thcContent: number | null;
  thcUnit: string | null;
  cbdContent: number | null;
  cbdUnit: string | null;
  created: string | null;
  lastModified: string | null;
  variants: LeaflyReadbackVariant[];
};

/**
 * A parse never throws and never returns a half-truth. Either `ok` with items, or `ok:
 * false` with a reason a human can act on. `totalCount` is Leafly's own count and is kept
 * separate from `items.length` precisely so a disagreement between them is visible —
 * that disagreement is how you detect a truncated or paged response.
 */
export type LeaflyReadbackParse =
  | {
      ok: true;
      items: LeaflyReadbackItem[];
      /** From `metadata.totalCount`, or null when absent/unusable. */
      totalCount: number | null;
      /** Non-fatal shape complaints. An empty array does NOT mean the schema matched. */
      warnings: string[];
    }
  | { ok: false; reason: string; warnings: string[] };

// ---------------------------------------------------------------------------
// Small, total coercions
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string, or null. Empty/whitespace-only becomes null so "" and absent compare alike. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A finite number, or null. NaN and Infinity are not data. */
function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Variant ids are `["number","string"]` on the WRITE side and `"string"` on the readback
 * side. So `7` and `"7"` are the same variant, and comparing them raw would report a
 * mismatch on every numerically-named variant. Normalising both sides through here is the
 * fix, and it is why this is a named function instead of an inline String().
 */
export function normalizeReadbackId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// ---------------------------------------------------------------------------
// parseLeaflyMenuReadback
// ---------------------------------------------------------------------------

/**
 * Parse a `GET /{menu_integration_key}/menu` body.
 *
 * Fails SOFT by design — see the header note on Leafly's "schema is subject to change"
 * warning. Anything unrecognised becomes a warning or a null, never an exception and
 * never a silent success.
 */
export function parseLeaflyMenuReadback(body: unknown): LeaflyReadbackParse {
  const warnings: string[] = [];

  if (typeof body === "string") {
    // authedFetch hands back the raw text when the body is not JSON. Reporting that
    // precisely saves a debugging session: a 403 HTML error page and an empty menu are
    // very different problems that both look like "no items".
    return {
      ok: false,
      reason:
        "Leafly returned a non-JSON body. This is usually an HTML error page from an " +
        "auth or routing failure rather than a menu.",
      warnings,
    };
  }
  if (!isRecord(body)) {
    return { ok: false, reason: "Leafly's response was not a JSON object.", warnings };
  }

  const rawResult = body[LEAFLY_READBACK_ENVELOPE_FIELDS.result];
  if (!Array.isArray(rawResult)) {
    return {
      ok: false,
      reason:
        `Leafly's response has no "${LEAFLY_READBACK_ENVELOPE_FIELDS.result}" array. ` +
        "v2-show.json marks it required, so the readback schema has changed or this is " +
        "not a menu response.",
      warnings,
    };
  }

  const metadata = body[LEAFLY_READBACK_ENVELOPE_FIELDS.metadata];
  let totalCount: number | null = null;
  if (isRecord(metadata)) {
    totalCount = num(metadata[LEAFLY_READBACK_ENVELOPE_FIELDS.totalCount]);
    if (totalCount === null) {
      warnings.push(
        `metadata.${LEAFLY_READBACK_ENVELOPE_FIELDS.totalCount} was missing or not a number.`,
      );
    }
  } else {
    warnings.push(
      `Response had no "${LEAFLY_READBACK_ENVELOPE_FIELDS.metadata}" object, which v2-show.json marks required.`,
    );
  }

  const items: LeaflyReadbackItem[] = [];
  let skipped = 0;

  for (const raw of rawResult) {
    if (!isRecord(raw)) {
      skipped += 1;
      continue;
    }
    const id = normalizeReadbackId(raw[LEAFLY_READBACK_ITEM_FIELDS.id]);
    if (id === null) {
      // An item with no id cannot be reconciled against anything. Counting it is the
      // honest outcome; inventing a key for it is not.
      skipped += 1;
      continue;
    }

    const rawVariants = raw[LEAFLY_READBACK_ITEM_FIELDS.variants];
    const variants: LeaflyReadbackVariant[] = [];
    if (Array.isArray(rawVariants)) {
      for (const rv of rawVariants) {
        if (!isRecord(rv)) continue;
        const vid = normalizeReadbackId(rv[LEAFLY_READBACK_VARIANT_FIELDS.id]);
        if (vid === null) continue;
        variants.push({
          id: vid,
          inventoryLevel: num(rv[LEAFLY_READBACK_VARIANT_FIELDS.inventoryLevel]),
          medical: bool(rv[LEAFLY_READBACK_VARIANT_FIELDS.medical]),
          packagePrice: num(rv[LEAFLY_READBACK_VARIANT_FIELDS.packagePrice]),
          packageSize: num(rv[LEAFLY_READBACK_VARIANT_FIELDS.packageSize]),
          packageUnit: str(rv[LEAFLY_READBACK_VARIANT_FIELDS.packageUnit]),
          packageWeightGrams: num(rv[LEAFLY_READBACK_VARIANT_FIELDS.packageWeightGrams]),
        });
      }
    } else {
      warnings.push(`Item ${id} had no variants array.`);
    }

    items.push({
      id,
      name: str(raw[LEAFLY_READBACK_ITEM_FIELDS.name]),
      type: str(raw[LEAFLY_READBACK_ITEM_FIELDS.type]),
      brandName: str(raw[LEAFLY_READBACK_ITEM_FIELDS.brandName]),
      strainName: str(raw[LEAFLY_READBACK_ITEM_FIELDS.strainName]),
      description: str(raw[LEAFLY_READBACK_ITEM_FIELDS.description]),
      imageUrl: str(raw[LEAFLY_READBACK_ITEM_FIELDS.imageUrl]),
      hidden: bool(raw[LEAFLY_READBACK_ITEM_FIELDS.hidden]),
      isReservable: bool(raw[LEAFLY_READBACK_ITEM_FIELDS.isReservable]),
      isStaffPick: bool(raw[LEAFLY_READBACK_ITEM_FIELDS.isStaffPick]),
      thcContent: num(raw[LEAFLY_READBACK_ITEM_FIELDS.thcContent]),
      thcUnit: str(raw[LEAFLY_READBACK_ITEM_FIELDS.thcUnit]),
      cbdContent: num(raw[LEAFLY_READBACK_ITEM_FIELDS.cbdContent]),
      cbdUnit: str(raw[LEAFLY_READBACK_ITEM_FIELDS.cbdUnit]),
      created: str(raw[LEAFLY_READBACK_ITEM_FIELDS.created]),
      lastModified: str(raw[LEAFLY_READBACK_ITEM_FIELDS.lastModified]),
      variants,
    });
  }

  if (skipped > 0) {
    warnings.push(
      `${skipped} entr${skipped === 1 ? "y was" : "ies were"} unreadable (not an object, or no id) and could not be reconciled.`,
    );
  }
  if (totalCount !== null && totalCount !== rawResult.length) {
    warnings.push(
      `Leafly reported totalCount=${totalCount} but sent ${rawResult.length} item(s). ` +
        "The response may be truncated or paged; reconcile results below are only about what arrived.",
    );
  }

  return { ok: true, items, totalCount, warnings };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type LeaflyReconcileSeverity = "error" | "warning" | "info";

export type LeaflyReconcileIssue = {
  severity: LeaflyReconcileSeverity;
  /** Stable machine code, safe to branch on. */
  code: string;
  /** Item id, or null for whole-menu issues. */
  itemId: string | null;
  /** One sentence a non-engineer can act on. */
  message: string;
};

/**
 * WHAT THE COMPARISON IS ENTITLED TO CONCLUDE.
 *
 * FIELD-REPORTED, and the reason this type exists. After the owner's first
 * targeted push -- 8 products, chosen deliberately -- the readback reported
 * nineteen "problems", led by sentences like:
 *
 *   We sent "1937 - 3.5g Flower - Blackberry - 3.5g" but Leafly's menu does
 *   not contain it.
 *
 * We did not send it. The reconciler was handed the WHOLE 2,562-item feed as
 * the baseline and diffed it against the 8 items Leafly actually holds, so
 * 2,554 untouched products were each reported as a failure. The reconciler was
 * not wrong about the data; it was answering a question nobody asked.
 *
 *   "full"     -- the baseline is the entire menu we intend Leafly to have.
 *                 Absence IS a defect, and an item at Leafly that we did not
 *                 send is genuinely unexpected (a POST full sync would have
 *                 removed it). This is the correct reading after a full sync.
 *
 *   "targeted" -- the baseline is ONLY the items we deliberately sent. Every
 *                 other item at Leafly is UNTOUCHED, which is the entire
 *                 promise of a targeted push -- not an anomaly to report.
 *
 * The distinction is not cosmetic and it is not a display filter. In targeted
 * scope the reconciler is never given ids it did not send, so "missing" for an
 * unsent item is impossible BY CONSTRUCTION rather than suppressed after the
 * fact. A warning you have to filter out later is a warning that will come
 * back the next time somebody forgets the filter.
 */
export type LeaflyReconcileScope = "full" | "targeted";

export type LeaflyReconcileResult = {
  /** True only when there are zero `error`-severity issues. */
  ok: boolean;
  /**
   * What this comparison was entitled to conclude. Carried in the result so the
   * UI never has to guess, and so a stored result stays interpretable later.
   */
  scope: LeaflyReconcileScope;
  sentItemCount: number;
  readbackItemCount: number;
  /** Items present on both sides, compared field by field. */
  comparedItemCount: number;
  /** Sent but absent from the readback. */
  missingFromLeafly: string[];
  /**
   * Present at Leafly but not in our payload (manual Menu Manager items live here).
   * Always empty in `targeted` scope: items outside the selection are untouched
   * by definition, so calling them "extra" would be false.
   */
  extraAtLeafly: string[];
  /**
   * In `targeted` scope, how many items Leafly holds that were outside this
   * push. Reported as a plain fact, never as a problem. Null in `full` scope,
   * where the same items are genuinely unexpected and appear in `extraAtLeafly`.
   */
  untouchedAtLeafly: number | null;
  issues: LeaflyReconcileIssue[];
  /** Correspondences we declined to check, carried through so the UI can say why. */
  unverifiable: readonly LeaflyUnverifiedCorrespondence[];
};

/** Cap on how many same-code issues are reported, so a 400-item menu stays readable. */
export const LEAFLY_RECONCILE_ISSUES_PER_CODE = 5;

function firstCompoundContent(
  item: LeaflyItem,
  which: "thc" | "cbd",
): { content: number | null; unit: string | null } | null {
  // Prefer the dedicated totals object; fall back to the compounds array. Both are
  // optional in the write contract, so "we never sent it" is a real, expected answer and
  // is represented by null rather than by 0.
  const total = which === "thc" ? item.total_thc : item.total_cbd;
  if (total) return { content: total.content, unit: total.unit };
  const found = item.compounds?.find((c) => c.type === which);
  if (found) return { content: found.content, unit: found.unit };
  return null;
}

/**
 * Compare the payload we sent against the menu Leafly says it has.
 *
 * What this is FOR: an HTTP 200 from POST /menu/items means "your JSON parsed". It does
 * not mean your menu is right. Slice L-2 found eight field defects that would each have
 * produced a 400, but a subtler defect — a field we think we are sending and are not —
 * produces a cheerful 200 and a wrong storefront. This function is the only thing in the
 * codebase that can detect that class of bug.
 *
 * Deliberate non-goals:
 *   - It does not compare price (unit unknown — see LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES).
 *   - It does not compare pickup availability (isReservable correspondence unproven).
 *   - It does not treat Leafly-owned fields (hidden, isStaffPick, timestamps) as errors.
 * Each non-goal is reported as `unverifiable` so the gap is visible rather than forgotten.
 */
export function reconcileLeaflyMenu(
  sentPayload: LeaflyItemsPayload | null | undefined,
  readback: LeaflyReadbackParse,
  scope: LeaflyReconcileScope = "full",
): LeaflyReconcileResult {
  const issues: LeaflyReconcileIssue[] = [];
  const perCode = new Map<string, number>();

  const add = (
    severity: LeaflyReconcileSeverity,
    code: string,
    itemId: string | null,
    message: string,
  ) => {
    const seen = perCode.get(code) ?? 0;
    perCode.set(code, seen + 1);
    if (seen < LEAFLY_RECONCILE_ISSUES_PER_CODE) {
      issues.push({ severity, code, itemId, message });
    } else if (seen === LEAFLY_RECONCILE_ISSUES_PER_CODE) {
      issues.push({
        severity,
        code: `${code}_truncated`,
        itemId: null,
        message: `More items share this problem; only the first ${LEAFLY_RECONCILE_ISSUES_PER_CODE} are listed.`,
      });
    }
  };

  const sentItems = sentPayload?.items ?? [];

  if (!readback.ok) {
    return {
      ok: false,
      scope,
      sentItemCount: sentItems.length,
      readbackItemCount: 0,
      comparedItemCount: 0,
      missingFromLeafly: [],
      extraAtLeafly: [],
      untouchedAtLeafly: null,
      issues: [
        {
          severity: "error",
          code: "readback_unreadable",
          itemId: null,
          message: readback.reason,
        },
        ...readback.warnings.map(
          (w): LeaflyReconcileIssue => ({
            severity: "warning",
            code: "readback_warning",
            itemId: null,
            message: w,
          }),
        ),
      ],
      unverifiable: LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES,
    };
  }

  for (const w of readback.warnings) {
    add("warning", "readback_warning", null, w);
  }

  const sentById = new Map<string, LeaflyItem>();
  for (const item of sentItems) {
    const id = normalizeReadbackId(item.id);
    if (id !== null) sentById.set(id, item);
  }
  const backById = new Map<string, LeaflyReadbackItem>();
  for (const item of readback.items) backById.set(item.id, item);

  const missingFromLeafly: string[] = [];
  const extraAtLeafly: string[] = [];
  let compared = 0;

  for (const [id, sent] of sentById) {
    const back = backById.get(id);
    if (!back) {
      missingFromLeafly.push(id);
      add(
        "error",
        "missing_from_leafly",
        id,
        `We sent "${sent.name}" but Leafly's menu does not contain it.`,
      );
      continue;
    }
    compared += 1;

    // --- name -------------------------------------------------------------
    if (str(sent.name) !== back.name) {
      add(
        "error",
        "name_mismatch",
        id,
        `Name differs: we sent "${sent.name}" and Leafly has "${back.name ?? "(none)"}".`,
      );
    }

    // --- brand: `brand` out, `brandName` back (L-06's field) --------------
    const sentBrand = str(sent.brand ?? null);
    if (sentBrand !== back.brandName) {
      add(
        "warning",
        "brand_mismatch",
        id,
        `Brand differs: we sent ${sentBrand === null ? "nothing" : `"${sentBrand}"`} ` +
          `and Leafly has ${back.brandName === null ? "nothing" : `"${back.brandName}"`}. ` +
          "Leafly may have matched the brand to its own catalogue.",
      );
    }

    // --- strain: `strain` out, `strainName` back (L-07's field) -----------
    const sentStrain = str(sent.strain ?? null);
    if (sentStrain !== back.strainName) {
      add(
        "warning",
        "strain_mismatch",
        id,
        `Strain differs: we sent ${sentStrain === null ? "nothing" : `"${sentStrain}"`} ` +
          `and Leafly has ${back.strainName === null ? "nothing" : `"${back.strainName}"`}. ` +
          "Leafly links known strains to its own pages, so a rewrite here can be normal.",
      );
    }

    // --- imageUrl: the L-10 field. Omitting it DELETES the image. ---------
    const sentImage = str(sent.imageUrl ?? null);
    if (sentImage !== null && back.imageUrl === null) {
      add(
        "error",
        "image_dropped",
        id,
        `We sent a photo for "${sent.name}" but Leafly has none. The photo did not take.`,
      );
    } else if (sentImage === null && back.imageUrl !== null) {
      add(
        "warning",
        "image_unexpected",
        id,
        `Leafly shows a photo for "${sent.name}" that we did not send. Per Leafly's ` +
          "schema, omitting imageUrl removes any existing image, so this one should " +
          "have been deleted — worth a second look.",
      );
    }

    // --- cannabinoids: nested objects out, flat pairs back ----------------
    for (const which of ["thc", "cbd"] as const) {
      const sentC = firstCompoundContent(sent, which);
      const backContent = which === "thc" ? back.thcContent : back.cbdContent;
      const backUnit = which === "thc" ? back.thcUnit : back.cbdUnit;
      if (sentC === null) {
        if (backContent !== null) {
          add(
            "warning",
            `${which}_unexpected`,
            id,
            `Leafly has a ${which.toUpperCase()} value of ${backContent} for "${sent.name}" that we did not send.`,
          );
        }
        continue;
      }
      if (sentC.content !== backContent) {
        add(
          "error",
          `${which}_mismatch`,
          id,
          `${which.toUpperCase()} differs on "${sent.name}": we sent ` +
            `${sentC.content === null ? "null (not tested)" : sentC.content} and Leafly has ` +
            `${backContent === null ? "null" : backContent}.`,
        );
      }
      if (sentC.unit !== null && backUnit !== null && sentC.unit !== backUnit) {
        add(
          "error",
          `${which}_unit_mismatch`,
          id,
          `${which.toUpperCase()} unit differs on "${sent.name}": we sent "${sentC.unit}" and Leafly has "${backUnit}".`,
        );
      }
    }

    // --- variants ---------------------------------------------------------
    const backVariants = new Map(back.variants.map((v) => [v.id, v]));
    for (const sv of sent.variants) {
      const svid = normalizeReadbackId(sv.id);
      if (svid === null) continue;
      const bv = backVariants.get(svid);
      if (!bv) {
        // FINDING L-21. A missing variant has two very different causes, and
        // telling the owner which one they are looking at is the difference
        // between an actionable message and an alarming one.
        //
        // If the size collided with a sibling on amount+unit, nothing failed in
        // transit -- Leafly received it and discarded it as a duplicate
        // descriptor. That is a data-shape problem in our own menu, fixable by
        // relabelling, and we can prove it from the payload we sent.
        //
        // `explainMissingVariant` returns null when we CANNOT prove that, and
        // then the plain message stands. It would have been easy to write an
        // explainer that always produces a confident-sounding cause; that is
        // just a guess with good grammar, and a wrong explanation is worse than
        // none because it sends the reader off to fix the wrong thing.
        const why = explainMissingVariant({
          missingVariantId: svid,
          sentVariants: sent.variants.map((v) => ({
            id: String(v.id),
            amount: v.amount,
            unit: v.unit,
          })),
        });
        add(
          "error",
          "variant_missing",
          id,
          `Size/variant "${svid}" of "${sent.name}" is missing from Leafly's menu.` +
            (why === null ? "" : ` ${why}`),
        );
        continue;
      }
      // inventoryLevel is capped at 10 by Leafly (contract-core), so a sent 40 coming
      // back as 10 is CORRECT behaviour and must not be reported as a defect.
      const expectedInventory = Math.min(sv.inventoryLevel, LEAFLY_INVENTORY_LEVEL_CAP);
      if (bv.inventoryLevel !== null && bv.inventoryLevel !== expectedInventory) {
        add(
          "warning",
          "inventory_mismatch",
          id,
          `Stock differs on "${sent.name}" size ${svid}: we sent ${sv.inventoryLevel} ` +
            `(Leafly caps at ${LEAFLY_INVENTORY_LEVEL_CAP}, so ${expectedInventory} was expected) ` +
            `and Leafly has ${bv.inventoryLevel}.`,
        );
      }
      if (bv.medical !== null && bv.medical !== sv.medical) {
        add(
          "error",
          "medical_mismatch",
          id,
          `Medical flag differs on "${sent.name}" size ${svid}: we sent ${sv.medical} and Leafly has ${bv.medical}. ` +
            "This flag decides medical-only visibility, so a disagreement is a compliance matter.",
        );
      }
      if (bv.packageUnit !== null && bv.packageUnit !== sv.unit) {
        add(
          "warning",
          "unit_mismatch",
          id,
          `Unit differs on "${sent.name}" size ${svid}: we sent "${sv.unit}" and Leafly has "${bv.packageUnit}".`,
        );
      }
      if (bv.packageSize !== null && bv.packageSize !== sv.amount) {
        add(
          "warning",
          "amount_mismatch",
          id,
          `Amount differs on "${sent.name}" size ${svid}: we sent ${sv.amount} and Leafly has ${bv.packageSize}.`,
        );
      }
    }
  }

  // Items at Leafly that were not in our payload.
  //
  // In FULL scope these are genuinely unexpected: a POST full sync deletes
  // omitted items, so anything surviving was almost certainly added by hand in
  // Menu Manager, and the owner should know.
  //
  // In TARGETED scope the identical set means the exact opposite -- it is the
  // rest of the menu, deliberately left alone, which is the whole point of a
  // targeted push. Counting it is useful; flagging it would be false.
  let untouchedAtLeafly: number | null = null;
  if (scope === "targeted") {
    let untouched = 0;
    for (const id of backById.keys()) if (!sentById.has(id)) untouched += 1;
    untouchedAtLeafly = untouched;
  } else {
    for (const id of backById.keys()) {
      if (!sentById.has(id)) {
        extraAtLeafly.push(id);
        add(
          "info",
          "extra_at_leafly",
          id,
          `Leafly has item "${id}" that we did not send. A POST full sync deletes omitted ` +
            "items, so this is usually an item added by hand in Menu Manager.",
        );
      }
    }
  }

  return {
    ok: issues.every((i) => i.severity !== "error"),
    scope,
    sentItemCount: sentItems.length,
    readbackItemCount: readback.items.length,
    comparedItemCount: compared,
    missingFromLeafly,
    extraAtLeafly,
    untouchedAtLeafly,
    issues,
    unverifiable: LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES,
  };
}

// ---------------------------------------------------------------------------
// Propagation window (finding L-19)
// ---------------------------------------------------------------------------
//
// THE BUG THIS PREVENTS
// ---------------------
// `reconcileLeaflyMenu` compares what we sent against what Leafly returns, and treats a
// difference as a problem. That is only sound once Leafly has finished ingesting the push.
// Leafly's own spec says it has not:
//
//   "Be aware that the effects of menu updates submitted through the API are not
//    instantaneously visible, either on the consumer-facing site or through subsequent
//    `GET` requests (when applicable). Background processing must occur that takes an
//    indeterminate amount of time varying with system load. In the sandbox environment
//    this is likely not more than about two and half minutes, while in the production
//    environment this is likely not more than about five minutes."
//
//   -- docs/leafly-specs/menu-integration-v2.openapi.json, .info.description, "### Latency"
//
// So a read-back run 20 seconds after a push can legitimately return the OLD menu, and the
// reconcile would report a wall of differences that are not defects. The damage is not just
// a confusing screen: the natural reaction is to "fix" the phantom differences and push
// again, which manufactures exactly the erratic, human-paced request pattern that Leafly's
// criterion 3 disqualifies. A correctness check that provokes the behaviour being graded
// against you is worse than no check.
//
// This does NOT suppress the comparison -- suppressing it would hide real defects. It
// labels the result as provisional and says when to look again.

/**
 * Sandbox background-processing window, in seconds. 2.5 minutes, quoted above.
 *
 * Leafly's words are "likely not more than about" -- an estimate, not a guarantee, and the
 * spec explicitly says it "can be faster or slower depending on external factors". So this
 * is used only to decide whether to WARN that a comparison may be premature. Nothing is
 * gated on it and no result is discarded because of it.
 */
export const LEAFLY_SANDBOX_PROPAGATION_SECONDS = 150;

/** Production window, in seconds. 5 minutes, quoted above. */
export const LEAFLY_PRODUCTION_PROPAGATION_SECONDS = 300;

/** The documented window for an environment. Not interpolated, not averaged. */
export function leaflyPropagationSeconds(environment: "sandbox" | "production"): number {
  return environment === "sandbox"
    ? LEAFLY_SANDBOX_PROPAGATION_SECONDS
    : LEAFLY_PRODUCTION_PROPAGATION_SECONDS;
}

export type ReadbackTimingVerdict = {
  /** True when the last push is still inside Leafly's documented ingest window. */
  tooSoon: boolean;
  /** Seconds since the last successful push; null when it is unknown. */
  secondsSincePush: number | null;
  /** Whole seconds still to wait. 0 when not waiting. */
  secondsToWait: number;
  /** A sentence for the UI. Never empty. */
  message: string;
};

/**
 * Decide whether a read-back is being compared too soon after a push.
 *
 * Fails SAFE in the ambiguous direction: when the last-push time is unknown or unparseable
 * the verdict is `tooSoon: false` with a message saying the timing could not be checked.
 * Claiming "too soon" without evidence would let a real defect be dismissed as latency,
 * which is the more expensive mistake of the two.
 *
 * A clock skew that puts the push in the future is reported rather than silently clamped.
 */
export function assessReadbackTiming(
  lastPushAt: string | null,
  now: Date,
  environment: "sandbox" | "production",
): ReadbackTimingVerdict {
  const windowSeconds = leaflyPropagationSeconds(environment);

  if (!lastPushAt) {
    return {
      tooSoon: false,
      secondsSincePush: null,
      secondsToWait: 0,
      message:
        "No successful push is on record, so there is nothing to compare against yet. " +
        "Anything Leafly returns here was not put there by this app.",
    };
  }

  const pushedMs = Date.parse(lastPushAt);
  if (Number.isNaN(pushedMs)) {
    return {
      tooSoon: false,
      secondsSincePush: null,
      secondsToWait: 0,
      message:
        "The time of the last push could not be read, so this comparison has not been " +
        "checked for Leafly's processing delay. Treat any differences as unconfirmed " +
        "until you re-run it a few minutes after a push.",
    };
  }

  const elapsed = Math.floor((now.getTime() - pushedMs) / 1000);

  if (elapsed < 0) {
    return {
      tooSoon: false,
      secondsSincePush: elapsed,
      secondsToWait: 0,
      message:
        "The last push is recorded in the future, which means a clock is wrong " +
        "somewhere. The timing of this comparison could not be checked.",
    };
  }

  if (elapsed < windowSeconds) {
    const wait = windowSeconds - elapsed;
    return {
      tooSoon: true,
      secondsSincePush: elapsed,
      secondsToWait: wait,
      message:
        `The last push was ${elapsed}s ago and Leafly says it can take up to ` +
        `${windowSeconds}s (${environment}) to finish processing one. Differences below ` +
        `may just be the old menu, not mistakes. Re-run this in about ${wait}s before ` +
        "changing anything.",
    };
  }

  return {
    tooSoon: false,
    secondsSincePush: elapsed,
    secondsToWait: 0,
    message:
      `The last push was ${elapsed}s ago, past Leafly's ${windowSeconds}s processing ` +
      "window, so this comparison should reflect the menu we sent.",
  };
}

/** One-line human summary, for logs and for the admin UI header. */
export function describeReconcileResult(result: LeaflyReconcileResult): string {
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.filter((i) => i.severity === "warning").length;
  if (result.readbackItemCount === 0 && result.sentItemCount > 0) {
    return `Leafly returned no items, but we sent ${result.sentItemCount}.`;
  }
  const head = `${result.comparedItemCount} of ${result.sentItemCount} item(s) matched up`;
  const tail =
    errors === 0 && warnings === 0
      ? "with no differences."
      : `with ${errors} problem(s) and ${warnings} thing(s) to look at.`;

  // In targeted scope, say what was NOT examined. The owner's first readback
  // said "8 of 2562 item(s) matched up with 10 problem(s)", which reads as a
  // catastrophe when it was in fact a complete success: all 8 landed. Naming
  // the untouched remainder turns an alarming ratio into an accurate sentence.
  if (result.scope === "targeted") {
    const rest =
      result.untouchedAtLeafly && result.untouchedAtLeafly > 0
        ? ` The other ${result.untouchedAtLeafly} item(s) on your Leafly menu were not part of this push and were left alone.`
        : "";
    return `Checked the ${result.sentItemCount} item(s) you sent: ${result.comparedItemCount} matched up ${tail}${rest}`;
  }

  return `${head} ${tail}`;
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyReadbackTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[readback-core] FAIL: ${label}`);
    }
  };

  // --- the anti-merge invariant ------------------------------------------
  // These two are widened to `string` on purpose. With the literal const types, `tsc`
  // rejects the comparison outright ("types '\"brandName\"' and '\"brand\"' have no
  // overlap") -- which is the compiler independently proving the very thing being
  // asserted, and is a nicer outcome than the test. The runtime check is kept anyway,
  // because the compile-time proof disappears the moment someone edits the constant, and
  // this assertion is the one that would then fail loudly.
  const readbackBrandField: string = LEAFLY_READBACK_ITEM_FIELDS.brandName;
  const readbackStrainField: string = LEAFLY_READBACK_ITEM_FIELDS.strainName;
  check("readback brand name differs from write brand name", readbackBrandField !== "brand");
  check("readback strain name differs from write strain name", readbackStrainField !== "strain");
  check(
    "brandName maps to brand",
    LEAFLY_READBACK_TO_WRITE_NAMES.brandName === "brand",
  );
  check(
    "strainName maps to strain",
    LEAFLY_READBACK_TO_WRITE_NAMES.strainName === "strain",
  );
  // The readback names are, by construction, the forbidden WRITE aliases. This is the
  // single most important fact in this file, so it is asserted, not just commented.
  check(
    "every readback-only spelling is a FORBIDDEN write alias",
    Object.keys(LEAFLY_READBACK_TO_WRITE_NAMES).every(
      (k) => LEAFLY_FORBIDDEN_FIELD_ALIASES[k] === LEAFLY_READBACK_TO_WRITE_NAMES[k],
    ),
  );

  // --- unverified correspondences ----------------------------------------
  check(
    "two correspondences are recorded as unverified",
    LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES.length === 2,
  );
  check(
    "isReservable is not asserted to equal availableForPickup",
    LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES.some(
      (c) => c.readbackField === "isReservable" && c.suspectedWriteField === "availableForPickup",
    ),
  );
  check(
    "every unverified correspondence states the missing fact and a question for Leafly",
    LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES.every(
      (c) => c.missingFact.length > 40 && c.askLeafly.trim().endsWith("?"),
    ),
  );

  // --- id normalisation --------------------------------------------------
  check("numeric id normalises to string", normalizeReadbackId(7) === "7");
  check("string id is trimmed", normalizeReadbackId("  7 ") === "7");
  check("empty id is null", normalizeReadbackId("   ") === null);
  check("null id is null", normalizeReadbackId(null) === null);
  check("NaN id is null", normalizeReadbackId(Number.NaN) === null);
  check("boolean id is null", normalizeReadbackId(true) === null);

  // --- parse: failure modes ----------------------------------------------
  const htmlParse = parseLeaflyMenuReadback("<html>403 Forbidden</html>");
  check("non-JSON body fails", htmlParse.ok === false);
  check(
    "non-JSON failure says so in plain words",
    htmlParse.ok === false && htmlParse.reason.includes("non-JSON"),
  );
  check("null body fails", parseLeaflyMenuReadback(null).ok === false);
  check("array body fails", parseLeaflyMenuReadback([]).ok === false);
  const noResult = parseLeaflyMenuReadback({ metadata: { totalCount: 0 } });
  check("missing result array fails", noResult.ok === false);

  // --- parse: happy path -------------------------------------------------
  const good = parseLeaflyMenuReadback({
    result: [
      {
        id: "SKU-1",
        name: "Blue Dream",
        type: "Flower",
        brandName: "Greenway",
        strainName: "Blue Dream",
        description: "A description",
        imageUrl: "https://example.com/a.jpg",
        hidden: false,
        isReservable: true,
        isStaffPick: false,
        thcContent: 22.5,
        thcUnit: "percent",
        cbdContent: null,
        cbdUnit: null,
        created: "2026-01-01T00:00:00Z",
        lastModified: "2026-01-02T00:00:00Z",
        variants: [
          {
            id: 11,
            inventoryLevel: 10,
            medical: false,
            packagePrice: 1200,
            packageSize: 3.5,
            packageUnit: "g",
            packageWeightGrams: 3.5,
          },
        ],
      },
    ],
    metadata: { totalCount: 1 },
  });
  check("well-formed readback parses", good.ok === true);
  check("one item parsed", good.ok === true && good.items.length === 1);
  check("totalCount captured", good.ok === true && good.totalCount === 1);
  check("no warnings on a clean body", good.ok === true && good.warnings.length === 0);
  check(
    "numeric variant id was normalised",
    good.ok === true && good.items[0].variants[0].id === "11",
  );
  check(
    "null cbdContent stays null rather than becoming 0",
    good.ok === true && good.items[0].cbdContent === null,
  );

  // --- parse: soft-failure warnings --------------------------------------
  const noMeta = parseLeaflyMenuReadback({ result: [] });
  check("missing metadata is a warning, not a failure", noMeta.ok === true);
  check(
    "missing metadata is reported",
    noMeta.ok === true && noMeta.warnings.some((w) => w.includes("metadata")),
  );
  const badItems = parseLeaflyMenuReadback({
    result: [{ id: "A", variants: [] }, "nonsense", { name: "no id" }],
    metadata: { totalCount: 3 },
  });
  check("unreadable entries are skipped, not fatal", badItems.ok === true);
  check("only the readable entry survives", badItems.ok === true && badItems.items.length === 1);
  check(
    "skipped entries are counted in a warning",
    badItems.ok === true && badItems.warnings.some((w) => w.includes("unreadable")),
  );
  const truncated = parseLeaflyMenuReadback({
    result: [{ id: "A", variants: [] }],
    metadata: { totalCount: 500 },
  });
  check(
    "a totalCount that disagrees with the array length is flagged",
    truncated.ok === true && truncated.warnings.some((w) => w.includes("truncated")),
  );

  // --- reconcile fixtures ------------------------------------------------
  const sent: LeaflyItemsPayload = {
    items: [
      {
        id: "SKU-1",
        type: "Flower",
        name: "Blue Dream",
        brand: "Greenway",
        strain: "Blue Dream",
        imageUrl: "https://example.com/a.jpg",
        total_thc: { content: 22.5, unit: "percent" },
        availableForPickup: true,
        variants: [
          { id: "11", medical: false, price: 1200, amount: 3.5, unit: "g", inventoryLevel: 10 },
        ],
      },
    ],
  };

  const clean = reconcileLeaflyMenu(sent, good);
  check("a faithful readback reconciles clean", clean.ok === true);
  check("clean reconcile has no errors", clean.issues.every((i) => i.severity !== "error"));
  check("clean reconcile compared the item", clean.comparedItemCount === 1);
  check("clean reconcile found nothing missing", clean.missingFromLeafly.length === 0);
  check(
    "clean reconcile still surfaces the unverifiable correspondences",
    clean.unverifiable.length === 2,
  );
  check(
    "a price difference is NOT reported, because the unit is unknown",
    !clean.issues.some((i) => i.code.includes("price")),
  );
  check(
    "pickup availability is NOT reported, because isReservable is unproven",
    !clean.issues.some((i) => i.code.includes("pickup") || i.code.includes("reservable")),
  );

  // Missing item
  const emptyBack = parseLeaflyMenuReadback({ result: [], metadata: { totalCount: 0 } });
  const missing = reconcileLeaflyMenu(sent, emptyBack);
  check("an item Leafly never stored is an error", missing.ok === false);
  check("the missing item is named", missing.missingFromLeafly.includes("SKU-1"));
  check(
    "the missing-item message names the product",
    missing.issues.some((i) => i.code === "missing_from_leafly" && i.message.includes("Blue Dream")),
  );

  // --- FINDING L-21: explaining a missing variant ------------------------
  //
  // Two sizes of one item that both describe themselves as `1 each`. Leafly
  // keeps one. The read-back must still report the other as missing -- it IS
  // missing -- but it must also say why, because "missing" alone sends the
  // owner looking for a transmission failure that never happened.
  {
    const collidingSent: LeaflyItemsPayload = {
      items: [
        {
          id: "TOPICAL-1",
          type: "Topical",
          name: "Ceres Dragon Balm CBD RED",
          variants: [
            { id: "tv-kept", medical: false, price: 1000, amount: 1, unit: "each", inventoryLevel: 5 },
            { id: "tv-lost", medical: false, price: 2000, amount: 1, unit: "each", inventoryLevel: 5 },
          ],
        },
      ],
    };
    // Leafly returns only the first of the two.
    const collidingBack = parseLeaflyMenuReadback({
      result: [
        {
          id: "TOPICAL-1",
          name: "Ceres Dragon Balm CBD RED",
          variants: [
            {
              id: "tv-kept",
              inventoryLevel: 5,
              medical: false,
              packagePrice: 1000,
              packageSize: 1,
              packageUnit: "each",
            },
          ],
        },
      ],
      metadata: { totalCount: 1 },
    });
    const rec = reconcileLeaflyMenu(collidingSent, collidingBack, "targeted");
    const vm = rec.issues.find((i) => i.code === "variant_missing");
    check("a collided variant is still reported missing", vm !== undefined);
    check(
      "the missing-variant message explains the collision",
      (vm?.message ?? "").includes("Leafly identifies a size only by its amount and unit"),
    );
    check(
      "the explanation names the surviving sibling",
      (vm?.message ?? "").includes("tv-kept"),
    );
    check(
      "the explanation rules out a transmission failure",
      (vm?.message ?? "").includes("not a transmission failure"),
    );
  }
  {
    // NEGATIVE CONTROL. A genuinely absent variant, with NO collision in the
    // payload, must get the plain message and no invented cause.
    const distinctSent: LeaflyItemsPayload = {
      items: [
        {
          id: "FLOWER-1",
          type: "Flower",
          name: "Khush Kush",
          variants: [
            { id: "fv-1", medical: false, price: 1200, amount: 3.5, unit: "g", inventoryLevel: 5 },
            { id: "fv-2", medical: false, price: 2200, amount: 7, unit: "g", inventoryLevel: 5 },
          ],
        },
      ],
    };
    const partialBack = parseLeaflyMenuReadback({
      result: [
        {
          id: "FLOWER-1",
          name: "Khush Kush",
          variants: [
            {
              id: "fv-1",
              inventoryLevel: 5,
              medical: false,
              packagePrice: 1200,
              packageSize: 3.5,
              packageUnit: "g",
            },
          ],
        },
      ],
      metadata: { totalCount: 1 },
    });
    const rec = reconcileLeaflyMenu(distinctSent, partialBack, "targeted");
    const vm = rec.issues.find((i) => i.code === "variant_missing");
    check("a genuinely absent variant is still an error", vm !== undefined);
    check(
      "no collision explanation is invented for a distinct size",
      !(vm?.message ?? "").includes("Leafly identifies a size only by its amount and unit"),
    );
  }

  // Dropped image — the L-10 regression detector
  const noImageBack = parseLeaflyMenuReadback({
    result: [{ ...(good.ok ? { ...good.items[0] } : {}), id: "SKU-1", imageUrl: null, variants: [
      { id: "11", inventoryLevel: 10, medical: false, packagePrice: 1200, packageSize: 3.5, packageUnit: "g", packageWeightGrams: 3.5 },
    ] }],
    metadata: { totalCount: 1 },
  });
  const droppedImage = reconcileLeaflyMenu(sent, noImageBack);
  check(
    "a photo we sent that Leafly does not have is an ERROR",
    droppedImage.issues.some((i) => i.code === "image_dropped" && i.severity === "error"),
  );

  // Inventory cap is respected, not reported
  const cappedSent: LeaflyItemsPayload = {
    items: [
      {
        ...sent.items[0],
        variants: [{ id: "11", medical: false, price: 1200, amount: 3.5, unit: "g", inventoryLevel: 40 }],
      },
    ],
  };
  const cappedBack = parseLeaflyMenuReadback({
    result: [
      {
        id: "SKU-1",
        name: "Blue Dream",
        brandName: "Greenway",
        strainName: "Blue Dream",
        imageUrl: "https://example.com/a.jpg",
        thcContent: 22.5,
        thcUnit: "percent",
        cbdContent: null,
        cbdUnit: null,
        variants: [
          { id: "11", inventoryLevel: 10, medical: false, packagePrice: 1200, packageSize: 3.5, packageUnit: "g", packageWeightGrams: 3.5 },
        ],
      },
    ],
    metadata: { totalCount: 1 },
  });
  const capped = reconcileLeaflyMenu(cappedSent, cappedBack);
  check(
    "sending 40 and reading back 10 is NOT an inventory mismatch (Leafly caps at 10)",
    !capped.issues.some((i) => i.code === "inventory_mismatch"),
  );

  // Medical disagreement is an error, and says why
  const medicalBack = parseLeaflyMenuReadback({
    result: [
      {
        id: "SKU-1",
        name: "Blue Dream",
        brandName: "Greenway",
        strainName: "Blue Dream",
        imageUrl: "https://example.com/a.jpg",
        thcContent: 22.5,
        thcUnit: "percent",
        cbdContent: null,
        cbdUnit: null,
        variants: [
          { id: "11", inventoryLevel: 10, medical: true, packagePrice: 1200, packageSize: 3.5, packageUnit: "g", packageWeightGrams: 3.5 },
        ],
      },
    ],
    metadata: { totalCount: 1 },
  });
  const medical = reconcileLeaflyMenu(sent, medicalBack);
  check(
    "a medical-flag disagreement is an error",
    medical.issues.some((i) => i.code === "medical_mismatch" && i.severity === "error"),
  );
  check(
    "the medical message explains it is a compliance matter",
    medical.issues.some((i) => i.code === "medical_mismatch" && i.message.includes("compliance")),
  );

  // Extra item at Leafly is info, not an error
  const extraBack = parseLeaflyMenuReadback({
    result: [
      ...(good.ok ? [{ id: "SKU-1", name: "Blue Dream", brandName: "Greenway", strainName: "Blue Dream", imageUrl: "https://example.com/a.jpg", thcContent: 22.5, thcUnit: "percent", cbdContent: null, cbdUnit: null, variants: [{ id: "11", inventoryLevel: 10, medical: false, packagePrice: 1200, packageSize: 3.5, packageUnit: "g", packageWeightGrams: 3.5 }] }] : []),
      { id: "MANUAL-1", name: "Added by hand", variants: [] },
    ],
    metadata: { totalCount: 2 },
  });
  const extra = reconcileLeaflyMenu(sent, extraBack);
  check("an item only Leafly has does not fail the reconcile", extra.ok === true);
  check("the extra item is listed", extra.extraAtLeafly.includes("MANUAL-1"));
  check(
    "the extra item is reported as info",
    extra.issues.some((i) => i.code === "extra_at_leafly" && i.severity === "info"),
  );

  // An unreadable readback must never reconcile clean
  const broken = reconcileLeaflyMenu(sent, parseLeaflyMenuReadback("<html/>"));
  check("an unreadable readback never reports ok", broken.ok === false);
  check(
    "an unreadable readback says it could not be read",
    broken.issues.some((i) => i.code === "readback_unreadable"),
  );
  check("an unreadable readback compares nothing", broken.comparedItemCount === 0);
  // The severity is a user-visible contract, not decoration: the admin report builds its
  // error list from `severity === "error"`, so an "info"-severity unreadable body would
  // render a report with nothing wrong on a readback that could not be read. Added after
  // a mutation that downgraded this severity survived the suite.
  check(
    "the unreadable issue is severity ERROR (or the admin report renders empty)",
    broken.issues.some((i) => i.code === "readback_unreadable" && i.severity === "error"),
  );
  check(
    "an unreadable readback always yields at least one error-severity issue",
    broken.issues.filter((i) => i.severity === "error").length > 0,
  );

  // Issue cap
  const manySent: LeaflyItemsPayload = {
    items: Array.from({ length: 40 }, (_, i) => ({
      id: `SKU-${i}`,
      type: "Flower" as const,
      name: `Item ${i}`,
      variants: [
        { id: `v${i}`, medical: false, price: 1200, amount: 3.5, unit: "g" as const, inventoryLevel: 5 },
      ],
    })),
  };
  const manyMissing = reconcileLeaflyMenu(manySent, emptyBack);
  const missingIssues = manyMissing.issues.filter((i) => i.code === "missing_from_leafly");
  check(
    "repeated issues are capped so the report stays readable",
    missingIssues.length === LEAFLY_RECONCILE_ISSUES_PER_CODE,
  );
  check(
    "the cap announces itself rather than hiding items",
    manyMissing.issues.some((i) => i.code === "missing_from_leafly_truncated"),
  );
  check(
    "but the full count is still available",
    manyMissing.missingFromLeafly.length === 40,
  );

  // Null payload
  const noSend = reconcileLeaflyMenu(null, good);
  check("reconciling with no payload does not throw", noSend.sentItemCount === 0);
  check("with no payload, everything at Leafly is extra", noSend.extraAtLeafly.length === 1);

  // Summary sentence
  check(
    "summary counts matched items",
    describeReconcileResult(clean).includes("1 of 1"),
  );
  check(
    "summary of an empty readback says Leafly returned nothing",
    describeReconcileResult(missing).includes("no items"),
  );
  check(
    "clean summary says there were no differences",
    describeReconcileResult(clean).includes("no differences"),
  );

  // Leafly-owned fields are never reconciled
  check(
    "Leafly-owned fields are declared and excluded",
    LEAFLY_READBACK_ONLY_FIELDS.includes("hidden") &&
      LEAFLY_READBACK_ONLY_FIELDS.includes("isStaffPick"),
  );
  check(
    "no issue code mentions a Leafly-owned field",
    !clean.issues.some((i) =>
      LEAFLY_READBACK_ONLY_FIELDS.some((f) => i.code.includes(f)),
    ),
  );

  // --- propagation window (finding L-19) ---------------------------------
  // The two constants are quoted from Leafly's spec; assert them by value so a future
  // edit that "rounds" them has to change a test and explain itself.
  check("sandbox propagation window is 2.5 minutes", LEAFLY_SANDBOX_PROPAGATION_SECONDS === 150);
  check("production propagation window is 5 minutes", LEAFLY_PRODUCTION_PROPAGATION_SECONDS === 300);
  check(
    "production window is longer than sandbox, as the spec says",
    LEAFLY_PRODUCTION_PROPAGATION_SECONDS > LEAFLY_SANDBOX_PROPAGATION_SECONDS,
  );
  check(
    "the window is selected per environment, not shared",
    leaflyPropagationSeconds("sandbox") === 150 && leaflyPropagationSeconds("production") === 300,
  );

  const t0 = new Date("2026-01-15T12:00:00.000Z");
  const at = (secondsAgo: number) => new Date(t0.getTime() - secondsAgo * 1000).toISOString();

  const soon = assessReadbackTiming(at(20), t0, "sandbox");
  check("20s after a push is too soon in sandbox", soon.tooSoon);
  check("too-soon reports how long is left", soon.secondsToWait === 130);
  check("too-soon reports elapsed seconds", soon.secondsSincePush === 20);
  check(
    "too-soon warns the differences may be the old menu",
    soon.message.includes("old menu"),
  );

  const later = assessReadbackTiming(at(600), t0, "sandbox");
  check("10 minutes after a push is not too soon", !later.tooSoon);
  check("settled verdict waits for nothing", later.secondsToWait === 0);

  // Boundary: exactly at the window is PAST it, not inside it. Asserted so an
  // off-by-one cannot drift unnoticed in either direction.
  check("exactly at the window is not too soon", !assessReadbackTiming(at(150), t0, "sandbox").tooSoon);
  check("one second inside the window is too soon", assessReadbackTiming(at(149), t0, "sandbox").tooSoon);

  // The SAME elapsed time is a different verdict per environment -- proof the
  // environment argument is actually used rather than decorative.
  check(
    "200s is settled in sandbox but still too soon in production",
    !assessReadbackTiming(at(200), t0, "sandbox").tooSoon &&
      assessReadbackTiming(at(200), t0, "production").tooSoon,
  );

  // Fails safe: unknown timing must never be reported as too soon, or a real defect
  // could be waved away as latency.
  const never = assessReadbackTiming(null, t0, "sandbox");
  check("no push on record is not 'too soon'", !never.tooSoon);
  check("no push on record has null elapsed", never.secondsSincePush === null);
  check(
    "no push on record says nothing was put there by us",
    never.message.includes("not put there by this app"),
  );

  const garbage = assessReadbackTiming("not a date", t0, "sandbox");
  check("an unparseable timestamp is not 'too soon'", !garbage.tooSoon);
  check("an unparseable timestamp admits it was not checked", garbage.message.includes("not been"));

  const future = assessReadbackTiming(new Date(t0.getTime() + 60_000).toISOString(), t0, "sandbox");
  check("a push in the future is not 'too soon'", !future.tooSoon);
  check("a push in the future is reported as a clock problem", future.message.includes("clock"));

  // Every branch must produce a usable sentence -- an empty message would render as a
  // blank warning box in the admin UI.
  check(
    "every timing verdict carries a non-empty message",
    [soon, later, never, garbage, future].every((v) => v.message.trim().length > 20),
  );

  // -------------------------------------------------------------------------
  // SCOPE. Field-reported: the owner's first targeted push of 8 products was a
  // complete success and the readback called it nineteen problems, because the
  // baseline handed to the reconciler was the whole 2,562-item feed.
  // -------------------------------------------------------------------------

  // Reproduce the shape of the real failure: we "sent" two items but Leafly was
  // only ever given one of them, because the other was never part of the push.
  const twoSent: LeaflyItemsPayload = {
    items: [
      sent.items[0],
      { ...sent.items[0], id: "SKU-NOT-PUSHED", name: "Blackberry 3.5g" } as LeaflyItem,
    ],
  };
  const oneBack = parseLeaflyMenuReadback({
    result: [
      {
        id: "SKU-1",
        name: "Blue Dream",
        brandName: "Greenway",
        strainName: "Blue Dream",
        imageUrl: "https://example.com/a.jpg",
        thcContent: 22.5,
        thcUnit: "percent",
        cbdContent: null,
        cbdUnit: null,
        variants: [
          {
            id: "11",
            inventoryLevel: 10,
            medical: false,
            packagePrice: 1200,
            packageSize: 3.5,
            packageUnit: "g",
            packageWeightGrams: 3.5,
          },
        ],
      },
      { id: "LEAFLY-OTHER-1", name: "Something we left alone", variants: [] },
      { id: "LEAFLY-OTHER-2", name: "Also left alone", variants: [] },
    ],
    metadata: { totalCount: 3 },
  });

  // FULL scope keeps today's behaviour exactly.
  const fullScope = reconcileLeaflyMenu(twoSent, oneBack, "full");
  check("full scope defaults are unchanged", reconcileLeaflyMenu(twoSent, oneBack).scope === "full");
  check("full scope reports the unsent item as missing", fullScope.missingFromLeafly.includes("SKU-NOT-PUSHED"));
  check("full scope still lists items only Leafly has", fullScope.extraAtLeafly.length === 2);
  check("full scope reports no untouched count", fullScope.untouchedAtLeafly === null);

  // TARGETED scope: the caller passes ONLY what it sent, so nothing it did not
  // send can be called missing -- and the rest of the menu is not "extra".
  const oneSent: LeaflyItemsPayload = { items: [sent.items[0]] };
  const targeted = reconcileLeaflyMenu(oneSent, oneBack, "targeted");
  check("targeted scope records its scope", targeted.scope === "targeted");
  check("targeted scope compares only what was sent", targeted.comparedItemCount === 1);
  check("targeted scope finds nothing missing", targeted.missingFromLeafly.length === 0);
  check("targeted scope reports no extras at all", targeted.extraAtLeafly.length === 0);
  check("targeted scope counts the untouched remainder", targeted.untouchedAtLeafly === 2);
  check("targeted scope passes", targeted.ok === true);
  check(
    "targeted scope raises no extra_at_leafly issue",
    !targeted.issues.some((i) => i.code === "extra_at_leafly"),
  );

  // NEGATIVE CONTROL. Targeted scope must not become a blanket amnesty: if an
  // item we DID send is genuinely absent, that is still an error. A scope that
  // silences every complaint would be worse than the bug it replaced.
  const targetedMissing = reconcileLeaflyMenu(twoSent, oneBack, "targeted");
  check(
    "targeted scope still fails when a SENT item is absent",
    targetedMissing.missingFromLeafly.includes("SKU-NOT-PUSHED"),
  );
  check("targeted scope with a genuine miss is not ok", targetedMissing.ok === false);

  // The sentence the owner reads must not imply the untouched menu is a problem.
  const targetedText = describeReconcileResult(targeted);
  check("targeted summary names what was sent", targetedText.includes("1 item(s) you sent"));
  check("targeted summary explains the remainder", targetedText.includes("left alone"));
  check("targeted summary does not claim a 1-of-2562 style ratio", !targetedText.startsWith("1 of 3"));

  return { passed, failed };
}
