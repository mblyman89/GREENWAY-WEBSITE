"use server";

/**
 * D243 E-3 (SOP-22 G-123): actions for the full-page newsletter editor:
 * start from a template, and the shared saved-sections library. Anyone who
 * can build a newsletter (blog.manage) can use them; every change is audited.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { newBlockId, type CanvasBlock, type CanvasDoc } from "@/lib/cms/newsletter-canvas-core";
import { addSavedSection, removeSavedSection, templateCanvas, templateIdOf, type SavedSection } from "@/lib/cms/newsletter-templates-core";
import { loadSavedSections, storeSavedSections } from "@/lib/cms/newsletter-templates-server";
import { getCanvasPost } from "@/lib/cms/newsletter-canvas-server";
import { greenwayBusiness } from "@/content/business";

type Fail = { ok: false; error: string };
const SITE = greenwayBusiness.website.replace(/\/$/, "");

export type TemplateOut = { ok: true; doc: CanvasDoc } | Fail;

/** A template's canvas (not saved: the editor shows it, the owner presses Save). */
export async function templateCanvasAction(postId: string, templateId: string): Promise<TemplateOut> {
  const session = await requirePermission("blog.manage");
  const id = templateIdOf(templateId);
  if (!id) return { ok: false, error: "Unknown template." };
  const post = await getCanvasPost(String(postId ?? ""));
  if (!post || post.kind !== "newsletter") return { ok: false, error: "Newsletter not found." };
  const doc = templateCanvas(id, post.title, SITE);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.canvas.template",
    entityType: "blog_post",
    entityId: post.id,
    after: { template: id, blocks: doc.blocks.length },
  });
  return { ok: true, doc };
}

export type SectionsOut = { ok: true; list: SavedSection[] } | Fail;

export async function listSavedSectionsAction(): Promise<SectionsOut> {
  await requirePermission("blog.manage");
  return { ok: true, list: await loadSavedSections() };
}

export async function saveSectionAction(name: string, block: CanvasBlock): Promise<SectionsOut> {
  const session = await requirePermission("blog.manage");
  const current = await loadSavedSections();
  const r = addSavedSection(current, String(name ?? ""), block, newBlockId("saved"));
  if (!r.ok) return r;
  const s = await storeSavedSections(r.list, session.userId);
  if (!s.ok) return s;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.sections.save",
    entityType: "site_settings",
    entityId: null,
    after: { name: r.list[0].name, type: r.list[0].block.type, count: s.list.length },
  });
  return s;
}

export async function deleteSectionAction(id: string): Promise<SectionsOut> {
  const session = await requirePermission("blog.manage");
  const current = await loadSavedSections();
  const gone = current.find((x) => x.id === id);
  if (!gone) return { ok: true, list: current };
  const s = await storeSavedSections(removeSavedSection(current, id), session.userId);
  if (!s.ok) return s;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.sections.delete",
    entityType: "site_settings",
    entityId: null,
    after: { name: gone.name, type: gone.block.type, count: s.list.length },
  });
  return s;
}
