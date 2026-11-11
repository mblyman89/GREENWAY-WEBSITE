/**
 * D232 slice M-3b (SOP-11 B.5 items 2 and 3, G-78): the Product journey
 * stepper and the per-tab coaching strips. PURE (no React, no storage).
 *
 * Owner (D231, verbatim): "first step, do this, done great, step two..."
 *
 * The stepper is for the design that is open in the Studio:
 *   Garment -> Design (n blockers) -> Print files -> Mockups -> Sample approved
 *   -> Price -> Publish -> On the shop -> Stock synced
 * Each pill links to its tab and "Next step" names the one thing to do.
 */
import type { StudioTab } from "./studio-tabs-core";

export type JourneyStageId = "garment" | "design" | "files" | "mockups" | "sample" | "price" | "publish" | "shop" | "stock";
export type JourneyState = "done" | "todo" | "blocked" | "optional";

export interface JourneyStage { id: JourneyStageId; label: string; state: JourneyState; tab: StudioTab | null; href?: string; note: string }

/** What the Studio knows about the open design (from this browser) and the catalog (from the server). */
export interface JourneyInput {
  design: null | {
    name: string;
    /** The garment still exists in the catalog. */
    garmentOk: boolean;
    /** Visible elements across every side. */
    elements: number;
    /** Blockers left after acknowledgements (checkSides + planPrintFiles). */
    blockers: number;
    /** Print files planned (one per Printful file type). */
    printFiles: number;
  };
  sample: { ticked: number; total: number; approved?: boolean };
  /** The catalog item published from this design, if any. */
  published: null | { handle: string; status: "live" | "hidden"; images: number; stockSyncedAt: string; minRetailCents: number };
  /** The last saved Merch Health run's H-7 (catalog reaches the shop): true ok, false red/amber, null unknown. */
  shopOk: boolean | null;
}

export interface Journey { stages: JourneyStage[]; next: { stage: JourneyStage; text: string } | null; doneCount: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildJourney(i: JourneyInput): Journey {
  const d = i.design;
  const p = i.published;
  const sampleOk = i.sample.approved ?? (i.sample.total > 0 && i.sample.ticked >= i.sample.total);
  const stages: JourneyStage[] = [
    {
      id: "garment", label: "Garment", tab: "garments",
      state: d && d.garmentOk ? "done" : d ? "blocked" : "todo",
      note: !d ? "Pick a blank and colour on Garments, then start a design on Design." : d.garmentOk ? "Garment picked." : "This design points at a garment that is no longer in the catalog. Pick one on Garments.",
    },
    {
      id: "design", label: d && d.blockers ? `Design (${d.blockers} \u26d4)` : "Design", tab: "design",
      state: !d || d.elements === 0 ? "todo" : d.blockers > 0 ? "blocked" : "done",
      note: !d || d.elements === 0 ? "Add text, an image or a shape on Design." : d.blockers > 0 ? `Fix ${plural(d.blockers, "blocker")} on Design (each one says how).` : "Design has no blockers.",
    },
    {
      id: "files", label: "Print files", tab: "proof",
      state: d && d.printFiles > 0 && d.blockers === 0 ? "done" : d && d.blockers > 0 ? "blocked" : "todo",
      note: d && d.printFiles > 0 ? `${plural(d.printFiles, "print file")} planned. Download the ZIP on Proof & Export to keep a backup.` : "Print files appear on Proof & Export once the design has artwork.",
    },
    {
      id: "mockups", label: "Mockups", tab: "proof",
      state: p && p.images > 0 ? "done" : "optional",
      note: p && p.images > 0 ? `${plural(p.images, "shop photo")} on the product.` : "Optional: Generate mockups on Proof & Export, or use photos of your sample.",
    },
    {
      id: "sample", label: "Sample approved", tab: "proof",
      state: sampleOk ? "done" : "todo",
      note: sampleOk ? "Sample checklist complete." : i.sample.total ? `Order a sample at Printful; when it arrives, tick the checklist on Proof & Export (${i.sample.ticked} of ${i.sample.total}).` : "Order a sample at Printful; when it arrives, tick the checklist on Proof & Export.",
    },
    {
      id: "price", label: "Price", tab: "publish",
      state: p && p.minRetailCents > 0 ? "done" : "todo",
      note: p && p.minRetailCents > 0 ? `From $${Math.floor(p.minRetailCents / 100)}.${String(p.minRetailCents % 100).padStart(2, "0")}.` : "Set the retail price on Publish & Ads (Fulfillment & Pricing shows Printful's cost).",
    },
    {
      id: "publish", label: "Publish", tab: "publish",
      state: p ? (p.status === "live" ? "done" : "blocked") : "todo",
      note: !p ? "Press Publish to greenwaymerch.com on Publish & Ads." : p.status === "live" ? "Published." : "Hidden in Merch Inventory. Show it there to put it back on the shop.",
    },
    {
      id: "shop", label: "On the shop", tab: null, href: "/admin/merch-studio/health",
      state: !p || p.status !== "live" ? "todo" : i.shopOk === true ? "done" : i.shopOk === false ? "blocked" : "todo",
      note: !p || p.status !== "live" ? "Appears after Publish." : i.shopOk === true ? "Live on greenwaymerch.com." : i.shopOk === false ? "Merch Health says the shop is not showing every live product (H-7). Open Merch Health." : "Run Merch Health to confirm the shop shows it (H-7).",
    },
    {
      id: "stock", label: "Stock synced", tab: null, href: "/admin/inventory/merch",
      state: p && p.stockSyncedAt ? "done" : "todo",
      note: p && p.stockSyncedAt ? `Printful stock copied ${p.stockSyncedAt.slice(0, 10)}.` : "Copy Printful stock in Inventory \u2192 Merch Inventory.",
    },
  ];
  const doneCount = stages.filter((s) => s.state === "done").length;
  const first = stages.find((s) => s.state === "blocked") ?? stages.find((s) => s.state === "todo");
  let next: Journey["next"] = null;
  if (first) next = { stage: first, text: first.note };
  else if (p && p.stockSyncedAt) next = null;
  return { stages, next, doneCount };
}

export function nextLine(j: Journey, published: JourneyInput["published"]): string {
  if (!j.next) return published ? "Live on greenwaymerch.com and stock is synced. Nothing to do." : "";
  if (j.next.stage.id === "stock" && published?.status === "live") return `Live on greenwaymerch.com. Next: ${j.next.text}`;
  return `Next step: ${j.next.text}`;
}

/** One-line "you are here / do this / then go to" strip per tab (SOP-11 B.5 item 3). */
export const TAB_COACH: Record<StudioTab, { here: string; todo: string; then: string; thenTab: StudioTab | null }> = {
  garments: { here: "Garments", todo: "pick the blank and colour; Printful stock and cost are shown for each.", then: "Design", thenTab: "design" },
  design: { here: "Design", todo: "add artwork to each side and fix every \u26d4 blocker (each says how).", then: "Proof & Export", thenTab: "proof" },
  proof: { here: "Proof & Export", todo: "check the print files, download the ZIP backup, order a sample and tick its checklist when it arrives.", then: "Artwork Check", thenTab: "check" },
  check: { here: "Artwork Check", todo: "drop in any outside art to check size, DPI and colours before you use it.", then: "Fulfillment & Pricing", thenTab: "fulfillment" },
  fulfillment: { here: "Fulfillment & Pricing", todo: "see Printful's cost, shipping and your profit per size.", then: "Publish & Ads", thenTab: "publish" },
  publish: { here: "Publish & Ads", todo: "set title, colours, sizes and price, then Publish to greenwaymerch.com.", then: "Inventory \u2192 Merch Inventory (copy stock)", thenTab: null },
};

export function __runMerchJourneyCoreTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (name: string, c: boolean) => { if (c) passed++; else { failed++; console.error("FAIL", name); } };
  const none = buildJourney({ design: null, sample: { ticked: 0, total: 0 }, published: null, shopOk: null });
  ok("9 stages in order", none.stages.map((s) => s.id).join(",") === "garment,design,files,mockups,sample,price,publish,shop,stock");
  ok("no design -> next is garment", none.next?.stage.id === "garment" && none.doneCount === 0);
  const blocked = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 3, printFiles: 1 }, sample: { ticked: 0, total: 6 }, published: null, shopOk: null });
  ok("blockers show in label and are next", blocked.stages[1].label === "Design (3 \u26d4)" && blocked.next?.stage.id === "design" && blocked.next.text.includes("3 blockers"));
  ok("files blocked while design blocked", blocked.stages[2].state === "blocked");
  const clean = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 0, printFiles: 2 }, sample: { ticked: 2, total: 6 }, published: null, shopOk: null });
  ok("clean design -> next is sample (mockups optional)", clean.next?.stage.id === "sample" && clean.stages[3].state === "optional" && clean.next.text.includes("2 of 6"));
  const sampled = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 0, printFiles: 2 }, sample: { ticked: 6, total: 6 }, published: null, shopOk: null });
  ok("sample ticked -> next is price", sampled.next?.stage.id === "price");
  ok("server approval wins over ticks", buildJourney({ design: { name: "A", garmentOk: true, elements: 1, blockers: 0, printFiles: 1 }, sample: { ticked: 6, total: 6, approved: false }, published: null, shopOk: null }).stages[4].state === "todo");
  const pub = { handle: "a", status: "live" as const, images: 0, stockSyncedAt: "", minRetailCents: 3500 };
  const live = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 0, printFiles: 2 }, sample: { ticked: 6, total: 6 }, published: pub, shopOk: true });
  ok("published + shop ok -> next is stock", live.next?.stage.id === "stock" && live.stages[5].note === "From $35.00.");
  ok("live next line says live", nextLine(live, pub).startsWith("Live on greenwaymerch.com. Next:"));
  const red = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 0, printFiles: 2 }, sample: { ticked: 6, total: 6 }, published: pub, shopOk: false });
  ok("H-7 red -> on the shop blocked and next", red.next?.stage.id === "shop" && red.stages[7].state === "blocked");
  const hidden = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 0, printFiles: 2 }, sample: { ticked: 6, total: 6 }, published: { ...pub, status: "hidden" }, shopOk: true });
  ok("hidden -> publish blocked", hidden.stages[6].state === "blocked" && hidden.next?.stage.id === "publish");
  const all = buildJourney({ design: { name: "A", garmentOk: true, elements: 2, blockers: 0, printFiles: 2 }, sample: { ticked: 6, total: 6 }, published: { ...pub, images: 2, stockSyncedAt: "2027-01-10T00:00:00Z" }, shopOk: true });
  ok("all done -> no next, 9 done", all.next === null && all.doneCount === 9 && nextLine(all, { ...pub, images: 2, stockSyncedAt: "2027-01-10T00:00:00Z" }).includes("Nothing to do"));
  ok("every tab has a strip", (["garments", "design", "proof", "check", "fulfillment", "publish"] as const).every((t) => TAB_COACH[t].todo.length > 10));
  ok("garment missing -> blocked", buildJourney({ design: { name: "A", garmentOk: false, elements: 0, blockers: 0, printFiles: 0 }, sample: { ticked: 0, total: 0 }, published: null, shopOk: null }).next?.stage.id === "garment");
  return { passed, failed };
}
