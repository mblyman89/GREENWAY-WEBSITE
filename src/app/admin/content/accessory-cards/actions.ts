"use server";
/**
 * OI-ACC S4 - Website > Accessory Cards: save / publish the shop card words
 * and pictures for every Other Inventory type (copied from the Merch Studio
 * category-card editor: content.edit, re-normalized server-side, audited,
 * draft -> publish, publish revalidates the shop).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { saveNcTypeCards } from "@/lib/noncannabis/types-store";
import { saveOnlineNcEnabled } from "@/lib/noncannabis/online-store";

const BACK = "/admin/content/accessory-cards";

type SentCard = { value: string; label: string; text: string; image: string; sort: number };

function parseCards(raw: string): SentCard[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c, i) => ({ value: String(c.value ?? ""), label: String(c.label ?? ""), text: String(c.text ?? ""), image: String(c.image ?? ""), sort: (i + 1) * 10 }))
      .filter((c) => /^[a-z0-9][a-z0-9_]{0,39}$/.test(c.value))
      .slice(0, 200);
  } catch {
    return [];
  }
}

async function cardsAction(formData: FormData, publish: boolean): Promise<void> {
  const session = await requirePermission("content.edit");
  const cards = parseCards(String(formData.get("cards") ?? ""));
  if (!cards.length) redirect(`${BACK}?typeError=${encodeURIComponent("Nothing to save.")}`);
  const res = await saveNcTypeCards(cards, publish, session.userId);
  if (!res.ok) redirect(`${BACK}?typeError=${encodeURIComponent(res.error)}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: publish ? "content.publish" : "content.draft",
    entityType: "noncannabis_types",
    entityId: "accessory-cards",
    after: { cards: cards.map((c) => c.value) },
  });
  revalidatePath(BACK);
  if (publish) {
    revalidatePath("/menu");
    revalidatePath("/menu/[category]", "page");
    revalidatePath("/accessories/[type]", "page");
  }
  redirect(`${BACK}?${publish ? "published=1" : "saved=1"}`);
}

export async function saveAccessoryCardsAction(formData: FormData): Promise<void> {
  await cardsAction(formData, false);
}
export async function publishAccessoryCardsAction(formData: FormData): Promise<void> {
  await cardsAction(formData, true);
}

/**
 * OI-ACC S6 - the owner's hold on online accessory orders. OFF by default;
 * checkout re-reads it on every order, so OFF refuses nc lines server-side.
 */
export async function setOnlineAccessoriesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  const res = await saveOnlineNcEnabled(enabled, session.userId);
  if (res.error) redirect(`${BACK}?typeError=${encodeURIComponent(`Could not save the online setting: ${res.error}`)}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "settings.update",
    entityType: "site_settings",
    entityId: "online_other_inventory_enabled",
    after: { enabled },
  });
  revalidatePath(BACK);
  revalidatePath("/accessories/[type]", "page");
  redirect(`${BACK}?online=${enabled ? "on" : "off"}`);
}
