"use server";
/**
 * R74 S27 (owner round 12): fix buttons for the bad product queue.
 *
 * One action, two fixes, both REUSED from round 11:
 *  - fix=hide  -> applyProductVisibility(key, "hide") (the product page's
 *                 reversible Visibility write, S22) + the product page set to
 *                 Always hide with the reason, so saving it never un-hides.
 *  - fix=never -> addNeverDiscount (the store-wide never-discount list, S23).
 *
 * The queue is RE-READ at press time and the press is checked against it
 * (pickQueueFix): a stale page or a hand-made form can never change a product
 * that is not in the queue for a fix that applies. A partial queue read
 * refuses the press (fail closed). Every failure is named in the banner.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { can } from "@/lib/auth/roles";
import { applyProductVisibility } from "@/lib/enrichment/product-visibility-store";
import { ensureEnrichment, updateEnrichment } from "@/lib/enrichment/store";
import { addNeverDiscount } from "@/lib/promotions/promotions-store";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { loadBadProductQueue } from "@/lib/promotions/bad-product-queue";
import {
  pickQueueFix,
  queueFixMessage,
  queueHideReason,
  queueNeverReason,
  QUEUE_KINDS,
  type QueueFix,
  type QueueFixOutcome,
  type QueueKind,
} from "@/lib/promotions/bad-product-queue-core";

const BASE = "/admin/promotions/bad-products";

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

export async function fixBadProductsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("promotions.manage");
  const back = (tone: "ok" | "error", text: string): never =>
    redirect(`${BASE}?fixTone=${tone}&fix=${encodeURIComponent(text)}`);

  const fixRaw = str(formData, "fix");
  if (fixRaw !== "hide" && fixRaw !== "never") back("error", "Nothing was changed: unknown fix.");
  const fix = fixRaw as QueueFix;
  if (fix === "hide" && !can(session.profile.role, "products.enrich")) {
    back("error", "Nothing was hidden: hiding a product from the menu needs the Enrich products permission.");
  }

  const load = await loadBadProductQueue();
  if (!load.complete) {
    back("error", `Nothing was changed: the queue could not be read in full (${load.problems.join("; ")}). Reload and try again.`);
  }
  const allKind = str(formData, "all");
  const requested: string[] | { all: QueueKind } = allKind
    ? { all: (QUEUE_KINDS.includes(allKind as QueueKind) ? allKind : "bogus") as QueueKind }
    : formData.getAll("key").map((k) => String(k));
  const pick = pickQueueFix(requested, load.queue, fix);
  if (!pick.ok) back("error", pick.error);
  const picks = pick.ok ? pick.picks : [];

  const outcome: QueueFixOutcome = { fix, done: [], already: [], failed: [] };
  for (const row of picks) {
    const ref = { key: row.key, name: row.name };
    if (fix === "hide") {
      const res = await applyProductVisibility(row.key, "hide");
      if (!res.ok) {
        outcome.failed.push({ ...ref, error: res.error });
        continue;
      }
      if (res.changed.length === 0) outcome.already.push(ref);
      else {
        outcome.done.push(ref);
        await recordAudit({
          actorId: session.userId,
          actorEmail: session.email,
          action: "product.visibility_changed",
          entityType: "product",
          entityId: row.key,
          before: { rows: res.changed.map((r) => ({ versionId: r.versionId, versionStatus: r.versionStatus, ...r.before })) },
          after: {
            choice: "hide",
            source: "bad_product_queue",
            problems: row.kinds,
            rows: res.changed.map((r) => ({ versionId: r.versionId, versionStatus: r.versionStatus, ...r.after })),
          },
        });
      }
      try {
        await ensureEnrichment(row.key, { name: row.name }, session.userId);
        await updateEnrichment(row.key, { hidden_override: true, hidden_reason: queueHideReason(row.kinds) }, session.userId);
      } catch (e) {
        outcome.failed.push({
          ...ref,
          error: `hidden on the menu, but its product page still says Inherit POS (${e instanceof Error ? e.message : String(e)}); set Visibility to Always hide there`,
        });
      }
    } else {
      const reason = queueNeverReason(row.kinds);
      const res = await addNeverDiscount(row.key, row.name, reason, session.userId);
      if (!res.ok) {
        outcome.failed.push({ ...ref, error: res.error });
        continue;
      }
      if (res.alreadyListed) {
        outcome.already.push(ref);
        continue;
      }
      outcome.done.push(ref);
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "promotion.never_discount.add",
        entityType: "promotion_never_discount",
        entityId: res.id,
        after: { productKey: row.key, productName: row.name, reason, source: "bad_product_queue", problems: row.kinds },
      });
    }
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "promotion.bad_products_fixed",
    entityType: "promotion",
    entityId: "bad-product-queue",
    after: {
      fix,
      requested: Array.isArray(requested) ? requested.length : `all:${requested.all}`,
      done: outcome.done.map((r) => r.key),
      already: outcome.already.map((r) => r.key),
      failed: outcome.failed.map((f) => ({ key: f.key, error: f.error })),
    },
  });

  if (outcome.done.length > 0) {
    if (fix === "hide") revalidatePublicMenuSurfaces();
    // Prices depend on the never-discount list (cart, cards) and visibility.
    revalidatePath("/(site)", "layout") /* PERF-S6: public site only, not /admin */;
  }
  revalidatePath(BASE);
  revalidatePath("/admin/promotions");
  revalidatePath("/admin/products");
  const msg = queueFixMessage(outcome);
  back(msg.tone, msg.text);
}
