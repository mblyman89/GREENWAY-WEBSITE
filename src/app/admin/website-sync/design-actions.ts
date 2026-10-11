"use server";
/**
 * src/app/admin/website-sync/design-actions.ts — R41 S7 (hub preview "Move mode").
 *
 * ONE server action that saves a drag the owner made inside the Website Sync
 * preview window. It never trusts the browser:
 *   1. requirePermission("content.edit") (same gate as every banner editor),
 *   2. re-validates the message with parseMoveMessage + parseDesignOwner,
 *   3. reads the current DRAFT (falling back to the live copy) of the owning
 *      row, applies the pure mover from design-move-core, and saves it back as
 *      a DRAFT only — a move never publishes,
 *   4. writes an audit row and revalidates the public page + its editor.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { parseMoveMessage, type DesignMove } from "@/lib/cms/banner-design-core";
import {
  editorFor,
  moveInLoyaltyJson,
  moveInSettings,
  moveInShopPresentation,
  moveInSpecialsJson,
  parseDesignOwner,
  publicPathFor,
} from "@/lib/cms/design-move-core";
import { getSection, saveSectionDraft } from "@/lib/cms/page-sections-store";
import { getContentBlock, saveContentDraft } from "@/lib/cms/content-store";
import { getShopCarouselSlide, saveShopCarouselDraft } from "@/lib/cms/shop-carousel-store";
import { SPECIALS_PRESENTATION_BLOCK } from "@/lib/specials/specials-presentation-core";
import { LOYALTY_HERO_PRESENTATION_BLOCK } from "@/lib/loyalty/loyalty-hero-core";

export type DesignMoveResult = { ok: boolean; message: string; editorHref?: string; editorLabel?: string };

const BAD = "That move couldn't be read. Refresh the preview and try again.";

export async function saveDesignMoveAction(input: unknown): Promise<DesignMoveResult> {
  const session = await requirePermission("content.edit");
  const msg = parseMoveMessage(input);
  const owner = msg ? parseDesignOwner(msg.owner) : null;
  if (!msg || !owner) return { ok: false, message: BAD };
  const move: DesignMove = { target: msg.target, id: msg.id, x: msg.x, y: msg.y, device: msg.device };

  let pageSlug: string | null = null;
  try {
    switch (owner.kind) {
      case "section": {
        const row = await getSection(owner.id);
        if (!row) return { ok: false, message: "That banner no longer exists. Refresh the preview." };
        if (row.locked) return { ok: false, message: "This section is locked and cannot be edited." };
        pageSlug = row.page_slug;
        const r = moveInSettings(row.draft_settings ?? row.settings, move);
        if (!r.ok) return { ok: false, message: r.message };
        const saved = await saveSectionDraft(owner.id, { settings: r.value }, session.userId);
        if (saved.error) return { ok: false, message: saved.error };
        break;
      }
      case "specials": {
        const block = await getContentBlock(SPECIALS_PRESENTATION_BLOCK);
        if (!block) return { ok: false, message: "The Specials settings haven't been set up yet. Open the Specials editor once, then try again." };
        const r = moveInSpecialsJson(block.draft_value ?? block.published_value, owner.which, move);
        if (!r.ok) return { ok: false, message: r.message };
        await saveContentDraft(SPECIALS_PRESENTATION_BLOCK, r.value, session.userId);
        break;
      }
      case "loyalty": {
        const block = await getContentBlock(LOYALTY_HERO_PRESENTATION_BLOCK);
        if (!block) return { ok: false, message: "The Loyalty banner settings haven't been set up yet. Open the Loyalty page editor once, then try again." };
        const r = moveInLoyaltyJson(block.draft_value ?? block.published_value, move);
        if (!r.ok) return { ok: false, message: r.message };
        await saveContentDraft(LOYALTY_HERO_PRESENTATION_BLOCK, r.value, session.userId);
        break;
      }
      case "shop-slide": {
        const slide = await getShopCarouselSlide(owner.id);
        if (!slide) return { ok: false, message: "That Shop slide no longer exists. Refresh the preview." };
        const r = moveInShopPresentation(slide.draft_presentation ?? slide.presentation, move);
        if (!r.ok) return { ok: false, message: r.message };
        await saveShopCarouselDraft(owner.id, r.value, undefined, session.userId);
        break;
      }
    }
  } catch (e) {
    return { ok: false, message: `Couldn't save the move: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "design.move",
    entityType: owner.kind === "section" ? "page_section" : owner.kind === "shop-slide" ? "shop_carousel_slide" : "content_block",
    entityId: msg.owner,
    after: move,
  });

  const editor = editorFor(owner, pageSlug);
  revalidatePath(publicPathFor(owner, pageSlug));
  revalidatePath(editor.href.split("?")[0]);
  const what = move.target === "box" ? "Text" : "Button";
  const where = move.device === "mobile" ? " (phone layout)" : "";
  return {
    ok: true,
    message: `${what} moved${where} and saved as a draft. Press Publish in ${editor.label} when you're happy.`,
    editorHref: editor.href,
    editorLabel: editor.label,
  };
}
