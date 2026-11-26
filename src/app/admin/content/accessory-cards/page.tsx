/**
 * OI-ACC S4 - Website > Accessory Cards. Owner (verbatim): "I want to now be
 * able to edit the cards so I can change the image and text on the card ...
 * just a simple version like the one used for the merch product cards". One
 * card per Other Inventory type (except Apparel, which is Greenway Merch); the
 * type list is the same one the Other Inventory page edits.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/admin/ui";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { listMedia } from "@/lib/media/store";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readNcTypes } from "@/lib/noncannabis/types-store";
import { AccessoryCardsEditor } from "./AccessoryCardsEditor";
import { setOnlineAccessoriesAction } from "./actions";
import { readOnlineNcEnabled } from "@/lib/noncannabis/online-store";
import { addNcTypeAction, archiveNcTypeAction, restoreNcTypeAction } from "@/app/admin/inventory/noncannabis/type-actions";

export const dynamic = "force-dynamic";

export default async function AccessoryCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; published?: string; typeError?: string; typeAdded?: string; online?: string }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;
  const [typeRead, media, onlineOn] = await Promise.all([
    readNcTypes(),
    isSupabaseServiceConfigured ? listMedia({ status: "published", limit: 200 }).catch(() => []) : Promise.resolve([]),
    readOnlineNcEnabled(),
  ]);
  const mediaChoices: MediaChoice[] = media
    .filter((m) => /^image\//.test(m.mime_type ?? "") && m.public_url)
    .map((m) => ({ id: m.id, url: m.public_url as string, title: m.title ?? m.filename ?? "Image", usageType: m.usage_type ?? null, mimeType: m.mime_type ?? null }));
  const cardTypes = typeRead.rows.filter((r) => r.menu_group !== "merch").sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  const live = cardTypes.filter((r) => !r.archived_at);
  const archived = cardTypes.filter((r) => r.archived_at);
  const msg = sp.published ? "Published - the shop shows these cards now." : sp.saved ? "Draft saved. Press Publish to show it on the shop." : sp.typeAdded ? "Type added - it is on the Other Inventory page too." : sp.online === "on" ? "Online ordering of accessories is ON." : sp.online === "off" ? "Online ordering of accessories is OFF." : null;

  return (
    <div>
      <AdminPageHeader
        title="Accessory Cards"
        subtitle="The picture, name and short text on each accessory card in the shop. One card per Other Inventory type; a card shows only while that type has stock."
        action={<Button href="/admin/inventory/noncannabis" variant="neutral">Other Inventory &rarr;</Button>}
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        {typeRead.error ? <p className="text-sm font-semibold text-[var(--admin-danger)]">{typeRead.error}</p> : null}
        {sp.typeError ? <p className="text-sm font-semibold text-[var(--admin-danger)]">{sp.typeError}</p> : null}
        {msg ? <p className="text-sm font-semibold text-[var(--admin-accent)]">{msg}</p> : null}

        <form action={setOnlineAccessoriesAction} className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--admin-border)] p-3">
          <input type="hidden" name="enabled" value={onlineOn ? "0" : "1"} />
          <span className="text-sm font-semibold text-[var(--admin-text)]">
            Customers can add accessories to online orders: {onlineOn ? "ON" : "OFF"}
          </span>
          <Button type="submit" size="sm" variant={onlineOn ? "neutral" : "primary"}>
            {onlineOn ? "Turn OFF" : "Turn ON"}
          </Button>
          <span className="text-xs text-[var(--admin-text-faint)]">
            While OFF the shop shows stock and prices only, and checkout refuses accessory items.
          </span>
        </form>

        <form action={addNcTypeAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="back" value="cards" />
          <input name="label" maxLength={40} required placeholder="New type / card, e.g. Hemp Wick" className="min-w-[16rem] rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm text-[var(--admin-text)]" />
          <Button type="submit" size="sm" disabled={!typeRead.fromRegistry}>Add type</Button>
          <span className="text-xs text-[var(--admin-text-faint)]">Adds it to Other Inventory too.</span>
        </form>

        <AccessoryCardsEditor
          disabled={!typeRead.fromRegistry}
          mediaChoices={mediaChoices}
          cards={live.map((r) => ({
            value: r.value,
            typeLabel: r.label,
            label: r.draft_label,
            text: r.draft_text,
            image: r.draft_image,
            changed: r.draft_label !== r.card_label || r.draft_text !== r.card_text || r.draft_image !== r.card_image,
          }))}
          archiveAction={archiveNcTypeAction}
        />

        {archived.length ? (
          <div className="text-xs text-[var(--admin-text-faint)]">
            <p className="mb-2 font-semibold">Archived types (hidden everywhere)</p>
            <ul className="flex flex-wrap gap-2">
              {archived.map((r) => (
                <li key={r.value} className="flex items-center gap-2 rounded-md border border-[var(--admin-border)] px-2 py-1">
                  {r.label}
                  <form action={restoreNcTypeAction}>
                    <input type="hidden" name="back" value="cards" />
                    <input type="hidden" name="value" value={r.value} />
                    <button type="submit" className="underline">Restore</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
