"use server";
/**
 * src/app/admin/products/[key]/remove-text/actions.ts  (D244 round 3, slice R-9)
 *
 * The three calls the "Remove text" editor makes. All need products.enrich.
 *   findTextAction  - vision model READS the photo (boxes + keep/remove advice).
 *   startEraseAction - FLUX Fill repaints the boxes (submit only).
 *   pollEraseAction - one poll; when ready a NEW library photo is saved.
 * None of them attaches anything: the person presses Attach / Attach as cover
 * on the before/after view (attachMatchedMedia, source "text-removed").
 * D244 R-22: publishErasedAction - the person's Publish press on a
 * text-removed draft, so the Copilot can suggest it.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { cleanKey } from "@/lib/enrichment/detail-nav-core";
import { findTextOnPhoto, pollMode, pollTextErase, publishErasedPhoto, startTextErase, type ErasedPublishOut, type ErasePollOut, type FindTextOut, type StartEraseOut } from "@/lib/enrichment/text-erase-server";
import { parseEraseBoxes, type EraseProduct } from "@/lib/enrichment/text-erase-core";

const id = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
const txt = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

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

export async function findTextAction(key: string, mediaId: string, product: EraseProduct): Promise<FindTextOut> {
  const session = await requirePermission("products.enrich");
  const k = cleanKey(key);
  const m = id(mediaId);
  if (!k || !m) return { ok: false, error: "Missing product or photo." };
  const out = await findTextOnPhoto({ mediaId: m, product: cleanProduct(product), productKey: k, actorId: session.userId });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.remove_text_found",
    entityType: "product",
    entityId: k,
    after: { mediaId: m, ok: out.ok, found: out.ok ? out.found.length : 0, advisedRemove: out.ok ? out.found.filter((f) => f.advice === "remove").length : 0 },
  }).catch(() => {});
  return out;
}

export async function startEraseAction(key: string, mediaId: string, boxesJson: string, surface: string, mode: string = "letters"): Promise<StartEraseOut> {
  const session = await requirePermission("products.enrich");
  const k = cleanKey(key);
  const m = id(mediaId);
  if (!k || !m) return { ok: false, error: "Missing product or photo." };
  const boxes = parseEraseBoxes(boxesJson);
  const out = await startTextErase({ mediaId: m, boxes, surface: txt(surface, 80), mode: pollMode(mode), productKey: k, actorId: session.userId, actorEmail: session.email });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.remove_text_started",
    entityType: "product",
    entityId: k,
    after: { mediaId: m, ok: out.ok, boxes: boxes.length, mode: out.ok ? out.mode : pollMode(mode), error: out.ok ? null : out.error.slice(0, 200) },
  }).catch(() => {});
  return out;
}

export async function pollEraseAction(key: string, pollingUrl: string, originalId: string, boxesJson = "[]", mode: string = "letters"): Promise<ErasePollOut> {
  const session = await requirePermission("products.enrich");
  const k = cleanKey(key);
  const m = id(originalId);
  if (!k || !m) return { state: "failed", error: "Missing product or photo." };
  try {
    const out = await pollTextErase({ pollingUrl: String(pollingUrl ?? "").slice(0, 600), originalId: m, actorId: session.userId, boxes: String(boxesJson ?? "").slice(0, 4000), mode: pollMode(mode) });
    if (out.state === "ready") {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "product.remove_text_saved",
        entityType: "media_asset",
        entityId: out.mediaId,
        after: { productKey: k, originalId: m, published: out.published },
      }).catch(() => {});
    }
    return out;
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "FLUX check failed." };
  }
}

export async function publishErasedAction(key: string, mediaId: string): Promise<ErasedPublishOut> {
  const session = await requirePermission("products.enrich");
  const k = cleanKey(key);
  const m = id(mediaId);
  if (!k || !m) return { ok: false, error: "Missing product or photo." };
  const out = await publishErasedPhoto(m, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.remove_text_published",
    entityType: "media_asset",
    entityId: m,
    after: { productKey: k, ok: out.ok, error: out.ok ? null : out.error },
  }).catch(() => {});
  return out;
}
