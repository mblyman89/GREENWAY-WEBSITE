/**
 * src/lib/inventory/restock-preview-view-core.ts  (S19.2)
 *
 * PURE: should Product Onboarding load the restock preview for this render,
 * and if not, what one line explains why? Kept out of the page so the rule
 * is testable without rendering a server component.
 *
 *   - Only the REVIEW tab ("draft"): approved/dismissed rows are already
 *     decided, so a "will join" prediction would be about the past.
 *   - Only ONE delivery (manifestId): the question is per delivery, and it
 *     keeps the live-card read bounded to that delivery's categories. With
 *     no delivery picked the page says how to get a preview (never silent).
 *   - No rows -> nothing to preview and nothing to say.
 */

export type RestockPreviewPlan = {
  load: boolean;
  unavailable: "no_delivery" | null;
};

export function restockPreviewPlan(input: {
  view: string;
  manifestId: string | null | undefined;
  rows: number;
}): RestockPreviewPlan {
  if (input.view !== "draft" || input.rows <= 0) return { load: false, unavailable: null };
  if (!input.manifestId) return { load: false, unavailable: "no_delivery" };
  return { load: true, unavailable: null };
}

export function __runRestockPreviewViewTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`restock-preview-view-core: ${msg}`);
    passed += 1;
  };
  const p = restockPreviewPlan;
  ok(p({ view: "draft", manifestId: "m1", rows: 3 }).load === true, "focused review tab loads");
  ok(p({ view: "draft", manifestId: "m1", rows: 3 }).unavailable === null, "focused: no note");
  ok(p({ view: "draft", manifestId: null, rows: 3 }).load === false, "no delivery: no load");
  ok(p({ view: "draft", manifestId: null, rows: 3 }).unavailable === "no_delivery", "no delivery: says how");
  ok(p({ view: "draft", manifestId: "", rows: 3 }).unavailable === "no_delivery", "empty id = no delivery");
  ok(p({ view: "approved", manifestId: "m1", rows: 3 }).load === false, "approved tab: no load");
  ok(p({ view: "approved", manifestId: null, rows: 3 }).unavailable === null, "approved tab: silent");
  ok(p({ view: "dismissed", manifestId: "m1", rows: 3 }).load === false, "dismissed tab: no load");
  ok(p({ view: "draft", manifestId: "m1", rows: 0 }).load === false, "no rows: no load");
  ok(p({ view: "draft", manifestId: null, rows: 0 }).unavailable === null, "no rows: silent");
  ok(p({ view: "draft", manifestId: "m1", rows: 1 }).load === true, "one row is enough");
  return { passed };
}
