/**
 * newsletter-email-core.ts — pure rules for every newsletter email (SOP-22, D236/D237 slice N-1).
 *
 * Owner (D237, verbatim): "I approve all from serious to small along with your
 * recommendations". This file holds the parts of N-1 that can be proven
 * without a network or a database:
 *
 *   G-108 / F-22-1  The four WAC 314-55-155(7) warnings in every newsletter
 *                   email, at no less than 10% of the largest type size. The
 *                   strings are REQUIRED_WARNINGS from the campaign planner, so
 *                   the planner and the email can never disagree.
 *   G-109 / F-22-2  One-click unsubscribe headers (RFC 8058):
 *                   List-Unsubscribe: <https://…>  +  List-Unsubscribe-Post.
 *   G-110 / F-22-6  Saving a newsletter post keeps its PDF unless a new one is
 *                   uploaded (mergeNewsletterAsset).
 *   G-110 / F-22-7  The post title is HTML-escaped before it goes in the email.
 *   G-110 / F-22-19 Email settings are trimmed (a pasted space no longer breaks
 *                   the from address).
 *   G-111 / F-22-4  Which engagement events take an address off the list
 *                   (hard bounce, spam complaint).
 */
import { REQUIRED_WARNINGS } from "@/lib/marketing/campaign-rules-core";

/** Font sizes (px) used in the email. The footer warnings must be ≥10% of the largest. */
export const EMAIL_FONT_PX = {
  brand: 22,
  title: 24,
  body: 14,
  button: 15,
  warnings: 11,
} as const;

/** WAC 314-55-155(7): warnings no less than 10% of the largest type size. */
export function warningsSizeOk(warningPx: number, largestPx: number): boolean {
  if (!(warningPx > 0) || !(largestPx > 0)) return false;
  return warningPx * 10 >= largestPx;
}

/** Escape text for HTML element content and double-quoted attributes. */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Trim an environment value; empty → null. */
export function cleanEnv(v: string | undefined | null): string | null {
  const t = String(v ?? "").trim();
  return t ? t : null;
}

/** The fixed legal footer block (four warnings, one per line). */
export function warningsFooterHtml(px: number = EMAIL_FONT_PX.warnings): string {
  const lines = REQUIRED_WARNINGS.map(escapeHtml).join("<br/>");
  return `<p data-gw-warnings="wac-314-55-155-7" style="margin:14px 0 0;color:#9a9a9a;font-size:${px}px;line-height:1.55;text-align:center">${lines}</p>`;
}

/** Plain-text form of the same four warnings (for text parts and tests). */
export function warningsFooterText(): string {
  return REQUIRED_WARNINGS.join("\n");
}

/** Largest font-size (px) found in an HTML string; 0 when none. */
export function largestFontPx(html: string): number {
  let max = 0;
  for (const m of html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

/** True when every one of the four warnings appears in the HTML (escaped form). */
export function hasAllWarnings(html: string): boolean {
  return REQUIRED_WARNINGS.every((w) => html.includes(escapeHtml(w)));
}

/**
 * RFC 8058 one-click unsubscribe headers. Only for a real https URL that
 * carries the member's token; test sends (no token) get none.
 */
export function listUnsubscribeHeaders(oneClickUrl: string | null): Record<string, string> {
  if (!oneClickUrl || !/^https:\/\//i.test(oneClickUrl)) return {};
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** The https endpoint a mail provider POSTs to for one-click unsubscribe. */
export function oneClickUnsubscribeUrl(siteUrl: string, token: string | null): string | null {
  const t = String(token ?? "").trim();
  if (!t) return null;
  return `${siteUrl.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(t)}`;
}

export type NewsletterAssetValues = {
  pdf_media_id: string | null;
  pdf_path: string | null;
  page_media_ids: string[];
  page_paths: string[];
};

export type NewsletterAssetInput = {
  pdf_media_id?: string | null;
  pdf_path?: string | null;
  page_media_ids?: string[];
  page_paths?: string[];
};

/**
 * F-22-6: a key that is not given (undefined) keeps what is stored. Before
 * N-1 every missing key was written as null/[], so saving a post without a
 * new PDF wiped it and the newsletter left the Send Center.
 */
export function mergeNewsletterAsset(
  existing: Partial<NewsletterAssetValues> | null,
  input: NewsletterAssetInput,
): NewsletterAssetValues {
  const ex = existing ?? {};
  return {
    pdf_media_id: input.pdf_media_id !== undefined ? input.pdf_media_id : (ex.pdf_media_id ?? null),
    pdf_path: input.pdf_path !== undefined ? input.pdf_path : (ex.pdf_path ?? null),
    page_media_ids: input.page_media_ids !== undefined ? input.page_media_ids : (ex.page_media_ids ?? []),
    page_paths: input.page_paths !== undefined ? input.page_paths : (ex.page_paths ?? []),
  };
}

export type SuppressReason = "hard_bounce" | "complaint";

/**
 * F-22-4: which engagement events take an address off the marketing list.
 * Hard bounces (the address does not exist) and spam complaints. Soft
 * bounces, delays, opens and clicks never do.
 */
export function suppressionFor(e: {
  eventType: string;
  bounceKind: "hard" | "soft" | null;
  recipientEmail: string;
}): { email: string; reason: SuppressReason } | null {
  const email = String(e.recipientEmail ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  if (e.eventType === "complained") return { email, reason: "complaint" };
  if (e.eventType === "bounced" && e.bounceKind === "hard") return { email, reason: "hard_bounce" };
  return null;
}

/** Unique suppressions from a batch of events (first reason per address wins). */
export function suppressionsFrom(
  events: { eventType: string; bounceKind: "hard" | "soft" | null; recipientEmail: string }[],
): { email: string; reason: SuppressReason }[] {
  const seen = new Map<string, SuppressReason>();
  for (const e of events) {
    const s = suppressionFor(e);
    if (s && !seen.has(s.email)) seen.set(s.email, s.reason);
  }
  return Array.from(seen, ([email, reason]) => ({ email, reason }));
}

/** Plain words for the Send Center when a non-owner/admin opens it (Q-22-3). */
export const BROADCAST_GATE_MESSAGE =
  "Only the owner or an admin can send a newsletter to the whole list. You can prepare it and send yourself a test.";

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runNewsletterEmailCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, c: boolean) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL newsletter-email-core: ${name}`);
    }
  };

  // Warnings
  ok("four warnings", REQUIRED_WARNINGS.length === 4);
  const foot = warningsFooterHtml();
  ok("footer has all four", hasAllWarnings(foot));
  ok("footer 21+ line", foot.includes("adults 21 and older"));
  ok("warning size rule ok at 11/24", warningsSizeOk(11, 24));
  ok("warning size rule fails at 2/24", !warningsSizeOk(2, 24));
  ok("warning size rule exact 10%", warningsSizeOk(2.4, 24));
  ok("warning size zero fails", !warningsSizeOk(0, 24));
  const largest = Math.max(...Object.values(EMAIL_FONT_PX));
  ok("configured sizes obey 10%", warningsSizeOk(EMAIL_FONT_PX.warnings, largest));
  ok("largestFontPx", largestFontPx('<p style="font-size:11px"></p><h2 style="font-size:24px">') === 24);
  ok("largestFontPx none", largestFontPx("<p></p>") === 0);
  ok("text warnings 4 lines", warningsFooterText().split("\n").length === 4);

  // Escaping
  ok("escape lt gt amp", escapeHtml("A & <b>") === "A &amp; &lt;b&gt;");
  ok("escape quotes", escapeHtml(`"x'`) === "&quot;x&#39;");
  ok("escape null safe", escapeHtml(undefined as unknown as string) === "");

  // Env
  ok("cleanEnv trims", cleanEnv("  a@b.com \n") === "a@b.com");
  ok("cleanEnv blank null", cleanEnv("   ") === null);
  ok("cleanEnv undefined null", cleanEnv(undefined) === null);

  // One-click
  const url = oneClickUnsubscribeUrl("https://www.greenwaymarijuana.com/", "tok 1");
  ok("one-click url", url === "https://www.greenwaymarijuana.com/api/unsubscribe?token=tok%201");
  ok("one-click no token", oneClickUnsubscribeUrl("https://x.com", "  ") === null);
  const h = listUnsubscribeHeaders(url);
  ok("header angle brackets", h["List-Unsubscribe"] === `<${url}>`);
  ok("header post", h["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
  ok("no headers without url", Object.keys(listUnsubscribeHeaders(null)).length === 0);
  ok("no headers for http", Object.keys(listUnsubscribeHeaders("http://x.com/a")).length === 0);

  // Asset merge
  const ex: NewsletterAssetValues = { pdf_media_id: "m1", pdf_path: null, page_media_ids: ["p"], page_paths: ["/a.png"] };
  const keep = mergeNewsletterAsset(ex, { page_paths: ["/b.png"] });
  ok("keeps pdf when not uploaded", keep.pdf_media_id === "m1");
  ok("keeps page media ids", keep.page_media_ids.length === 1);
  ok("updates page paths", keep.page_paths[0] === "/b.png");
  ok("replaces pdf when uploaded", mergeNewsletterAsset(ex, { pdf_media_id: "m2" }).pdf_media_id === "m2");
  ok("explicit null clears", mergeNewsletterAsset(ex, { pdf_media_id: null }).pdf_media_id === null);
  ok("no existing → defaults", mergeNewsletterAsset(null, {}).page_paths.length === 0);

  // Suppression
  ok("hard bounce suppresses", suppressionFor({ eventType: "bounced", bounceKind: "hard", recipientEmail: " A@B.com " })?.email === "a@b.com");
  ok("complaint suppresses", suppressionFor({ eventType: "complained", bounceKind: null, recipientEmail: "a@b.com" })?.reason === "complaint");
  ok("soft bounce does not", suppressionFor({ eventType: "delivery_delayed", bounceKind: "soft", recipientEmail: "a@b.com" }) === null);
  ok("open does not", suppressionFor({ eventType: "opened", bounceKind: null, recipientEmail: "a@b.com" }) === null);
  ok("bad email ignored", suppressionFor({ eventType: "complained", bounceKind: null, recipientEmail: "nope" }) === null);
  const many = suppressionsFrom([
    { eventType: "bounced", bounceKind: "hard", recipientEmail: "a@b.com" },
    { eventType: "complained", bounceKind: null, recipientEmail: "A@b.com" },
    { eventType: "opened", bounceKind: null, recipientEmail: "c@d.com" },
  ]);
  ok("dedupe suppressions", many.length === 1 && many[0].reason === "hard_bounce");

  return { passed, failed };
}
