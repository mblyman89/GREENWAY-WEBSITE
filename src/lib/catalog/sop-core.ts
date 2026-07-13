/**
 * src/lib/catalog/sop-core.ts
 *
 * W13 — the printable SOP pack (audit gap G11, Pillar E "caveman layer").
 *
 * One-page Standard Operating Procedures for every stage of the canonical
 * Product Intake journey (journey-core), plus one "truck day" master SOP —
 * the day-in-the-life walkthrough a brand-new hire follows from "truck
 * arrives" to "product is sellable".
 *
 * Content rules (never guess):
 *  - Every step below restates the VERIFIED in-app workflow — the same steps
 *    each stage's on-page HelpPanel teaches — so paper and screen never
 *    disagree. When the app changes, update the HelpPanel and this file
 *    together.
 *  - Drafts-first ethos is stated on paper too: nothing goes live and nothing
 *    is paid without a human clicking the button.
 *
 * PURE module: no `server-only`, no DB, no React — safe for tsx test
 * harnesses, server components, and client components alike.
 */

import {
  JOURNEY_STAGES,
  journeyStage,
  type JourneyStageKey,
} from "@/lib/catalog/journey-core";

export type SopDoc = {
  /** URL segment under /admin/sop/. Stage key or "truck-day". */
  slug: string;
  /** The journey stage this SOP covers, or null for the truck-day master SOP. */
  stageKey: JourneyStageKey | null;
  /** Sheet heading, e.g. "SOP — Receiving (inbound transfers)". */
  title: string;
  /** One sentence: why this job exists. */
  purpose: string;
  /** The admin page where the work happens (href printed on the sheet). */
  where: string;
  /** Prerequisites — what to have ready before starting. */
  before: string[];
  /** Numbered actions, in order. Kept short enough to fit one printed page. */
  steps: string[];
  /** Plain-language completion criteria: "you're done when…". */
  doneWhen: string;
  /** Troubleshooting / escalation notes. */
  ifStuck: string[];
};

export const TRUCK_DAY_SLUG = "truck-day";

/** Base path for the SOP pack routes. */
export const SOP_BASE_PATH = "/admin/sop";

/** Href for a single printable SOP sheet. */
export function sopHref(slug: string): string {
  return `${SOP_BASE_PATH}/${slug}`;
}

export const SOP_DOCS: readonly SopDoc[] = [
  // ── Master SOP first: it's the one a new hire prints on day one. ────────
  {
    slug: TRUCK_DAY_SLUG,
    stageKey: null,
    title: "SOP — Truck day (delivery to sellable)",
    purpose:
      "The full day-in-the-life walkthrough: a vendor truck arrives and you take the product all the way to sellable on the live menu.",
    where: "/admin/catalog",
    before: [
      "The vendor's manifest email (Washington has NO automatic CCRS inbound feed — the sending licensee uploads the manifest and everyone gets an email).",
      "The vendor's Transfer Data Link / WCIA JSON if they provide one — it saves you typing.",
      "A clear counting space to verify the physical delivery against the paperwork.",
    ],
    steps: [
      "Go to Receiving (Inventory → Intake) and build the inbound record: paste the vendor's Transfer Data Link / WCIA JSON, or enter it by hand.",
      "The system stages a DRAFT: status pending, lots in quarantine, COAs captured to the Knowledge Base. Nothing is active yet.",
      "Move the record along the pipeline (in transit → received) as the truck actually arrives.",
      "Count the physical boxes against the manifest lines. Verify every count before going further.",
      "Accept the manifest to activate the lots — or reject it to discard. Accepting is the human sign-off.",
      "Open Product Onboarding (Inventory → Drafts): lots that didn't match the published menu got a DRAFT product, pre-filled from the JSON + COA potency. Review each one, then Approve or Dismiss.",
      "Open Menu Imports: export PRODUCTS and INVENTORIES from the POS, upload both, and review the staged version — approved drafts are listed in that review.",
      "Publish the staged version when it looks right. The public menu updates and the new product is sellable.",
      "Later, Accounts Payable pays the invoice (the accepted manifest) — the linked purchase order is stamped Paid automatically once payments cover what's owed.",
    ],
    doneWhen:
      "The manifest is accepted, every new-product draft is approved or dismissed, and the published menu shows the new items.",
    ifStuck: [
      "Counts don't match the manifest? Do NOT accept — resolve it with the vendor first, or reject the manifest.",
      "Everything here is drafts-first: nothing goes live and nothing gets paid without a human clicking the button.",
    ],
  },

  // ── Stage 0 · Discover ───────────────────────────────────────────────────
  {
    slug: "discover",
    stageKey: "discover",
    title: "SOP — Product Discovery",
    purpose:
      "Capture and qualify candidate vendors and products, then start a purchase order from the winners.",
    where: journeyStage("discover").href,
    before: [
      "The lead details in front of you — a vendor menu, price list, or the rep's email.",
      "For many leads at once, a CSV to use on the Import screen.",
    ],
    steps: [
      "Capture leads: add candidate vendors and products manually, or import a list on the Import screen.",
      "Qualify: set a status and priority as you research each lead.",
      "Check the match badge on vendor leads — they are auto-reconciled against vendors you already buy from.",
      "Promote: when a product lead is worth ordering, click 'Start PO from lead' — it prefills a new purchase order in Purchasing.",
    ],
    doneWhen:
      "Every new lead has a status and priority, and leads worth buying have a purchase order started from them.",
    ifStuck: [
      "A vendor lead didn't match anyone you already buy from? That's fine — you can still promote it; the vendor is carried by name.",
      "Nothing in Discovery touches your live catalog — everything is a draft you confirm.",
    ],
  },

  // ── Stage 1 · Order ──────────────────────────────────────────────────────
  {
    slug: "order",
    stageKey: "order",
    title: "SOP — Purchasing",
    purpose: "Build a purchase order and send it to the vendor.",
    where: journeyStage("order").href,
    before: [
      "Know which vendor you're ordering from and roughly what you need — the builder fills in the rest.",
    ],
    steps: [
      "Click 'New purchase order'. The builder suggests what to reorder using on-hand stock and recent sales velocity (reorder point = avg daily sales × lead time + safety stock).",
      "Use the include/exclude filters (vendor, brand, category, product) or describe what you want in plain English and let AI draft the plan — you always review before saving.",
      "Adjust quantities, save the PO as a draft, then send it to the vendor by email (or export/print).",
      "When the shipment arrives, receive it against each line in Receiving; the PO moves to Partial then Received.",
      "Then pay it in Accounts Payable.",
    ],
    doneWhen: "The PO is saved and sent to the vendor.",
    ifStuck: [
      "AI only drafts the plan — quantities are yours to adjust, and nothing is ordered until you send it.",
    ],
  },

  // ── Stage 2 · Receive ────────────────────────────────────────────────────
  {
    slug: "receive",
    stageKey: "receive",
    title: "SOP — Receiving (inbound transfers)",
    purpose: "Accept inbound transfers and their COAs, with counts verified by a human.",
    where: journeyStage("receive").href,
    before: [
      "The vendor's manifest email — Washington has NO automatic CCRS inbound feed; the sending licensee uploads the manifest and everyone gets an email.",
      "The vendor's Transfer Data Link / WCIA JSON if provided.",
    ],
    steps: [
      "Build the inbound record two ways: paste the vendor's Transfer Data Link / WCIA JSON, or enter it by hand.",
      "The system stages a DRAFT: pending status, lots in quarantine, COAs captured to the Knowledge Base.",
      "Move it along the pipeline (in transit → received) as the delivery progresses.",
      "Verify the physical counts against the manifest.",
      "Accept to activate the lots — or reject to discard.",
    ],
    doneWhen: "The manifest is accepted and its lots are active (out of quarantine).",
    ifStuck: [
      "Counts don't match? Do NOT accept — resolve with the vendor first, or reject the manifest.",
      "If the delivery was ordered on a PO, link it at receiving — that powers the invoice-vs-PO check when you pay.",
    ],
  },

  // ── Stage 3 · Onboard ────────────────────────────────────────────────────
  {
    slug: "onboard",
    stageKey: "onboard",
    title: "SOP — Product Onboarding",
    purpose: "Approve brand-new products onto the menu — a human confirms every machine suggestion.",
    where: journeyStage("onboard").href,
    before: ["An accepted manifest — drafts are created when a manifest is accepted."],
    steps: [
      "On accepting a manifest, each lot is matched to the published menu by its POS key.",
      "Lots that don't match get a DRAFT product, pre-filled from the JSON + COA potency.",
      "Review the details, then Approve (validated) or Dismiss (not a new product).",
      "Approved drafts are added automatically to the next menu import you stage — the import review screen lists each one, and they go live when you publish that version.",
    ],
    doneWhen:
      "No pending drafts remain — each is approved (waiting for the next menu publish) or dismissed.",
    ifStuck: [
      "This keeps the live menu clean: machine-suggested products always wait for a human to confirm them before customers ever see them.",
    ],
  },

  // ── Stage 4 · Publish ────────────────────────────────────────────────────
  {
    slug: "publish",
    stageKey: "publish",
    title: "SOP — Live Menu (publish)",
    purpose: "Put the day's menu live from your POS exports — staged first, published on your click.",
    where: journeyStage("publish").altHref ?? journeyStage("publish").href,
    before: [
      "Fresh PRODUCTS and INVENTORIES exports from your POS (.xlsx or .csv).",
    ],
    steps: [
      "In your POS, export your PRODUCTS and INVENTORIES lists as spreadsheet files (.xlsx or .csv).",
      "Upload both files under Menu Imports — they're staged, so nothing changes on your site yet.",
      "Open the staged version and review the changes (new items, price changes, removals). Approved onboarding drafts are listed here too.",
      "Click Publish when it looks right. Your public menu updates with the new items and prices.",
    ],
    doneWhen: "The staged version is published and the public menu shows the changes.",
    ifStuck: [
      "If an upload fails, re-export the files straight from your POS (don't rename a .csv to .xlsx) and try again.",
      "Your menu always comes from your point-of-sale system, so prices and stock stay accurate.",
    ],
  },

  // ── Stage 5 · Enrich ─────────────────────────────────────────────────────
  {
    slug: "enrich",
    stageKey: "enrich",
    title: "SOP — Product Enrichment",
    purpose: "Add the photos, descriptions, and tags that make a product look great online.",
    where: journeyStage("enrich").href,
    before: ["A published menu — products appear here automatically once you receive and approve them (or from the one-time Cultivera import)."],
    steps: [
      "Products come in automatically once you receive and approve them (or, one time, from the initial Cultivera import).",
      "Open a product to add a photo, description, and tags.",
      "Use the AI helper to draft a description or alt-text, then edit it.",
      "Save — the richer info shows on your public product page.",
    ],
    doneWhen: "The product page shows a photo, description, and tags you approved.",
    ifStuck: [
      "The AI helper only writes drafts; you always approve. Price & stock stay POS-controlled.",
      "Never add medical or health claims.",
    ],
  },

  // ── Stage 6 · Master ─────────────────────────────────────────────────────
  {
    slug: "master",
    stageKey: "master",
    title: "SOP — Product Mastering",
    purpose: "Group the same product's sizes into one clean card on the public menu.",
    where: journeyStage("master").href,
    before: ["A live menu with products on it."],
    steps: [
      "Click 'Generate suggestions' to scan your live menu for items that look like the same product at different sizes.",
      "Review each suggestion. Accept the good ones — that creates a DRAFT product card.",
      "Open a draft, tidy the name and variants, then Publish to group them on your public menu.",
    ],
    doneWhen: "The grouped card is published and the sizes show together on the public menu.",
    ifStuck: [
      "Nothing changes on your menu until you publish. AI never publishes on its own.",
    ],
  },

  // ── Stage 7 · Pay ────────────────────────────────────────────────────────
  {
    slug: "pay",
    stageKey: "pay",
    title: "SOP — Accounts Payable",
    purpose: "Match the invoice against the order and pay the vendor — drafts only, uploaded to the bank by you.",
    where: journeyStage("pay").href,
    before: [
      "Company/bank ACH details set once on the Payroll page — they're shared here.",
      "An accepted manifest — that IS the invoice.",
    ],
    steps: [
      "Pick the invoice (an accepted manifest). The amount box auto-fills with what you owe — edit it for a partial delivery.",
      "If the delivery was linked to a purchase order, a note compares the invoice against what you ordered before you pay. Overpaying is blocked; partial payments warn.",
      "Click Generate — every row is validated, then a NACHA (CCD) file is built.",
      "Download the file and upload it in your bank's ACH portal. Nothing is sent from here.",
    ],
    doneWhen:
      "The NACHA file is uploaded at your bank — and once payments cover what's owed, the linked PO is stamped Paid automatically in Purchasing.",
    ifStuck: [
      "Amounts are entered in dollars and stored in cents. This is a draft for your review and manual bank upload — nothing moves money automatically.",
    ],
  },
] as const;

/** Look up a SOP by slug; null when unknown (routes turn that into a 404). */
export function findSopDoc(slug: string): SopDoc | null {
  return SOP_DOCS.find((d) => d.slug === slug) ?? null;
}

/** The SOP for a journey stage. Throws on gaps so drift fails loudly in CI. */
export function sopForStage(key: JourneyStageKey): SopDoc {
  const doc = SOP_DOCS.find((d) => d.stageKey === key);
  if (!doc) throw new Error(`No SOP for journey stage: ${key}`);
  return doc;
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runSopCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL sop-core: " + msg);
    passed += 1;
  };

  // Pack shape: one master + one per journey stage.
  assert(SOP_DOCS.length === JOURNEY_STAGES.length + 1, "one SOP per stage + truck-day master");
  assert(new Set(SOP_DOCS.map((d) => d.slug)).size === SOP_DOCS.length, "slugs unique");
  assert(SOP_DOCS[0].slug === TRUCK_DAY_SLUG, "truck-day master leads the pack");
  assert(SOP_DOCS[0].stageKey === null, "truck-day is not a stage SOP");

  // Every journey stage is covered, in canonical order after the master.
  JOURNEY_STAGES.forEach((s, i) => {
    const doc = SOP_DOCS[i + 1];
    assert(doc.stageKey === s.key, `stage order preserved at ${s.key}`);
    assert(doc.slug === s.key, `slug matches stage key at ${s.key}`);
    assert(doc.where.startsWith("/admin/"), `where rooted at ${s.key}`);
  });
  // 'where' points at the stage's real surface (primary href or altHref).
  for (const s of JOURNEY_STAGES) {
    const doc = sopForStage(s.key);
    assert(doc.where === s.href || doc.where === s.altHref, `where matches journey at ${s.key}`);
  }

  // Every sheet fits one page and has the full skeleton.
  for (const d of SOP_DOCS) {
    assert(d.title.startsWith("SOP — "), `title prefixed: ${d.slug}`);
    assert(d.purpose.length > 0, `purpose present: ${d.slug}`);
    assert(d.steps.length >= 3 && d.steps.length <= 10, `steps fit one page: ${d.slug}`);
    assert(d.before.length >= 1, `before present: ${d.slug}`);
    assert(d.doneWhen.length > 0, `doneWhen present: ${d.slug}`);
    assert(d.ifStuck.length >= 1, `ifStuck present: ${d.slug}`);
  }

  // Lookups.
  assert(findSopDoc("receive")?.stageKey === "receive", "findSopDoc hits");
  assert(findSopDoc("nope") === null, "findSopDoc misses safely");
  assert(sopForStage("pay").slug === "pay", "sopForStage works");
  assert(sopHref("truck-day") === "/admin/sop/truck-day", "sopHref shape");

  // Drafts-first ethos is printed on paper: the master SOP says it explicitly.
  assert(
    SOP_DOCS[0].ifStuck.some((s) => s.toLowerCase().includes("drafts-first")),
    "master SOP states the drafts-first ethos",
  );

  return { passed };
}
