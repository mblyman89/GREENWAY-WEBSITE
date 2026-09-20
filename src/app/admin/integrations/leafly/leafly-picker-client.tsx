"use client";

/**
 * src/app/admin/integrations/leafly/leafly-picker-client.tsx  (SLICE L-18)
 *
 * The Leafly item picker.
 *
 * DESIGN INTENT. This screen exists so the owner can make his first-ever menu
 * transmission a small, checkable one instead of 2,562 items into a sandbox
 * that already holds 1,876. Everything here follows from that:
 *
 *   - The safe path is the default and the fast one. "Suggest a sample" is one
 *     click and produces a spread across categories, sizes and photos.
 *   - The destructive path is not reachable by accident. A partial selection is
 *     always sent as PUT; the core refuses to do otherwise, and the banner
 *     explains why rather than just asserting it.
 *   - Nothing transmits without a preview being available first, and the push
 *     button is a two-step arm/confirm.
 *   - The screen tells the operator what the push will NOT prove (coverage
 *     gaps), because a clean read-back on an unrepresentative sample is the
 *     most misleading possible outcome.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/admin/ui";
import {
  browseLeaflyItemsAction,
  previewLeaflySelectionAction,
  pushLeaflySelectionAction,
  suggestLeaflySampleAction,
  type PickerRow,
} from "./selection-actions";
import {
  SELECTION_PRESETS,
  TARGETED_PUSH_MAX_ITEMS,
  describeMethodCoercion,
  type SelectionFacets,
  type SelectionSort,
  type SelectionSpec,
  type TriState,
} from "@/lib/leafly/selection-core";
import type { SelectionPreviewResult } from "@/lib/leafly/selection-server";

function money(minorUnits: number): string {
  return `$${(minorUnits / 100).toFixed(2)}`;
}

const SORTS: { value: SelectionSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "name", label: "Name (A–Z)" },
  { value: "brand", label: "Brand" },
  { value: "category", label: "Category" },
  { value: "price-asc", label: "Price (low to high)" },
  { value: "price-desc", label: "Price (high to low)" },
  { value: "thc-desc", label: "THC (high to low)" },
];

const TRI: { value: TriState; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function LeaflyItemPicker({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();

  // Filter state
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [strainType, setStrainType] = useState("");
  const [stock, setStock] = useState<"any" | "in-stock" | "out-of-stock">("in-stock");
  const [hasImage, setHasImage] = useState<TriState>("any");
  const [hasDescription, setHasDescription] = useState<TriState>("any");
  const [hasMultipleVariants, setHasMultipleVariants] = useState<TriState>("any");
  const [isDohRestricted, setIsDohRestricted] = useState<TriState>("any");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [thcMin, setThcMin] = useState("");
  const [thcMax, setThcMax] = useState("");
  const [sort, setSort] = useState<SelectionSort>("relevance");

  // Data
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [facets, setFacets] = useState<SelectionFacets | null>(null);
  const [feedCount, setFeedCount] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selection — ids persist across filter changes on purpose. Someone building
  // a cross-category sample filters to flower, picks two, filters to edibles,
  // picks two more. Clearing on filter change would silently discard the first
  // two and they would only find out by reading the count.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Preview / push
  //
  // The preview is stored TOGETHER WITH the exact selection it was built from
  // (`builtFor`, a stable sorted key). Staleness is then DERIVED by comparing
  // that key to the live selection, rather than being cleared by an effect that
  // watches `selected`.
  //
  // This is not a lint workaround, it is strictly safer. An effect fires AFTER
  // the render that changed the selection, and it cannot see a preview request
  // that is still in flight -- so a slow preview could resolve after the owner
  // had already changed the selection and quietly present itself as current.
  // Deriving from the key closes that race: a preview whose key does not match
  // the current selection can never be shown or armed, whenever it arrives.
  const [preview, setPreview] = useState<
    { builtFor: string; value: SelectionPreviewResult } | null
  >(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushOk, setPushOk] = useState<boolean | null>(null);

  const spec: SelectionSpec = useMemo(() => {
    const parseNum = (v: string): number | undefined => {
      const t = v.trim();
      if (!t) return undefined;
      const n = Number.parseFloat(t);
      return Number.isFinite(n) ? n : undefined;
    };
    const dollarsToMinor = (v: string): number | undefined => {
      const n = parseNum(v);
      return n === undefined ? undefined : Math.round(n * 100);
    };
    return {
      search: search.trim() || undefined,
      categories: category ? [category] : undefined,
      brands: brand ? [brand] : undefined,
      strainTypes: strainType ? [strainType] : undefined,
      stock,
      hasImage,
      hasDescription,
      hasMultipleVariants,
      isDohRestricted,
      priceMinMinorUnits: dollarsToMinor(priceMin),
      priceMaxMinorUnits: dollarsToMinor(priceMax),
      thcMinPercent: parseNum(thcMin),
      thcMaxPercent: parseNum(thcMax),
    };
  }, [
    search,
    category,
    brand,
    strainType,
    stock,
    hasImage,
    hasDescription,
    hasMultipleVariants,
    isDohRestricted,
    priceMin,
    priceMax,
    thcMin,
    thcMax,
  ]);

  const load = useCallback(() => {
    setLoadError(null);
    startTransition(async () => {
      const res = await browseLeaflyItemsAction({ spec, sort });
      if (res.ok) {
        setRows(res.rows);
        setFacets(res.facets);
        setFeedCount(res.feedCount);
        setMatchedCount(res.matchedCount);
        setSuggestedIds(res.suggestedSampleIds);
      } else {
        setLoadError(res.error);
        setRows([]);
      }
    });
  }, [spec, sort]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Any change to the selection invalidates a preview built from the old one.
  // Leaving a stale preview on screen next to a changed selection is how
  // somebody ends up confidently pushing something they did not inspect.
  //
  // `selectionKey` is order-independent (sorted), so selecting A then B and
  // selecting B then A produce the same key and do not needlessly discard a
  // still-valid preview.
  const selectionKey = useMemo(
    () => Array.from(selected).sort().join(","),
    [selected],
  );

  // A preview is only shown when it was built from the CURRENT selection.
  const livePreview =
    preview && preview.builtFor === selectionKey ? preview.value : null;

  // Arming is likewise derived: you cannot be armed without a live preview, so
  // changing the selection disarms the confirm step with no effect required.
  const isArmed = armed && livePreview !== null;

  const selectedCount = selected.size;
  const overLimit = selectedCount > TARGETED_PUSH_MAX_ITEMS;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) next.add(row.id);
      return next;
    });
  }

  function deselectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) next.delete(row.id);
      return next;
    });
  }

  function useSuggested() {
    setSelected(new Set(suggestedIds));
  }

  function suggestFromWholeFeed() {
    startTransition(async () => {
      const res = await suggestLeaflySampleAction({ size: 8 });
      if (res.ok) setSelected(new Set(res.ids));
    });
  }

  function applyPreset(presetId: string) {
    const preset = SELECTION_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSearch(preset.spec.search ?? "");
    setCategory(preset.spec.categories?.[0] ?? "");
    setBrand(preset.spec.brands?.[0] ?? "");
    setStrainType(preset.spec.strainTypes?.[0] ?? "");
    setStock(preset.spec.stock ?? "any");
    setHasImage(preset.spec.hasImage ?? "any");
    setHasDescription(preset.spec.hasDescription ?? "any");
    setHasMultipleVariants(preset.spec.hasMultipleVariants ?? "any");
    setIsDohRestricted(preset.spec.isDohRestricted ?? "any");
    setPriceMin("");
    setPriceMax("");
    setThcMin("");
    setThcMax("");
    setSort(preset.sort);
  }

  function clearFilters() {
    setSearch("");
    setCategory("");
    setBrand("");
    setStrainType("");
    setStock("any");
    setHasImage("any");
    setHasDescription("any");
    setHasMultipleVariants("any");
    setIsDohRestricted("any");
    setPriceMin("");
    setPriceMax("");
    setThcMin("");
    setThcMax("");
    setSort("relevance");
  }

  function doPreview() {
    setPreviewError(null);
    setPushMsg(null);
    startTransition(async () => {
      const ids = Array.from(selected);
      // Tag the result with the selection it was built from, computed from the
      // SAME ids that were sent, so the tag cannot disagree with the payload.
      const builtFor = [...ids].sort().join(",");
      const res = await previewLeaflySelectionAction({ ids });
      if (res.ok) setPreview({ builtFor, value: res.preview });
      else setPreviewError(res.error);
    });
  }

  function doPush() {
    setPushMsg(null);
    setPushOk(null);
    startTransition(async () => {
      const res = await pushLeaflySelectionAction({
        ids: Array.from(selected),
        confirm: true,
      });
      if (res.ok) {
        setPushOk(res.result.ok);
        setPushMsg(
          res.result.ok
            ? res.result.message
            : `Leafly returned HTTP ${res.result.httpStatus}. ${res.result.message}`,
        );
      } else {
        setPushOk(false);
        setPushMsg(res.refusals?.map((r) => r.message).join(" ") ?? res.error);
      }
      setArmed(false);
    });
  }

  const coercion = livePreview ? describeMethodCoercion(livePreview.plan) : null;

  return (
    <Card>
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold">Send only certain products</h3>
          <p className="mt-1 text-sm opacity-80">
            Pick a handful of products and send just those. Everything else on your Leafly
            menu is left exactly as it is. This is the safe way to make a first push, or to
            re-send one product after fixing it, without re-syncing the whole menu.
          </p>
        </div>

        {!configured && (
          <p className="rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
            Leafly is not configured yet, so nothing can be sent. You can still browse and
            build a selection.
          </p>
        )}

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide opacity-70">
            Quick starts
          </span>
          {SELECTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => applyPreset(preset.id)}
              className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-white/10 px-3 py-1 text-xs opacity-70 hover:bg-white/10"
          >
            Clear filters
          </button>
        </div>

        {/* Filters */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, brand, strain or product key"
            />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {facets?.categories.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.count})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Brand">
            <Select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">All brands</option>
              {facets?.brands.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.count})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Strain type">
            <Select value={strainType} onChange={(e) => setStrainType(e.target.value)}>
              <option value="">All types</option>
              {facets?.strainTypes.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.count})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Stock">
            <Select
              value={stock}
              onChange={(e) => setStock(e.target.value as typeof stock)}
            >
              <option value="any">Any</option>
              <option value="in-stock">In stock only</option>
              <option value="out-of-stock">Out of stock only</option>
            </Select>
          </Field>
          <Field label="Has a photo">
            <Select value={hasImage} onChange={(e) => setHasImage(e.target.value as TriState)}>
              {TRI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Has a description">
            <Select
              value={hasDescription}
              onChange={(e) => setHasDescription(e.target.value as TriState)}
            >
              {TRI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="More than one size">
            <Select
              value={hasMultipleVariants}
              onChange={(e) => setHasMultipleVariants(e.target.value as TriState)}
            >
              {TRI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Min price ($)">
            <Input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Max price ($)">
            <Input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="200" />
          </Field>
          <Field label="Min THC (%)">
            <Input value={thcMin} onChange={(e) => setThcMin(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Max THC (%)">
            <Input value={thcMax} onChange={(e) => setThcMax(e.target.value)} placeholder="100" />
          </Field>

          <Field label="DOH medical only">
            <Select
              value={isDohRestricted}
              onChange={(e) => setIsDohRestricted(e.target.value as TriState)}
            >
              {TRI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort by">
            <Select value={sort} onChange={(e) => setSort(e.target.value as SelectionSort)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Selection toolbar */}
        <div className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-white/5 p-3">
          <span className="text-sm">
            <strong>{matchedCount}</strong> of {feedCount} products match
            {selectedCount > 0 && (
              <>
                {" · "}
                <strong>{selectedCount}</strong> selected
              </>
            )}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="neutral" onClick={suggestFromWholeFeed} disabled={pending}>
              Suggest a sample
            </Button>
            {suggestedIds.length > 0 && (
              <Button
                type="button"
                variant="neutral"
                onClick={useSuggested}
                disabled={pending}
                title="A spread across what you are currently filtered to"
              >
                Sample these {suggestedIds.length}
              </Button>
            )}
            <Button type="button" variant="neutral" onClick={selectAllVisible} disabled={pending}>
              Select all shown
            </Button>
            <Button type="button" variant="neutral" onClick={deselectAllVisible} disabled={pending}>
              Deselect shown
            </Button>
            {selectedCount > 0 && (
              <Button type="button" variant="neutral" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            )}
          </div>
        </div>

        {overLimit && (
          <p className="rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
            {selectedCount} products are selected. A targeted push is capped at{" "}
            {TARGETED_PUSH_MAX_ITEMS}. Past that it is a real menu publish rather than a
            test — use the full sync button above, which is built for it.
          </p>
        )}

        {loadError && (
          <p className="rounded border border-red-400/40 bg-red-400/10 p-3 text-sm">{loadError}</p>
        )}

        {/* Results */}
        <div className="max-h-96 overflow-auto rounded border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-black/40 backdrop-blur">
              <tr>
                <th className="w-10 p-2" />
                <th className="p-2">Product</th>
                <th className="p-2">Category</th>
                <th className="p-2">Price</th>
                <th className="p-2">THC</th>
                <th className="p-2">Sizes</th>
                <th className="p-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !pending && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm opacity-70">
                    Nothing matches these filters. Try clearing one.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const isSelected = selected.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className={`border-t border-white/5 ${isSelected ? "bg-emerald-400/10" : ""}`}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs opacity-60">
                        {row.brand ?? "No brand"} · {row.id}
                      </div>
                    </td>
                    <td className="p-2">{row.category}</td>
                    <td className="p-2">{money(row.priceMinorUnits)}</td>
                    <td className="p-2">{row.thc ?? "—"}</td>
                    <td className="p-2">{row.variantCount}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {!row.inStock && <Badge tone="orange">Out of stock</Badge>}
                        {row.hasImage && <Badge tone="neutral">Photo</Badge>}
                        {!row.hasDescription && <Badge tone="orange">No description</Badge>}
                        {row.dohRestricted && <Badge tone="danger">DOH</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Preview + push */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={doPreview}
            disabled={pending || selectedCount === 0 || overLimit}
          >
            Preview these {selectedCount || ""}
          </Button>
          <span className="text-xs opacity-70">
            A preview builds the exact payload and sends nothing.
          </span>
        </div>

        {previewError && (
          <p className="rounded border border-red-400/40 bg-red-400/10 p-3 text-sm">
            {previewError}
          </p>
        )}

        {livePreview && (
          <div className="space-y-3 rounded border border-white/15 bg-white/5 p-4">
            <h4 className="font-semibold">Preview — nothing has been sent</h4>
            <p className="text-sm">{livePreview.plan.summary}</p>

            {coercion && (
              <p className="rounded border border-sky-400/40 bg-sky-400/10 p-3 text-sm">
                {coercion}
              </p>
            )}

            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                Items in payload: <strong>{livePreview.payload.items.length}</strong>
              </div>
              <div>
                Variants: <strong>{livePreview.coverage.variantCount}</strong>
              </div>
              <div>
                Categories covered: <strong>{livePreview.coverage.categories.join(", ") || "—"}</strong>
              </div>
              <div>
                With a photo: <strong>{livePreview.coverage.withImage}</strong>
              </div>
              <div>
                With a description: <strong>{livePreview.coverage.withDescription}</strong>
              </div>
              <div>
                With readable THC: <strong>{livePreview.coverage.withPotency}</strong>
              </div>
            </div>

            {livePreview.validationOk ? (
              <p className="text-sm text-emerald-300">
                The payload passes the Leafly contract check.
              </p>
            ) : (
              <div className="rounded border border-red-400/40 bg-red-400/10 p-3 text-sm">
                <p className="font-medium">
                  The payload does not satisfy Leafly&apos;s contract, so it cannot be sent:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {livePreview.validationErrors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {livePreview.droppedItemIds.length > 0 && (
              <p className="text-sm">
                <strong>{livePreview.droppedItemIds.length}</strong> selected product(s) could not be
                represented and will not be sent: {livePreview.droppedItemIds.join(", ")}
              </p>
            )}

            {livePreview.coverage.gaps.length > 0 && (
              <div className="rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
                <p className="font-medium">What this push will not prove:</p>
                <ul className="mt-1 list-disc pl-5">
                  {livePreview.coverage.gaps.map((g) => (
                    <li key={g.code}>{g.message}</li>
                  ))}
                </ul>
                <p className="mt-2 opacity-80">
                  That is not a problem in itself — it just means a clean read-back would not
                  tell you anything about those.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              {!isArmed ? (
                <Button
                  type="button"
                  onClick={() => setArmed(true)}
                  disabled={!configured || !livePreview.validationOk || !livePreview.plan.ok || pending}
                >
                  Send these {livePreview.payload.items.length} to Leafly
                </Button>
              ) : (
                <>
                  <Button type="button" onClick={doPush} disabled={pending}>
                    {pending ? "Sending…" : "Yes — send them now"}
                  </Button>
                  <Button type="button" variant="neutral" onClick={() => setArmed(false)}>
                    Cancel
                  </Button>
                  <span className="text-sm">
                    This sends {livePreview.payload.items.length} product(s) as an update. Nothing
                    else on your Leafly menu is changed or removed.
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {pushMsg && (
          <p
            className={`rounded border p-3 text-sm ${
              pushOk
                ? "border-emerald-400/40 bg-emerald-400/10"
                : "border-red-400/40 bg-red-400/10"
            }`}
          >
            {pushMsg}
          </p>
        )}
      </div>
    </Card>
  );
}
