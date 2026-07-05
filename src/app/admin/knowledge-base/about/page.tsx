/**
 * /admin/knowledge-base/about
 *
 * Store/brand FACTS (KB hardening v2, Slice 4). Owner-extendable "about us"
 * cards — hours, address, phone, payment, delivery, mission statement, and
 * anything else the owner wants the concierge to know about Greenway. Where the
 * product KB teaches the AI about strains/effects/formats, THIS teaches it about
 * the store itself so it never guesses a store detail.
 *
 * Every seeded fact is owner-confirmed or mirrored from the live customer site.
 * The owner can ADD, EDIT, and HIDE facts right here (no code needed).
 *
 * COMPLIANCE (WA I-502): policy/marketing language only — no medical claims, no
 * minor-appeal, no dosing. Copy is checked by the same gate as all KB content.
 *
 * Degrades to a pre-migration notice if kb_store_facts is empty (0090 not yet
 * applied) — nothing breaks before the owner applies the migration.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbStoreFactsFull, type KbStoreFactRow } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";
import { upsertKbStoreFactAction, toggleKbStoreFactAction } from "../actions";

export const dynamic = "force-dynamic";

const CATEGORY_OPTIONS = ["basics", "payment", "policies", "about", "other"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  basics: "Basics",
  payment: "Payment",
  policies: "Policies",
  about: "About us",
  other: "Other",
};

const inputClass =
  "w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";

function FactForm({ fact }: { fact?: KbStoreFactRow }) {
  const isEdit = Boolean(fact);
  return (
    <form action={upsertKbStoreFactAction} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Key (stable slug)</label>
          <input
            name="key"
            defaultValue={fact?.key ?? ""}
            readOnly={isEdit}
            placeholder="mission"
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className={labelClass}>Label (heading)</label>
          <input name="label" defaultValue={fact?.label ?? ""} placeholder="Our mission" className={inputClass} required />
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select name="category" defaultValue={fact?.category ?? "basics"} className={inputClass}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Sort order</label>
          <input name="sort_order" type="number" defaultValue={fact?.sort_order ?? 100} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>The fact (in our voice)</label>
        <textarea name="body" defaultValue={fact?.body ?? ""} rows={3} className={inputClass} required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Tags (comma-separated, for matching)</label>
          <input name="tags" defaultValue={fact?.tags?.join(", ") ?? ""} placeholder="hours, open" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Sources (comma-separated)</label>
          <input name="sources" defaultValue={fact?.sources?.join(", ") ?? ""} placeholder="owner-confirmed" className={inputClass} />
        </div>
      </div>
      <button
        type="submit"
        className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white"
      >
        {isEdit ? "Save changes" : "Add fact"}
      </button>
    </form>
  );
}

export default async function KbAboutPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const facts = await listKbStoreFactsFull();

  return (
    <div>
      <AdminPageHeader
        title="About us & store facts"
        subtitle="Everything the AI should know about Greenway — hours, address, payment, mission, and more. Add your own any time."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "About us" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          These are the store facts the concierge leans on so it never guesses a store detail.
          Anything you add here (mission statement, an &ldquo;about us&rdquo; blurb, parking notes,
          seasonal hours&mdash;whatever) becomes reliable, on-brand knowledge. Keep it factual and in
          our voice; the same compliance gate applies as everywhere else in the KB.
        </p>

        {/* Add new */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-lg font-bold text-[var(--admin-text)]">Add a store fact</h2>
          <FactForm />
        </div>

        {facts.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No store facts loaded yet. Apply migration{" "}
            <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-xs">0090_kb_store_voice_faq.sql</code>{" "}
            then load the starter set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-3">
            {facts.map((f) => (
              <div
                key={f.id}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
                style={{ opacity: f.active ? 1 : 0.55 }}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-lg font-bold text-[var(--admin-text)]">{f.label}</span>
                    <span className="ml-2 rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-xs text-[var(--admin-text-muted)]">
                      {CATEGORY_LABELS[f.category] ?? f.category}
                    </span>
                    <span className="ml-2 text-xs text-[var(--admin-text-faint)]">{f.key}</span>
                    {!f.active ? (
                      <span className="ml-2 text-xs font-semibold text-[var(--admin-text-faint)]">(hidden)</span>
                    ) : null}
                  </div>
                  <form action={toggleKbStoreFactAction}>
                    <input type="hidden" name="key" value={f.key} />
                    <input type="hidden" name="active" value={(!f.active).toString()} />
                    <button type="submit" className="text-xs font-semibold text-[var(--admin-accent)] underline">
                      {f.active ? "Hide" : "Show"}
                    </button>
                  </form>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-[var(--admin-text)]">{f.body}</summary>
                  <div className="mt-4 border-t border-[var(--admin-border)] pt-4">
                    <FactForm fact={f} />
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
