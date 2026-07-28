import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Select, Button, Badge } from "@/components/admin/ui";
import {
  listWebsiteCategoryTypes,
  listInventoryTypes,
} from "@/lib/pos/types-store";
import {
  createWebsiteCategory,
  updateWebsiteCategory,
  deleteWebsiteCategory,
  createInventoryType,
  updateInventoryType,
  deleteInventoryType,
  reassignCategoryAction,
} from "./actions";
// SLICE 78: real cross-surface usage counts + live-menu orphan detection.
import { countAllCategoryUsage, findMenuOrphans } from "@/lib/pos/category-registry";
import type { ReassignCounts } from "@/lib/pos/category-registry-core";

export const dynamic = "force-dynamic";

const BASE = "/admin/settings/types";

function flashMessage(saved?: string, reason?: string): { tone: "ok" | "warn"; text: string } | null {
  if (!saved) return null;
  switch (saved) {
    case "category":
      return { tone: "ok", text: "Website category saved." };
    case "inventory":
      return { tone: "ok", text: "Inventory type saved." };
    case "deleted":
      return { tone: "ok", text: "Deleted." };
    case "reassigned": {
      const n = Number(reason) || 0;
      return {
        tone: "ok",
        text: `Done — ${n} record${n === 1 ? "" : "s"} moved to the new category. The customer menu updated immediately.`,
      };
    }
    case "deactivated": {
      if (reason === "system") return { tone: "warn", text: "This is a built-in type, so it was hidden (deactivated) instead of deleted. Historical data stays intact." };
      if (reason?.startsWith("in-use-")) {
        const n = reason.replace("in-use-", "");
        return { tone: "warn", text: `Still used by ${n} live item(s), so it was hidden (deactivated) instead of deleted. Historical data stays intact.` };
      }
      return { tone: "warn", text: "Hidden (deactivated)." };
    }
    default:
      return { tone: "ok", text: "Saved." };
  }
}

export default async function TypesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; reason?: string; tab?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const tab = sp.tab === "inventory" ? "inventory" : "website";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Types & Categories" subtitle="Manage website categories and inventory types." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once setup is complete, your
            categories and inventory types will appear here. For now the public
            menu uses the built-in category list.
          </div>
        </div>
      </div>
    );
  }

  const [categories, inventoryTypes, menuOrphans] = await Promise.all([
    listWebsiteCategoryTypes({ includeInactive: true }),
    listInventoryTypes({ includeInactive: true }),
    findMenuOrphans(),
  ]);
  // SLICE 78: real per-surface usage (live menu, staged drafts, onboarding
  // picks, type mappings) for every category — powers the usage badges and
  // the bulk-reassign preview. Counted from the tables, never guessed.
  const usage = Object.fromEntries(await countAllCategoryUsage(categories.map((c) => c.value)));

  const activeCats = categories.filter((c) => c.is_active).length;
  const activeInv = inventoryTypes.filter((t) => t.is_active).length;
  const flash = flashMessage(sp.saved, sp.reason);

  return (
    <div>
      <AdminPageHeader
        title="Types & Categories"
        subtitle="Rename labels, edit help text, reorder, and activate or hide the categories that group your menu — and catalog the POS inventory types behind them."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin" }, { label: "Types & Categories" }]} />}
        help={
          <HelpPanel
            id="types-categories"
            title="How types & categories work"
            steps={[
              "Website categories control how products are grouped on your public menu.",
              "Inventory types are the raw POS labels that arrive with imported stock — map each one to a website category.",
              "Editing a label here changes it everywhere instantly. Nothing in your sales history changes.",
              "Built-in or in-use types can be hidden but never permanently deleted, so old data always resolves.",
            ]}
          >
            <p>
              Renaming a category only changes how it&apos;s <strong>displayed</strong>.
              Hidden categories stop appearing in pickers but still resolve on
              historical orders and reports.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {flash && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              flash.tone === "ok"
                ? "border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
                : "border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
            }`}
          >
            {flash.text}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Website categories" value={categories.length} hint={`${activeCats} active`} accent="green" />
          <StatCard label="Hidden categories" value={categories.length - activeCats} accent="muted" />
          <StatCard label="Inventory types" value={inventoryTypes.length} hint={`${activeInv} active`} accent="gold" />
          <StatCard label="Hidden inventory types" value={inventoryTypes.length - activeInv} accent="muted" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[var(--admin-border)]">
          <a
            href={`${BASE}?tab=website`}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === "website"
                ? "border-b-2 border-[var(--admin-accent)] text-white"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            Website Categories
          </a>
          <a
            href={`${BASE}?tab=inventory`}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === "inventory"
                ? "border-b-2 border-[var(--admin-accent)] text-white"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            Inventory Types
          </a>
        </div>

        {tab === "website" ? (
          <WebsiteCategoriesTab categories={categories} usage={usage} menuOrphans={menuOrphans} />
        ) : (
          <InventoryTypesTab inventoryTypes={inventoryTypes} categories={categories} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Website categories tab
// ---------------------------------------------------------------------------

function usageTotal(u: ReassignCounts | undefined): number {
  if (!u) return 0;
  return u.publishedItems + u.stagedItems + u.draftPicks + u.typeMappings;
}

function usageSummary(u: ReassignCounts | undefined): string {
  if (!u) return "not used anywhere";
  const parts: string[] = [];
  if (u.publishedItems > 0) parts.push(`${u.publishedItems} on the live menu`);
  if (u.stagedItems > 0) parts.push(`${u.stagedItems} on staged drafts`);
  if (u.draftPicks > 0) parts.push(`${u.draftPicks} onboarding pick${u.draftPicks === 1 ? "" : "s"}`);
  if (u.typeMappings > 0) parts.push(`${u.typeMappings} inventory-type mapping${u.typeMappings === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "not used anywhere";
}

function WebsiteCategoriesTab({
  categories,
  usage,
  menuOrphans,
}: {
  categories: Awaited<ReturnType<typeof listWebsiteCategoryTypes>>;
  usage: Record<string, ReassignCounts>;
  menuOrphans: string[];
}) {
  const activeCategories = categories.filter((c) => c.is_active);
  return (
    <div className="space-y-6">
      {/* SLICE 78: live-menu orphans — category values on the published menu
          that no longer exist in the registry. Plain-English fix path. */}
      {menuOrphans.length > 0 && (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-5">
          <h3 className="mb-2 text-sm font-semibold text-[var(--admin-gold)]">
            Heads up — {menuOrphans.length} categor{menuOrphans.length === 1 ? "y" : "ies"} on your live menu {menuOrphans.length === 1 ? "isn't" : "aren't"} in this list
          </h3>
          <p className="mb-3 text-xs text-[var(--admin-gold)]/80">
            Products filed under these values still show on the customer site (with an
            auto-generated name), but you can&apos;t manage them here. Either add the
            category below with the same value, or use &ldquo;Move products between
            categories&rdquo; to file them somewhere you do manage.
          </p>
          <div className="flex flex-wrap gap-2">
            {menuOrphans.map((v) => (
              <span key={v} className="rounded border border-[var(--admin-gold)]/40 px-2 py-1 font-mono text-[11px] text-[var(--admin-gold)]">
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* SLICE 78: bulk reassign — move everything from one category to another. */}
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="mb-1 text-sm font-semibold text-white">Move products between categories</h3>
        <p className="mb-4 text-xs text-white/50">
          Moves everything at once: live menu, staged drafts, onboarding picks, and the
          inventory-type mappings (so future intake follows). Your sales history and
          archived menus are never touched. The change is recorded in the audit log.
        </p>
        <form action={reassignCategoryAction} className="grid gap-4 sm:grid-cols-3">
          <Field label="Move everything from" required>
            <Select name="from" required defaultValue="">
              <option value="" disabled>
                Pick the source…
              </option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                  {c.is_active ? "" : " (hidden)"} — {usageTotal(usage[c.value])} record{usageTotal(usage[c.value]) === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Into" required>
            <Select name="to" required defaultValue="">
              <option value="" disabled>
                Pick the target…
              </option>
              {activeCategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit">Move products</Button>
          </div>
        </form>
      </div>
      {/* Add new */}
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Add a website category</h3>
        <form action={createWebsiteCategory} className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" required help="Shown on the public menu (e.g. “Flower”).">
            <Input name="label" placeholder="e.g. Live Resin" required />
          </Field>
          <Field label="Value (optional)" help="URL-safe slug. Auto-derived from the label if left blank.">
            <Input name="value" placeholder="auto" />
          </Field>
          <Field label="Helper text" className="sm:col-span-2" help="A short description staff can read when assigning products.">
            <Textarea name="helper" placeholder="What kinds of products belong here?" />
          </Field>
          <Field label="Sort order" help="Lower numbers show first.">
            <Input name="sort_order" type="number" defaultValue={999} />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add category</Button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="space-y-3">
        {categories.map((c) => (
          <details
            key={c.value}
            className="group rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <span className="font-mono text-[10px] text-white/30">#{c.sort_order}</span>
              <span className="flex-1 text-sm font-semibold text-white">{c.label}</span>
              <span className="font-mono text-[11px] text-white/30">{c.value}</span>
              {/* SLICE 78: real cross-surface usage at a glance. */}
              <Badge tone={usageTotal(usage[c.value]) > 0 ? "green" : "neutral"}>
                {usageTotal(usage[c.value])} in use
              </Badge>
              {c.is_system && <Badge tone="neutral">built-in</Badge>}
              {c.is_active ? (
                <Badge tone="green">active</Badge>
              ) : (
                <Badge tone="gold">hidden</Badge>
              )}
            </summary>
            <div className="border-t border-[var(--admin-border)] px-4 py-4">
              {/* SLICE 78: plain-English breakdown of where this category is used. */}
              <p className="mb-4 text-xs text-white/50">
                Where it&apos;s used: {usageSummary(usage[c.value])}.
              </p>
              <form action={updateWebsiteCategory} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="value" value={c.value} />
                <Field label="Label" required>
                  <Input name="label" defaultValue={c.label} required />
                </Field>
                <Field label="Sort order">
                  <Input name="sort_order" type="number" defaultValue={c.sort_order} />
                </Field>
                <Field label="Helper text" className="sm:col-span-2">
                  <Textarea name="helper" defaultValue={c.helper} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" name="is_active" defaultChecked={c.is_active} className="h-4 w-4" />
                  Active (show in pickers and on the menu)
                </label>
                <div className="flex items-end justify-end gap-2">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteWebsiteCategory} className="mt-3 border-t border-[var(--admin-border)] pt-3">
                <input type="hidden" name="value" value={c.value} />
                <p className="mb-2 text-xs text-white/40">
                  {c.is_system
                    ? "Built-in categories can’t be permanently deleted — deleting hides them instead."
                    : usageTotal(usage[c.value]) > 0
                      ? `This category has ${usageTotal(usage[c.value])} record${usageTotal(usage[c.value]) === 1 ? "" : "s"} attached (${usageSummary(usage[c.value])}), so deleting will hide it instead. Use “Move products between categories” first if you want a clean delete.`
                      : "Not used anywhere — deleting removes it permanently."}
                </p>
                <Button type="submit" variant="neutral">
                  {c.is_system ? "Hide category" : "Delete category"}
                </Button>
              </form>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory types tab
// ---------------------------------------------------------------------------

function InventoryTypesTab({
  inventoryTypes,
  categories,
}: {
  inventoryTypes: Awaited<ReturnType<typeof listInventoryTypes>>;
  categories: Awaited<ReturnType<typeof listWebsiteCategoryTypes>>;
}) {
  const activeCategories = categories.filter((c) => c.is_active);
  const categoryLabel = (value: string | null) =>
    (value && categories.find((c) => c.value === value)?.label) || null;

  // Group the (preloaded) types by their website category, in taxonomy order so
  // the table reads top-to-bottom like the public menu. Types are alphabetized
  // within each group. Types with no mapping fall into an "Unmapped" bucket last.
  const order = categories.map((c) => c.value);
  const groupsMap = new Map<string, typeof inventoryTypes>();
  const UNMAPPED = "__unmapped__";
  for (const t of inventoryTypes) {
    const cat = t.website_category ?? UNMAPPED;
    const list = groupsMap.get(cat) ?? [];
    list.push(t);
    groupsMap.set(cat, list);
  }
  const orderedCats: string[] = [];
  for (const c of order) if (groupsMap.has(c)) orderedCats.push(c);
  for (const c of groupsMap.keys()) if (!orderedCats.includes(c) && c !== UNMAPPED) orderedCats.push(c);
  if (groupsMap.has(UNMAPPED)) orderedCats.push(UNMAPPED);

  const totalTypes = inventoryTypes.length;

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]/60 px-4 py-3 text-xs text-white/60">
        These are the inventory types Greenway carries, preloaded and grouped by
        the website category each maps to. Built-in types are ready to use out of
        the box — edit one to fine-tune its label, mapping, or notes (that saves
        your own copy), or add a brand-new type below. Imported stock also lands
        here automatically.
      </div>

      {/* Add new */}
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Add an inventory type</h3>
        <form action={createInventoryType} className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" required help="Friendly name (e.g. “Live Resin Cartridge”).">
            <Input name="label" placeholder="e.g. Live Resin Cartridge" required />
          </Field>
          <Field label="Key (optional)" help="Canonical matching key. Auto-derived (lowercase) from the label if blank.">
            <Input name="key" placeholder="auto" />
          </Field>
          <Field label="Maps to website category" help="Groups items of this type on the public menu.">
            <Select name="website_category" defaultValue="">
              <option value="">— none —</option>
              {activeCategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" help="Optional staff notes.">
            <Input name="notes" placeholder="Anything to remember about this type" />
          </Field>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit">Add inventory type</Button>
          </div>
        </form>
      </div>

      {/* Grouped list */}
      {totalTypes === 0 ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border)] p-8 text-center text-sm text-white/50">
          No inventory types catalogued yet. They populate automatically as stock
          is imported, or add one above.
        </div>
      ) : (
        <div className="space-y-6">
          {orderedCats.map((cat) => {
            const rows = (groupsMap.get(cat) ?? [])
              .slice()
              .sort((a, b) => a.label.localeCompare(b.label));
            const label = cat === UNMAPPED ? "Unmapped (no website category)" : categoryLabel(cat) ?? cat;
            return (
              <section
                key={cat}
                className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface)]/80 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-white">{label}</h3>
                  <span className="text-[11px] text-white/40">
                    {rows.length} type{rows.length === 1 ? "" : "s"}
                  </span>
                </header>
                <div className="divide-y divide-[var(--admin-border)]">
                  {rows.map((t) => (
                    <details key={t.id} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                        <span className="flex-1 text-sm font-medium text-white">{t.label}</span>
                        <span className="hidden font-mono text-[11px] text-white/25 sm:inline">{t.key}</span>
                        {t.is_system && <Badge tone="neutral">built-in</Badge>}
                        {t.is_active ? (
                          <Badge tone="green">active</Badge>
                        ) : (
                          <Badge tone="gold">hidden</Badge>
                        )}
                        <span className="text-white/25 transition group-open:rotate-180" aria-hidden>
                          ▾
                        </span>
                      </summary>
                      <div className="border-t border-[var(--admin-border)] bg-[var(--admin-surface)]/40 px-4 py-4">
                        <form action={updateInventoryType} className="grid gap-4 sm:grid-cols-2">
                          <input type="hidden" name="id" value={t.id} />
                          <Field label="Label" required>
                            <Input name="label" defaultValue={t.label} required />
                          </Field>
                          <Field label="Maps to website category">
                            <Select name="website_category" defaultValue={t.website_category ?? ""}>
                              <option value="">— none —</option>
                              {activeCategories.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Notes" className="sm:col-span-2">
                            <Textarea name="notes" defaultValue={t.notes ?? ""} />
                          </Field>
                          <label className="flex items-center gap-2 text-sm text-white/70">
                            <input type="checkbox" name="is_active" defaultChecked={t.is_active} className="h-4 w-4" />
                            Active (show in pickers)
                          </label>
                          <div className="flex items-end justify-end gap-2">
                            <Button type="submit">Save</Button>
                          </div>
                        </form>
                        <form action={deleteInventoryType} className="mt-3 border-t border-[var(--admin-border)] pt-3">
                          <input type="hidden" name="id" value={t.id} />
                          <p className="mb-2 text-xs text-white/40">
                            {t.is_system
                              ? "Built-in types can’t be permanently deleted — deleting hides them instead."
                              : "If this type is used by live stock, it will be hidden instead of permanently deleted."}
                          </p>
                          <Button type="submit" variant="neutral">
                            {t.is_system ? "Hide type" : "Delete type"}
                          </Button>
                        </form>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
