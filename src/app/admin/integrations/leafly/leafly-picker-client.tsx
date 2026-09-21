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
  suggestRotatingSampleAction,
  type PickerRow,
} from "./selection-actions";
// ROADMAP R3/R4/R6 (owner asks 3, 4, 7): see what Leafly will refuse BEFORE
// pressing send, and send the passing products without the failing ones.
import { SendabilityPanel } from "./sendability-panel";
import {
  SELECTION_PRESETS,
  TARGETED_PUSH_MAX_ITEMS,
  describeMethodCoercion,
  type SelectionFacets,
  type SelectionSort,
  type SelectionSpec,
  type TriState,
} from "@/lib/leafly/selection-core";
import {
  CLEARED_PICKER_FILTER_STATE,
  buildSendManifest,
  computeSelectionVisibility,
  countActiveFilters,
  describeHiddenSelection,
  describeSendManifest,
  describeSizeLoss,
  matchActivePresetId,
  presetFilterState,
  summarizeSizeLoss,
  visibleRows,
  type PickerFilterState,
  type PickerView,
} from "@/lib/leafly/picker-view-core";
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

  // Filter state.
  //
  // Held as ONE object rather than thirteen useState calls. That is not tidiness
  // for its own sake: the quick-start pills light up by comparing the current
  // filters against what each preset would set, and that comparison cannot be
  // written at all when the values live in thirteen separate variables that no
  // function can be handed. Keeping them together is what makes the highlight
  // derivable instead of remembered -- see picker-view-core for why remembering
  // it produces a highlight that lies.
  //
  // The screen opens on in-stock because an out-of-stock product cannot exercise
  // inventory or orderability, which are two of the mappings most worth proving.
  // Note this differs from CLEARED_PICKER_FILTER_STATE on purpose: "the default
  // view" and "no filters at all" are different things.
  const [filters, setFilters] = useState<PickerFilterState>({
    ...CLEARED_PICKER_FILTER_STATE,
    stock: "in-stock",
  });

  // One setter per field, so the JSX below reads the same as it did before and
  // no control can accidentally drop its siblings by spreading incorrectly.
  const setField = useCallback(
    <K extends keyof PickerFilterState>(key: K, value: PickerFilterState[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const {
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
    sort,
  } = filters;

  // Data
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [facets, setFacets] = useState<SelectionFacets | null>(null);
  const [feedCount, setFeedCount] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ROADMAP R7 (owner asks 1 and 2). `sampleRound` is what makes "suggest
  // another" produce a DIFFERENT eight while keeping each round
  // reproducible. See `suggestRotating` for why this is not randomness.
  const [sampleRound, setSampleRound] = useState(0);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [sampleFailing, setSampleFailing] = useState<
    Array<{ id: string; label: string; reason: string | null; fixHref: string | null }>
  >([]);

  // Selection — ids persist across filter changes on purpose. Someone building
  // a cross-category sample filters to flower, picks two, filters to edibles,
  // picks two more. Clearing on filter change would silently discard the first
  // two and they would only find out by reading the count.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Which rows the table shows: everything matching the filters, or only the
  // picks. The owner reported that after "Suggest a sample" the table still
  // showed all 2,555 matches with eight ticks buried somewhere inside it, which
  // made the single most important question on the screen -- what am I actually
  // sending? -- effectively unanswerable.
  const [view, setView] = useState<PickerView>("all");

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

  // Which quick start the current filters correspond to, or null for "custom".
  // DERIVED, never stored: editing any control by hand un-lights the pill with
  // no event handler involved, so the highlight cannot come to disagree with
  // the filters it claims to describe.
  const activePresetId = useMemo(
    () => matchActivePresetId(filters, SELECTION_PRESETS),
    [filters],
  );

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

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

  // Where the selection sits relative to what is on screen, and what exactly
  // the push would transmit. Both are pure functions of state that is already
  // here, so neither can drift from the checkboxes the operator ticked.
  const visibility = useMemo(
    () => computeSelectionVisibility(rows, selected),
    [rows, selected],
  );
  const hiddenNotice = useMemo(() => describeHiddenSelection(visibility), [visibility]);
  // FINDING L-21. Derived, never stored. The moment a row is selected or
  // deselected this recomputes, so the banner cannot describe a selection the
  // owner has already moved on from.
  const sizeLoss = useMemo(() => summarizeSizeLoss(rows, selected), [rows, selected]);
  const sizeLossNotice = useMemo(() => describeSizeLoss(sizeLoss), [sizeLoss]);
  const manifest = useMemo(() => buildSendManifest(rows, selected), [rows, selected]);
  const manifestSentence = useMemo(() => describeSendManifest(manifest), [manifest]);
  const shownRows = useMemo(() => visibleRows(rows, selected, view), [rows, selected, view]);

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

  // Both samplers switch the table to "selected" as well as setting the
  // selection. Choosing a sample and being shown the same 2,555-row list is
  // what made the feature look broken: the work had been done, it was simply
  // invisible. Showing the result of an action is part of performing it.
  function useSuggested() {
    setSelected(new Set(suggestedIds));
    setView("selected");
  }

  /**
   * ROADMAP R7 -- owner asks 1 and 2.
   *
   * ########################################################################
   * # "i tried to resend the same 8 products we sent before, but the       #
   * #  system wont let me send them again ... will you make the suggest a  #
   * #  sample button ... be more intelligent and have it pick a DIFFERENT  #
   * #  set of 8 products to send as a sample."                             #
   * ########################################################################
   *
   * WHY A ROUND COUNTER AND NOT `Math.random()`. The old sampler was
   * deterministic on purpose: a failed push has to be reproducible, and a
   * random sample makes "send me exactly what you sent last time" impossible
   * to honour. Incrementing a round keeps BOTH properties -- the owner gets
   * a different eight on every click, and any given round always yields the
   * same eight, so a failure can be reproduced by asking for that round
   * again. The counter lives in the client because it is a property of this
   * person's clicking, not of the menu.
   *
   * The server prefers products that PASS Leafly's contract and names any
   * that do not, which is what makes the second click useful rather than
   * just different.
   */
  function suggestRotating() {
    startTransition(async () => {
      const next = sampleRound + 1;
      const res = await suggestRotatingSampleAction({ size: 8, round: next });
      if (res.ok) {
        setSampleRound(next);
        setSampleNote(res.note);
        setSampleFailing(res.failing);
        setSelected(new Set(res.ids));
        setFilters(CLEARED_PICKER_FILTER_STATE);
        setView("selected");
      } else {
        setSampleNote(res.error);
        setSampleFailing([]);
      }
    });
  }

  function suggestFromWholeFeed() {
    startTransition(async () => {
      const res = await suggestLeaflySampleAction({ size: 8 });
      if (res.ok) {
        setSelected(new Set(res.ids));
        // This sampler draws from the WHOLE feed on purpose, so its picks are
        // frequently outside the current filters. Clearing the filters is what
        // makes them visible; without it the table would switch to "selected"
        // and show fewer than eight rows, which is worse than showing none.
        setFilters(CLEARED_PICKER_FILTER_STATE);
        setView("selected");
      }
    });
  }

  // Applying and highlighting a preset go through the SAME function, so a
  // preset cannot apply one set of values and light up based on another.
  function applyPreset(presetId: string) {
    const preset = SELECTION_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setFilters(presetFilterState(preset));
    // Re-filtering is a browsing action; drop back to the full list so the
    // operator can see what the preset actually matched.
    setView("all");
  }

  function clearFilters() {
    setFilters(CLEARED_PICKER_FILTER_STATE);
    setView("all");
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
          {SELECTION_PRESETS.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                onClick={() => applyPreset(preset.id)}
                // aria-pressed, not just colour. A toggle that communicates its
                // state only through a background tint is invisible to a screen
                // reader and to anyone who cannot distinguish the two greens.
                aria-pressed={isActive}
                className={
                  isActive
                    ? "rounded-full border border-emerald-400 bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-100 shadow-[0_0_0_1px_rgba(52,211,153,0.5)]"
                    : "rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
                }
              >
                {isActive ? `✓ ${preset.label}` : preset.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-white/10 px-3 py-1 text-xs opacity-70 hover:bg-white/10"
          >
            {activeFilterCount > 0 ? `Clear filters (${activeFilterCount})` : "Clear filters"}
          </button>
        </div>

        {/*
          Says out loud what the filters currently correspond to. Without this
          line, "no pill is lit" is ambiguous between "you have a custom filter"
          and "the highlighting is broken again" -- and the owner has already
          had one of those, so he is entitled to be told which it is.
        */}
        <p className="-mt-3 text-xs opacity-70">
          {activePresetId
            ? `Showing the "${SELECTION_PRESETS.find((p) => p.id === activePresetId)?.label}" quick start.`
            : activeFilterCount > 0
              ? `Custom filter — ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active. No quick start matches this exactly.`
              : "No filters applied — showing everything in the published feed."}
        </p>

        {/* Filters */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            <Input
              value={search}
              onChange={(e) => setField("search", e.target.value)}
              placeholder="Name, brand, strain or product key"
            />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setField("category", e.target.value)}>
              <option value="">All categories</option>
              {facets?.categories.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.count})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Brand">
            <Select value={brand} onChange={(e) => setField("brand", e.target.value)}>
              <option value="">All brands</option>
              {facets?.brands.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.count})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Strain type">
            <Select value={strainType} onChange={(e) => setField("strainType", e.target.value)}>
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
              onChange={(e) => setField("stock", e.target.value as typeof stock)}
            >
              <option value="any">Any</option>
              <option value="in-stock">In stock only</option>
              <option value="out-of-stock">Out of stock only</option>
            </Select>
          </Field>
          <Field label="Has a photo">
            <Select value={hasImage} onChange={(e) => setField("hasImage", e.target.value as TriState)}>
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
              onChange={(e) => setField("hasDescription", e.target.value as TriState)}
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
              onChange={(e) => setField("hasMultipleVariants", e.target.value as TriState)}
            >
              {TRI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Min price ($)">
            <Input value={priceMin} onChange={(e) => setField("priceMin", e.target.value)} placeholder="0" />
          </Field>
          <Field label="Max price ($)">
            <Input value={priceMax} onChange={(e) => setField("priceMax", e.target.value)} placeholder="200" />
          </Field>
          <Field label="Min THC (%)">
            <Input value={thcMin} onChange={(e) => setField("thcMin", e.target.value)} placeholder="0" />
          </Field>
          <Field label="Max THC (%)">
            <Input value={thcMax} onChange={(e) => setField("thcMax", e.target.value)} placeholder="100" />
          </Field>

          <Field label="DOH medical only">
            <Select
              value={isDohRestricted}
              onChange={(e) => setField("isDohRestricted", e.target.value as TriState)}
            >
              {TRI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort by">
            <Select value={sort} onChange={(e) => setField("sort", e.target.value as SelectionSort)}>
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
          {/*
            The selected count is the headline, not an afterthought appended to
            the match count. "2,555 of 2,562 products match · 8 selected" buries
            the only number the operator is about to act on behind two he is
            not. The number that is about to be transmitted gets the large type.
          */}
          <span className="text-sm">
            {selectedCount > 0 ? (
              <>
                <strong className="text-base text-emerald-300">
                  {selectedCount} selected to send
                </strong>
                <span className="opacity-70">
                  {" "}
                  — out of {matchedCount} shown, {feedCount} in the feed
                </span>
              </>
            ) : (
              <>
                <strong>{matchedCount}</strong> of {feedCount} products match.{" "}
                <span className="opacity-70">Nothing selected yet.</span>
              </>
            )}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {/*
              ROADMAP R7. This replaces the old always-identical sampler as
              the primary control: it picks a different eight each time and
              prefers products that actually pass Leafly's contract, which is
              what the owner asked for after the same eight were refused on a
              re-send.
            */}
            <Button type="button" variant="primary" onClick={suggestRotating} disabled={pending}>
              {sampleRound === 0 ? "Suggest a sample" : "Suggest another 8"}
            </Button>
            <Button
              type="button"
              variant="neutral"
              onClick={suggestFromWholeFeed}
              disabled={pending}
              title="The original fixed sample: the same spread every time, for reproducing an earlier push"
            >
              Same sample as before
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
              <Button
                type="button"
                variant="neutral"
                onClick={() => {
                  setSelected(new Set());
                  // An empty "only selected" table is a dead end with no way
                  // out except guessing. Emptying the selection returns to the
                  // full list.
                  setView("all");
                }}
              >
                Clear selection
              </Button>
            )}
          </div>
        </div>

        {/* Table view toggle */}
        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide opacity-70">
              Table shows
            </span>
            <button
              type="button"
              aria-pressed={view === "all"}
              onClick={() => setView("all")}
              className={
                view === "all"
                  ? "rounded-full border border-emerald-400 bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-100"
                  : "rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
              }
            >
              Everything that matches ({matchedCount})
            </button>
            <button
              type="button"
              aria-pressed={view === "selected"}
              onClick={() => setView("selected")}
              className={
                view === "selected"
                  ? "rounded-full border border-emerald-400 bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-100"
                  : "rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
              }
            >
              Only what I am sending ({visibility.visible})
            </button>
          </div>
        )}

        {/*
          A selected product that is filtered off-screen WILL be transmitted and
          CANNOT be reviewed, which is the most dangerous state this screen can
          reach. It is also a routine one, because the toolbar sampler draws
          from the whole feed while the table shows a filtered slice.

          This renders only when it is true. A banner that appears on every load
          teaches the reader to scroll past it, and then it is not there on the
          day it matters -- which is why the self-tests pin the silent case as
          hard as the noisy one.
        */}
        {hiddenNotice && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
            <span>{hiddenNotice}</span>
            <Button type="button" variant="neutral" onClick={clearFilters}>
              Clear the filters
            </Button>
          </div>
        )}

        {/*
          ROADMAP R7 -- what the rotating sampler just did, and ROADMAP R3 --
          any product in the suggested set that Leafly will refuse, named,
          with the button that goes to the page where it can be corrected.
        */}
        {sampleNote && (
          <div className="rounded border border-white/15 bg-white/[0.03] p-3 text-sm">
            <p className="leading-relaxed">{sampleNote}</p>
            {sampleFailing.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {sampleFailing.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-start gap-2 rounded bg-white/[0.04] p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold">{f.label}</div>
                      {f.reason && (
                        <div className="text-[0.7rem] text-white/70">{f.reason}</div>
                      )}
                    </div>
                    {f.fixHref && (
                      <Button type="button" variant="primary" size="sm" href={f.fixHref}>
                        Fix this product
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/*
          ROADMAP R4/R6 -- the pre-flight the owner asked for: what will
          Leafly take, what will it refuse, how do I fix the refusals, and
          send the good ones without the bad ones.
        */}
        <SendabilityPanel
          selectedIds={Array.from(selected)}
          onPushed={() => setSelected(new Set())}
        />

        {/*
          FINDING L-21 -- sizes that will not survive the trip.

          This is the warning that would have saved the owner's first push. Two
          sizes of the Ceres topical both described themselves to Leafly as
          "1 each", Leafly kept one, and the read-back afterwards reported the
          other as missing from the menu. Nothing failed in transit; the data
          arrived and was deduplicated.

          Stated BEFORE the push, because afterwards it is a diagnosis and
          beforehand it is a decision. Rendered only when something is actually
          being lost -- the self-tests pin the silent case explicitly.
        */}
        {sizeLossNotice && (
          <div className="space-y-2 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
            <p>
              <strong>
                {sizeLoss.totalLost} size{sizeLoss.totalLost === 1 ? "" : "s"} will not appear on
                Leafly.
              </strong>
            </p>
            <p>{sizeLossNotice}</p>
            <p className="text-xs opacity-80">
              You can still send this push — everything else about it is fine, and the sizes
              that do arrive will be correct. But the read-back afterwards will report the
              missing ones, and it will be right to.
            </p>
          </div>
        )}

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
                {/*
                  FINDING L-21. This column used to read "Sizes" and show how
                  many sizes the product has in our system. That is not the
                  number the owner needs. Leafly tells sizes apart only by
                  amount+unit, so a product with two sizes can arrive as one.
                  The column now reports what Leafly will actually hold, and
                  says so in its own heading.
                */}
                <th
                  className="p-2"
                  title="How many sizes Leafly will end up showing for this product. If it is lower than the number of sizes you have, two of them look identical to Leafly."
                >
                  Sizes to Leafly
                </th>
                <th className="p-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.length === 0 && !pending && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm opacity-70">
                    {view === "selected"
                      ? selectedCount === 0
                        ? "You have not selected anything yet."
                        : "Everything you have selected is hidden by the filters above. Clear them to see it."
                      : "Nothing matches these filters. Try clearing one."}
                  </td>
                </tr>
              )}
              {shownRows.map((row) => {
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
                    {/*
                      Show the honest number, and show the loss beside it rather
                      than instead of it. Replacing "2" with "1" would be
                      truthful and still useless — the owner would have no way to
                      tell a one-size product from a two-size product that lost
                      one. The strikethrough makes the difference legible at a
                      glance, which is the only place this ever gets read.
                    */}
                    <td className="p-2">
                      {row.lostVariantCount > 0 ? (
                        <span className="text-amber-300" title={`This product has ${row.variantCount} sizes, but ${row.lostVariantCount} of them describe themselves to Leafly the same way as another, so Leafly will only show ${row.sentVariantCount}.`}>
                          <span className="opacity-50 line-through">{row.variantCount}</span>{" "}
                          <strong>{row.sentVariantCount}</strong>
                        </span>
                      ) : (
                        row.sentVariantCount
                      )}
                    </td>
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

        {/*
          The manifest. The owner's words were "refine the process so it is
          easier for me to know what exactly i am sending", and the honest
          answer to "what am I sending?" is a list of the things, by name, short
          enough to read before clicking. Ticks scattered through a 2,555-row
          scroller are not that list, no matter how correct they are.

          It sits ABOVE the preview button because it needs no server round
          trip: it is built from rows already in the browser, so it is there the
          instant a checkbox changes, and the operator can catch a mis-click
          before spending a preview on it.
        */}
        {selectedCount > 0 && (
          <div className="space-y-2 rounded border border-emerald-400/30 bg-emerald-400/5 p-4">
            <h4 className="font-semibold">What you are about to send</h4>
            <p className="text-sm">{manifestSentence}</p>

            <ol className="max-h-56 list-decimal overflow-auto pl-6 text-sm">
              {manifest.rows.map((row) => (
                <li key={row.id} className="py-0.5">
                  <span className="font-medium">{row.name}</span>
                  <span className="opacity-60">
                    {" "}
                    — {row.category} · {money(row.priceMinorUnits)} · {row.id}
                  </span>
                </li>
              ))}
            </ol>

            {/*
              Named, not silently omitted. A manifest listing six items beside a
              button offering to send eight is worse than no manifest, because
              it is precise and wrong.
            */}
            {manifest.unknownIds.length > 0 && (
              <p className="text-sm opacity-80">
                <strong>{manifest.unknownIds.length}</strong> more selected product(s) cannot be
                described here because they are outside the current filters:{" "}
                {manifest.unknownIds.join(", ")}. They would still be sent.
              </p>
            )}

            <p className="border-t border-white/10 pt-2 text-xs opacity-70">
              These are sent as an update. Nothing else on your Leafly menu is changed or
              removed. This list is what your read-back will be checked against afterwards.
            </p>
          </div>
        )}

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
