"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/admin/ui/Button";
import type {
  ImageSubstituteWithUrl,
  SubstituteScope,
} from "@/lib/ai/kb/image-substitutes";
import {
  upsertSubstituteAction,
  toggleSubstituteAction,
  deleteSubstituteAction,
} from "./actions";

const inputCls =
  "mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const labelCls = "block text-xs font-medium text-[var(--admin-text-muted)]";

const SCOPE_LABELS: Record<SubstituteScope, string> = {
  category: "Category",
  inventory_type: "Inventory type",
  brand: "Brand",
  vendor: "Vendor",
  global: "Global (last resort)",
};

export type MediaOption = { id: string; label: string; url: string | null };

export function SubstituteManager({
  substitutes,
  media,
  categoryKeys,
  inventoryTypeKeys,
  coveredCategories,
  coveredInventoryTypes,
  totalCategories,
  totalInventoryTypes,
  migrated,
}: {
  substitutes: ImageSubstituteWithUrl[];
  media: MediaOption[];
  categoryKeys: string[];
  inventoryTypeKeys: string[];
  coveredCategories: number;
  coveredInventoryTypes: number;
  totalCategories: number;
  totalInventoryTypes: number;
  migrated: boolean;
}) {
  const [scope, setScope] = useState<SubstituteScope>("category");
  const [key, setKey] = useState("");
  const [mediaId, setMediaId] = useState("");

  const keyOptions = useMemo(() => {
    if (scope === "category") return categoryKeys;
    if (scope === "inventory_type") return inventoryTypeKeys;
    return [];
  }, [scope, categoryKeys, inventoryTypeKeys]);

  const selectedMedia = media.find((m) => m.id === mediaId) ?? null;

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="text-base font-semibold text-[var(--admin-text)]">
        Fallback images (so a product card is never blank)
      </h2>
      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
        When we can&apos;t find an exact product photo, the product card falls back — honestly — to an
        <strong> approved</strong> image chosen by the product&apos;s category or type. You can also add a
        branded-but-untitled shot for a brand/vendor (a branded joint tube, flower jar, or boxed edible
        photographed without a name). The website shows a small &ldquo;representative image&rdquo; note on
        any fallback, so customers are never misled.
      </p>

      {/* Coverage summary */}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-[var(--admin-bg)] px-3 py-1 text-[var(--admin-text-muted)]">
          Categories covered: <strong className="text-[var(--admin-text)]">{coveredCategories}/{totalCategories}</strong>
        </span>
        <span className="rounded-full bg-[var(--admin-bg)] px-3 py-1 text-[var(--admin-text-muted)]">
          Inventory types covered: <strong className="text-[var(--admin-text)]">{coveredInventoryTypes}/{totalInventoryTypes}</strong>
        </span>
      </div>

      {!migrated ? (
        <div className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          The fallback-images table isn&apos;t set up yet. Once your administrator applies the database
          update (migration 0021), you can add approved fallback images here.
        </div>
      ) : null}

      {media.length === 0 ? (
        <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
          No images in your Media Library yet. Upload images in <strong>Media</strong> first, then assign
          them as fallbacks here.
        </div>
      ) : null}

      {/* Add / update form */}
      <form action={upsertSubstituteAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={labelCls}>This fallback applies to…</span>
          <select
            name="scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as SubstituteScope);
              setKey("");
            }}
            className={inputCls}
          >
            {(Object.keys(SCOPE_LABELS) as SubstituteScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className={labelCls}>
            {scope === "global"
              ? "Applies to everything (no key needed)"
              : scope === "brand"
                ? "Brand name / slug"
                : scope === "vendor"
                  ? "Vendor name / slug"
                  : `Which ${SCOPE_LABELS[scope].toLowerCase()}?`}
          </span>
          {scope === "global" ? (
            <input className={inputCls} value="*" readOnly />
          ) : keyOptions.length > 0 ? (
            <select name="key" value={key} onChange={(e) => setKey(e.target.value)} className={inputCls}>
              <option value="">Choose…</option>
              {keyOptions.map((k) => (
                <option key={k} value={k} className="capitalize">
                  {k}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={inputCls}
              placeholder={scope === "brand" ? "e.g. torus" : "e.g. evergreen hydro farms"}
            />
          )}
        </label>

        <label className="text-sm">
          <span className={labelCls}>Image (from your Media Library)</span>
          <select
            name="media_id"
            value={mediaId}
            onChange={(e) => setMediaId(e.target.value)}
            className={inputCls}
          >
            <option value="">Choose an image…</option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className={labelCls}>Label (optional)</span>
          <input name="label" className={inputCls} placeholder="e.g. Neutral flower jar" />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Priority (lower wins when several match)</span>
          <input name="priority" type="number" min="0" step="1" defaultValue={100} className={inputCls} />
        </label>

        <div className="flex items-end">
          {selectedMedia?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedMedia.url}
              alt="preview"
              className="h-16 w-16 rounded-[var(--admin-radius)] border border-[var(--admin-border)] object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-[var(--admin-radius)] border border-dashed border-[var(--admin-border)] text-xs text-[var(--admin-text-muted)]">
              preview
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={!migrated || media.length === 0}>
            Save fallback image
          </Button>
        </div>
      </form>

      {/* Existing substitutes */}
      {substitutes.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--admin-text-muted)]">
                <th className="py-2 pr-4 font-medium">Image</th>
                <th className="py-2 pr-4 font-medium">Applies to</th>
                <th className="py-2 pr-4 font-medium">Key</th>
                <th className="py-2 pr-4 font-medium">Label</th>
                <th className="py-2 pr-4 font-medium">Priority</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {substitutes.map((s) => (
                <tr key={s.id} className="border-t border-[var(--admin-border)]">
                  <td className="py-2 pr-4">
                    {s.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.url}
                        alt={s.label ?? "fallback"}
                        className="h-10 w-10 rounded border border-[var(--admin-border)] object-cover"
                      />
                    ) : (
                      <span className="text-[var(--admin-text-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{SCOPE_LABELS[s.scope]}</td>
                  <td className="py-2 pr-4 capitalize text-[var(--admin-text)]">{s.key}</td>
                  <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{s.label ?? "—"}</td>
                  <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{s.priority}</td>
                  <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{s.active ? "Active" : "Disabled"}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <form action={toggleSubstituteAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="active" value={(!s.active).toString()} />
                        <button type="submit" className="text-xs text-[var(--admin-accent)] hover:underline">
                          {s.active ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={deleteSubstituteAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="text-xs text-[var(--admin-orange)] hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--admin-text-muted)]">
          No fallback images yet. Add one above so cards without a photo still look complete.
        </p>
      )}
    </section>
  );
}
