"use server";
/**
 * src/components/admin/products/remove-text-queue-actions.ts  (D244 R-11)
 *
 * Owner (round 4, verbatim): "the remove text feature, I would like it to be
 * available on the copilot feature as well as the brand kit. ... I want to
 * draw a box on all product images, then click the remove text button. that
 * way I can quickly queue up several images to feed to flux to fix one after
 * the next."
 *
 * The queue's three calls. Same work as the product editor's actions, but the
 * scope can be one product card (Copilot) or one vendor (Vendor kits). All
 * need products.enrich and write an audit row. None attaches anything: the
 * person presses Attach (Copilot) or "Use as the kit photo" (Vendor kits).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { findTextOnPhoto, pollTextErase, startTextErase, type ErasePollOut, type FindTextOut, type StartEraseOut } from "@/lib/enrichment/text-erase-server";
import { cleanQueueScope, parseEraseBoxes, type EraseProduct, type QueueScope } from "@/lib/enrichment/text-erase-core";

const id = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
const txt = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
/** The id the AI usage log and the FLUX log file the work under. */
const logKey = (s: QueueScope) => (s.kind === "vendor" ? `vendor:${s.id}` : s.id);
const entityType = (s: QueueScope) => (s.kind === "vendor" ? "vendor" : "product");

function cleanProduct(p: unknown): EraseProduct {
  const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  return {
    name: txt(r.name, 200) || "this product",
    brand: txt(r.brand, 120) || null,
    strainName: txt(r.strainName, 120) || null,
    vendor: txt(r.vendor, 120) || null,
    category: txt(r.category, 80) || null,
  };
}

export async function queueFindTextAction(scope: QueueScope, mediaId: string, product: EraseProduct): Promise<FindTextOut> {
  const session = await requirePermission("products.enrich");
  const s = cleanQueueScope(scope);
  const m = id(mediaId);
  if (!s || !m) return { ok: false, error: "Missing product or photo." };
  const out = await findTextOnPhoto({ mediaId: m, product: cleanProduct(product), productKey: logKey(s), actorId: session.userId });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.remove_text_found",
    entityType: entityType(s),
    entityId: s.id,
    after: { mediaId: m, via: "queue", ok: out.ok, found: out.ok ? out.found.length : 0 },
  }).catch(() => {});
  return out;
}

export async function queueStartEraseAction(scope: QueueScope, mediaId: string, boxesJson: string, surface: string): Promise<StartEraseOut> {
  const session = await requirePermission("products.enrich");
  const s = cleanQueueScope(scope);
  const m = id(mediaId);
  if (!s || !m) return { ok: false, error: "Missing product or photo." };
  const boxes = parseEraseBoxes(boxesJson);
  const out = await startTextErase({ mediaId: m, boxes, surface: txt(surface, 80), productKey: logKey(s), actorId: session.userId, actorEmail: session.email });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.remove_text_started",
    entityType: entityType(s),
    entityId: s.id,
    after: { mediaId: m, via: "queue", ok: out.ok, boxes: boxes.length, error: out.ok ? null : out.error.slice(0, 200) },
  }).catch(() => {});
  return out;
}

export async function queuePollEraseAction(scope: QueueScope, pollingUrl: string, originalId: string): Promise<ErasePollOut> {
  const session = await requirePermission("products.enrich");
  const s = cleanQueueScope(scope);
  const m = id(originalId);
  if (!s || !m) return { state: "failed", error: "Missing product or photo." };
  try {
    const out = await pollTextErase({ pollingUrl: String(pollingUrl ?? "").slice(0, 600), originalId: m, actorId: session.userId });
    if (out.state === "ready") {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "product.remove_text_saved",
        entityType: "media_asset",
        entityId: out.mediaId,
        after: { scope: s.kind, scopeId: s.id, via: "queue", originalId: m, published: out.published },
      }).catch(() => {});
    }
    return out;
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "FLUX check failed." };
  }
}
