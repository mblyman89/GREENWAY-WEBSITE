"use server";

/**
 * src/app/admin/products/vendor-kits/actions.ts  (D244 R-8)
 *
 * Vendor kits: one generic on-brand photo for a vendor's like-kind
 * products. Both buttons need products.enrich. "Ask the AI" only READS (the
 * vision model checks the top photos for a printed product name; the
 * verdicts ride back in the URL). "Apply" is the only write and is one
 * person's press: it attaches to the ticked cards, sets the cover when a card
 * has none (or always, if asked), runs the photo-first publish rule and
 * writes an audit row per card plus one for the kit.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { applyKitPhoto, checkKitPhotos } from "@/lib/enrichment/vendor-kit-server";
import { KIT_AI_CHECK_MAX, KIT_APPLY_MAX, decodeKitVerdicts, encodeKitVerdicts, kitUrl, parseKitApplyMode, parseKitGroupBy } from "@/lib/enrichment/vendor-kit-core";

const str = (v: FormDataEntryValue | null, n = 200) => String(v ?? "").trim().slice(0, n);

function ctx(fd: FormData) {
  return { vendor: str(fd.get("vendor"), 100), by: parseKitGroupBy(fd.get("by")), group: str(fd.get("group"), 200), chk: str(fd.get("chk"), 2000) };
}

const ok = (note: string) => `saved=1&note=${encodeURIComponent(note)}`;
const err = (msg: string) => `error=${encodeURIComponent(msg)}`;

/** "Ask the AI which photo is generic" — reads the top photos with the vision model. */
export async function kitCheckAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  const ids = formData.getAll("mediaId").map((v) => str(v, 64)).filter(Boolean).slice(0, KIT_AI_CHECK_MAX);
  const products = formData.getAll("product").map((v) => str(v, 120)).filter(Boolean).slice(0, 12);
  const out = await checkKitPhotos({
    vendorLabel: str(formData.get("vendorLabel"), 120),
    groupLabel: str(formData.get("groupLabel"), 120),
    products,
    mediaIds: ids,
    actorId: session.userId,
  });
  if (!out.ok) redirect(kitUrl({ ...c, flash: err(out.error), hash: "photos" }));
  const merged = new Map([...decodeKitVerdicts(c.chk), ...out.verdicts]);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.vendor_kit_checked",
    entityType: "vendor",
    entityId: c.vendor,
    after: { group: c.group, checked: [...out.verdicts.keys()], generic: [...out.verdicts].filter(([, v]) => v.generic === "yes").map(([k]) => k), failed: out.failed },
  });
  const generic = [...out.verdicts.values()].filter((v) => v.generic === "yes").length;
  const note = `The AI looked at ${out.verdicts.size} photo${out.verdicts.size === 1 ? "" : "s"}: ${generic} generic.${out.failed ? ` ${out.failed} could not be read.` : ""} The list is re-ranked.`;
  redirect(kitUrl({ ...c, chk: encodeKitVerdicts(merged), flash: ok(note), hash: "photos" }));
}

/** "Apply to the ticked products" — the one write. */
export async function kitApplyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  const mediaId = str(formData.get("mediaId"), 64);
  const keys = formData.getAll("key").map((v) => str(v, 300)).filter(Boolean).slice(0, KIT_APPLY_MAX);
  if (!c.vendor || !mediaId) redirect(kitUrl({ ...c, flash: err("Pick a photo first."), hash: "photos" }));
  if (keys.length === 0) redirect(kitUrl({ ...c, photo: mediaId, flash: err("Tick at least one product."), hash: "products" }));
  const out = await applyKitPhoto({
    vendorId: c.vendor,
    mediaId,
    keys,
    mode: parseKitApplyMode(formData.get("mode")),
    groupLabel: str(formData.get("groupLabel"), 120),
    actor: { userId: session.userId, email: session.email },
  });
  if (!out.ok) redirect(kitUrl({ ...c, photo: mediaId, flash: err(out.error), hash: "products" }));
  revalidatePath("/admin/products");
  revalidatePath("/admin/products/vendor-kits");
  for (const k of keys.slice(0, 50)) revalidatePath(`/admin/products/${encodeURIComponent(k)}`);
  if (out.attached > 0) revalidatePublicMenuSurfaces();
  redirect(kitUrl({ ...c, photo: mediaId, flash: ok(out.message), hash: "products" }));
}
