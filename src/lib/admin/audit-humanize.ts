/**
 * src/lib/admin/audit-humanize.ts
 *
 * Turns terse audit `action` codes (e.g. "vendor.ai_accepted") into friendly,
 * plain-language phrases + an icon + a tone, for the admin audit timeline. Pure
 * functions — safe anywhere. Unknown actions degrade gracefully to a
 * title-cased version of the code so nothing ever looks broken.
 */

export type AuditTone = "create" | "update" | "publish" | "delete" | "ai" | "auth" | "neutral";

export type HumanAction = {
  icon: string;
  /** Verb phrase, e.g. "published a vendor". */
  phrase: string;
  tone: AuditTone;
};

const TONE_ICON: Record<AuditTone, string> = {
  create: "➕",
  update: "✏️",
  publish: "🚀",
  delete: "🗑️",
  ai: "✨",
  auth: "🔑",
  neutral: "•",
};

/** Map an action code to a tone + friendly phrase. */
export function humanizeAction(action: string): HumanAction {
  const a = action.toLowerCase();

  // Pattern-based tone detection (works for most "<entity>.<verb>" codes).
  let tone: AuditTone = "neutral";
  if (/(published|unpublished)/.test(a)) tone = "publish";
  else if (/(created|added|invited|imported|placed)/.test(a)) tone = "create";
  else if (/(deleted|removed|cancelled|archived|deactivated)/.test(a)) tone = "delete";
  else if (/ai_|\.ai\b|ai\./.test(a)) tone = "ai";
  else if (/(login|logout|sign_in|sign_out|role|active)/.test(a)) tone = "auth";
  else if (/(updated|edited|changed|set_|saved|note)/.test(a)) tone = "update";

  const phrase = friendlyPhrase(a) ?? prettify(action);
  return { icon: TONE_ICON[tone], phrase, tone };
}

const KNOWN: Record<string, string> = {
  "vendor.updated": "updated a vendor profile",
  "vendor.published": "published a vendor",
  "vendor.unpublished": "unpublished a vendor",
  "vendor.ai_drafted": "asked AI to draft a vendor profile",
  "vendor.ai_accepted": "accepted an AI vendor draft",
  "vendor.ai_rejected": "rejected an AI vendor draft",
  "brand.updated": "updated a brand",
  "order.status_changed": "moved an order forward",
  "loyalty.status_changed": "updated a loyalty signup",
  "menu.published": "published a new menu version",
  "menu.imported": "imported a menu file",
  "promotion.published": "published a promotion",
  "promotion.updated": "updated a promotion",
  "promotion.deleted": "deleted a promotion",
  "user.invited": "invited a teammate",
  "user.role_updated": "changed a teammate's role",
  "user.activated": "reactivated a teammate",
  "user.deactivated": "deactivated a teammate",
  "blog.published": "published a blog post",
  "content.ai_suggest": "asked AI to draft site content",
  "media.ai_alt_text": "asked AI to suggest alt text",
  "product.bulk_ai_generated": "generated AI product drafts",
  "product.bulk_ai_accepted": "accepted an AI product draft",
};

function friendlyPhrase(action: string): string | null {
  return KNOWN[action] ?? null;
}

/** Title-case a dotted/underscored action code as a fallback. */
function prettify(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const TONE_BADGE: Record<AuditTone, string> = {
  create: "border-[#7ed957]/30 bg-[#7ed957]/10 text-[#7ed957]",
  update: "border-[#ffd700]/30 bg-[#ffd700]/10 text-[#ffd700]",
  publish: "border-[#7ed957]/40 bg-[#7ed957]/15 text-[#7ed957]",
  delete: "border-red-500/30 bg-red-500/10 text-red-300",
  ai: "border-[#7ed957]/30 bg-[#7ed957]/[0.07] text-[#7ed957]",
  auth: "border-white/20 bg-white/5 text-white/70",
  neutral: "border-white/15 bg-white/5 text-white/60",
};
