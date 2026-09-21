"use server";

/**
 * src/app/admin/integrations/leafly/selection-actions.ts  (SLICE L-18)
 *
 * Server actions for the Leafly item picker: browse the published feed, preview
 * a targeted payload, and send only the chosen items.
 *
 * WHY THESE RUN SERVER-SIDE, like every other Leafly call in this codebase.
 * Leafly's menu certification checklist disqualifies retailers whose "request
 * signatures indicate ... the use of manual tools (e.g., postman or curl)".
 * Every Leafly request this business makes must therefore originate from the
 * deployed application and never from anybody's laptop. Driving the picker from
 * a button in the back office is what keeps the resulting request log
 * certifiable.
 *
 * All three actions require `settings.manage`. Browsing and previewing touch no
 * network and change nothing, but they still read live product data, and the
 * back office does not have a "slightly privileged" tier.
 */

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { recordSyndicationLog } from "@/lib/syndication/store";
import { requireLeaflyReady } from "@/lib/leafly/readiness-gate";
import {
  browseLeaflySelection,
  previewLeaflySelection,
  pushLeaflySelection,
  SelectionRefusedError,
  type SelectionPreviewResult,
  type SelectionPushResult,
} from "@/lib/leafly/selection-server";
import {
  buildRepresentativeSample,
  computeFacets,
  selectItems,
  type SelectionFacets,
  type SelectionSort,
  type SelectionSpec,
} from "@/lib/leafly/selection-core";
// The read-back decides which payload to compare Leafly's menu against by
// recognising targeted pushes in the syndication log BY THEIR MESSAGE PREFIX.
// That makes this string a contract between two modules, not cosmetic text.
// It is imported rather than retyped so that renaming it cannot quietly break
// the read-back: a hand-typed copy here would still compile, still log, and
// would silently send every future read-back back to comparing against the
// whole 2,562-item feed -- which is the exact bug that produced the owner's
// "19 PROBLEMS!" screen.
import { TARGETED_PUSH_LOG_PREFIX } from "@/lib/leafly/readback-baseline-core";
// FINDING L-21. The picker's "Sizes" column used to report how many sizes the
// product has in OUR system, which is not the same as how many Leafly will end
// up holding. These two imports let the column report the number that actually
// matters, using the same mapper the push itself uses rather than a copy of it.
import { variantsFor } from "@/lib/leafly/payload-core";
import { variantSizeKey } from "@/lib/leafly/variant-identity-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";
// ROADMAP R6/R7 (owner asks 1-5, 7). The triage decides what may be sent and
// names what may not; the rotating sampler suggests a DIFFERENT, contract-
// aware sample each time; the identity loader supplies vendor and barcode so
// no message has to lead with a product id.
import {
  triageLeaflySelection,
  type SelectionTriageResult,
} from "@/lib/leafly/selection-server";
import {
  buildRotatingSample,
  describeSample,
  type SampleCandidate,
} from "@/lib/leafly/sample-rotation-core";
import { humanLabel, fixHrefFor } from "@/lib/leafly/sendability-core";
import { loadProductIdentities } from "@/lib/leafly/identity-server";
import type { ProductIdentity } from "@/lib/leafly/product-identity-core";

const BASE = "/admin/integrations/leafly";

/**
 * The slimmed-down shape the picker grid needs.
 *
 * Deliberately NOT the whole `SyndicationItem`. A 2,562-item feed carrying full
 * descriptions is a large payload to ship to a browser on every keystroke, and
 * the grid renders none of it. Sending only what is displayed keeps the picker
 * responsive on the shop's connection.
 */
export type PickerRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  strainType: string;
  thc: string | null;
  priceMinorUnits: number;
  inStock: boolean;
  variantCount: number;
  /**
   * FINDING L-21 — how many sizes Leafly will actually be able to SEE.
   *
   * `variantCount` is how many sizes the product has in our system. This is how
   * many survive the trip. They are usually the same number, and when they are
   * not, the difference is the whole story.
   *
   * Leafly describes a variant's size with exactly one pair of fields, `amount`
   * and `unit`. Two sizes that come out to the same pair are one size to Leafly,
   * and it keeps one. The owner's first push hit this: a topical with two sizes
   * both mapped to `1 each`, and the read-back afterwards correctly reported a
   * size as missing from Leafly's menu.
   *
   * Computing this on the SERVER is the point. The browser only ever receives
   * `PickerRow`, which carries no amount or unit, so a client-side check would
   * have to re-derive the mapping from data it does not have — which is to say,
   * it would have to guess. Here we run the same `variantsFor()` the push runs.
   */
  sentVariantCount: number;
  /** `variantCount - sentVariantCount`. Sizes that will be lost. Usually 0. */
  lostVariantCount: number;
  hasImage: boolean;
  hasDescription: boolean;
  dohRestricted: boolean;
};

function toRow(item: SyndicationItem): PickerRow {
  // Run the REAL mapper — not a reimplementation of it. If `variantsFor` ever
  // changes how it assigns amount+unit, this column changes with it on the same
  // commit. A second copy of the rule here would be a second thing to forget.
  const built = variantsFor(item);
  const distinctSizes = new Set(
    built.variants.map((v) => variantSizeKey({ amount: v.amount, unit: v.unit })),
  ).size;

  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    category: item.category,
    strainType: item.strainType,
    thc: item.thc,
    priceMinorUnits: item.priceMinorUnits,
    inStock: item.inStock,
    variantCount: item.variants.length,
    sentVariantCount: distinctSizes,
    // Measured against what we HAVE, not against what mapped. A variant the
    // mapper refused outright (a Flower with no readable weight) is also a size
    // the customer will not see, and the owner should not have to learn two
    // different numbers to understand one outcome.
    lostVariantCount: Math.max(0, item.variants.length - distinctSizes),
    hasImage: Boolean(item.imageUrl),
    hasDescription: (item.description ?? "").trim().length > 0,
    dohRestricted: Boolean(item.dohCategory),
  };
}

export type BrowseActionResult =
  | {
      ok: true;
      rows: PickerRow[];
      facets: SelectionFacets;
      feedCount: number;
      matchedCount: number;
      versionId: string | null;
      /** Ids of a suggested representative sample drawn from the CURRENT match. */
      suggestedSampleIds: string[];
    }
  | { ok: false; error: string };

/**
 * Browse the published feed with a filter spec.
 *
 * The suggested sample is computed from the MATCHED items rather than the whole
 * feed, so "suggest a sample" respects the filters already applied. Suggesting
 * edibles to someone who has filtered to flower would be the system overruling
 * a decision the operator just made.
 */
export async function browseLeaflyItemsAction(input: {
  spec: SelectionSpec;
  sort?: SelectionSort;
  sampleSize?: number;
}): Promise<BrowseActionResult> {
  await requirePermission("settings.manage");
  try {
    const { versionId, allItems, matched } = await browseLeaflySelection(
      input.spec ?? {},
      input.sort ?? "relevance",
    );
    const sampleSize = Math.min(Math.max(1, Math.floor(input.sampleSize ?? 8)), 50);
    return {
      ok: true,
      rows: matched.map(toRow),
      facets: computeFacets(allItems),
      feedCount: allItems.length,
      matchedCount: matched.length,
      versionId,
      suggestedSampleIds: buildRepresentativeSample(matched, sampleSize).map((i) => i.id),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not load the published menu feed.",
    };
  }
}

export type SelectionPreviewActionResult =
  | { ok: true; preview: SelectionPreviewResult }
  | { ok: false; error: string };

/**
 * Dry run: build the exact payload for the chosen ids and send nothing.
 *
 * Audited even though it touches no network. "Who inspected what was about to
 * be sent, and when" is exactly the record you want when reconstructing why a
 * push looked the way it did.
 */
export async function previewLeaflySelectionAction(input: {
  ids: string[];
  method?: "POST" | "PUT";
}): Promise<SelectionPreviewActionResult> {
  const session = await requirePermission("settings.manage");
  try {
    const preview = await previewLeaflySelection({
      ids: input.ids ?? [],
      requestedMethod: input.method ?? "PUT",
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.selection.preview",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        requestedIds: preview.plan.ids.length,
        payloadItems: preview.payload.items.length,
        method: preview.plan.method,
        methodWasCoerced: preview.plan.methodWasCoerced,
        validationOk: preview.validationOk,
        coverageGaps: preview.coverage.gaps.map((g) => g.code),
      },
    });
    return { ok: true, preview };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build the preview.",
    };
  }
}

export type SelectionPushActionResult =
  | { ok: true; result: SelectionPushResult }
  | { ok: false; error: string; refusals?: { code: string; message: string }[] };

/**
 * Send ONLY the chosen items to Leafly.
 *
 * Requires `confirm === true` from the form, exactly like the full push. The
 * guard is cheap and the thing it prevents — a stray click transmitting to a
 * live menu — is not recoverable by undo.
 *
 * Note what this deliberately does NOT do: it does not open a
 * `leafly_sync_runs` row. That table is the scheduler's lock, and its meaning
 * is "a full sync is in flight, stand aside". A targeted PUT of a handful of
 * items neither conflicts with a scheduled full sync nor should suppress one:
 * it writes no sync state, deletes nothing, and leaves the delta engine's model
 * untouched, so a cron tick landing mid-push is harmless. Taking the lock would
 * mean a five-item test could silence automatic syncing for the staleness
 * window, which is a real cost to prevent an imaginary conflict.
 *
 * It IS recorded to `syndication_logs` and the audit log, because the
 * certification record must show every request this business sent.
 */
export async function pushLeaflySelectionAction(input: {
  ids: string[];
  confirm: boolean;
  method?: "POST" | "PUT";
}): Promise<SelectionPushActionResult> {
  const session = await requirePermission("settings.manage");

  if (!input.confirm) {
    return { ok: false, error: "Confirmation required for a targeted Leafly push." };
  }
  // FINDING J-4: refresh-then-check via the shared gate, so a cold lambda
  // never reports configured credentials as missing.
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  try {
    const result = await pushLeaflySelection({
      ids: input.ids ?? [],
      confirm: true,
      requestedMethod: input.method ?? "PUT",
    });

    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message: `${TARGETED_PUSH_LOG_PREFIX} — ${result.message}`,
      createdBy: session.userId,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok ? "leafly.selection.push.success" : "leafly.selection.push.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        method: result.method,
        itemCount: result.itemCount,
        httpStatus: result.httpStatus,
        ids: result.plan.ids,
        // Recorded explicitly so the audit trail itself testifies that a
        // targeted push moved no state and removed nothing. A reviewer should
        // not have to read the source to establish that.
        syncStateWritten: result.syncStateWritten,
        deletesIssued: result.deletesIssued,
        methodWasCoerced: result.plan.methodWasCoerced,
      },
    });

    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof SelectionRefusedError) {
      return {
        ok: false,
        error: err.message,
        refusals: err.refusals.map((r) => ({ code: r.code, message: r.message })),
      };
    }
    const message = err instanceof Error ? err.message : "Targeted Leafly push failed.";
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: "error",
      itemCount: 0,
      message: `${TARGETED_PUSH_LOG_PREFIX} failed — ${message}`,
      createdBy: session.userId,
    });
    revalidatePath(BASE);
    return { ok: false, error: message };
  }
}

/**
 * Suggest a representative sample across the WHOLE feed, ignoring filters.
 *
 * Separate from the filtered suggestion in `browseLeaflyItemsAction` because
 * the two answer different questions: "give me a good first push" versus "give
 * me a good sample of what I am currently looking at".
 */
export async function suggestLeaflySampleAction(input: {
  size?: number;
}): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  await requirePermission("settings.manage");
  try {
    const { allItems } = await browseLeaflySelection({}, "name");
    const size = Math.min(Math.max(1, Math.floor(input.size ?? 8)), 50);
    // Sample from sellable stock when there is any: an out-of-stock item cannot
    // exercise inventory levels or orderability, which are two of the mappings
    // most worth proving on a first push.
    const inStock = selectItems(allItems, { stock: "in-stock" }, "name");
    const pool = inStock.length > 0 ? inStock : allItems;
    return { ok: true, ids: buildRepresentativeSample(pool, size).map((i) => i.id) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build a suggested sample.",
    };
  }
}

/* ========================================================================== */
/* Sendability triage + partial send (ROADMAP R6 -- owner asks 4, 5, 7)       */
/* ========================================================================== */

export type TriageActionResult =
  | { ok: true; result: SelectionTriageResult }
  | { ok: false; error: string };

/**
 * Answer "which of these will Leafly take, and what is wrong with the rest".
 *
 * Touches no network and changes nothing, but still requires
 * `settings.manage` for the same reason browsing does: it reads live product
 * data and the back office has no lesser tier.
 */
export async function triageLeaflySelectionAction(input: {
  ids: string[];
}): Promise<TriageActionResult> {
  await requirePermission("settings.manage");
  try {
    const result = await triageLeaflySelection({ ids: input.ids ?? [] });
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not work out which products Leafly will accept.",
    };
  }
}

/**
 * Send ONLY the products that pass Leafly's contract, and report the rest.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #                                                                        #
 * #   "i want the ability to send the products that do pass leafly's       #
 * #    contract skipping the bad ones ... listing them with the button     #
 * #    that directs me to the area to fix it."                             #
 * #                                                                        #
 * #   "it did not give me the option to send the good products and         #
 * #    withhold the bad ones."                                             #
 * ###########################################################################
 *
 * SAFETY PROPERTIES, each deliberate:
 *
 *   1. The skip list is DERIVED, never supplied by the caller. A client that
 *      could name the products to skip could also name products to skip that
 *      are perfectly fine, and quietly shrink the menu.
 *
 *   2. If nothing passes, this REFUSES rather than sending an empty payload.
 *      A PUT of zero items against a menu endpoint is not a no-op in spirit,
 *      and "we sent nothing successfully" is not a success worth reporting.
 *
 *   3. If errors could not be attributed to specific products, this REFUSES.
 *      Skipping the named ones would not make the payload valid, so the push
 *      would fail anyway -- and it would fail after telling the owner we had
 *      solved his problem.
 *
 *   4. Every withheld product is recorded in the audit log and the
 *      syndication log, by name. Nothing is dropped silently.
 */
export async function pushLeaflyPassingOnlyAction(input: {
  ids: string[];
  confirm: boolean;
}): Promise<
  | {
      ok: true;
      result: SelectionPushResult;
      skipped: Array<{ id: string; label: string; fixHref: string | null }>;
    }
  | { ok: false; error: string; triage?: SelectionTriageResult }
> {
  const session = await requirePermission("settings.manage");
  if (!input.confirm) {
    return { ok: false, error: "Confirmation required for a targeted Leafly push." };
  }
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  try {
    const triaged = await triageLeaflySelection({ ids: input.ids ?? [] });
    const { triage } = triaged;

    // Property 3.
    if (triage.unattributedErrorCount > 0) {
      return {
        ok: false,
        error:
          `Some problems could not be traced to a specific product, so sending ` +
          `only the good ones would not make this push succeed. ${triaged.summary}`,
        triage: triaged,
      };
    }
    // Property 2.
    if (triage.sendableIds.length === 0) {
      return {
        ok: false,
        error:
          `None of the ${triage.totalConsidered} selected products meet Leafly's ` +
          `contract yet, so there is nothing to send.`,
        triage: triaged,
      };
    }

    // Property 1: the ids come from the triage, not from the client.
    const result = await pushLeaflySelection({
      ids: triage.sendableIds,
      confirm: true,
      requestedMethod: "PUT",
    });

    const skipped = triage.blocked.map((b) => ({
      id: b.id,
      label: b.label,
      fixHref: b.fixHref,
    }));

    // Property 4: the withheld products are named in the durable record.
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message:
        `${TARGETED_PUSH_LOG_PREFIX} (passing only) — ${result.message} ` +
        `Withheld ${skipped.length}: ${skipped.map((s) => s.label).join("; ")}`,
      createdBy: session.userId,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok
        ? "leafly.selection.push.passing_only.success"
        : "leafly.selection.push.passing_only.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        requested: triage.totalConsidered,
        sent: result.itemCount,
        withheld: skipped.length,
        withheldIds: skipped.map((s) => s.id),
        httpStatus: result.httpStatus,
        syncStateWritten: result.syncStateWritten,
        deletesIssued: result.deletesIssued,
      },
    });

    revalidatePath(BASE);
    return { ok: true, result, skipped };
  } catch (err) {
    if (err instanceof SelectionRefusedError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Targeted Leafly push failed.",
    };
  }
}

/* ========================================================================== */
/* Intelligent, rotating sample (ROADMAP R7 -- owner asks 1, 2, 3)            */
/* ========================================================================== */

export type RotatingSampleResult =
  | {
      ok: true;
      ids: string[];
      round: number;
      exhausted: boolean;
      /** Products in the sample known to FAIL, named, each with a fix link. */
      failing: Array<{ id: string; label: string; reason: string | null; fixHref: string | null }>;
      note: string;
    }
  | { ok: false; error: string };

/**
 * Suggest a sample, a DIFFERENT one each time, that prefers products Leafly
 * will actually accept.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #                                                                        #
 * #   "will you make the suggest a sample button ... be more intelligent   #
 * #    and have it pick a different set of 8 products to send as a sample. #
 * #    if the sample set has a product in it that does not meet leafly's   #
 * #    contract, please both identify it, and give me a way to fix it, a   #
 * #    button that sends me to the page in the back office that lets me    #
 * #    fix it."                                                            #
 * ###########################################################################
 *
 * WHY THE CALLER PASSES THE ROUND
 *
 * `round` is what makes "suggest another" work while keeping the result
 * reproducible: the same round always yields the same sample. A random
 * sampler would give the owner a different set on every render and make a
 * failed push impossible to reproduce -- which is exactly why the original
 * sampler was deterministic in the first place. Rotation gives him variety
 * without giving up that property.
 *
 * WHY CONTRACT STATUS IS MEASURED, NOT ASSUMED
 *
 * Sendability comes from building and validating the real payload for the
 * candidate pool, so "passes" means the same thing here as it does at the
 * moment of the push.
 */
export async function suggestRotatingSampleAction(input: {
  size?: number;
  round?: number;
}): Promise<RotatingSampleResult> {
  await requirePermission("settings.manage");
  try {
    const size = Math.min(Math.max(1, Math.floor(input.size ?? 8)), 50);
    const round = Math.max(0, Math.floor(input.round ?? 0));

    const { allItems } = await browseLeaflySelection({}, "name");
    if (allItems.length === 0) {
      return { ok: false, error: "The published menu feed is empty." };
    }

    // Prefer sellable stock, exactly as the classic sampler did: an
    // out-of-stock product cannot exercise inventory or orderability.
    const inStock = selectItems(allItems, { stock: "in-stock" }, "name");
    const pool = inStock.length > 0 ? inStock : allItems;

    // Establish who passes. Validating 2,500 products on every click would be
    // wasteful, so a bounded working set is triaged: large enough that the
    // sampler has real choice, small enough to stay responsive.
    const WORKING_SET = Math.min(pool.length, Math.max(size * 12, 120));
    const window = pool.slice(0, WORKING_SET);
    let passing = new Set<string>();
    const failingReason = new Map<string, string>();
    let checked = false;
    try {
      const triaged = await triageLeaflySelection({ ids: window.map((i) => i.id) });
      passing = new Set(triaged.triage.sendableIds);
      for (const b of triaged.triage.blocked) {
        failingReason.set(b.id, b.reasons[0] ?? "Does not meet Leafly's contract.");
      }
      checked = triaged.triage.unattributedErrorCount === 0;
    } catch {
      // Unchecked is NOT the same as failing. If the check cannot run we fall
      // back to the coverage-only sampler rather than declaring the whole
      // menu broken and refusing to suggest anything.
      checked = false;
    }

    const candidates: SampleCandidate[] = window.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      brand: item.brand,
      strainType: item.strainType,
      inStock: item.inStock,
      variantCount: item.variants.length,
      hasImage: Boolean(item.imageUrl),
      hasDescription: (item.description ?? "").trim().length > 0,
      hasPotency: typeof item.thc === "string" && item.thc.trim().length > 0,
      // Tri-state on purpose: undefined means "not checked", which must not
      // be scored as a failure.
      passesContract: checked ? passing.has(item.id) : undefined,
      failureReason: failingReason.get(item.id) ?? null,
    }));

    const selection = buildRotatingSample(candidates, size, round);
    const pickedIds = selection.picked.map((p) => p.id);

    // Name any failures that still made the cut, with a fix link each.
    let identities: Map<string, ProductIdentity> = new Map();
    try {
      identities = await loadProductIdentities(selection.failing.map((f) => f.id));
    } catch {
      identities = new Map();
    }

    const failing = selection.failing.map((f) => {
      const identity = identities.get(f.id) ?? null;
      return {
        id: f.id,
        label: humanLabel(
          identity === null
            ? null
            : {
                id: identity.id,
                productName: identity.productName ?? identity.name,
                brand: identity.brand,
                vendor: identity.vendor,
                barcodes: identity.barcodes,
                category: identity.category,
                size: null,
              },
          f.id,
        ),
        reason: f.failureReason ?? null,
        fixHref: fixHrefFor(f.id),
      };
    });

    const note = checked
      ? describeSample(selection)
      : `${describeSample(selection)} (Leafly's contract could not be checked for this ` +
        `suggestion, so these products have not been verified as sendable.)`;

    return {
      ok: true,
      ids: pickedIds,
      round: selection.round,
      exhausted: selection.exhausted,
      failing,
      note,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build a suggested sample.",
    };
  }
}
