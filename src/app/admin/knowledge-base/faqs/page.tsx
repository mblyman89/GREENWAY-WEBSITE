/**
 * /admin/knowledge-base/faqs
 *
 * FAQ pack (KB hardening v2, Slice 4). Curated + owner-extendable Q&A the
 * concierge answers from, in Greenway's voice. Seeded from the verified store
 * facts and the live customer FAQ/price-match pages; the owner can ADD, EDIT,
 * and HIDE entries here without touching code.
 *
 * COMPLIANCE (WA I-502): every answer passes the same gate as all KB copy — no
 * medical claims, no minor-appeal, no dosing directives.
 *
 * NOTE: the loyalty FAQ deliberately carries no hard-coded earn rate. At
 * grounding time the retrieval layer stitches the LIVE rate from loyalty_config
 * onto it, so the concierge can never quote a stale number.
 *
 * Degrades to a pre-migration notice if kb_faqs is empty (0090 not yet applied).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button, CHIP_ACTION } from "@/components/admin/ui";
import { listKbFaqsFull, type KbFaqRow } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";
import { upsertKbFaqAction, toggleKbFaqAction } from "../actions";

export const dynamic = "force-dynamic";

const CATEGORY_OPTIONS = ["basics", "buying", "compliance", "products", "loyalty", "other"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  basics: "Basics",
  buying: "Buying",
  compliance: "Compliance",
  products: "Products",
  loyalty: "Loyalty",
  other: "Other",
};

const inputClass =
  "w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";

function FaqForm({ faq }: { faq?: KbFaqRow }) {
  const isEdit = Boolean(faq);
  return (
    <form action={upsertKbFaqAction} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Slug (stable id)</label>
          <input
            name="slug"
            defaultValue={faq?.slug ?? ""}
            readOnly={isEdit}
            placeholder="parking"
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select name="category" defaultValue={faq?.category ?? "basics"} className={inputClass}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass}>Question</label>
        <input name="question" defaultValue={faq?.question ?? ""} placeholder="Is there parking?" className={inputClass} required />
      </div>
      <div>
        <label className={labelClass}>Answer (in our voice)</label>
        <textarea name="answer" defaultValue={faq?.answer ?? ""} rows={4} className={inputClass} required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className={labelClass}>Sort order</label>
          <input name="sort_order" type="number" defaultValue={faq?.sort_order ?? 100} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Tags (comma-separated)</label>
          <input name="tags" defaultValue={faq?.tags?.join(", ") ?? ""} placeholder="parking, ada" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Sources (comma-separated)</label>
          <input name="sources" defaultValue={faq?.sources?.join(", ") ?? ""} placeholder="owner-confirmed" className={inputClass} />
        </div>
      </div>
      <Button type="submit" variant="confirm" size="sm">
        {isEdit ? "Save changes" : "Add FAQ"}
      </Button>
    </form>
  );
}

export default async function KbFaqsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const faqs = await listKbFaqsFull();

  return (
    <div>
      <AdminPageHeader
        title="FAQ pack"
        subtitle="The questions customers actually ask, answered in our voice — the concierge leans on these instead of guessing."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "FAQs" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {faqs.length} FAQ{faqs.length === 1 ? "" : "s"} in the pack. These mirror the verified
          answers on our website and store facts, written the way we&apos;d actually say them. Add
          your own any time&mdash;the more the concierge knows, the fewer questions it has to punt on.
          The loyalty answer pulls the <em>live</em> earn rate from your loyalty settings, so it never
          goes stale.
        </p>

        {/* Add new */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-lg font-bold text-[var(--admin-text)]">Add an FAQ</h2>
          <FaqForm />
        </div>

        {faqs.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No FAQs loaded yet. Apply migration{" "}
            <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-xs">0090_kb_store_voice_faq.sql</code>{" "}
            then load the starter set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-3">
            {faqs.map((q) => (
              <div
                key={q.id}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
                style={{ opacity: q.active ? 1 : 0.55 }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-base font-bold text-[var(--admin-text)]">{q.question}</span>
                    <span className="ml-2 rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-xs text-[var(--admin-text-muted)]">
                      {CATEGORY_LABELS[q.category] ?? q.category}
                    </span>
                    {!q.active ? (
                      <span className="ml-2 text-xs font-semibold text-[var(--admin-text-faint)]">(hidden)</span>
                    ) : null}
                  </div>
                  <form action={toggleKbFaqAction}>
                    <input type="hidden" name="slug" value={q.slug} />
                    <input type="hidden" name="active" value={(!q.active).toString()} />
                    <button type="submit" className={CHIP_ACTION}>
                      {q.active ? "Hide" : "Show"}
                    </button>
                  </form>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-[var(--admin-text-muted)]">{q.answer}</summary>
                  <div className="mt-4 border-t border-[var(--admin-border)] pt-4">
                    <FaqForm faq={q} />
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
