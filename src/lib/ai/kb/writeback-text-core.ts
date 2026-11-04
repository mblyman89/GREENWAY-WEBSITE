/**
 * ai/kb/writeback-text-core — make Knowledge Base write-back values safe for
 * PostgreSQL `text` columns (pure, no imports).
 *
 * WHY THIS EXISTS (owner report 2026-11-04: "I can fetch the menu items, and I
 * can save the images. It fails to save the descriptions"): the vendor-menu
 * KB identity (Cultivera / GrowFlow / LeafLink `kbIdentityForItem`) joins
 * brand, product and variant with a NUL byte (U+0000), byte-for-byte the
 * crawler's `product_key()`. PostgreSQL `text` cannot store U+0000 at all
 * ("\u0000 cannot be converted to text", SQLSTATE 22P05, verified in
 * production). So every `kb_products` upsert from a menu save carried
 * `pos_product_key = "brand\0product\0"`, was refused, and the description
 * never landed, while the image save (which never touches that column)
 * succeeded. The same NUL key also made every `media_usages` insert for
 * `kb_product` / `cultivera_strain` fail silently (0 rows in production).
 *
 * The rules:
 *   • A NUL-joined menu identity is NOT a POS product key (real POS keys are
 *     Cultivera product ids, all digits). It is stored as NULL in
 *     `kb_products.pos_product_key`; the row is found by its real unique
 *     identity (brand_slug, product_slug, variant_label). This matches the
 *     crawler, whose rows also carry pos_product_key NULL.
 *   • Free text (description, names) has any NUL stripped. Nothing else changes.
 *   • The media-usage entity id keeps the identity readable and unique by
 *     swapping NUL for "/" (slugs are dashed and never contain "/").
 */

const NUL_RE = /\u0000/g;

/** True when a string contains a byte PostgreSQL text refuses. */
export function hasNul(value: string | null | undefined): boolean {
  return typeof value === "string" && value.includes("\u0000");
}

/** Strip NUL from free text. Null/undefined pass through as null. */
export function pgSafeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value).replace(NUL_RE, "");
}

/**
 * The value to store in kb_products.pos_product_key: the key itself when it is
 * storable and non-empty, otherwise NULL (a NUL-joined menu identity is not a
 * POS key, and inventing a substitute would create a key nothing else uses).
 */
export function posKeyForStorage(key: string | null | undefined): string | null {
  const k = (key ?? "").trim();
  if (!k || hasNul(k)) return null;
  return k;
}

/** media_usages.entity_id for a KB identity: NUL becomes "/". */
export function usageEntityId(entityId: string): string {
  return String(entityId).replace(NUL_RE, "/");
}

/**
 * Turn a database error into the short sentence the save button shows, so a
 * failed write is never again reported only as "did not complete".
 */
export function kbWriteErrorReason(error: { message?: string | null; code?: string | null } | null | undefined): string {
  const msg = (error?.message ?? "").trim();
  const code = (error?.code ?? "").trim();
  if (!msg && !code) return "The Knowledge Base write did not complete.";
  return `The Knowledge Base refused the write${code ? ` (${code})` : ""}: ${msg || "no message"}`.slice(0, 300);
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

export function __runWritebackTextCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`writeback-text-core self-test failed: ${msg}`);
    n += 1;
  };
  const menuKey = ["subx", "blue-nerdz", ""].join("\u0000");

  ok(hasNul(menuKey), "menu identity carries NUL");
  ok(!hasNul("16203787111862507"), "a real POS key has no NUL");
  ok(!hasNul(null) && !hasNul(undefined) && !hasNul(""), "empty values have no NUL");

  ok(posKeyForStorage(menuKey) === null, "NUL-joined menu identity is stored as NULL");
  ok(posKeyForStorage("16203787111862507") === "16203787111862507", "real POS key kept");
  ok(posKeyForStorage("  2019412  ") === "2019412", "POS key trimmed");
  ok(posKeyForStorage("") === null && posKeyForStorage(null) === null, "empty key -> NULL");

  ok(pgSafeText("Fruity\u0000 and loud") === "Fruity and loud", "NUL stripped from prose");
  ok(pgSafeText("plain text") === "plain text", "clean prose unchanged");
  ok(pgSafeText(null) === null && pgSafeText(undefined) === null, "null prose stays null");
  ok(!hasNul(pgSafeText("\u0000\u0000x\u0000")), "every NUL removed");

  ok(usageEntityId(menuKey) === "subx/blue-nerdz/", "usage id readable, NUL -> /");
  ok(usageEntityId("3b8da870-a96a-470a-8351-30573af08a12") === "3b8da870-a96a-470a-8351-30573af08a12", "uuid usage id unchanged");
  ok(usageEntityId(["a", "b", "c"].join("\u0000")) !== usageEntityId(["a", "bc", ""].join("\u0000")), "distinct identities stay distinct");

  ok(kbWriteErrorReason(null) === "The Knowledge Base write did not complete.", "no error -> old sentence");
  ok(
    kbWriteErrorReason({ code: "22P05", message: "unsupported Unicode escape sequence" }).includes("22P05"),
    "error code shown",
  );
  ok(kbWriteErrorReason({ message: "x".repeat(1000) }).length <= 300, "reason capped");
  return { passed: n, failed: 0 };
}
