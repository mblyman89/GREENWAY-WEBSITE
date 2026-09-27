/**
 * src/lib/inventory/kb-link-store.ts  (S05 - Phase 1, Ring 1)
 *
 * The finalize "link" step: AFTER the onboarding drafts are seeded and the
 * manifest KB write-back has settled (both run inside finalize's
 * Promise.allSettled), point each accepted lot - and the drafts seeded from
 * it - at its kb_products row, and stamp the lot's identity_key.
 *
 * Why after, not inside, the fan-out: the KB write-back is what CREATES the
 * kb_products rows for new products. Linking concurrently would race it and
 * miss exactly the rows this manifest produced.
 *
 * Usage discipline (standing rules): no new polls/crons; named columns; the
 * kb_products read is bounded to this manifest's product slugs; writes are
 * one statement per distinct (identity, kb id) pair, never one per lot.
 *
 * Pre-migration safe: 0234 may not be applied yet (owner applies migrations).
 * The first missing-identity-column error stops the step with an honest
 * timeline note; nothing else about finalize is affected.
 *
 * NEVER GUESS / never destructive: a lot with no KB match keeps any link it
 * already has; a draft's kb_product_id is only filled when empty.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  IDENTITY_MIGRATION,
  isMissingIdentityColumnError,
  type DbErrorLike,
} from "@/lib/catalog/identity-columns-core";
import {
  KB_LINK_EVENT,
  kbLinkEventNote,
  kbLinkSkippedPreMigrationNote,
  lotLinkPatch,
  planKbLinks,
  type KbRow,
  type LotIdentityStamp,
} from "@/lib/inventory/identity-stamp-core";

/** Named kb_products columns - kb_products.identity_key is NOT read (0234). */
export const KB_LINK_COLUMNS = "id, brand_slug, product_slug, variant_label";

export type KbLinkResult =
  | { status: "skipped"; reason: "no-lots" | "not-configured" }
  | { status: "pre-migration"; note: string }
  | {
      status: "linked";
      note: string;
      products: number;
      linkedProducts: number;
      linkedLots: number;
      failedWrites: number;
    }
  | { status: "error"; error: string };

/**
 * Link one manifest's lots + drafts to kb_products and log ONE timeline
 * event. Never throws (the caller is finalize; a link hiccup must not break
 * it) - every failure comes back as a result value.
 */
export async function linkKbProductsToDrafts(
  manifestId: string,
  lotIdentities: LotIdentityStamp[] | undefined,
  actorId: string | null,
  opts: { restockHints?: number } = {},
): Promise<KbLinkResult> {
  if (!isSupabaseServiceConfigured) return { status: "skipped", reason: "not-configured" };
  const lots = (lotIdentities ?? []).filter((l) => l.promotable);
  if (lots.length === 0) return { status: "skipped", reason: "no-lots" };

  try {
    const admin = createSupabaseAdminClient();

    // 1) kb_products candidates: only this manifest's product slugs (chunked).
    //    planKbLinks then requires all three natural-key parts to match.
    const slugs = Array.from(
      new Set(lots.map((l) => l.kb?.product_slug).filter((s): s is string => Boolean(s))),
    );
    const kbRows: KbRow[] = [];
    const CHUNK = 200;
    for (let i = 0; i < slugs.length; i += CHUNK) {
      const { data, error } = await admin
        .from("kb_products")
        .select(KB_LINK_COLUMNS)
        .in("product_slug", slugs.slice(i, i + CHUNK));
      if (error) return await failed(manifestId, actorId, `knowledge base read failed: ${error.message}`);
      kbRows.push(...(((data as unknown as KbRow[] | null) ?? [])));
    }

    const plan = planKbLinks({ lots, kbRows });

    // 2) writes: one lot UPDATE per group (+ one draft UPDATE when linked).
    let failedWrites = 0;
    for (const g of plan.groups) {
      const { error: lotErr } = await admin
        .from("inventory_lots")
        .update(lotLinkPatch(g, actorId))
        .eq("manifest_id", manifestId)
        .in("id", g.lotIds);
      if (lotErr) {
        if (isMissingIdentityColumnError("inventory_lots", lotErr)) return await preMigration(manifestId, actorId);
        failedWrites += 1;
        console.error("[kb-link] lot link write failed:", lotErr.message);
        continue;
      }
      if (!g.kbProductId) continue;
      const { error: draftErr } = await admin
        .from("catalog_product_drafts")
        .update({ kb_product_id: g.kbProductId, updated_by: actorId })
        .eq("manifest_id", manifestId)
        .in("lot_id", g.lotIds)
        .is("kb_product_id", null);
      if (draftErr) {
        if (isMissingIdentityColumnError("catalog_product_drafts", draftErr)) {
          return await preMigration(manifestId, actorId);
        }
        failedWrites += 1;
        console.error("[kb-link] draft link write failed:", draftErr.message);
      }
    }

    const note = kbLinkEventNote({
      products: plan.products,
      linkedProducts: plan.linkedProducts,
      noNameLots: plan.noNameLots,
      restockHints: opts.restockHints ?? 0,
      failedWrites,
    });
    await logEvent(admin, manifestId, KB_LINK_EVENT, note, actorId);
    return {
      status: "linked",
      note,
      products: plan.products,
      linkedProducts: plan.linkedProducts,
      linkedLots: plan.linkedLots,
      failedWrites,
    };
  } catch (err) {
    return await failed(manifestId, actorId, err instanceof Error ? err.message : String(err));
  }
}

async function preMigration(manifestId: string, actorId: string | null): Promise<KbLinkResult> {
  const note = kbLinkSkippedPreMigrationNote(IDENTITY_MIGRATION);
  await logEvent(null, manifestId, KB_LINK_EVENT, note, actorId);
  return { status: "pre-migration", note };
}

async function failed(manifestId: string, actorId: string | null, error: string): Promise<KbLinkResult> {
  console.error("[kb-link] link step failed:", error);
  await logEvent(
    null,
    manifestId,
    KB_LINK_EVENT,
    `Knowledge base link FAILED: ${error.slice(0, 500)}. Lots and drafts were not linked; nothing else was affected.`,
    actorId,
  );
  return { status: "error", error };
}

/** Best-effort manifest_events insert (never throws). */
async function logEvent(
  admin: ReturnType<typeof createSupabaseAdminClient> | null,
  manifestId: string,
  eventType: string,
  note: string,
  actorId: string | null,
): Promise<void> {
  try {
    const client = admin ?? createSupabaseAdminClient();
    const { error } = (await client.from("manifest_events").insert({
      manifest_id: manifestId,
      event_type: eventType,
      note,
      actor_id: actorId,
    })) as { error: DbErrorLike };
    if (error) console.error("[kb-link] manifest_events insert failed:", error.message);
  } catch (err) {
    console.error("[kb-link] manifest_events insert threw:", err);
  }
}
