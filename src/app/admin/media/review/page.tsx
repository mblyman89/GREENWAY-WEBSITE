/**
 * /admin/media/review   (D221 M3)
 *
 * The review queue: every picture with review_state = 'needs_review' (the
 * 0352 "filed as a logo but looks like a product photo" rule, and anything
 * the M4 describe pass doubted). One click per picture: Looks right / It's a
 * product photo / It's a logo / Reject; "Fix" opens the picture's own page.
 * The Rejected tab lists rejected pictures (kept, never deleted) with
 * Un-reject. Pages of 48 via .range() (rule 15).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { publicUrlForKey } from "@/lib/media/store";
import { reviewReasonKind } from "@/lib/media/media-review-core";
import { reviewMediaAction } from "../ai-actions";

export const dynamic = "force-dynamic";

const PAGE = 48;

type Row = {
  id: string;
  storage_key: string;
  filename: string;
  title: string | null;
  mime_type: string | null;
  status: string;
  usage_type: string | null;
  role: string | null;
  platform: string | null;
  vendor_id: string | null;
  review_state: string;
  review_note: string | null;
  ai_caption: string | null;
  reviewed_at: string | null;
};

const KIND_LABEL: Record<ReturnType<typeof reviewReasonKind>, string> = {
  "logo-vs-product": "Logo or product?",
  brand: "Different brand?",
  copy: "Wording blocked",
  confidence: "AI unsure",
  other: "Check",
};

export default async function MediaReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; saved?: string; error?: string }>;
}) {
  await requirePermission("media.manage");
  const { tab: rawTab, page: rawPage, saved, error } = await searchParams;
  const tab = rawTab === "rejected" ? "rejected" : "needs_review";
  const pageNo = Math.max(1, Math.floor(Number(rawPage) || 1));
  const selfHref = `/admin/media/review?tab=${tab}${pageNo > 1 ? `&page=${pageNo}` : ""}`;

  let rows: Row[] = [];
  let total = 0;
  let loadError: string | null = null;
  const vendorNames = new Map<string, string>();
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const from = (pageNo - 1) * PAGE;
    const { data, error: e, count } = await admin
      .from("media_assets")
      .select("id,storage_key,filename,title,mime_type,status,usage_type,role,platform,vendor_id,review_state,review_note,ai_caption,reviewed_at", { count: "exact" })
      .eq("review_state", tab)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (e) loadError = e.message;
    rows = (data as Row[] | null) ?? [];
    total = count ?? 0;
    const vids = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => Boolean(v)))];
    if (vids.length) {
      const { data: vs, error: ve } = await admin.from("vendors").select("id,display_name").in("id", vids);
      if (ve) loadError = loadError ?? ve.message;
      for (const v of (vs as { id: string; display_name: string }[] | null) ?? []) vendorNames.set(v.id, v.display_name);
    }
  } else {
    loadError = "The database isn't configured on this deployment.";
  }
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div>
      <AdminPageHeader
        title="Media review queue"
        subtitle="Pictures the library is not sure about. One click each; nothing is ever deleted."
        breadcrumbs={<Breadcrumbs items={[{ label: "Digital Assets", href: "/admin/media" }, { label: "Review queue" }]} />}
        action={
          <Link
            href="/admin/media"
            data-testid="media-review-back-button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Back to media library
          </Link>
        }
      />
      <div className="space-y-4 px-5 py-6 sm:px-8">
        {saved && <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">Saved.</div>}
        {(error || loadError) && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-2 text-sm text-[var(--admin-orange)]">{error || loadError}</div>
        )}

        <div className="flex gap-2 text-sm">
          <Link href="/admin/media/review" className={tab === "needs_review" ? "font-semibold text-[var(--admin-text)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>Needs review</Link>
          <span className="text-[var(--admin-text-faint)]">·</span>
          <Link href="/admin/media/review?tab=rejected" className={tab === "rejected" ? "font-semibold text-[var(--admin-text)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>Rejected</Link>
          <span className="ml-auto text-xs text-[var(--admin-text-faint)]">{total} picture(s)</span>
        </div>

        {rows.length === 0 && !loadError && (
          <EmptyState icon="✅" title={tab === "rejected" ? "Nothing rejected" : "Nothing waiting"} description="The queue is empty." />
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const url = publicUrlForKey(r.storage_key);
            const kind = reviewReasonKind(r.review_note);
            return (
              <div key={r.id} className="flex gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                <Link href={`/admin/media/${r.id}`} className="h-24 w-24 shrink-0 overflow-hidden rounded bg-black/30">
                  {url && r.mime_type?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={r.title ?? r.filename} className="h-full w-full object-contain" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-3xl">🗂</span>
                  )}
                </Link>
                <div className="min-w-0 flex-1 space-y-1 text-xs">
                  <p className="truncate text-sm font-medium text-[var(--admin-text)]">{r.title ?? r.filename}</p>
                  <p className="text-[var(--admin-text-faint)]">
                    {r.vendor_id ? vendorNames.get(r.vendor_id) ?? "vendor" : "no vendor"} · filed as {r.usage_type ?? "?"}{r.role ? ` / ${r.role}` : ""} · {r.status}
                  </p>
                  <p>
                    <span className="mr-1 rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">{KIND_LABEL[kind]}</span>
                    <span className="text-[var(--admin-text-muted)]">{r.review_note ?? ""}</span>
                  </p>
                  {r.ai_caption && <p className="truncate text-[var(--admin-text-faint)]">AI: {r.ai_caption}</p>}
                  <form action={reviewMediaAction} className="flex flex-wrap gap-1 pt-1">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="return_to" value={selfHref} />
                    {tab === "needs_review" ? (
                      <>
                        <Button type="submit" name="decision" value="accept" variant="confirm" size="sm">Looks right</Button>
                        <Button type="submit" name="decision" value="product" variant="neutral" size="sm">Product photo</Button>
                        <Button type="submit" name="decision" value="logo" variant="neutral" size="sm">Logo</Button>
                        <Button type="submit" name="decision" value="reject" variant="danger" size="sm">Reject</Button>
                      </>
                    ) : (
                      <Button type="submit" name="decision" value="accept" variant="neutral" size="sm">Un-reject</Button>
                    )}
                    <Link href={`/admin/media/${r.id}`} className="self-center px-1 text-[var(--admin-accent)] hover:underline">Fix →</Link>
                  </form>
                </div>
              </div>
            );
          })}
        </div>

        {pages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            {pageNo > 1 && <Link href={`/admin/media/review?tab=${tab}&page=${pageNo - 1}`} className="rounded border border-[var(--admin-border)] px-2 py-1">← Previous</Link>}
            <span className="text-[var(--admin-text-muted)]">Page {pageNo} of {pages}</span>
            {pageNo < pages && <Link href={`/admin/media/review?tab=${tab}&page=${pageNo + 1}`} className="rounded border border-[var(--admin-border)] px-2 py-1">Next →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
