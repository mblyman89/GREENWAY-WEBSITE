/**
 * src/lib/leafly/cart-picker-core.ts
 *
 * SLICE L-50: the "Change items" picker offers only sizes Leafly can have.
 *
 * PURE. No imports beyond types, no database, no network, no clock.
 *
 * WHAT WENT WRONG (owner's SQL, 2026-09-28)
 *   All five cart attempts were single-line SUBSTITUTIONS (same cart item id,
 *   new integratorVariantId). All five returned 400 with the body
 *   {"error":"Bad Request","status":400}. Leafly's spec says a cart update is
 *   rejected when an integratorVariantId does not exist in its catalog for
 *   the store, or is out of stock. The picker built its list from our
 *   syndication feed (preview-lookup) and did not run the payload builder
 *   (`buildLeaflyItemsResult` -> `variantsFor`), which REJECTS some sizes
 *   (no readable weight, a weight-typed product with no sizes). Those sizes
 *   are never sent to Leafly, but the picker offered them anyway.
 *
 * THE RULE
 *   A size may be offered, or accepted for an addition, substitution or
 *   edit, only if the menu payload we build for Leafly contains that exact
 *   variant id. The set is read from the SAME builder the menu push uses,
 *   called with the SAME store options (pickup toggle, medical endorsement),
 *   so it cannot drift from what is sent.
 *
 *   Being in our payload is necessary, not sufficient: Leafly must also have
 *   RECEIVED it (a send since the size was added). That half is covered by
 *   the L-49 sandbox pre-flight, which reads Leafly's own catalog before the
 *   cart POST.
 */

/** The minimum payload shape this core reads: items with variant ids. */
export type PayloadLikeItems = ReadonlyArray<{
  variants?: ReadonlyArray<{ id?: unknown }> | null;
}>;

/** Every variant id the built Leafly payload would send, trimmed, non-empty. */
export function sentVariantIdsFromPayload(items: PayloadLikeItems): Set<string> {
  const out = new Set<string>();
  for (const it of items ?? []) {
    for (const v of it?.variants ?? []) {
      const id = typeof v?.id === "string" ? v.id.trim() : typeof v?.id === "number" ? String(v.id) : "";
      if (id.length > 0) out.add(id);
    }
  }
  return out;
}

/**
 * Is this variant id one we send to Leafly? `sent === null` means the
 * payload could not be built. In that case this answers false (never offer a
 * size we cannot vouch for); the caller already reports the menu as not
 * loaded.
 */
export function isSentToLeafly(sent: ReadonlySet<string> | null, variantId: string): boolean {
  if (sent === null) return false;
  const id = (variantId ?? "").trim();
  return id.length > 0 && sent.has(id);
}

/** Why a size is missing from the picker, in words, or null when it is offered. */
export const NOT_SENT_REASON =
  "This size is not in the menu we send to Leafly (the menu builder refuses it, usually because no weight can be read from its label), so Leafly does not have it and would refuse the change.";

export function __runCartPickerTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[cart-picker-core] FAILED: ${label}`);
    }
  };

  const payload = [
    { variants: [{ id: "62784764934810737-onboarded" }, { id: " pos-1-2 " }] },
    { variants: [{ id: "item9-default" }] },
    { variants: [] },
    { variants: null },
    { variants: [{ id: "" }, { id: null }, { id: 42 }] },
  ];
  const sent = sentVariantIdsFromPayload(payload);
  ok(sent.has("62784764934810737-onboarded"), "real onboarded variant id collected");
  ok(sent.has("pos-1-2"), "ids are trimmed");
  ok(sent.has("item9-default"), "synthesized default id collected");
  ok(sent.has("42"), "numeric id stringified (payload ids are String(v.id))");
  ok(!sent.has(""), "blank id never collected");
  ok(sent.size === 4, "exactly the four real ids");
  ok(sentVariantIdsFromPayload([]).size === 0, "empty payload -> empty set");

  ok(isSentToLeafly(sent, "pos-1-2"), "sent id is offered");
  ok(isSentToLeafly(sent, " pos-1-2 "), "lookup trims");
  ok(!isSentToLeafly(sent, "pos-9-9"), "an id the builder rejected is NOT offered (the 400 case)");
  ok(!isSentToLeafly(sent, ""), "blank id not offered");
  ok(!isSentToLeafly(null, "pos-1-2"), "unbuildable payload -> nothing offered (never vouch blind)");
  ok(/not in the menu we send to Leafly/.test(NOT_SENT_REASON), "reason names the cause plainly");

  return { passed, failed };
}
