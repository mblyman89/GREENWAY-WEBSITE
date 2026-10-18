/**
 * R73 S3 - GET /api/merch-content: the PUBLISHED greenwaymerch.com copy +
 * attached banner URLs, for the separate merch site (merch-site/lib/site-content.ts).
 *
 * Read-only and public by design: it returns only published_value of rows in
 * the four merch page-groups (never drafts, never any other block), each value
 * re-cleaned by resolveMerchContent (unknown keys dropped, unsafe URLs blanked).
 * Uses the same service-role read path the cannabis site's own pages use
 * (getPublishedContent), so it does not depend on anon table grants.
 * CDN-cached 60 s; the merch site also caches 60 s and falls back to its
 * built-in defaults if this is unreachable.
 */
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MERCH_SITE_PAGES, merchDefaults, resolveMerchContent } from "../../../../merch-site/lib/site-content-core";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
  "Access-Control-Allow-Origin": "*",
  "X-Robots-Tag": "noindex",
};

export async function GET(): Promise<Response> {
  if (!isSupabaseServiceConfigured) return Response.json({ content: merchDefaults(), source: "defaults" }, { headers: HEADERS });
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("content_blocks")
      .select("block_key, published_value, status")
      .in("page", [...MERCH_SITE_PAGES]);
    if (error) throw new Error(error.message);
    const published: Record<string, unknown> = {};
    for (const r of (data as { block_key: string; published_value: string | null; status: string }[] | null) ?? []) {
      if (r.status === "published" && r.published_value != null) published[r.block_key] = r.published_value;
    }
    return Response.json({ content: resolveMerchContent(published), source: "db" }, { headers: HEADERS });
  } catch {
    return Response.json({ content: merchDefaults(), source: "defaults" }, { headers: { ...HEADERS, "Cache-Control": "public, s-maxage=15" } });
  }
}
