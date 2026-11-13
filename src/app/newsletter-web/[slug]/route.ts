/**
 * GET /newsletter-web/<slug>
 *
 * D238 N-8c (SOP-22 G-118): the hosted "View in your browser" copy of a
 * published canvas newsletter, exactly as emailed (warnings footer included).
 * Not a canvas (or not published)? It sends the reader to the blog post.
 * Served as a document with no scripts allowed (CSP).
 */
import { webVersionFor } from "@/lib/cms/newsletter-motion-server";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  const clean = String(slug ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 120);
  const html = clean ? await webVersionFor(clean).catch(() => null) : null;
  if (!html) return Response.redirect(new URL(clean ? `/blog/${clean}` : "/blog", req.url), 302);
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=0, s-maxage=300",
    },
  });
}
