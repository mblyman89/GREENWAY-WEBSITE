/**
 * src/lib/inventory/lot-onboard-core.ts   (D207 — "it won't let me add/change
 * the price. And I can't find them in onboarding like it tells me.")
 *
 * A lot whose product key is on NO published menu card has no price box: the
 * price lives on the menu card. The normal way onto the menu is a Product
 * Onboarding draft, which is made when a delivery is finalized. A delivery
 * that was REFUSED (by accident, then re-activated lot by lot) never got
 * those drafts, so the page pointed at an onboarding row that did not exist.
 *
 * This core decides, for ONE lot, what the lot page offers:
 *   - "send"      : no draft at all -> a "Send to Product Onboarding" button
 *                   (seeds exactly one draft for this lot, same as finalize);
 *   - "open_draft": a draft is waiting -> link straight to it;
 *   - "approved"  : approved but not on the published menu yet -> link to
 *                   Publish Menu (the approval staged a version);
 *   - "none"      : nothing to offer, with the plain reason.
 *
 * NEVER GUESS: a lot with no key, no delivery, a trade sample, a destroyed or
 * sold-out lot, or a lot that is still refused (status not back to active /
 * quarantine) is never sent. A refused-at-the-dock lot is only eligible when
 * a person set its status back to a live status (the owner's "rejected by
 * accident"). PURE: no I/O. Registered in run-pure-selftests.ts.
 */

export type OnboardLot = {
  status: string | null;
  disposition: string | null;
  is_sample: boolean | null;
  pos_product_key: string | null;
  manifest_id: string | null;
};

/** The lot page's price state (price-write-store getLotPriceState().status). */
export type OnboardPriceStatus = "priced" | "ambiguous" | "not-on-menu" | "unavailable";

export type OnboardDraft = { status: string | null; pos_product_key: string | null };

export type OnboardVerdict =
  | { kind: "send" }
  | { kind: "open_draft"; href: string }
  | { kind: "approved"; href: string }
  | { kind: "none"; reason: string };

/** Live statuses a lot may be onboarded from (sold_out / destroyed never). */
const LIVE_STATUSES = new Set(["active", "quarantine"]);

export const ONBOARD_ANCHOR = "lot-onboard";

export function onboardingHref(key: string): string {
  return `/admin/inventory/drafts?status=draft&q=${encodeURIComponent(key)}`;
}

export const PUBLISH_HREF = "/admin/publish";

export function lotOnboardVerdict(
  lot: OnboardLot,
  priceStatus: OnboardPriceStatus,
  drafts: readonly OnboardDraft[] | null,
): OnboardVerdict {
  const key = (lot.pos_product_key ?? "").trim();
  if (priceStatus !== "not-on-menu") return { kind: "none", reason: "The product is already on the published menu." };
  if (!key) return { kind: "none", reason: "This lot has no product key yet." };
  if (!lot.manifest_id) return { kind: "none", reason: "This lot has no delivery on file, so there is nothing to onboard it from." };
  if (lot.is_sample === true) return { kind: "none", reason: "Trade samples never go on the menu." };
  const status = (lot.status ?? "").toLowerCase();
  if (!LIVE_STATUSES.has(status)) {
    return { kind: "none", reason: `This lot's status is "${lot.status ?? "unknown"}", so it can't be put on the menu.` };
  }
  if (drafts === null) return { kind: "none", reason: "Product Onboarding couldn't be read just now. Reload the page." };
  const mine = drafts.filter((d) => (d.pos_product_key ?? "").trim() === key);
  if (mine.some((d) => d.status === "draft")) return { kind: "open_draft", href: onboardingHref(key) };
  if (mine.some((d) => d.status === "approved")) return { kind: "approved", href: PUBLISH_HREF };
  // A refused-at-the-dock lot is only eligible when a person put it back to
  // a live status (checked above) — the status gate IS that confirmation.
  return { kind: "send" };
}

/** The banner after the send action (query `onb=`). */
export function onboardBanner(code: string | null | undefined): { tone: "ok" | "error"; text: string } | null {
  switch (code) {
    case "priced":
      return { tone: "ok", text: "Price saved. The product was approved and is on the menu at that price; the register shows it on its next refresh." };
    case "priced_pending":
      return { tone: "ok", text: "Price saved and the product approved. Its menu update is waiting at Publish Menu (it could not go live on its own); publish it there." };
    case "sent":
      return { tone: "ok", text: "Sent to Product Onboarding. Open it there, set the price and approve; the price box here works as soon as it is on the menu." };
    case "exists":
      return { tone: "ok", text: "This product already had an onboarding row, so nothing new was made. Use the link below." };
    default:
      return null;
  }
}

/**
 * D208 ("I want to set the price in the detail page like all the others."):
 * what the lot page's price box does for a lot that is NOT on the menu yet.
 *  - "seed_then_approve": no onboarding row -> make it, then approve it at
 *    the typed price (the approval puts it on the menu, same as onboarding);
 *  - "approve": an onboarding row is waiting -> approve it at the price;
 *  - "refuse": nothing to approve here, with the plain reason.
 * Every approval gate (2x cost floor, category, compliance) still runs in
 * approveDraftWithPrice; this only decides which path is allowed.
 */
export type OffMenuPriceStep = { kind: "seed_then_approve" } | { kind: "approve" } | { kind: "refuse"; reason: string };

export function offMenuPriceStep(verdict: OnboardVerdict): OffMenuPriceStep {
  if (verdict.kind === "send") return { kind: "seed_then_approve" };
  if (verdict.kind === "open_draft") return { kind: "approve" };
  if (verdict.kind === "approved") {
    return { kind: "refuse", reason: "This product is already approved; its menu update is waiting at Publish Menu. Publish it, then edit the price here." };
  }
  return { kind: "refuse", reason: verdict.reason };
}

/** True when the lot page should show the off-menu price box. */
export function showOffMenuPriceBox(verdict: OnboardVerdict | null): boolean {
  return verdict?.kind === "send" || verdict?.kind === "open_draft";
}

export function __runLotOnboardCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`lot-onboard-core: ${what}`);
    passed += 1;
  };
  const base: OnboardLot = { status: "active", disposition: "rejected_at_dock", is_sample: false, pos_product_key: "GF41918905566981", manifest_id: "m1" };

  ok(lotOnboardVerdict(base, "not-on-menu", []).kind === "send", "re-activated refused lot with no draft -> send");
  ok(lotOnboardVerdict({ ...base, disposition: null }, "not-on-menu", []).kind === "send", "accepted lot with no draft -> send");
  ok(lotOnboardVerdict(base, "priced", []).kind === "none", "already priced -> none");
  ok(lotOnboardVerdict(base, "ambiguous", []).kind === "none", "ambiguous -> none (size picker handles it)");
  ok(lotOnboardVerdict(base, "unavailable", []).kind === "none", "unreadable menu -> none");
  ok(lotOnboardVerdict({ ...base, pos_product_key: " " }, "not-on-menu", []).kind === "none", "no key -> none");
  ok(lotOnboardVerdict({ ...base, manifest_id: null }, "not-on-menu", []).kind === "none", "no delivery -> none");
  ok(lotOnboardVerdict({ ...base, is_sample: true }, "not-on-menu", []).kind === "none", "sample -> none");
  ok(lotOnboardVerdict({ ...base, status: "rejected" }, "not-on-menu", []).kind === "none", "still refused -> none");
  ok(lotOnboardVerdict({ ...base, status: "destroyed" }, "not-on-menu", []).kind === "none", "destroyed -> none");
  ok(lotOnboardVerdict({ ...base, status: "sold_out" }, "not-on-menu", []).kind === "none", "sold out -> none");
  ok(lotOnboardVerdict({ ...base, status: "quarantine" }, "not-on-menu", []).kind === "send", "quarantine -> send");
  ok(lotOnboardVerdict(base, "not-on-menu", null).kind === "none", "draft read failed -> none (never guess)");

  const open = lotOnboardVerdict(base, "not-on-menu", [{ status: "draft", pos_product_key: "GF41918905566981" }]);
  ok(open.kind === "open_draft" && open.href === "/admin/inventory/drafts?status=draft&q=GF41918905566981", "open draft -> link to it");
  const appr = lotOnboardVerdict(base, "not-on-menu", [{ status: "approved", pos_product_key: "GF41918905566981" }]);
  ok(appr.kind === "approved" && appr.href === PUBLISH_HREF, "approved -> publish link");
  ok(lotOnboardVerdict(base, "not-on-menu", [{ status: "dismissed", pos_product_key: "GF41918905566981" }]).kind === "send", "dismissed only -> send again");
  ok(lotOnboardVerdict(base, "not-on-menu", [{ status: "draft", pos_product_key: "OTHER" }]).kind === "send", "another key's draft ignored");
  ok(onboardingHref("A&B") === "/admin/inventory/drafts?status=draft&q=A%26B", "href encoded");
  ok(onboardBanner("sent")?.tone === "ok" && onboardBanner("x") === null, "banner");

  // D208: the off-menu price box.
  ok(offMenuPriceStep({ kind: "send" }).kind === "seed_then_approve", "no draft -> seed then approve");
  ok(offMenuPriceStep({ kind: "open_draft", href: "x" }).kind === "approve", "open draft -> approve it");
  ok(offMenuPriceStep({ kind: "approved", href: PUBLISH_HREF }).kind === "refuse", "approved -> refuse (publish first)");
  const r = offMenuPriceStep({ kind: "none", reason: "Trade samples never go on the menu." });
  ok(r.kind === "refuse" && r.reason === "Trade samples never go on the menu.", "none -> refuse with its reason");
  ok(showOffMenuPriceBox({ kind: "send" }) && showOffMenuPriceBox({ kind: "open_draft", href: "x" }), "box shows for send/open");
  ok(!showOffMenuPriceBox(null) && !showOffMenuPriceBox({ kind: "approved", href: "x" }) && !showOffMenuPriceBox({ kind: "none", reason: "r" }), "box hidden otherwise");
  ok(onboardBanner("priced")?.tone === "ok" && onboardBanner("priced_pending")?.tone === "ok", "price banners");
  return { passed, failed: 0 };
}
