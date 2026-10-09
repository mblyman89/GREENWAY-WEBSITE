/**
 * src/lib/catalog/menu-kb-link-server.ts  (R25 C - the menu item linked to
 * its knowledge-base product)
 *
 * The I/O half of menu-kb-link-core: read the cards' lots, plan the links,
 * and give every menu_items writer ONE insert that stamps them. Also the
 * owner-pressed backfill for cards published before R25 C.
 *
 * NEVER WORSE THAN BEFORE:
 *   * A failed / pre-0234 lot read = no links; the menu still builds exactly
 *     as it did (a row with no link carries no kb_product_id key at all).
 *   * A pre-0234 menu_items table (42703 / PGRST204 naming the column, via
 *     isMissingIdentityColumnError) = the batch is retried WITHOUT the link.
 *     Any other insert error is returned unchanged for the caller's existing
 *     handling: it is never retried away.
 *   * Backfill writes are fill-only (`... is kb_product_id null`), so a
 *     re-run, or a racing writer, never overwrites a link.
 *   * R35 #6: a pre-0254 menu_items table (no effects / aroma_notes) is the
 *     same story for the two sensory columns (isMissingSensoryColumnError):
 *     the batch is retried WITHOUT them, and the card page keeps using the
 *     knowledge base. Both fallbacks compose: a database missing BOTH
 *     migrations is retried at most twice, each time stripping only the set
 *     the error actually named.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { isMissingIdentityColumnError, withoutIdentityColumns } from "@/lib/catalog/identity-columns-core";
import { hasSensoryColumns, isMissingSensoryColumnError, withoutSensoryColumns } from "@/lib/pos/menu-sensory-core";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import {
  MENU_KB_LINK_LOT_COLUMNS,
  cardsNeedingLots,
  indexLinkLots,
  lotKeysForCards,
  menuKbBackfillMessage,
  planMenuKbLinkBackfill,
  planMenuKbLinks,
  withMenuKbLink,
  type BackfillCard,
  type MenuKbLinkCard,
  type MenuKbLinkLot,
  type MenuKbLinkSummary,
} from "@/lib/catalog/menu-kb-link-core";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type DbError = { code?: string | null; message?: string | null } | null;

const LOT_CHUNK = 200;
const PAGE = 1000;
const UPDATE_CHUNK = 200;

/** The card lots for these keys; null = the read failed or 0234 is missing. */
export async function loadLinkLots(admin: AdminClient, keys: string[]): Promise<MenuKbLinkLot[] | null> {
  if (keys.length === 0) return [];
  let failed = false;
  try {
    const rows = await chunkedIn<string, MenuKbLinkLot>(
      keys,
      async (chunk, from, to) => {
        if (failed) return [];
        const { data, error } = await admin
          .from("inventory_lots")
          .select(MENU_KB_LINK_LOT_COLUMNS)
          .in("pos_product_key", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          failed = true;
          return [];
        }
        return (data as unknown as MenuKbLinkLot[] | null) ?? [];
      },
      { chunkSize: LOT_CHUNK, concurrency: MENU_READ_CONCURRENCY },
    );
    return failed ? null : rows;
  } catch {
    return null;
  }
}

export type MenuKbLinkPlan = {
  links: Map<string, string>;
  summary: MenuKbLinkSummary;
  /** True when the lot read failed: links from priors only, nothing invented. */
  lotReadFailed: boolean;
};

/** Plan the kb_product_id for every card a writer is about to insert. */
export async function planMenuKbLinksForCards(admin: AdminClient, cards: MenuKbLinkCard[]): Promise<MenuKbLinkPlan> {
  const need = cardsNeedingLots(cards);
  const lots = need.length > 0 ? await loadLinkLots(admin, lotKeysForCards(need)) : [];
  const { links, summary } = planMenuKbLinks(cards, indexLinkLots(lots ?? []));
  return { links, summary, lotReadFailed: lots === null };
}

/**
 * The shared menu_items insert. Stamps each row's link (when it has one) and
 * returns exactly what `.insert(rows).select("id, source_item_id")` returns.
 *
 * Pre-migration safety (Parallel Change): when the insert fails because a
 * 0234 identity column or a 0254 sensory column does not exist yet, the batch
 * is retried once per missing set, without exactly that set. Any other error
 * is returned unchanged - never retried away.
 */
export async function insertMenuItemsWithKbLink<R extends Record<string, unknown> & { source_item_id: string }>(
  admin: AdminClient,
  rows: R[],
  links: Map<string, string>,
): Promise<{
  data: { id: string; source_item_id: string }[] | null;
  error: DbError;
  retriedWithoutLink: boolean;
  retriedWithoutSensory: boolean;
}> {
  let payload: Record<string, unknown>[] = rows.map((r) => withMenuKbLink(r, links, r.source_item_id));
  let retriedWithoutLink = false;
  let retriedWithoutSensory = false;
  let res = await admin.from("menu_items").insert(payload).select("id, source_item_id");
  // At most one retry per migration set (0234, 0254), so never more than 3 calls.
  for (let attempt = 0; attempt < 2 && res.error; attempt += 1) {
    const anyLink = payload.some((r) => Object.prototype.hasOwnProperty.call(r, "kb_product_id"));
    const anySensory = payload.some((r) => hasSensoryColumns(r));
    if (!retriedWithoutLink && anyLink && isMissingIdentityColumnError("menu_items", res.error)) {
      payload = payload.map((r) => withoutIdentityColumns("menu_items", r));
      retriedWithoutLink = true;
    } else if (!retriedWithoutSensory && anySensory && isMissingSensoryColumnError(res.error)) {
      payload = payload.map((r) => withoutSensoryColumns(r));
      retriedWithoutSensory = true;
      console.warn(
        "[menu-items] effects / aroma_notes columns are not in the database yet (migration 0254): this batch was saved without them; the product pages keep the knowledge-base wording.",
      );
    } else {
      break;
    }
    res = await admin.from("menu_items").insert(payload).select("id, source_item_id");
  }
  return {
    data: (res.data as { id: string; source_item_id: string }[] | null) ?? null,
    error: res.error,
    retriedWithoutLink,
    retriedWithoutSensory,
  };
}

/** One console line per writer batch (no PII: counts only). */
export function logMenuKbLinkPlan(tag: string, plan: MenuKbLinkPlan): void {
  const s = plan.summary;
  console.info(
    `[${tag}] menu kb link: linked ${s.linked}, kept ${s.kept}, no link ${s.noLink}, conflicts ${s.conflicts}` +
      (plan.lotReadFailed ? " (lot read failed: no new links this batch)" : ""),
  );
}

// --- Backfill ---------------------------------------------------------------------

export type MenuKbBackfillResult =
  | { ok: true; stamped: number; alreadyLinked: number; noLink: number; conflicts: number; failed: number; message: string }
  | { ok: false; error: string };

/**
 * Link every PUBLISHED menu card that has no link yet, from its lots. Reads
 * the whole published menu with a completeness verdict (a partial read
 * refuses), then fill-only conditional updates grouped by kb row.
 */
export async function runMenuKbLinkBackfill(admin?: AdminClient): Promise<MenuKbBackfillResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  let client: AdminClient;
  try {
    client = admin ?? createSupabaseAdminClient();
  } catch {
    return { ok: false, error: "Supabase is not configured." };
  }
  try {
    const version = await getPublishedVersion();
    if (!version) return { ok: false, error: "No published menu yet: publish a menu first, then link it." };

    let missingColumn = false;
    const menu = await pagedAllChecked<{ id: string; source_item_id: string; kb_product_id: string | null }>(
      async (from, to) => {
        const { data, error } = await client
          .from("menu_items")
          .select("id, source_item_id, kb_product_id")
          .eq("menu_version_id", version.id)
          .order("id", { ascending: true })
          .range(from, to);
        if (error && isMissingIdentityColumnError("menu_items", error)) missingColumn = true;
        return { rows: (data as unknown as { id: string; source_item_id: string; kb_product_id: string | null }[] | null) ?? [], ok: !error };
      },
      { pageSize: PAGE },
    );
    if (missingColumn) {
      return { ok: false, error: "The menu link column is not in the database yet (migration 0234). Nothing was changed." };
    }
    if (!menu.verdict.complete) {
      return { ok: false, error: `Could not read the whole live menu (${menu.verdict.message}). Nothing was changed; try again.` };
    }

    // Variants only for the cards that still need a link.
    const open = menu.rows.filter((r) => !r.kb_product_id);
    let variantFailed = false;
    const variants = await chunkedIn<string, { menu_item_id: string; source_variant_id: string }>(
      open.map((r) => r.id),
      async (chunk, from, to) => {
        if (variantFailed) return [];
        const { data, error } = await client
          .from("menu_variants")
          .select("menu_item_id, source_variant_id")
          .in("menu_item_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          variantFailed = true;
          return [];
        }
        return (data as { menu_item_id: string; source_variant_id: string }[] | null) ?? [];
      },
      { chunkSize: LOT_CHUNK, concurrency: MENU_READ_CONCURRENCY },
    );
    if (variantFailed) return { ok: false, error: "Could not read the menu sizes. Nothing was changed; try again." };
    const variantIds = new Map<string, string[]>();
    for (const v of variants) {
      const list = variantIds.get(v.menu_item_id) ?? [];
      list.push(v.source_variant_id);
      variantIds.set(v.menu_item_id, list);
    }

    const cards: BackfillCard[] = menu.rows.map((r) => ({
      id: r.id,
      source_item_id: r.source_item_id,
      kb_product_id: r.kb_product_id,
      variantIds: variantIds.get(r.id) ?? [],
    }));
    const lots = await loadLinkLots(
      client,
      lotKeysForCards(cards.filter((c) => !c.kb_product_id).map((c) => ({ source_item_id: c.source_item_id, variantIds: c.variantIds }))),
    );
    if (lots === null) return { ok: false, error: "Could not read the inventory lots. Nothing was changed; try again." };

    const plan = planMenuKbLinkBackfill(cards, indexLinkLots(lots));
    let stamped = 0;
    let failed = 0;
    for (const [kbId, ids] of plan.updates) {
      for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
        const chunk = ids.slice(i, i + UPDATE_CHUNK);
        const { data, error } = await client
          .from("menu_items")
          .update({ kb_product_id: kbId })
          .in("id", chunk)
          .is("kb_product_id", null)
          .select("id");
        if (error) failed += chunk.length;
        else stamped += Array.isArray(data) ? data.length : 0;
        // Fewer rows than asked = someone linked them first: not ours, not a failure.
      }
    }
    const counts = { stamped, alreadyLinked: plan.alreadyLinked, noLink: plan.noLink, conflicts: plan.conflicts, failed };
    return { ok: true, ...counts, message: menuKbBackfillMessage(counts) };
  } catch (err) {
    return { ok: false, error: `Linking failed: ${err instanceof Error ? err.message : String(err)}. Nothing further was changed.` };
  }
}
