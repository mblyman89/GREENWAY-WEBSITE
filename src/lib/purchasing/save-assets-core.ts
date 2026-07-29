/**
 * src/lib/purchasing/save-assets-core.ts
 *
 * SLICE 90 — make the SILENT description save visible. Every vendor-menu
 * "save image" flow that binds to the Knowledge Base (Cultivera detail
 * strains, Cultivera single-item KB save, LeafLink + GrowFlow per-item image
 * saves) has ALWAYS written the vendor's description into kb_products too
 * (gap-fill, compliance-gated) — but the buttons said "Save image" and the
 * success messages never mentioned it. The owner asked for the buttons to say
 * "save all assets"-style and for the messages to report the description
 * outcome honestly.
 *
 * This module is the ONE place that:
 *   • decides the per-save description outcome (pure, from writeback facts),
 *   • renders the plain-English sentence for each outcome,
 *   • renders the multi-strain descriptions summary,
 *   • pins the new button labels.
 *
 * 100% pure (no I/O, no Date.now, no DOM). Self-tested in the pure runner
 * and mirrored in vitest.
 */

/**
 * What happened to the DESCRIPTION during one KB write:
 *   • "saved"                — written into an empty KB slot (new value landed).
 *   • "kept_existing"        — the KB row already had prose; gap-fill kept it.
 *   • "none_provided"        — the menu item had no description to offer.
 *   • "blocked_noncompliant" — the compliance gate stripped the prose.
 *   • "kb_unavailable"       — the KB write itself didn't happen/failed.
 */
export type DescriptionSaveOutcome =
  | "saved"
  | "kept_existing"
  | "none_provided"
  | "blocked_noncompliant"
  | "kb_unavailable";

/**
 * Decide the description outcome for ONE writeback. Order matters:
 * nothing offered beats everything; a compliance block beats write status
 * (the row may still upsert with the prose stripped); an unwritten row can't
 * have saved anything; then existing-vs-empty decides kept/saved.
 */
export function decideDescriptionOutcome(input: {
  /** A non-empty description was passed into the writeback. */
  provided: boolean;
  /** The compliance gate stripped the prose before the write. */
  blocked: boolean;
  /** The pre-existing KB row already had a non-empty description. */
  existingHadDescription: boolean;
  /** The kb_products upsert succeeded. */
  wroteProduct: boolean;
}): DescriptionSaveOutcome {
  if (!input.provided) return "none_provided";
  if (input.blocked) return "blocked_noncompliant";
  if (!input.wroteProduct) return "kb_unavailable";
  if (input.existingHadDescription) return "kept_existing";
  return "saved";
}

/**
 * The plain-English sentence for a SINGLE item's description outcome, appended
 * to the save-success message. `null` outcome = no KB write was attempted at
 * all (COA saves, already-linked early returns) → empty string, say nothing.
 * `wasFallback` = the description sent was the category/product-line stand-in.
 */
export function descriptionOutcomeSentence(
  outcome: DescriptionSaveOutcome | null,
  wasFallback: boolean,
): string {
  switch (outcome) {
    case "saved":
      return wasFallback
        ? " No product-specific description, so the category description was saved to the Knowledge Base as a flagged stand-in."
        : " The vendor's description was saved to the Knowledge Base with it.";
    case "kept_existing":
      return " The Knowledge Base already has a description for this product — your existing text was kept (never overwritten).";
    case "none_provided":
      return " This menu item has no description, so there was nothing to add to the Knowledge Base.";
    case "blocked_noncompliant":
      return " The vendor's description did not pass the compliance check, so it was not saved.";
    case "kb_unavailable":
      return " The description could not be written to the Knowledge Base this time — the image is still safe in the library.";
    default:
      return "";
  }
}

/**
 * The descriptions summary for the multi-strain "Save all assets" run on a
 * Cultivera detail page. Counts come from the per-strain writeback outcomes:
 * `saved` new prose landed, `kept` rows already curated, `fallbacks` strains
 * whose offered prose was the product-line stand-in (SLICE 85 counter).
 */
export function strainDescriptionsSentence(counts: {
  saved: number;
  kept: number;
  fallbacks: number;
}): string {
  const parts: string[] = [];
  if (counts.saved > 0) {
    parts.push(`${counts.saved} saved to the Knowledge Base`);
  }
  if (counts.kept > 0) {
    parts.push(`${counts.kept} kept (already curated — never overwritten)`);
  }
  const lead =
    parts.length > 0
      ? ` Descriptions: ${parts.join(", ")}.`
      : " Descriptions: none were available to save.";
  const standIn =
    counts.fallbacks > 0
      ? ` ${counts.fallbacks} used the product-line description as a flagged stand-in.`
      : "";
  return `${lead}${standIn}`;
}

/** Detail-page bulk button: images + descriptions + KB links, per strain. */
export function saveAllAssetsLabel(strainCount?: number | null): string {
  return typeof strainCount === "number" && strainCount > 0
    ? `Save all assets to KB (${strainCount} strain${strainCount === 1 ? "" : "s"})`
    : "Save all assets to KB";
}

/**
 * Per-item image button on LeafLink/GrowFlow menus — those saves also write
 * the description + KB link, so "Save image" undersold what happens.
 */
export const SAVE_ASSETS_ITEM_LABEL = "Save assets";

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`save-assets-core self-test failed: ${msg}`);
}

export function __runSaveAssetsCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // Outcome decisions — order of precedence.
  const base = { provided: true, blocked: false, existingHadDescription: false, wroteProduct: true };
  ok(decideDescriptionOutcome(base) === "saved", "provided + empty slot + wrote -> saved");
  ok(
    decideDescriptionOutcome({ ...base, existingHadDescription: true }) === "kept_existing",
    "existing prose wins -> kept_existing",
  );
  ok(
    decideDescriptionOutcome({ ...base, provided: false }) === "none_provided",
    "nothing offered -> none_provided",
  );
  ok(
    decideDescriptionOutcome({ ...base, provided: false, wroteProduct: false }) === "none_provided",
    "nothing offered beats failed write",
  );
  ok(
    decideDescriptionOutcome({ ...base, blocked: true }) === "blocked_noncompliant",
    "compliance block beats write success",
  );
  ok(
    decideDescriptionOutcome({ ...base, wroteProduct: false }) === "kb_unavailable",
    "failed write -> kb_unavailable",
  );
  ok(
    decideDescriptionOutcome({ ...base, blocked: true, wroteProduct: false }) === "blocked_noncompliant",
    "block outranks kb_unavailable",
  );

  // Sentences — every outcome has honest copy; null says nothing.
  ok(
    descriptionOutcomeSentence("saved", false).includes("saved to the Knowledge Base"),
    "saved sentence",
  );
  ok(
    descriptionOutcomeSentence("saved", true).includes("stand-in"),
    "saved-with-fallback sentence flags the stand-in",
  );
  ok(
    descriptionOutcomeSentence("kept_existing", false).includes("never overwritten"),
    "kept sentence reassures gap-fill",
  );
  ok(
    descriptionOutcomeSentence("none_provided", false).includes("no description"),
    "none sentence",
  );
  ok(
    descriptionOutcomeSentence("blocked_noncompliant", false).includes("compliance"),
    "blocked sentence names compliance",
  );
  ok(
    descriptionOutcomeSentence("kb_unavailable", false).includes("could not be written"),
    "unavailable sentence",
  );
  ok(descriptionOutcomeSentence(null, false) === "", "null outcome -> empty string");
  ok(
    descriptionOutcomeSentence("saved", false).startsWith(" "),
    "sentences lead with a space for message concatenation",
  );

  // Multi-strain summary.
  ok(
    strainDescriptionsSentence({ saved: 3, kept: 2, fallbacks: 1 }) ===
      " Descriptions: 3 saved to the Knowledge Base, 2 kept (already curated — never overwritten)." +
        " 1 used the product-line description as a flagged stand-in.",
    "full summary reads naturally",
  );
  ok(
    strainDescriptionsSentence({ saved: 0, kept: 0, fallbacks: 0 }) ===
      " Descriptions: none were available to save.",
    "empty summary is honest",
  );
  ok(
    strainDescriptionsSentence({ saved: 1, kept: 0, fallbacks: 0 }) ===
      " Descriptions: 1 saved to the Knowledge Base.",
    "saved-only summary",
  );
  ok(
    strainDescriptionsSentence({ saved: 0, kept: 4, fallbacks: 0 }).includes("4 kept"),
    "kept-only summary",
  );

  // Button labels pinned.
  ok(saveAllAssetsLabel(5) === "Save all assets to KB (5 strains)", "bulk label with count");
  ok(saveAllAssetsLabel(1) === "Save all assets to KB (1 strain)", "bulk label singular");
  ok(saveAllAssetsLabel(0) === "Save all assets to KB", "bulk label zero-count fallback");
  ok(saveAllAssetsLabel(null) === "Save all assets to KB", "bulk label null fallback");
  ok(SAVE_ASSETS_ITEM_LABEL === "Save assets", "per-item label pinned");

  console.log(`save-assets-core: ${n} self-tests passed`);
}
