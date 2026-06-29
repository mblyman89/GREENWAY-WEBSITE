import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { HelpPanel } from "@/components/admin/ux/HelpPanel";
import { Button } from "@/components/admin/ui/Button";
import {
  getKbCounts,
  listKbStrains,
  listKbBrands,
  listKbBanned,
} from "@/lib/ai/kb/store";
import {
  seedKbAction,
  addBannedPhraseAction,
  toggleBannedAction,
  upsertBrandAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const counts = await getKbCounts();
  const [strains, brands, banned] = await Promise.all([
    listKbStrains(50),
    listKbBrands(50),
    listKbBanned(200),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Knowledge Base"
        subtitle="The expert facts the AI is allowed to use when writing product copy"
      />

      <div className="px-5 py-6 sm:px-8 space-y-6">
        {msg ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
            {msg}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
            {error}
          </div>
        ) : null}

        <HelpPanel id="kb-help" title="What is the knowledge base?">
          <p>
            Your point-of-sale data is thin — often just a product name and a category. To write
            genuinely <strong>expert, accurate</strong> descriptions, the AI needs real facts to work
            from. The knowledge base is that source of truth: a curated list of <em>strains</em> (with
            their lineage and typical aroma/flavor), <em>terpenes</em> (what each one smells and tastes
            like), <em>category words</em> (the right way to describe flower vs. vapes vs. edibles), and
            <em> brand notes</em>.
          </p>
          <p className="mt-2">
            When you ask the AI to write a description, it looks up the matching facts here and is told
            to <strong>use only those facts</strong> — so it never invents a strain lineage or a terpene
            that isn&apos;t real. The more you fill this in, the better and more trustworthy the copy.
          </p>
          <p className="mt-2">
            Start by clicking <strong>Seed expert starter set</strong> below to load a solid baseline of
            common strains, terpenes, and category vocabulary. Then edit or add to it any time.
          </p>
          <p className="mt-2 text-[var(--admin-text-muted)]">
            Everything here is <strong>sensory and factual only</strong> — aroma, flavor, format,
            lineage. There is deliberately no place to record health or effect claims, because
            Washington advertising rules don&apos;t allow them.
          </p>
        </HelpPanel>

        {!counts.migrated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-4 text-sm text-[var(--admin-text)]">
            <p className="font-medium">The knowledge base isn&apos;t fully set up yet.</p>
            <p className="mt-1 text-[var(--admin-text-muted)]">
              Once your administrator finishes the one-time database setup, this page will let you seed
              and manage the AI&apos;s reference facts.
            </p>
          </div>
        ) : null}

        {/* Counts */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Strains" value={counts.strains} accent="green" />
          <StatCard label="Terpenes" value={counts.terpenes} accent="gold" />
          <StatCard label="Categories" value={counts.categories} accent="muted" />
          <StatCard label="Brand facts" value={counts.brands} accent="muted" />
          <StatCard label="Banned phrases" value={counts.banned} accent="orange" />
        </div>

        {/* Seed */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Expert starter set</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Loads a curated baseline of common strains, the terpene aroma/flavor map, and per-category
            vocabulary. It&apos;s safe to run more than once — it refreshes the starter rows and leaves
            anything you&apos;ve added untouched.
          </p>
          <form action={seedKbAction} className="mt-4">
            <Button type="submit" variant="primary" disabled={!counts.migrated}>
              Seed expert starter set
            </Button>
          </form>
        </section>

        {/* Strains preview */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Strains ({counts.strains})</h2>
          {strains.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              No strains yet. Click <strong>Seed expert starter set</strong> to load the baseline.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--admin-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Strain</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Aroma</th>
                    <th className="py-2 pr-4 font-medium">Terpenes</th>
                  </tr>
                </thead>
                <tbody>
                  {strains.map((s) => (
                    <tr key={s.id} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-4 text-[var(--admin-text)]">{s.name}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{s.strain_type ?? "—"}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{(s.aroma_notes ?? []).join(", ") || "—"}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{(s.terpenes ?? []).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {counts.strains > strains.length ? (
                <p className="mt-2 text-xs text-[var(--admin-text-muted)]">Showing first {strains.length} of {counts.strains}.</p>
              ) : null}
            </div>
          )}
        </section>

        {/* Brand facts */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Brand facts ({counts.brands})</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Tell the AI what each brand is known for, so it can write copy that matches their style.
          </p>
          <form action={upsertBrandAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Brand name</span>
              <input name="name" required className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. Avitas" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Known for</span>
              <input name="known_for" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. clean live-resin vape cartridges" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">House style (voice)</span>
              <input name="house_style" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. clean, modern, understated" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Sensory notes (comma-separated)</span>
              <input name="sensory_notes" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. bright, true-to-strain, smooth" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="subtle" disabled={!counts.migrated}>Save brand facts</Button>
            </div>
          </form>

          {brands.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--admin-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Brand</th>
                    <th className="py-2 pr-4 font-medium">Known for</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.id} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-4 text-[var(--admin-text)]">{b.name}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{b.known_for ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* Banned phrases */}
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Banned phrases ({counts.banned})</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Extra words or phrases the AI must never use. These are checked on top of the built-in
            compliance rules. A <strong>block</strong> phrase means a draft must be edited before it can
            be accepted; a <strong>warn</strong> is just a heads-up.
          </p>
          <form action={addBannedPhraseAction} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Phrase</span>
              <input name="phrase" required className="mt-1 w-64 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. couch lock" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Severity</span>
              <select name="severity" className="mt-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]">
                <option value="block">Block</option>
                <option value="warn">Warn</option>
              </select>
            </label>
            <label className="text-sm flex-1 min-w-[12rem]">
              <span className="block text-[var(--admin-text-muted)]">Reason (optional)</span>
              <input name="reason" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="why it's banned" />
            </label>
            <Button type="submit" variant="subtle" disabled={!counts.migrated}>Add phrase</Button>
          </form>

          {banned.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--admin-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Phrase</th>
                    <th className="py-2 pr-4 font-medium">Severity</th>
                    <th className="py-2 pr-4 font-medium">Reason</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {banned.map((b) => (
                    <tr key={b.id} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-4 text-[var(--admin-text)]">{b.phrase}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)] capitalize">{b.severity}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{b.reason ?? "—"}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{b.active ? "Active" : "Disabled"}</td>
                      <td className="py-2 pr-4">
                        <form action={toggleBannedAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="active" value={(!b.active).toString()} />
                          <button type="submit" className="text-xs text-[var(--admin-accent)] hover:underline">
                            {b.active ? "Disable" : "Enable"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
