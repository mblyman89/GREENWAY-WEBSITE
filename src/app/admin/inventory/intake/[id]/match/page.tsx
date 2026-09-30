/**
 * /admin/inventory/intake/[id]/match?identity=<vendor|axis|family>  (bible S32)
 *
 * The match review. A delivered product matched two or more live menu cards
 * (intake_master_merge_ambiguous), so the planner made it its own card
 * instead of guessing. Here the owner compares them side by side and chooses
 * once - Join this card / Keep separate - and the planner reads that choice
 * on every future delivery (intake_merge_decisions, 0239). A duplicate card
 * is hidden with the product page's Visibility control (the one existing
 * hide lever, applyProductVisibility); two old live cards are never merged
 * here (D-R3-2).
 *
 * Everything shown comes from the delivery's newest staged/published intake
 * version (merge-review-server loadMatchReview); nothing is guessed.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import { loadMatchReview } from "@/lib/pos/merge-review-server";
import { getMergeDecision } from "@/lib/pos/merge-decision-store";
import {
  MERGE_REVIEW_COPY,
  buildMergeReview,
  isMergeIdentity,
  mergeResultCopy,
  parseMergeResult,
  type MatchedOn,
} from "@/lib/pos/merge-review-core";
import { productVisibilityHref } from "@/lib/pos/pos-import-fix-core";
import { saveMergeDecisionAction, forgetMergeDecisionAction } from "../../actions";

export const dynamic = "force-dynamic";

const MATCHED_LABEL: Record<MatchedOn, string> = {
  vendor: "same vendor",
  category: "same category",
  family: "same product name",
};

function safeBack(v: unknown): string | null {
  const b = typeof v === "string" ? v.trim() : "";
  return b.startsWith("/admin/") && !b.startsWith("//") ? b : null;
}

export default async function MatchReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ identity?: string; back?: string; merge?: string; merge_msg?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const manifestId = String(id ?? "").trim().toLowerCase();
  const identity = typeof sp.identity === "string" ? sp.identity.trim() : "";
  const back = safeBack(sp.back);
  const backTo = back ?? `/admin/inventory/intake/${manifestId}`;
  const result = parseMergeResult(sp.merge);

  const header = (
    <AdminPageHeader
      title={MERGE_REVIEW_COPY.heading}
      subtitle="Where does this delivered product belong on your menu?"
      breadcrumbs={
        <Breadcrumbs
          items={[
            { label: "Intake", href: "/admin/inventory/intake" },
            { label: "Delivery", href: `/admin/inventory/intake/${manifestId}` },
            { label: "Compare & choose" },
          ]}
        />
      }
      action={
        <Link
          href={backTo}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
        >
          Back
        </Link>
      }
    />
  );

  if (!isMergeIdentity(identity) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(manifestId)) {
    return (
      <div>
        {header}
        <div className="px-5 py-6 sm:px-8">
          <Card>
            <p className="text-sm text-[var(--admin-text)]">
              This link is missing which product to compare. Open it again from the Publish page or the delivery.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const [data, saved] = await Promise.all([loadMatchReview(manifestId, identity), getMergeDecision(identity)]);
  const review = data.warning
    ? buildMergeReview({ warning: data.warning, cards: data.cards, liveKeys: data.liveKeys, ownCard: data.ownCard })
    : null;
  const row = saved.row;
  const candidatesJson = review ? JSON.stringify(data.warning?.liveCardKeys ?? []) : "[]";

  const hidden = (decision: "join" | "separate", target?: string) => (
    <>
      <input type="hidden" name="manifestId" value={manifestId} />
      <input type="hidden" name="identity" value={identity} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="candidates" value={candidatesJson} />
      {target ? <input type="hidden" name="target" value={target} /> : null}
      {back ? <input type="hidden" name="back" value={back} /> : null}
    </>
  );

  return (
    <div>
      {header}
      <div className="space-y-5 px-5 py-6 sm:px-8">
        {result ? (
          <div
            role="status"
            className={`rounded-[var(--admin-radius-lg)] border px-4 py-3 text-sm text-[var(--admin-text)] ${
              result === "error" || result === "migration" || result === "rebuild" || result === "held"
                ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10"
                : "border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10"
            }`}
          >
            {mergeResultCopy(result, sp.merge_msg ?? null)}
            {result === "held" ? (
              <>
                {" "}
                <Link href="/admin/publish" className="text-[var(--admin-accent)] underline">
                  Open the Publish page
                </Link>
              </>
            ) : null}
          </div>
        ) : null}

        {!saved.migrated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            {MERGE_REVIEW_COPY.migration}
          </div>
        ) : null}

        {row ? (
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--admin-text)]">
                Your saved choice:{" "}
                <strong>
                  {row.decision === "join" ? (
                    <>
                      join card <span className="font-mono">{row.target_card_key}</span>
                    </>
                  ) : (
                    "keep it as its own card"
                  )}
                </strong>
                {data.decided ? " \u2014 in effect on this delivery's newest menu update." : null}
              </p>
              <form action={forgetMergeDecisionAction}>
                <input type="hidden" name="manifestId" value={manifestId} />
                <input type="hidden" name="identity" value={identity} />
                {back ? <input type="hidden" name="back" value={back} /> : null}
                <Button type="submit" variant="neutral" size="sm">
                  {MERGE_REVIEW_COPY.forget}
                </Button>
              </form>
            </div>
          </Card>
        ) : null}

        {!data.ok ? (
          <Card>
            <p className="text-sm text-[var(--admin-text)]">
              This delivery&apos;s menu update could not be read right now, so there is nothing safe to show. Try again in a
              moment.
            </p>
          </Card>
        ) : !review ? (
          <Card>
            <p className="text-sm text-[var(--admin-text)]">{MERGE_REVIEW_COPY.notFound}</p>
            {data.decided ? (
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                Your choice ({data.decided === "join" ? "join a card" : "keep separate"}) was applied to this product on
                the newest update.
              </p>
            ) : null}
          </Card>
        ) : (
          <>
            <p className="text-sm text-[var(--admin-text-muted)]">{MERGE_REVIEW_COPY.lead}</p>
            {review.staleDecision ? (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
                {MERGE_REVIEW_COPY.stale}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--admin-gold)]">Delivered product</p>
                <h2 className="mt-1 text-lg font-bold text-[var(--admin-text)]">{review.newProduct.name}</h2>
                <dl className="mt-3 space-y-1 text-sm">
                  <div>
                    <dt className="inline text-[var(--admin-text-muted)]">Vendor: </dt>
                    <dd className="inline text-[var(--admin-text)]">{review.newProduct.vendor || "\u2014"}</dd>
                  </div>
                  <div>
                    <dt className="inline text-[var(--admin-text-muted)]">Brand: </dt>
                    <dd className="inline text-[var(--admin-text)]">{review.newProduct.brand || "\u2014"}</dd>
                  </div>
                  <div>
                    <dt className="inline text-[var(--admin-text-muted)]">Category: </dt>
                    <dd className="inline text-[var(--admin-text)]">{review.newProduct.category}</dd>
                  </div>
                  <div>
                    <dt className="inline text-[var(--admin-text-muted)]">Sizes: </dt>
                    <dd className="inline text-[var(--admin-text)]">{review.newProduct.sizes.join(", ") || "\u2014"}</dd>
                  </div>
                  <div>
                    <dt className="inline text-[var(--admin-text-muted)]">Lots: </dt>
                    <dd className="inline font-mono text-xs text-[var(--admin-text)]">{review.newProduct.lots.join(", ")}</dd>
                  </div>
                </dl>
                <form action={saveMergeDecisionAction} className="mt-4">
                  {hidden("separate")}
                  <Button type="submit" variant="neutral" size="sm">
                    {MERGE_REVIEW_COPY.separate}
                  </Button>
                </form>
              </Card>

              {review.candidates.map((c) => (
                <Card key={c.cardKey}>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
                    Card on your menu
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--admin-text)]">{c.name}</h2>
                  <p className="font-mono text-xs text-[var(--admin-text-muted)]">{c.cardKey}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.matchedOn.map((m) => (
                      <Badge key={m} tone="green">
                        {MATCHED_LABEL[m]}
                      </Badge>
                    ))}
                    {c.hidden ? <Badge tone="orange">hidden</Badge> : null}
                    {!c.onLiveMenu ? <Badge tone="neutral">not on the live menu now</Badge> : null}
                  </div>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div>
                      <dt className="inline text-[var(--admin-text-muted)]">Vendor: </dt>
                      <dd className="inline text-[var(--admin-text)]">{c.vendor || "\u2014"}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--admin-text-muted)]">Brand: </dt>
                      <dd className="inline text-[var(--admin-text)]">{c.brand || "\u2014"}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--admin-text-muted)]">Category: </dt>
                      <dd className="inline text-[var(--admin-text)]">{c.category}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--admin-text-muted)]">Sizes: </dt>
                      <dd className="inline text-[var(--admin-text)]">{c.sizes.join(", ") || "\u2014"}</dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <form action={saveMergeDecisionAction}>
                      {hidden("join", c.cardKey)}
                      <Button type="submit" variant="confirm" size="sm">
                        {MERGE_REVIEW_COPY.join}
                      </Button>
                    </form>
                    {c.onLiveMenu ? (
                      <Link href={productVisibilityHref(c.cardKey)} className="text-sm text-[var(--admin-accent)] underline">
                        {MERGE_REVIEW_COPY.hide}
                      </Link>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>

            {review.missingCardKeys.length > 0 ? (
              <p className="text-sm text-[var(--admin-text-muted)]">
                {review.missingCardKeys.length} matched card(s) could not be read from this update (
                <span className="font-mono">{review.missingCardKeys.join(", ")}</span>); choosing is still safe - your
                choice only counts while the matched cards stay exactly these.
              </p>
            ) : null}
            <p className="text-sm text-[var(--admin-text-muted)]">{MERGE_REVIEW_COPY.hideWhy}</p>
          </>
        )}
      </div>
    </div>
  );
}
