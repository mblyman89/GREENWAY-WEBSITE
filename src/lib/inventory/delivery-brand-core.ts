/**
 * R37 S5 - ONE BRAND FOR A WHOLE DELIVERY (OR PER ROW), REMEMBERED PER VENDOR.
 *
 * Owner (verbatim): "add a brand field at the top of the page in the ai
 * section that lets me set a brand for the whole manifest, or to set them
 * individually in the product rows bellow. This feature should update the
 * vendor record in the vendors page. This field should be auto filled after
 * the first time the manifest comes in so we only have to set it the one
 * time. This fact should flow through to enrichment and the inventory table
 * and the menu and the customer facing product cards and Leafly."
 *
 * WHERE THE BRAND LIVES (verified, not assumed)
 *   - inventory_lots.brand_id (0023) - the lot has NO brand_name column; the
 *     inventory table reads brands.display_name by that id.
 *   - catalog_product_drafts.brand_name (0026) + brand_id (0234).
 *   - menu_items.brand_name (0002, NOT NULL - a cleared brand is "") - read by
 *     the customer cards, enrichment identity and the Leafly identity bridge.
 *   - brands.vendor_id - the brand shows under its vendor on Admin -> Vendors.
 *   - NEW (0257): vendors.default_brand_id - the remembered brand that fills
 *     the next delivery from that vendor; inbound_manifests.brand_id - the
 *     brand chosen for this delivery.
 *
 * THE RULES THIS MODULE OWNS (pure, self-tested)
 *   1. Input: trimmed, inner spaces collapsed, 1..120 chars, must contain a
 *      letter or digit (brandKey() of a punctuation label is "" and never
 *      matches anything - the receiving resolver's own rule).
 *   2. Matching uses resolveBrandDecision (brand-resolve-core) - the SAME
 *      brandKey() receiving and promotions use, so the three cannot drift:
 *        a. this vendor's brands first (exact, then squeezed);
 *        b. then every brand: a match with NO vendor is ADOPTED by this
 *           vendor (so it appears on the vendor's page); a match owned by a
 *           DIFFERENT vendor is REFUSED (lot-edit-core brandMatchesVendor:
 *           physical ownership is not a coin flip - move it on the vendor
 *           page first);
 *        c. two different brands that squeeze to the same key are REFUSED
 *           (never a coin flip);
 *        d. nothing matches: a NEW brand is created under this vendor.
 *      An incomplete brand read refuses (a truncated list is not a miss).
 *   3. The delivery-wide brand either FILLS rows that have no brand (default)
 *      or REPLACES every row's brand. Rows the owner set one by one keep
 *      theirs under "fill".
 *   4. At intake the vendor's remembered brand fills ONLY lines that carry
 *      no brand label. A line whose label missed or was ambiguous keeps no
 *      brand: the document named something else, and guessing is how a wrong
 *      brand reaches a customer card.
 */
import { brandKey } from "@/lib/promotions/brand-match-core";
import { resolveBrandDecision, type BrandCandidate, type BrandResolveOutcome } from "@/lib/inventory/brand-resolve-core";

export const BRAND_NAME_MAX = 120;

/** Manifest event + audit names. */
export const DELIVERY_BRAND_EVENT = "brand_set";
export const DELIVERY_BRAND_DEFAULT_EVENT = "brand_default_applied";
export const DELIVERY_BRAND_AUDIT = "intake_manifest.brand_set";
export const DRAFT_BRAND_AUDIT = "catalog_draft.brand_set";
export const VENDOR_DEFAULT_BRAND_AUDIT = "vendor.default_brand_set";

export const DELIVERY_BRAND_MIGRATION_COPY =
  "Remembering the brand per vendor needs database migration 0257 (supabase/migrations/0257_delivery_brand.sql). The brand was still set on the products; run the migration in the Supabase SQL editor so the next delivery fills itself.";

export const DELIVERY_BRAND_HELP =
  "Sets the brand on every product of this delivery, the inventory lots, the menu cards (website and Leafly) and the vendor record. It is remembered for this vendor, so the next delivery fills itself. A brand set on one row below overrides it for that product.";

export type BrandInput = { ok: true; name: string } | { ok: false; error: string };

/** Rule 1 - clean what the owner typed. Empty = "clear the brand" (callers decide if that is allowed). */
export function cleanBrandInput(raw: unknown): BrandInput | { ok: true; name: "" } {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (s === "") return { ok: true, name: "" };
  if (s.length > BRAND_NAME_MAX) return { ok: false, error: `A brand name can be at most ${BRAND_NAME_MAX} characters.` };
  if (brandKey(s) === "") return { ok: false, error: "A brand name needs at least one letter or number." };
  return { ok: true, name: s };
}

/**
 * The slug for a NEW brand: lower-case, "&" -> " and ", runs of anything
 * else -> "-", trimmed, max 80 - byte-for-byte vendors/import.ts slugifyName
 * (the brand importer), so a brand created here and one imported later agree.
 */
export function brandSlugCandidate(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type BrandDecision =
  | { kind: "use"; brandId: string; name: string; adoptVendor: boolean; how: string }
  | { kind: "create"; name: string; slug: string }
  | { kind: "refuse"; reason: string };

function used(o: BrandResolveOutcome, adoptVendor: boolean, scope: string): BrandDecision | null {
  if (o.kind === "exact") return { kind: "use", brandId: o.brandId, name: o.matched, adoptVendor, how: `matched ${scope} brand "${o.matched}"` };
  if (o.kind === "squeezed")
    return { kind: "use", brandId: o.brandId, name: o.matched, adoptVendor, how: `matched ${scope} brand "${o.matched}" ignoring case, spacing and punctuation` };
  return null;
}

/**
 * Rule 2 - which brand row the typed name means for this vendor.
 * `all` is EVERY brand (id, display_name, vendor_id); `complete` false = the
 * read was cut short, which refuses. `vendorNames` labels a refusal.
 */
export function decideBrandForVendor(input: {
  name: string;
  vendorId: string | null;
  all: readonly BrandCandidate[];
  complete: boolean;
  vendorNames?: ReadonlyMap<string, string>;
}): BrandDecision {
  const name = input.name;
  if (!input.complete) return { kind: "refuse", reason: "The brand list could not be read completely just now, so nothing was changed. Try again in a minute." };
  const vendorId = input.vendorId;
  if (vendorId) {
    const own = input.all.filter((b) => b.vendor_id === vendorId);
    const o = resolveBrandDecision(name, own);
    const u = used(o, false, "this vendor's");
    if (u) return u;
    if (o.kind === "ambiguous")
      return { kind: "refuse", reason: `"${name}" matches ${o.candidates.length} of this vendor's brands (${o.candidates.map((c) => c.display_name ?? "?").join(", ")}). Type the exact name.` };
  }
  const o = resolveBrandDecision(name, input.all);
  if (o.kind === "ambiguous")
    return { kind: "refuse", reason: `"${name}" matches ${o.candidates.length} different brands (${o.candidates.map((c) => c.display_name ?? "?").join(", ")}). Type the exact name.` };
  if (o.kind === "exact" || o.kind === "squeezed") {
    const row = input.all.find((b) => b.id === o.brandId) ?? null;
    const owner = row?.vendor_id ?? null;
    if (!owner) return used(o, Boolean(vendorId), "the unlinked")!;
    if (!vendorId || owner === vendorId) return used(o, false, "the")!;
    const ownerName = input.vendorNames?.get(owner) ?? "another vendor";
    return {
      kind: "refuse",
      reason: `The brand "${o.matched}" belongs to ${ownerName}. Move it to this vendor on Admin -> Vendors first, or type a different brand.`,
    };
  }
  const slug = brandSlugCandidate(name);
  if (!slug) return { kind: "refuse", reason: "That brand name has no letters or numbers to file it under." };
  return { kind: "create", name, slug };
}

export type BrandRow = {
  draftId: string;
  lotId: string | null;
  brandId: string | null;
  brandName: string | null;
};

export type DeliveryBrandPlan = {
  /** Rows whose brand changes. */
  change: BrandRow[];
  /** Rows already carrying this brand. */
  already: number;
  /** Rows with a different brand that "fill" left alone. */
  kept: number;
};

const blank = (s: string | null | undefined) => !s || s.trim() === "";

/** Rule 3 - which rows a delivery-wide brand touches. */
export function planDeliveryBrand(rows: readonly BrandRow[], brand: { id: string; name: string }, mode: "fill" | "replace"): DeliveryBrandPlan {
  const plan: DeliveryBrandPlan = { change: [], already: 0, kept: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.draftId)) continue;
    seen.add(r.draftId);
    const same = r.brandId === brand.id || (r.brandId === null && !blank(r.brandName) && brandKey(r.brandName) === brandKey(brand.name));
    if (same && r.brandId === brand.id && (r.brandName ?? "") === brand.name) {
      plan.already += 1;
      continue;
    }
    const empty = r.brandId === null && blank(r.brandName);
    if (mode === "fill" && !empty && !same) {
      plan.kept += 1;
      continue;
    }
    plan.change.push(r);
  }
  return plan;
}

export function parseBrandMode(raw: unknown): "fill" | "replace" {
  return raw === "replace" ? "replace" : "fill";
}

export type IntakeBrandPick = { brandId: string | null; source: "manifest" | "vendor-default" | "none" };

/** Rule 4 - the brand an intake line gets. */
export function intakeBrandForLine(outcome: BrandResolveOutcome, resolvedId: string | null, vendorDefaultId: string | null): IntakeBrandPick {
  if (resolvedId) return { brandId: resolvedId, source: "manifest" };
  if (outcome.kind === "no-label" && vendorDefaultId) return { brandId: vendorDefaultId, source: "vendor-default" };
  return { brandId: null, source: "none" };
}

export type BrandPrefill = { name: string; source: "delivery" | "vendor" | "rows" | "none"; note: string };

/**
 * What the delivery field shows. The delivery's own brand wins, then the
 * vendor's remembered brand, then the ONE brand every branded row already
 * shares; otherwise empty (several different brands are not guessed into one).
 */
export function deliveryBrandPrefill(i: { deliveryBrand: string | null; vendorDefault: string | null; vendorName: string | null; rowBrands: readonly (string | null)[] }): BrandPrefill {
  const d = (i.deliveryBrand ?? "").trim();
  if (d) return { name: d, source: "delivery", note: "Set for this delivery." };
  const v = (i.vendorDefault ?? "").trim();
  if (v) return { name: v, source: "vendor", note: `Remembered for ${i.vendorName?.trim() || "this vendor"} from an earlier delivery.` };
  const keys = new Map<string, string>();
  for (const b of i.rowBrands) {
    const t = (b ?? "").trim();
    if (t && brandKey(t)) keys.set(brandKey(t), keys.get(brandKey(t)) ?? t);
  }
  if (keys.size === 1) return { name: [...keys.values()][0], source: "rows", note: "Every branded product of this delivery already says this." };
  if (keys.size > 1) return { name: "", source: "none", note: `The products carry ${keys.size} different brands - type one to set them all, or set each row below.` };
  return { name: "", source: "none", note: "No brand yet - type it once; it is remembered for this vendor." };
}

export type DeliveryBrandResult = {
  code: "ok" | "cleared" | "refused" | "error" | "none";
  brand?: string;
  changed?: number;
  already?: number;
  kept?: number;
  cards?: number;
  created?: boolean;
  remembered?: boolean | null;
  reason?: string;
};

/** Redirect params (all strings; numbers clamped). */
export function deliveryBrandParams(r: DeliveryBrandResult): Record<string, string> {
  const n = (v: number | undefined) => String(Math.max(0, Math.min(9999, Math.floor(Number.isFinite(v ?? NaN) ? (v as number) : 0))));
  const p: Record<string, string> = { brand_set: r.code };
  if (r.brand) p.brand_name = r.brand.slice(0, BRAND_NAME_MAX);
  if (r.code === "ok" || r.code === "cleared") {
    p.brand_changed = n(r.changed);
    p.brand_already = n(r.already);
    p.brand_kept = n(r.kept);
    p.brand_cards = n(r.cards);
    if (r.created) p.brand_new = "1";
    if (r.remembered === true) p.brand_mem = "1";
    if (r.remembered === null) p.brand_mem = "migration";
  }
  if (r.reason) p.brand_reason = r.reason.slice(0, 300);
  return p;
}

const int = (v: unknown) => {
  const x = Number(typeof v === "string" ? v : NaN);
  return Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
};
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** The banner after a brand save (null when the URL carries none). */
export function deliveryBrandBanner(sp: Record<string, unknown>): { tone: "ok" | "warn" | "bad"; text: string } | null {
  const code = sp.brand_set;
  if (typeof code !== "string") return null;
  const brand = typeof sp.brand_name === "string" ? sp.brand_name : "";
  const reason = typeof sp.brand_reason === "string" ? sp.brand_reason : "";
  if (code === "refused") return { tone: "warn", text: `Brand not set. ${reason || "Check the name and try again."}` };
  if (code === "error") return { tone: "bad", text: `The brand could not be saved just now.${reason ? ` ${reason}` : ""} Nothing was half-changed on the menu; try again.` };
  if (code === "none") return { tone: "warn", text: "This delivery has no products to brand yet." };
  if (code !== "ok" && code !== "cleared") return null;
  const changed = int(sp.brand_changed);
  const already = int(sp.brand_already);
  const kept = int(sp.brand_kept);
  const cards = int(sp.brand_cards);
  const parts: string[] = [];
  parts.push(
    code === "cleared"
      ? `Brand cleared on ${plural(changed, "product", "products")}.`
      : `Brand "${brand}" set on ${plural(changed, "product", "products")}${sp.brand_new === "1" ? " (a new brand, filed under this vendor)" : ""}.`,
  );
  if (already > 0) parts.push(`${plural(already, "already had it", "already had it")}.`);
  if (kept > 0) parts.push(`${plural(kept, "product keeps", "products keep")} the brand set on its own row.`);
  if (cards > 0) parts.push(`${plural(cards, "menu card", "menu cards")} updated (website + Leafly).`);
  if (sp.brand_mem === "1") parts.push("Remembered for this vendor - the next delivery fills itself.");
  if (sp.brand_mem === "migration") return { tone: "warn", text: `${parts.join(" ")} ${DELIVERY_BRAND_MIGRATION_COPY}` };
  if (reason) return { tone: "warn", text: `${parts.join(" ")} ${reason}` };
  return { tone: "ok", text: parts.join(" ") };
}

/** One plain manifest-event note. */
export function deliveryBrandNote(brand: string, plan: { changed: number; kept: number; already: number }, mode: "fill" | "replace"): string {
  return `Brand "${brand}" set for this delivery (${mode === "replace" ? "every row" : "rows without a brand"}): ${plan.changed} changed, ${plan.already} already had it, ${plan.kept} kept their own.`;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runDeliveryBrandCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`delivery-brand-core FAIL: ${name}`);
    }
  };
  const eq = (name: string, a: unknown, b: unknown) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

  // Rule 1
  eq("trim + collapse", cleanBrandInput("  Phat   Panda "), { ok: true, name: "Phat Panda" });
  eq("empty = clear", cleanBrandInput("   "), { ok: true, name: "" });
  eq("non-string = clear", cleanBrandInput(null), { ok: true, name: "" });
  ok("punctuation refused", cleanBrandInput("--!!").ok === false);
  ok("121 chars refused", cleanBrandInput("a".repeat(121)).ok === false);
  ok("120 chars allowed", cleanBrandInput("a".repeat(120)).ok === true);

  // Slug - same as vendors/import slugifyName
  eq("slug &", brandSlugCandidate("Fire & Ice"), "fire-and-ice");
  eq("slug trims dashes", brandSlugCandidate("  -Phat Panda!- "), "phat-panda");
  eq("slug max 80", brandSlugCandidate("b".repeat(90)).length, 80);

  // Rule 2
  const V1 = "v1";
  const V2 = "v2";
  const all: BrandCandidate[] = [
    { id: "b1", display_name: "Phat Panda", vendor_id: V1 },
    { id: "b2", display_name: "Ceres", vendor_id: V2 },
    { id: "b3", display_name: "Orphan Farms", vendor_id: null },
    { id: "b4", display_name: "High Tide", vendor_id: V1 },
    { id: "b5", display_name: "HighTide", vendor_id: V2 },
  ];
  const names = new Map([[V2, "Ceres Wholesale"]]);
  const d1 = decideBrandForVendor({ name: "phat panda", vendorId: V1, all, complete: true });
  ok("own exact (case)", d1.kind === "use" && d1.brandId === "b1" && !d1.adoptVendor && d1.name === "Phat Panda");
  const d2 = decideBrandForVendor({ name: "Phat-Panda", vendorId: V1, all, complete: true });
  ok("own squeezed", d2.kind === "use" && d2.brandId === "b1" && d2.how.includes("ignoring"));
  const d3 = decideBrandForVendor({ name: "Orphan Farms", vendorId: V1, all, complete: true });
  ok("unlinked adopted", d3.kind === "use" && d3.brandId === "b3" && d3.adoptVendor);
  const d3b = decideBrandForVendor({ name: "Orphan Farms", vendorId: null, all, complete: true });
  ok("unlinked no vendor not adopted", d3b.kind === "use" && !d3b.adoptVendor);
  const d4 = decideBrandForVendor({ name: "Ceres", vendorId: V1, all, complete: true, vendorNames: names });
  ok("other vendor refused + named", d4.kind === "refuse" && d4.reason.includes("Ceres Wholesale"));
  const d4b = decideBrandForVendor({ name: "Ceres", vendorId: V2, all, complete: true });
  ok("owner vendor uses", d4b.kind === "use" && d4b.brandId === "b2");
  // High Tide (V1) vs HighTide (V2): V1 exact own wins; V1 squeezed own still unique within V1.
  const d5 = decideBrandForVendor({ name: "high tide", vendorId: V1, all, complete: true });
  ok("own wins over cross-vendor squeeze", d5.kind === "use" && d5.brandId === "b4");
  const d5b = decideBrandForVendor({ name: "HIGH-TIDE", vendorId: null, all, complete: true });
  ok("cross-vendor squeeze ambiguous refused", d5b.kind === "refuse" && d5b.reason.includes("2 different brands"));
  const d6 = decideBrandForVendor({ name: "Brand New Co", vendorId: V1, all, complete: true });
  eq("miss creates", d6, { kind: "create", name: "Brand New Co", slug: "brand-new-co" });
  ok("incomplete refuses", decideBrandForVendor({ name: "Phat Panda", vendorId: V1, all, complete: false }).kind === "refuse");
  const amb: BrandCandidate[] = [
    { id: "x1", display_name: "Dab Co", vendor_id: V1 },
    { id: "x2", display_name: "DabCo", vendor_id: V1 },
  ];
  ok("own ambiguous refused", decideBrandForVendor({ name: "dab-co!", vendorId: V1, all: amb, complete: true }).kind === "refuse");
  ok("other vendor unnamed falls back", (() => {
    const d = decideBrandForVendor({ name: "Ceres", vendorId: V1, all, complete: true });
    return d.kind === "refuse" && d.reason.includes("another vendor");
  })());

  // Rule 3
  const rows: BrandRow[] = [
    { draftId: "d1", lotId: "l1", brandId: null, brandName: null },
    { draftId: "d2", lotId: "l2", brandId: "b9", brandName: "Other" },
    { draftId: "d3", lotId: "l3", brandId: "b1", brandName: "Phat Panda" },
    { draftId: "d4", lotId: null, brandId: null, brandName: "  " },
    { draftId: "d1", lotId: "l1", brandId: null, brandName: null },
    { draftId: "d5", lotId: "l5", brandId: null, brandName: "phat-panda" },
  ];
  const brand = { id: "b1", name: "Phat Panda" };
  const pf = planDeliveryBrand(rows, brand, "fill");
  eq("fill changes blanks + same-key text", pf.change.map((r) => r.draftId), ["d1", "d4", "d5"]);
  ok("fill keeps other brand", pf.kept === 1 && pf.already === 1);
  const pr = planDeliveryBrand(rows, brand, "replace");
  eq("replace changes all but same", pr.change.map((r) => r.draftId), ["d1", "d2", "d4", "d5"]);
  ok("replace keeps none", pr.kept === 0 && pr.already === 1);
  ok("same id but stale name is changed", planDeliveryBrand([{ draftId: "z", lotId: null, brandId: "b1", brandName: "Old" }], brand, "fill").change.length === 1);
  eq("mode parse", [parseBrandMode("replace"), parseBrandMode("x"), parseBrandMode(null)], ["replace", "fill", "fill"]);

  // Rule 4
  eq("label resolved wins", intakeBrandForLine({ kind: "exact", brandId: "b1", matched: "P" }, "b1", "b7"), { brandId: "b1", source: "manifest" });
  eq("no label -> default", intakeBrandForLine({ kind: "no-label" }, null, "b7"), { brandId: "b7", source: "vendor-default" });
  eq("miss never defaulted", intakeBrandForLine({ kind: "miss", label: "X" }, null, "b7"), { brandId: null, source: "none" });
  eq("ambiguous never defaulted", intakeBrandForLine({ kind: "ambiguous", label: "X", candidates: [] }, null, "b7"), { brandId: null, source: "none" });
  eq("incomplete never defaulted", intakeBrandForLine({ kind: "read-incomplete", label: "X", reason: "r" }, null, "b7"), { brandId: null, source: "none" });
  eq("no label no default", intakeBrandForLine({ kind: "no-label" }, null, null), { brandId: null, source: "none" });

  // Prefill
  ok("delivery wins", deliveryBrandPrefill({ deliveryBrand: "A", vendorDefault: "B", vendorName: "V", rowBrands: ["C"] }).name === "A");
  const pv = deliveryBrandPrefill({ deliveryBrand: " ", vendorDefault: "B", vendorName: "Vendo", rowBrands: ["C"] });
  ok("vendor next + named", pv.name === "B" && pv.source === "vendor" && pv.note.includes("Vendo"));
  const prw = deliveryBrandPrefill({ deliveryBrand: null, vendorDefault: null, vendorName: null, rowBrands: [null, "Phat Panda", "phat-panda", ""] });
  ok("one shared row brand", prw.name === "Phat Panda" && prw.source === "rows");
  const pm = deliveryBrandPrefill({ deliveryBrand: null, vendorDefault: null, vendorName: null, rowBrands: ["A", "B"] });
  ok("several not guessed", pm.name === "" && pm.note.includes("2 different"));
  ok("none", deliveryBrandPrefill({ deliveryBrand: null, vendorDefault: null, vendorName: null, rowBrands: [] }).source === "none");

  // Params + banner round trip
  const p = deliveryBrandParams({ code: "ok", brand: "Phat Panda", changed: 3, already: 1, kept: 2, cards: 4, created: true, remembered: true });
  eq("params", p, { brand_set: "ok", brand_name: "Phat Panda", brand_changed: "3", brand_already: "1", brand_kept: "2", brand_cards: "4", brand_new: "1", brand_mem: "1" });
  const b = deliveryBrandBanner(p)!;
  ok("banner ok tone", b.tone === "ok");
  ok("banner text", b.text.includes('Brand "Phat Panda" set on 3 products (a new brand') && b.text.includes("2 products keep") && b.text.includes("4 menu cards") && b.text.includes("Remembered"));
  const bm = deliveryBrandBanner(deliveryBrandParams({ code: "ok", brand: "X", changed: 1, remembered: null }))!;
  ok("migration warns", bm.tone === "warn" && bm.text.includes("0257") && bm.text.includes("1 product."));
  ok("clamp", deliveryBrandParams({ code: "ok", changed: 1e9 }).brand_changed === "9999");
  ok("negative clamp", deliveryBrandParams({ code: "ok", changed: -3 }).brand_changed === "0");
  ok("refused banner", deliveryBrandBanner({ brand_set: "refused", brand_reason: "Nope." })?.text === "Brand not set. Nope.");
  ok("error banner bad", deliveryBrandBanner({ brand_set: "error" })?.tone === "bad");
  ok("unknown code null", deliveryBrandBanner({ brand_set: "zzz" }) === null);
  ok("absent null", deliveryBrandBanner({}) === null);
  ok("cleared text", deliveryBrandBanner(deliveryBrandParams({ code: "cleared", changed: 2 }))?.text.startsWith("Brand cleared on 2 products."));
  ok("reason on ok warns", deliveryBrandBanner(deliveryBrandParams({ code: "ok", brand: "X", changed: 1, reason: "1 card skipped." }))?.tone === "warn");
  ok("note", deliveryBrandNote("X", { changed: 2, kept: 1, already: 0 }, "fill").includes("rows without a brand"));
  return { passed, failed };
}
