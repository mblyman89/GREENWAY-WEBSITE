"use server";

/**
 * src/app/admin/products/copilot/actions.ts  (D244 R-5, strategy slice E-6)
 *
 * The Enrichment Copilot's buttons. Every one requires products.enrich and
 * writes an audit row. The chat (copilotAskAction) and "Look closely"
 * (copilotInspectAction) only READ and return text; every write is a click
 * and goes through the same gates as the product page: "Use this" files the
 * proposal as a draft and accepts it through acceptDraftWithEdit (compliance
 * re-scan, effects gate; potency must match a lab, lot or POS number).
 * Owner, round 2: "a product should be publish once it has a picture."
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getMedia, recordUsage } from "@/lib/media/store";
import { ensureEnrichment, getEnrichment, updateEnrichment, setEnrichmentStatusForKeys } from "@/lib/enrichment/store";
import { getPublishedVersion, getItemBySourceKey } from "@/lib/pos/menu-version";
import { attachImageToGallery, setPrimaryImage } from "@/lib/ai/kb/product-images-core";
import { rememberImageAttach } from "@/lib/catalog/image-memory-server";
import { publishOnPhoto } from "@/lib/enrichment/publish-on-photo-server";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { reviewSuggestion } from "@/lib/ai/suggestions";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { draftAllFieldsForProduct } from "@/lib/enrichment/ai-draft-v2-server";
import { acceptAllMessage, acceptDraftWithEdit, acceptHighConfidenceForKey } from "@/lib/enrichment/accept-drafts-server";
import { ACCEPT_ALL_THRESHOLD } from "@/lib/enrichment/ai-draft-v2-core";
import { cleanKey } from "@/lib/enrichment/detail-nav-core";
import { askCopilot, inspectPhoto, fileCopilotProposal } from "@/lib/enrichment/copilot-server";
import {
  COPILOT_MESSAGE_MAX_CHARS,
  copilotUrl,
  parseCopilotHistory,
  parseSkips,
  publishBlockReason,
  type CopilotAnswer,
} from "@/lib/enrichment/copilot-core";

type Ctx = { key: string; vendor: string; skip: string[]; next: string };

function ctx(formData: FormData): Ctx {
  return {
    key: cleanKey(formData.get("key")),
    vendor: String(formData.get("vendor") ?? "").trim().slice(0, 100),
    skip: parseSkips(formData.get("skip")),
    next: cleanKey(formData.get("nextKey")),
  };
}

const back = (c: Ctx, flash: string, key: string | null = c.key, hash = "") =>
  copilotUrl({ vendor: c.vendor, key, skip: c.skip, flash, hash });
const ok = (note = "") => (note ? `saved=1&note=${encodeURIComponent(note)}` : "saved=1");
const err = (msg: string) => `error=${encodeURIComponent(msg)}`;

function touched(key: string) {
  revalidatePath("/admin/products/copilot");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
}

// ---------------------------------------------------------------------------
// The chat (read-only: returns text + proposals)
// ---------------------------------------------------------------------------

export type CopilotChatTurn = { role: "user" | "assistant"; content: string; answer?: CopilotAnswer; error?: boolean };
export type CopilotChatState = { turns: CopilotChatTurn[] };

export async function copilotAskAction(prev: CopilotChatState, formData: FormData): Promise<CopilotChatState> {
  // One chat state: a "Look closely" button posts op=inspect into the same conversation.
  const inspect = String(formData.get("inspect") ?? "");
  if (inspect) {
    const [mediaId, label] = inspect.split("|");
    formData.set("mediaId", mediaId ?? "");
    formData.set("label", label ?? "this photo");
    return copilotInspectAction(prev, formData);
  }
  const session = await requirePermission("products.enrich");
  const key = cleanKey(formData.get("key"));
  const vendor = String(formData.get("vendor") ?? "").trim().slice(0, 100);
  const message = (String(formData.get("message") ?? "").trim() || String(formData.get("starter") ?? "").trim()).slice(0, COPILOT_MESSAGE_MAX_CHARS);
  const turns = prev?.turns ?? [];
  if (!key || !message) return { turns };
  const history = parseCopilotHistory(JSON.stringify(turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }))));
  const out = await askCopilot({ key, vendorId: vendor, history, message, actorId: session.userId });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.copilot_asked",
    entityType: "product",
    entityId: key,
    after: out.ok ? { proposals: out.answer.proposals.map((p) => p.field), photoPick: out.answer.photoPick, model: out.model } : { error: out.error },
  });
  const mine: CopilotChatTurn = { role: "user", content: message };
  const reply: CopilotChatTurn = out.ok
    ? { role: "assistant", content: out.answer.reply, answer: out.answer }
    : { role: "assistant", content: out.error, error: true };
  return { turns: [...turns, mine, reply].slice(-24) };
}

/** "Look closely" at one photo; the answer lands in the chat. */
export async function copilotInspectAction(prev: CopilotChatState, formData: FormData): Promise<CopilotChatState> {
  const session = await requirePermission("products.enrich");
  const key = cleanKey(formData.get("key"));
  const mediaId = String(formData.get("mediaId") ?? "").trim().slice(0, 100);
  const label = String(formData.get("label") ?? "this photo").slice(0, 80);
  const turns = prev?.turns ?? [];
  if (!key || !mediaId) return { turns };
  const out = await inspectPhoto({ key, mediaId, actorId: session.userId });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.copilot_inspected",
    entityType: "product",
    entityId: key,
    after: { mediaId, ok: out.ok },
  });
  return {
    turns: [
      ...turns,
      { role: "user" as const, content: `Look closely at ${label}.` },
      out.ok ? { role: "assistant" as const, content: out.reply } : { role: "assistant" as const, content: out.error, error: true },
    ].slice(-24),
  };
}

// ---------------------------------------------------------------------------
// Writes (each one a click)
// ---------------------------------------------------------------------------

/** "Use this": file the copilot's (possibly edited) proposal and accept it through the gates. */
export async function copilotUseProposalAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  if (!c.key) redirect(back(c, err("Missing product key.")));
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");
  const out = await fileCopilotProposal({ key: c.key, field, value, actorId: session.userId });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: out.ok ? "product.copilot_used" : "product.copilot_use_blocked",
    entityType: "product",
    entityId: c.key,
    after: out.ok ? { ...out.audit, via: "copilot" } : { field, error: out.error, ...(out.audit ?? {}) },
  });
  if (!out.ok) redirect(back(c, err(out.error), c.key, "chat"));
  await writeBackOnPublish(c.key, session.userId).catch(() => null);
  if (field === "strain_type" || field === "potency") revalidatePublicMenuSurfaces();
  touched(c.key);
  redirect(back(c, ok(`Saved the copilot's ${field.replace(/_/g, " ")}.`), c.key, "chat"));
}

/** Attach a recommended photo (keys 1-9). The cover when the card has none; then the photo-publish rule. */
export async function copilotAttachPhotoAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  const mediaId = String(formData.get("mediaId") ?? "").trim();
  if (!c.key || !mediaId) redirect(back(c, err("Missing product or photo.")));
  const asset = await getMedia(mediaId);
  if (!asset) redirect(back(c, err("That photo no longer exists in the media library.")));
  await ensureEnrichment(c.key, {}, session.userId);
  const current = await getEnrichment(c.key);
  const merge = attachImageToGallery({ image_media_ids: current?.image_media_ids ?? [], primary_media_id: current?.primary_media_id ?? null }, mediaId);
  const cover = !merge.primary_media_id ? setPrimaryImage(merge, mediaId) : null;
  if (!merge.alreadyPresent || cover?.changed) {
    await updateEnrichment(
      c.key,
      { image_media_ids: merge.image_media_ids, primary_media_id: cover?.changed ? cover.primary_media_id : merge.primary_media_id },
      session.userId,
    );
  }
  if (!merge.alreadyPresent) await recordUsage(mediaId, "product", c.key, "image");
  const identityKey = (current?.identity_key ?? "").trim() || String(formData.get("identityKey") ?? "").trim().slice(0, 300);
  const remembered = identityKey
    ? await rememberImageAttach({ identityKey, mediaId, posProductKey: c.key, source: "library", actorId: session.userId }).catch(() => ({ ok: false }))
    : { ok: false };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.match_image_attached",
    entityType: "product",
    entityId: c.key,
    after: { mediaId, source: "copilot", becamePrimary: merge.becamePrimary || Boolean(cover?.changed), identityKey: identityKey || null, remembered: remembered.ok },
  });
  const pub = await publishOnPhoto(c.key, session);
  touched(c.key);
  redirect(back(c, ok(pub.note || "Photo attached.")));
}

/** "A": accept every draft at 80% or better, plus best guesses (flagged). */
export async function copilotAcceptAllAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  if (!c.key) redirect(back(c, err("Missing product key.")));
  const out = await acceptHighConfidenceForKey(c.key, session.userId);
  if (!out.ok) redirect(back(c, err(out.error)));
  if (out.eligible === 0) redirect(back(c, err(`No draft is at or above ${ACCEPT_ALL_THRESHOLD}% and none is a best guess. Press D to draft, or review them one by one.`)));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.ai_accepted_all",
    entityType: "product",
    entityId: c.key,
    after: { threshold: ACCEPT_ALL_THRESHOLD, accepted: out.accepted, blocked: out.blocked, flagged_best_guesses: out.flagged, via: "copilot", kb_writeback: out.writeback ?? undefined },
  });
  touched(c.key);
  const msg = acceptAllMessage(out.accepted, out.blocked, out.flagged);
  redirect(back(c, out.accepted.length ? ok(msg) : err(msg)));
}

/** "P": publish (a photo is the only requirement) and go to the next card. */
export async function copilotPublishAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  if (!c.key) redirect(back(c, err("Missing product key.")));
  const e = await getEnrichment(c.key).catch(() => null);
  const hasImage = Boolean(e?.primary_media_id || (e?.image_media_ids ?? []).length);
  const blocked = publishBlockReason(hasImage);
  if (blocked) redirect(back(c, err(blocked)));
  const done = await setEnrichmentStatusForKeys([c.key], "published", session.userId);
  if (done.length !== 1) redirect(back(c, err("It could not be published just now. Try again.")));
  const writeback = await writeBackOnPublish(c.key, session.userId).catch(() => null);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.published",
    entityType: "product",
    entityId: c.key,
    after: { via: "copilot", kb_writeback: writeback ?? undefined },
  });
  touched(c.key);
  revalidatePublicMenuSurfaces();
  redirect(back(c, ok("Published. On to the next card."), c.next && c.next !== c.key ? c.next : null));
}

/** "S": move this card to the back of the session. */
export async function copilotSkipAction(formData: FormData): Promise<void> {
  await requirePermission("products.enrich");
  const c = ctx(formData);
  const skip = c.key && !c.skip.includes(c.key) ? [...c.skip, c.key] : c.skip;
  redirect(copilotUrl({ vendor: c.vendor, key: c.next && c.next !== c.key ? c.next : null, skip }));
}

/** "D": draft every field now (live, the enrichment model). */
export async function copilotDraftNowAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  if (!c.key) redirect(back(c, err("Missing product key.")));
  const published = await getPublishedVersion().catch(() => null);
  const row = published ? await getItemBySourceKey(published.id, c.key).catch(() => null) : null;
  if (!row) redirect(back(c, err("That product is not on the published menu any more.")));
  let note = "";
  try {
    const out = await draftAllFieldsForProduct(
      c.key,
      { name: row!.name, product_name: row!.product_name, brand_name: row!.brand_name, vendor_name: row!.vendor_name, category: row!.category, strain_type: row!.strain_type, strain_name: row!.strain_name, thc: row!.thc, cbd: row!.cbd },
      session.userId,
    );
    if (out.saved.length === 0) throw new Error("The AI reply had nothing usable for any field. Try again.");
    note = `Drafted ${out.saved.length} field${out.saved.length === 1 ? "" : "s"}. Press A to accept the ones at ${ACCEPT_ALL_THRESHOLD}% or better.`;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "product.ai_generated",
      entityType: "product",
      entityId: c.key,
      after: { kind: "all", via: "copilot", saved: out.saved.map((x) => `${x.field}:${x.confidence}${x.bestGuess ? "?" : ""}`), skipped: out.skipped.map((x) => x.field) },
    });
  } catch (e) {
    redirect(back(c, err((e as Error).message)));
  }
  touched(c.key);
  redirect(back(c, ok(note), c.key, "drafts"));
}

/** Accept one pending draft (with the person's edit, if any) through the ONE accept path. */
export async function copilotAcceptDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  const id = String(formData.get("id") ?? "").trim();
  if (!c.key || !id) redirect(back(c, err("Missing draft.")));
  const out = await acceptDraftWithEdit(id, formData.get("editedValue"), session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: out.ok ? "product.ai_accepted" : "product.ai_accept_blocked",
    entityType: "product",
    entityId: c.key,
    after: out.ok ? { ...out.audit, via: "copilot" } : { error: out.error, ...(out.audit ?? {}) },
  });
  if (!out.ok) redirect(back(c, err(out.error), c.key, "drafts"));
  await writeBackOnPublish(c.key, session.userId).catch(() => null);
  if (out.field === "strain_type" || out.field === "potency") revalidatePublicMenuSurfaces();
  touched(c.key);
  redirect(back(c, ok(), c.key, "drafts"));
}

/** Reject one pending draft. */
export async function copilotRejectDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const c = ctx(formData);
  const id = String(formData.get("id") ?? "").trim();
  if (!c.key || !id) redirect(back(c, err("Missing draft.")));
  await reviewSuggestion(id, "rejected", session.userId);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "product.ai_rejected", entityType: "product", entityId: c.key, after: { suggestionId: id, via: "copilot" } });
  touched(c.key);
  redirect(back(c, ok("Draft rejected."), c.key, "drafts"));
}
