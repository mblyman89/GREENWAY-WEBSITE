/**
 * src/lib/pos/card-alias-core.ts  (R50 A1)
 *
 * PURE. "Yes, this is that Cultivera product" - the one-click accept of the
 * R50 S4 suggestion, saved as a permanent decision (intake_card_aliases,
 * migration 0270).
 *
 * THE RULE (owner: never guess, never assume):
 *   - An alias can only be SAVED for a card the S4 scorer actually suggested
 *     for that row right now (acceptCheck): the server re-runs the preview,
 *     it never trusts the posted card key.
 *   - An alias is only APPLIED by the planner when the exact restock rule
 *     matches NO live card, and only while that card is still a valid merge
 *     target in the same category axis (intake-mastering-core aliasTarget).
 *     Otherwise it is stale and the product becomes its own card, exactly as
 *     before A1.
 *   - "Forget" deletes it; nothing already on the menu changes either way.
 */

export const CARD_ALIAS_TABLE = "intake_card_aliases";
export const CARD_ALIAS_COLUMNS = "identity, card_key, card_name, decided_by, decided_at, note";
export const CARD_ALIAS_AUDIT_ACCEPT = "intake_card_alias.accept";
export const CARD_ALIAS_AUDIT_FORGET = "intake_card_alias.forget";
export const CARD_ALIAS_MIGRATION = "0270_intake_card_aliases.sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** vendor|categoryAxis|family: three non-blank parts, at most 500 chars (the 0270 check). */
export function isAliasIdentity(v: unknown): v is string {
  const t = s(v);
  if (!t || t.length > 500) return false;
  const parts = t.split("|");
  return parts.length === 3 && parts.every((p) => p.trim().length > 0);
}

/** A card key: non-blank, at most 200 chars, no whitespace inside (the 0270 check, stricter). */
export function isAliasCardKey(v: unknown): v is string {
  const t = s(v);
  return t.length > 0 && t.length <= 200 && !/\s/.test(t);
}

/** Missing-table errors (0270 not applied yet) - never logged as failures. */
export function isCardAliasTableMissing(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  const code = typeof err.code === "string" ? err.code : "";
  const msg = typeof err.message === "string" ? err.message : "";
  if (code !== "42P01" && code !== "PGRST205") return false;
  return /intake_card_aliases/.test(msg);
}

export type AcceptForm = { draftId: string; manifestId: string; cardKey: string };

/** The accept form: the row, its delivery and the card the button named. */
export function parseAcceptForm(get: (name: string) => string): { ok: true; value: AcceptForm } | { ok: false; error: string } {
  const draftId = s(get("draftId")).toLowerCase();
  const manifestId = s(get("manifestId")).toLowerCase();
  const cardKey = s(get("cardKey"));
  if (!UUID.test(draftId)) return { ok: false, error: "That product row could not be found." };
  if (!UUID.test(manifestId)) return { ok: false, error: "That delivery could not be found." };
  if (!isAliasCardKey(cardKey)) return { ok: false, error: "That card could not be found." };
  return { ok: true, value: { draftId, manifestId, cardKey } };
}

export type ForgetForm = { identity: string; manifestId: string; draftId: string | null };

export function parseForgetForm(get: (name: string) => string): { ok: true; value: ForgetForm } | { ok: false; error: string } {
  const identity = s(get("identity"));
  const manifestId = s(get("manifestId")).toLowerCase();
  const draftRaw = s(get("draftId")).toLowerCase();
  if (!isAliasIdentity(identity)) return { ok: false, error: "That choice could not be found." };
  if (!UUID.test(manifestId)) return { ok: false, error: "That delivery could not be found." };
  return { ok: true, value: { identity, manifestId, draftId: UUID.test(draftRaw) ? draftRaw : null } };
}

/** What the server re-computed for the row (from loadRestockPreview). */
export type AcceptEvidence = {
  /** The row's verdict kind right now. */
  verdictKind: string | null;
  /** The identity of the group the row is in (null = the row is not grouped: no vendor / vague name). */
  identity: string | null;
  /** The cards the S4 scorer suggests for this row right now, best first. */
  suggested: { cardKey: string; cardName: string }[];
};

/**
 * May this alias be saved? Only for a "New card" row, with an identity, and
 * only for a card the scorer suggests for it NOW. Never a posted guess.
 */
export function acceptCheck(
  cardKey: string,
  ev: AcceptEvidence | null,
): { ok: true; identity: string; cardName: string } | { ok: false; error: string } {
  if (!ev) return { ok: false, error: "The preview for this delivery could not be read in full, so nothing was saved. Try again." };
  if (ev.verdictKind !== "new") {
    return { ok: false, error: "This product no longer reads as a new card (it already joins a card, or matches more than one), so nothing was saved." };
  }
  if (!ev.identity || !isAliasIdentity(ev.identity)) {
    return { ok: false, error: "This product cannot be grouped safely (no vendor, or the name is too vague), so nothing was saved." };
  }
  const hit = ev.suggested.find((c) => c.cardKey.trim() === cardKey.trim());
  if (!hit) return { ok: false, error: "That card is no longer suggested for this product, so nothing was saved." };
  return { ok: true, identity: ev.identity, cardName: hit.cardName };
}

/** Result banner codes (?alias=<code>). */
export const ALIAS_RESULT_CODES = ["saved", "forgotten", "migration", "error"] as const;
export type AliasResultCode = (typeof ALIAS_RESULT_CODES)[number];

export function aliasResultCode(v: unknown): AliasResultCode | null {
  return (ALIAS_RESULT_CODES as readonly string[]).includes(s(v)) ? (s(v) as AliasResultCode) : null;
}

export function aliasBanner(code: AliasResultCode, msg?: string | null): { tone: "ok" | "warn"; text: string } {
  switch (code) {
    case "saved":
      return { tone: "ok", text: "Saved. This product now joins that card as a size / restock when you approve it, and on every future delivery. Nothing on the live menu changed yet." };
    case "forgotten":
      return { tone: "ok", text: "Choice forgotten. This product is added as its own card again, exactly as before. Nothing on the live menu changed." };
    case "migration":
      return { tone: "warn", text: `Nothing was saved: apply migration ${CARD_ALIAS_MIGRATION} in the Supabase SQL editor first.` };
    case "error":
      return { tone: "warn", text: s(msg).slice(0, 300) || "Nothing was saved." };
  }
}

/** The button label and the fine print beside it. */
export const ACCEPT_BUTTON_LABEL = "Yes, same product \u2014 always join this card";
export const ACCEPT_DETAIL =
  "Saves your answer: approving adds this lot to that card as a size / restock, and future deliveries of this product do the same. Forget undoes it.";
export const FORGET_BUTTON_LABEL = "Forget this choice";

/** One line for the manifest timeline. */
export function aliasEventNote(identity: string, cardKey: string, cardName: string): string {
  return `${identity} \u2192 is card '${cardName}' (${cardKey})`.slice(0, 500);
}

/** Every identity a saved alias exists for, from store rows (blank / malformed rows dropped). */
export function aliasMapFromRows(rows: readonly { identity?: unknown; card_key?: unknown }[] | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows ?? []) {
    if (!r) continue;
    const id = s(r.identity);
    const key = s(r.card_key);
    if (isAliasIdentity(id) && isAliasCardKey(key)) out.set(id, key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runCardAliasCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: unknown, label: string) => {
    if (!cond) throw new Error(`card-alias-core self-test failed: ${label}`);
    passed++;
  };
  const U1 = "11111111-2222-3333-4444-555555555555";
  const U2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const ID = "grow-op-farms|flower|train-wreck";

  // identity / card key
  ok(isAliasIdentity(ID), "identity: three parts");
  ok(!isAliasIdentity("a|b"), "identity: two parts refused");
  ok(!isAliasIdentity("a|b|c|d"), "identity: four parts refused");
  ok(!isAliasIdentity("a| |c"), "identity: blank part refused");
  ok(!isAliasIdentity(`a|b|${"x".repeat(500)}`), "identity: over 500 refused");
  ok(isAliasIdentity(`a|b|${"x".repeat(496)}`), "identity: exactly 500 accepted");
  ok(!isAliasIdentity(42), "identity: non-string refused");
  ok(isAliasCardKey("pos-0123456789ab"), "card key: ok");
  ok(!isAliasCardKey("   "), "card key: blank refused");
  ok(!isAliasCardKey("pos 1"), "card key: inner space refused");
  ok(!isAliasCardKey("x".repeat(201)), "card key: over 200 refused");
  ok(isAliasCardKey("x".repeat(200)), "card key: exactly 200 accepted");

  // table missing
  ok(isCardAliasTableMissing({ code: "PGRST205", message: "Could not find the table 'public.intake_card_aliases' in the schema cache" }), "missing: PGRST205");
  ok(isCardAliasTableMissing({ code: "42P01", message: 'relation "public.intake_card_aliases" does not exist' }), "missing: 42P01");
  ok(!isCardAliasTableMissing({ code: "42P01", message: 'relation "public.other" does not exist' }), "missing: other table is a real error");
  ok(!isCardAliasTableMissing({ code: "23505", message: "intake_card_aliases duplicate" }), "missing: other code is a real error");
  ok(!isCardAliasTableMissing(null), "missing: null");

  // forms
  const form = (m: Record<string, string>) => (n: string) => m[n] ?? "";
  const a = parseAcceptForm(form({ draftId: U1.toUpperCase(), manifestId: U2, cardKey: " pos-0123456789ab " }));
  ok(a.ok && a.value.draftId === U1 && a.value.manifestId === U2 && a.value.cardKey === "pos-0123456789ab", "accept form: normalised");
  ok(!parseAcceptForm(form({ draftId: "x", manifestId: U2, cardKey: "k" })).ok, "accept form: bad draft");
  ok(!parseAcceptForm(form({ draftId: U1, manifestId: "x", cardKey: "k" })).ok, "accept form: bad manifest");
  ok(!parseAcceptForm(form({ draftId: U1, manifestId: U2, cardKey: "" })).ok, "accept form: no card");
  const f = parseForgetForm(form({ identity: ` ${ID} `, manifestId: U2, draftId: U1 }));
  ok(f.ok && f.value.identity === ID && f.value.draftId === U1, "forget form: ok");
  const f2 = parseForgetForm(form({ identity: ID, manifestId: U2, draftId: "nope" }));
  ok(f2.ok && f2.value.draftId === null, "forget form: bad draft id -> null (no anchor)");
  ok(!parseForgetForm(form({ identity: "a|b", manifestId: U2 })).ok, "forget form: bad identity");
  ok(!parseForgetForm(form({ identity: ID, manifestId: "" })).ok, "forget form: bad manifest");

  // acceptCheck
  const ev: AcceptEvidence = {
    verdictKind: "new",
    identity: ID,
    suggested: [
      { cardKey: "pos-0123456789ab", cardName: "Trainwreck" },
      { cardKey: "pos-aaaaaaaaaaaa", cardName: "Train Wreck Kush" },
    ],
  };
  const c1 = acceptCheck("pos-0123456789ab", ev);
  ok(c1.ok && c1.identity === ID && c1.cardName === "Trainwreck", "accept: best suggestion");
  const c2 = acceptCheck("pos-aaaaaaaaaaaa", ev);
  ok(c2.ok && c2.cardName === "Train Wreck Kush", "accept: a runner-up is also allowed");
  ok(!acceptCheck("pos-ffffffffffff", ev).ok, "accept: a card not suggested is refused");
  ok(!acceptCheck("pos-0123456789ab", null).ok, "accept: unreadable preview refused");
  ok(!acceptCheck("pos-0123456789ab", { ...ev, verdictKind: "joins" }).ok, "accept: not new -> refused");
  ok(!acceptCheck("pos-0123456789ab", { ...ev, verdictKind: "ambiguous" }).ok, "accept: ambiguous -> refused");
  ok(!acceptCheck("pos-0123456789ab", { ...ev, verdictKind: null }).ok, "accept: no verdict -> refused");
  ok(!acceptCheck("pos-0123456789ab", { ...ev, identity: null }).ok, "accept: no identity -> refused");
  ok(!acceptCheck("pos-0123456789ab", { ...ev, identity: "a|b" }).ok, "accept: malformed identity -> refused");
  ok(!acceptCheck("pos-0123456789ab", { ...ev, suggested: [] }).ok, "accept: no suggestions -> refused");

  // banners / codes
  ok(aliasResultCode("saved") === "saved" && aliasResultCode("nope") === null && aliasResultCode(undefined) === null, "result codes");
  ok(aliasBanner("saved").tone === "ok" && aliasBanner("saved").text.includes("Nothing on the live menu changed"), "banner: saved");
  ok(aliasBanner("forgotten").text.includes("exactly as before"), "banner: forgotten");
  ok(aliasBanner("migration").tone === "warn" && aliasBanner("migration").text.includes(CARD_ALIAS_MIGRATION), "banner: migration names 0270");
  ok(aliasBanner("error", "boom").text === "boom" && aliasBanner("error", "").text === "Nothing was saved.", "banner: error");
  ok(aliasBanner("error", "x".repeat(400)).text.length === 300, "banner: error capped");
  ok(aliasEventNote(ID, "pos-1", "Trainwreck") === `${ID} \u2192 is card 'Trainwreck' (pos-1)`, "event note");

  // rows -> map
  const m = aliasMapFromRows([
    { identity: ID, card_key: "pos-1" },
    { identity: "bad", card_key: "pos-2" },
    { identity: "a|b|c", card_key: " " },
    { identity: " x|y|z ", card_key: " pos-3 " },
  ]);
  ok(m.size === 2 && m.get(ID) === "pos-1" && m.get("x|y|z") === "pos-3", "rows: malformed dropped, trimmed");
  ok(aliasMapFromRows(null).size === 0, "rows: null -> empty");
  return { passed, failed: 0 };
}
