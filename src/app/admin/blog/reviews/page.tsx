import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Button, Input, Textarea } from "@/components/admin/ui";
import { loadCuratedReviews } from "@/lib/cms/curated-reviews-server";
import { REVIEW_QUOTE_MAX, reviewProblems } from "@/lib/cms/curated-reviews-core";
import { saveCuratedReviewAction, deleteCuratedReviewAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * D239 N-9 (SOP-22 G-119; F-22-12; Q-22-2 (a)): the Curated reviews list.
 * Quote, first name, Google link and a permission tick. Only ticked reviews
 * can be used in posts and the newsletter canvas.
 */
export default async function CuratedReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; removed?: string; error?: string; edit?: string }>;
}) {
  await requirePermission("blog.manage");
  const sp = await searchParams;
  const list = await loadCuratedReviews();
  const editing = sp.edit ? list.find((r) => r.id === sp.edit) ?? null : null;
  const usable = list.filter((r) => reviewProblems(r).length === 0).length;

  return (
    <div>
      <AdminPageHeader
        title="Curated reviews"
        subtitle={`${list.length} saved · ${usable} ready to use in posts and newsletters`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Blog & Newsletter", href: "/admin/blog" }, { label: "Curated reviews" }]} />}
        help={
          <HelpPanel
            id="curated-reviews"
            title="How curated reviews work"
            steps={[
              "Pick a review you like on Google. Ask the customer (in the store, by text or by email) if we may quote it in our blog and newsletter.",
              "Only after they say yes: paste the words exactly, add their first name only, paste the link to the review on Google, tick Permission given and note how they said yes.",
              "Ticked reviews appear in the Review picker on the newsletter canvas (Customer review section), in the post editor (Insert a review) and in New post from… > Review spotlight.",
              "A review that talks about health benefits (pain, anxiety, sleep and similar) cannot be used in advertising (WAC 314-55-155) and is held back even when ticked.",
              "Remove a review here if the customer changes their mind. Posts already published keep their text, so also edit those posts.",
            ]}
          >
            <p>Google&rsquo;s rules do not allow copying its reviews into our site without the reviewer&rsquo;s say-so, so there is no automatic Google feed (Q-22-2 (a)).</p>
          </HelpPanel>
        }
      />
      <div className="mx-auto w-full max-w-4xl space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div role="alert" className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            {sp.error}
          </div>
        ) : sp.saved ? (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">Saved.</div>
        ) : sp.removed ? (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">Removed.</div>
        ) : null}

        <form action={saveCuratedReviewAction} className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4" data-testid="curated-review-form">
          <h2 className="text-sm font-bold text-[var(--admin-text)]">{editing ? "Edit review" : "Add a review"}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-muted)]">The review, word for word</span>
            <Textarea name="quote" rows={3} maxLength={REVIEW_QUOTE_MAX} required defaultValue={editing?.quote ?? ""} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-muted)]">First name only</span>
              <Input name="first_name" maxLength={30} defaultValue={editing?.firstName ?? ""} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-muted)]">Link to the review on Google</span>
              <Input name="google_url" placeholder="https://g.page/r/…" defaultValue={editing?.googleUrl ?? ""} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
            <input type="checkbox" name="permission" defaultChecked={editing?.permission ?? false} className="h-4 w-4" />
            Permission given: the customer said we may quote this review
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-muted)]">How they said yes (who, when)</span>
            <Input name="permission_note" maxLength={200} placeholder="Asked at the counter 11/10 by Sam, said yes" defaultValue={editing?.permissionNote ?? ""} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="confirm">{editing ? "Save review" : "Add review"}</Button>
            {editing ? <Button href="/admin/blog/reviews" variant="neutral">Cancel</Button> : null}
          </div>
        </form>

        {list.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-muted)]">No reviews yet. Add the first one above.</p>
        ) : (
          <ul className="space-y-3" data-testid="curated-review-list">
            {list.map((r) => {
              const problems = reviewProblems(r);
              return (
                <li key={r.id} className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm italic text-[var(--admin-text)]">&ldquo;{r.quote}&rdquo;</p>
                      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                        — {r.firstName || "(no name)"}
                        {r.googleUrl ? (
                          <>
                            {" · "}
                            <a href={r.googleUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--admin-accent)] hover:underline">
                              On Google ↗
                            </a>
                          </>
                        ) : null}
                        {r.permissionNote ? ` · ${r.permissionNote}` : ""}
                      </p>
                      {problems.length ? (
                        <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-orange)]">
                          {problems.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={problems.length ? "orange" : "green"}>{problems.length ? "Not usable yet" : "Ready to use"}</Badge>
                      <Link href={`/admin/blog/reviews?edit=${encodeURIComponent(r.id)}`} className="text-xs text-[var(--admin-accent)] hover:underline">
                        Edit
                      </Link>
                      <form action={deleteCuratedReviewAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm" variant="neutral">Remove</Button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
