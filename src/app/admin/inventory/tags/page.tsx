/**
 * /admin/inventory/tags  (R49 S5)
 *
 * Owner: "a tag system ... a New tag that is automatically applied when a
 * product is first put on the menu and removed 14 days later (I want to be
 * able to change that) ... a Tag Settings page, opened from a button at the
 * top of the Inventory page next to Expiration rules, where I can create
 * tags, set their colour, and apply or remove them by hand."
 *
 * Server-rendered forms (no client JavaScript):
 *   1. Create a tag (name, colour, order, show on the menu).
 *   2. Your tags: rename / recolour / reorder / turn off / hide from the menu
 *      / delete; the built-in New tag also has its window (days).
 *   3. Pick a tag -> search the live menu -> tick products -> Apply / Remove.
 *      The products that carry the tag by hand are listed with Remove boxes.
 * Every change clears the public menu cache so the shop updates at once.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import {
  MAX_TAG_LABEL,
  MAX_WINDOW_DAYS,
  NEW_TAG_SLUG,
  TAG_COLOR_PRESETS,
  DEFAULT_TAG_COLOR,
  isInNewWindow,
  newWindowEndsAt,
  tagTextColor,
  type TagDefinition,
} from "@/lib/menu/product-tags-core";
import {
  countFirstSeen,
  listAssignmentsForTag,
  listTagDefinitions,
  loadTagInputsForKeys,
  tagClockNowMs,
} from "@/lib/menu/product-tags-store";
import { assignTagAction, createTagAction, deleteTagAction, updateTagAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

const INPUT =
  "admin-focus rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-1 text-sm text-[var(--admin-text)]";
const LABEL = "flex flex-col gap-1 text-xs font-semibold text-[var(--admin-text-muted)]";
const PICKER_LIMIT = 150;

function TagChip({ tag }: { tag: Pick<TagDefinition, "label" | "color"> }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.68rem] font-black uppercase tracking-[0.06em]"
      style={{ background: tag.color, color: tagTextColor(tag.color) }}
    >
      {tag.label}
    </span>
  );
}

function ColorField({ name, value }: { name: string; value: string }) {
  const listId = `${name}-presets`;
  return (
    <label className={LABEL}>
      Colour
      <span className="flex items-center gap-2">
        <input type="color" name={name} defaultValue={value} list={listId} className="h-8 w-12 cursor-pointer rounded border border-[var(--admin-border-strong)] bg-transparent" />
        <datalist id={listId}>
          {TAG_COLOR_PRESETS.map((p) => (
            <option key={p.hex} value={p.hex}>
              {p.name}
            </option>
          ))}
        </datalist>
      </span>
    </label>
  );
}

export default async function TagSettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return <div className="p-8 text-sm text-[var(--admin-text-muted)]">Supabase is not configured in this environment, so tags are unavailable.</div>;
  }

  const defsRead = await listTagDefinitions();
  const defs = defsRead.ok ? defsRead.defs : [];
  const selected = sp.tag ? defs.find((d) => d.id === sp.tag) ?? null : null;
  const newTag = defs.find((d) => d.slug === NEW_TAG_SLUG) ?? null;
  const nowMs = tagClockNowMs();

  // The live menu (hidden items included, so the owner can pre-tag them).
  const menu = defsRead.ok ? await loadLiveMenuAll() : [];
  const nameByKey = new Map(menu.map((m) => [m.id, m]));

  // Products currently "New" (for the New tag card) + first-seen count.
  let newNow: { key: string; name: string; endsAt: string | null }[] = [];
  let firstSeenCount: number | null = null;
  if (defsRead.ok && newTag) {
    const inputs = await loadTagInputsForKeys(menu.map((m) => m.id));
    firstSeenCount = await countFirstSeen();
    if (inputs) {
      newNow = menu
        .filter((m) => isInNewWindow(inputs.firstSeen.get(m.id), nowMs, newTag.windowDays))
        .map((m) => ({ key: m.id, name: m.name, endsAt: newWindowEndsAt(inputs.firstSeen.get(m.id), newTag.windowDays) }))
        .sort((a, b) => (a.endsAt ?? "").localeCompare(b.endsAt ?? ""));
    }
  }

  // Product picker for the selected tag.
  const q = String(sp.q ?? "").trim().toLowerCase();
  const assigned = selected ? await listAssignmentsForTag(selected.id) : null;
  const assignedSet = new Set(assigned && assigned.ok ? assigned.value : []);
  const matches = selected
    ? menu
        .filter((m) => !q || `${m.name} ${m.brand} ${m.vendor ?? ""} ${m.strainName ?? ""} ${m.category}`.toLowerCase().includes(q))
        .slice(0, PICKER_LIMIT)
    : [];
  const totalMatches = selected ? menu.filter((m) => !q || `${m.name} ${m.brand} ${m.vendor ?? ""} ${m.strainName ?? ""} ${m.category}`.toLowerCase().includes(q)).length : 0;

  return (
    <div>
      <AdminPageHeader
        title="Tags"
        subtitle="Label products on the website menu (New, Staff Pick, Local ...). Shoppers see the tags on product cards and can filter by them. The New tag is automatic."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Tags" }]} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button href="/menu" variant="neutral" size="sm">
              View the menu
            </Button>
            <Button href="/admin/inventory" variant="neutral" size="sm">
              Back to inventory
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        {!defsRead.ok ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-text)]">{defsRead.missing ? "One-time setup needed" : "Tags could not be read"}</p>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{defsRead.error}</p>
          </Card>
        ) : null}
        {sp.error ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-danger)]">Nothing was changed</p>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{sp.error}</p>
          </Card>
        ) : null}
        {sp.created || sp.updated || sp.deleted || sp.applied || sp.removed ? (
          <Card accent="green">
            <p className="text-sm text-[var(--admin-text)]" role="status">
              {sp.created ? `Created "${sp.created}". ` : ""}
              {sp.updated ? `Saved "${sp.updated}". ` : ""}
              {sp.deleted ? `Deleted "${sp.deleted}" and removed it from every product. ` : ""}
              {sp.applied ? `Applied to ${sp.applied} product(s). ` : ""}
              {sp.removed ? `Removed from ${sp.removed} product(s).${sp.note ?? ""} ` : ""}
              The website menu updates on the next page load.
            </p>
          </Card>
        ) : null}

        {defsRead.ok ? (
          <>
            {/* 1. Create */}
            <Card>
              <h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--admin-text)]">Create a tag</h2>
              <form action={createTagAction} className="mt-3 flex flex-wrap items-end gap-3">
                <label className={LABEL}>
                  Name
                  <input name="label" required maxLength={MAX_TAG_LABEL} placeholder="Staff Pick" className={`${INPUT} w-48`} />
                </label>
                <ColorField name="color" value={DEFAULT_TAG_COLOR} />
                <label className={LABEL}>
                  Order
                  <input name="sort_order" type="number" min={0} max={10000} defaultValue={100} className={`${INPUT} w-20`} />
                </label>
                <label className="flex items-center gap-2 pb-1 text-xs text-[var(--admin-text-muted)]">
                  <input type="checkbox" name="show_on_menu" defaultChecked /> Show on the website
                </label>
                <Button type="submit" variant="save" size="sm">
                  Create tag
                </Button>
              </form>
              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                Lower order numbers show first on a card (a card shows up to 3 tags). Untick &quot;Show on the website&quot; for a staff-only label.
              </p>
            </Card>

            {/* 2. Your tags */}
            <Card>
              <h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--admin-text)]">Your tags</h2>
              {defs.length === 0 ? <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No tags yet.</p> : null}
              <div className="mt-3 space-y-3">
                {defs.map((d) => (
                  <div key={d.id} className={`rounded-[var(--admin-radius)] border p-3 ${selected?.id === d.id ? "border-[var(--admin-orange)]" : "border-[var(--admin-border)]"}`} data-testid={`tag-row-${d.slug}`}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <TagChip tag={d} />
                      {d.autoRule === "new_window" ? <Badge tone="gold">Automatic</Badge> : null}
                      {!d.enabled ? <Badge tone="neutral">Off</Badge> : null}
                      {!d.showOnMenu ? <Badge tone="outline">Staff only</Badge> : null}
                      <span className="text-xs text-[var(--admin-text-muted)]">link: /menu?tags={d.slug}</span>
                      <Link href={`/admin/inventory/tags?tag=${d.id}#products`} className="ml-auto text-xs text-[var(--admin-orange)] underline">
                        Add / remove products
                      </Link>
                    </div>
                    <form action={updateTagAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={d.id} />
                      <label className={LABEL}>
                        Name
                        <input name="label" required maxLength={MAX_TAG_LABEL} defaultValue={d.label} className={`${INPUT} w-44`} />
                      </label>
                      <ColorField name="color" value={d.color} />
                      {d.autoRule === "new_window" ? (
                        <label className={LABEL}>
                          Show &quot;{d.label}&quot; for (days)
                          <input name="window_days" type="number" min={1} max={MAX_WINDOW_DAYS} defaultValue={d.windowDays} className={`${INPUT} w-24`} />
                        </label>
                      ) : null}
                      <label className={LABEL}>
                        Order
                        <input name="sort_order" type="number" min={0} max={10000} defaultValue={d.sortOrder} className={`${INPUT} w-20`} />
                      </label>
                      <label className="flex items-center gap-2 pb-1 text-xs text-[var(--admin-text-muted)]">
                        <input type="checkbox" name="enabled" defaultChecked={d.enabled} /> On
                      </label>
                      <label className="flex items-center gap-2 pb-1 text-xs text-[var(--admin-text-muted)]">
                        <input type="checkbox" name="show_on_menu" defaultChecked={d.showOnMenu} /> Show on the website
                      </label>
                      <Button type="submit" variant="save" size="sm">
                        Save
                      </Button>
                    </form>
                    {d.slug !== NEW_TAG_SLUG ? (
                      <form action={deleteTagAction} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]">
                        <input type="hidden" name="id" value={d.id} />
                        <label className="flex items-center gap-1">
                          <input type="checkbox" name="confirm" /> Yes, delete
                        </label>
                        <Button type="submit" variant="danger" size="sm">
                          Delete tag
                        </Button>
                      </form>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                        Automatic: a product shows this tag for {d.windowDays} day(s) from the first time it was on a published menu, then it comes off by itself.
                        {firstSeenCount != null ? ` ${firstSeenCount} products have a first-on-menu date on record.` : ""} The built-in tag can be renamed, recoloured or turned off, but not deleted.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {/* New right now */}
            {newTag ? (
              <Card>
                <h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--admin-text)]">
                  Showing &quot;{newTag.label}&quot; right now ({newNow.length})
                </h2>
                {!newTag.enabled ? <p className="mt-1 text-xs text-[var(--admin-text-muted)]">The tag is turned off, so the website shows none of these.</p> : null}
                {newNow.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No product on the live menu is inside the {newTag.windowDays}-day window.</p>
                ) : (
                  <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                    {newNow.slice(0, 100).map((n) => (
                      <li key={n.key} className="flex justify-between gap-2 border-b border-[var(--admin-border)] py-1">
                        <span className="truncate text-[var(--admin-text)]">{n.name}</span>
                        <span className="whitespace-nowrap text-xs text-[var(--admin-text-muted)]">until {n.endsAt ? n.endsAt.slice(0, 10) : "?"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}

            {/* 3. Products for a tag */}
            <Card>
              <h2 id="products" className="text-sm font-black uppercase tracking-[0.08em] text-[var(--admin-text)]">
                Add or remove products
              </h2>
              <form method="get" action="/admin/inventory/tags" className="mt-3 flex flex-wrap items-end gap-3">
                <label className={LABEL}>
                  Tag
                  <select name="tag" defaultValue={selected?.id ?? ""} className={`${INPUT} w-48`}>
                    <option value="">Choose a tag...</option>
                    {defs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  Search the live menu
                  <input name="q" defaultValue={sp.q ?? ""} placeholder="name, brand, strain, category" className={`${INPUT} w-64`} />
                </label>
                <Button type="submit" variant="neutral" size="sm">
                  Show products
                </Button>
              </form>

              {selected ? (
                <>
                  {selected.slug === NEW_TAG_SLUG ? (
                    <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
                      Products you add here show &quot;{selected.label}&quot; until you remove them, on top of the automatic window.
                    </p>
                  ) : null}
                  <form action={assignTagAction} className="mt-3">
                    <input type="hidden" name="tag_id" value={selected.id} />
                    <input type="hidden" name="q" value={sp.q ?? ""} />
                    <p className="text-xs text-[var(--admin-text-muted)]">
                      {totalMatches > PICKER_LIMIT ? `Showing the first ${PICKER_LIMIT} of ${totalMatches} matches - search to narrow it down.` : `${totalMatches} product(s).`}{" "}
                      Products already tagged by hand are marked.
                    </p>
                    <div className="mt-2 max-h-[28rem] overflow-y-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
                      <table className="w-full text-sm">
                        <tbody>
                          {matches.map((m) => (
                            <tr key={m.id} className="border-b border-[var(--admin-border)]">
                              <td className="w-8 px-2 py-1">
                                <input type="checkbox" name="key" value={m.id} aria-label={`Select ${m.name}`} />
                              </td>
                              <td className="px-2 py-1 text-[var(--admin-text)]">
                                {m.name}
                                {m.hidden ? <span className="ml-2 text-xs text-[var(--admin-text-muted)]">(hidden)</span> : null}
                              </td>
                              <td className="px-2 py-1 text-xs text-[var(--admin-text-muted)]">{m.brand || m.vendor || ""}</td>
                              <td className="px-2 py-1 text-xs text-[var(--admin-text-muted)]">{m.category}</td>
                              <td className="px-2 py-1 text-right">{assignedSet.has(m.id) ? <TagChip tag={selected} /> : null}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="submit" name="mode" value="apply" variant="confirm" size="sm">
                        Apply &quot;{selected.label}&quot; to ticked
                      </Button>
                      <Button type="submit" name="mode" value="remove" variant="danger" size="sm">
                        Remove from ticked
                      </Button>
                    </div>
                  </form>

                  <div className="mt-5">
                    <h3 className="text-xs font-black uppercase tracking-[0.08em] text-[var(--admin-text-muted)]">
                      Tagged &quot;{selected.label}&quot; by hand ({assignedSet.size})
                    </h3>
                    {assigned && !assigned.ok ? <p className="mt-1 text-sm text-[var(--admin-danger)]">{assigned.error}</p> : null}
                    {assignedSet.size > 0 ? (
                      <form action={assignTagAction} className="mt-2">
                        <input type="hidden" name="tag_id" value={selected.id} />
                        <input type="hidden" name="mode" value="remove" />
                        <input type="hidden" name="q" value={sp.q ?? ""} />
                        <ul className="grid gap-1 text-sm sm:grid-cols-2">
                          {[...assignedSet].slice(0, 500).map((k) => (
                            <li key={k} className="flex items-center gap-2">
                              <input type="checkbox" name="key" value={k} aria-label={`Remove ${nameByKey.get(k)?.name ?? k}`} />
                              <span className="truncate text-[var(--admin-text)]">{nameByKey.get(k)?.name ?? k}</span>
                              {!nameByKey.has(k) ? <span className="text-xs text-[var(--admin-text-muted)]">(not on the menu now)</span> : null}
                            </li>
                          ))}
                        </ul>
                        <Button type="submit" variant="danger" size="sm" className="mt-2">
                          Remove ticked
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-[var(--admin-text-muted)]">Choose a tag to tick products on the live menu.</p>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
