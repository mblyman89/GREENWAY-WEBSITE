"use client";

/**
 * src/app/admin/integrations/leafly/menu-browser-client.tsx   (ROADMAP R8)
 *
 * ###########################################################################
 * # THE OWNER'S WORDS (ask 6)                                               #
 * #                                                                        #
 * #   "i don't understand product ids, nor are they a useful way to        #
 * #    identify products for the delete function ... they should not be    #
 * #    the product id, but the names of the product, the barcode, vendor   #
 * #    perhaps, just far more ways to identify the products we actually    #
 * #    need to get off the menu."                                          #
 * #                                                                        #
 * #   "there is no way to know what's on the menu so we can delete         #
 * #    something. we can push the read the menu back button, but it        #
 * #    doesn't really give very useful information."                       #
 * #                                                                        #
 * #   "i do not know how this should be set up ... i want you, as the      #
 * #    expert and professional, to do the enterprise grade solution that   #
 * #    allows me to delete products in an easy, efficient, effective,      #
 * #    intelligent way."                                                   #
 * ###########################################################################
 *
 * The design was explicitly delegated, so the reasoning is recorded here
 * rather than left implicit.
 *
 * WHAT WAS WRONG. Removal was a textarea that accepted product ids. To use it
 * the owner had to already know the id of a thing he wanted gone, which meant
 * reading an id out of a log or a push report and trusting he had matched it
 * to the right product by eye. Ids are the one identifier in this system with
 * no meaning to a human: `pos-45c6e282e0e8` names nothing. The delete feature
 * was therefore only usable by someone who did not need it.
 *
 * THE SHAPE CHOSEN. Browse, then tick, then confirm by name.
 *
 *   1. SEE THE MENU FIRST. The list is loaded before any destructive control
 *      is reachable. You cannot tick a product you have not been shown.
 *   2. FIND BY WHAT YOU KNOW. One search box matches across name, brand,
 *      vendor, strain, type, size and barcode simultaneously (AND across
 *      words), so any remembered fragment finds the row. Ids are searchable
 *      too, last, so an id pasted from a log still works -- but nothing in
 *      the UI asks for one.
 *   3. NARROW BY FACET. Brand / vendor / type counts come from the live rows,
 *      so a filter can never offer a value that matches nothing.
 *   4. TICK ROWS. Selection is by row, never by typing.
 *   5. CONFIRM BY NAME. The confirmation sentence lists the products by name
 *      and explicitly discloses anything selected that the current filter
 *      hides -- the classic way a filtered delete UI removes the wrong thing.
 *
 * WHY THE SOURCE BANNER IS NOT DECORATION. Leafly only permits reading the
 * menu back in the sandbox (405 in production), so in production this list is
 * built from our own record of what we sent. That is an honest but weaker
 * claim, and the banner says which one the owner is looking at. A delete UI
 * that silently implied "this is Leafly's menu" when it was really "our
 * records" would be lying at the exact moment it mattered.
 *
 * ALL DISPLAY LOGIC LIVES IN THE PURE CORE. Searching, filtering, sorting,
 * facet counting, row description and the confirmation sentence are all in
 * `menu-browser-core.ts`, which is pure and self-tested (70 assertions) and
 * mutation-tested. This file is wiring and markup only, so the rules that
 * protect the owner cannot be quietly rewritten by a styling change.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/admin/ui";
import { browseLeaflyMenuAction, deleteLeaflyMenuSelectionAction } from "./actions";
import {
  describeMenuRow,
  describeSelectAll,
  summarizeSelection,
  type MenuBrowserRow,
  type MenuBrowserSort,
} from "@/lib/leafly/menu-browser-core";
import type { MenuBrowserResult } from "@/lib/leafly/menu-browser-server";

function money(minorUnits: number | null): string {
  if (minorUnits === null || !Number.isFinite(minorUnits)) return "\u2014";
  return `$${(minorUnits / 100).toFixed(2)}`;
}

const SORTS: Array<{ value: MenuBrowserSort; label: string }> = [
  { value: "name", label: "Name (A\u2013Z)" },
  { value: "brand", label: "Brand" },
  { value: "vendor", label: "Vendor" },
  { value: "type", label: "Type" },
  { value: "sizes", label: "Most sizes first" },
];

export function LeaflyMenuBrowser({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<MenuBrowserResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [vendor, setVendor] = useState("");
  const [type, setType] = useState("");
  const [orphanedOnly, setOrphanedOnly] = useState(false);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [sort, setSort] = useState<MenuBrowserSort>("name");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState<boolean | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Filtering happens on the SERVER, against the same pure functions the
  // tests exercise. Re-implementing the match here would create a second
  // definition of "matches", and the two would eventually disagree.
  const load = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const res = await browseLeaflyMenuAction({
        query: query.trim() === "" ? null : query.trim(),
        brand: brand === "" ? null : brand,
        vendor: vendor === "" ? null : vendor,
        type: type === "" ? null : type,
        orphanedOnly,
        hiddenOnly,
        sort,
      });
      if (res.ok) {
        setData(res.result);
        setLoaded(true);
      } else {
        setError(res.error);
        setLoaded(true);
      }
    });
  }, [query, brand, vendor, type, orphanedOnly, hiddenOnly, sort]);

  // Re-filter when a control changes, but only once the owner has chosen to
  // open the browser. Loading a full menu on mount would make every visit to
  // this page pay for a feature most visits do not use.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, brand, vendor, type, orphanedOnly, hiddenOnly, sort]);

  // Memoised so the identity of `rows` is stable between renders. Without
  // this the `summarizeSelection` memo below re-runs on every render, which
  // is wasted work on a menu of a few thousand rows.
  const rows = useMemo(() => data?.matched ?? [], [data]);
  const facets = data?.facets ?? null;

  // The confirmation sentence is computed by the pure core from the rows the
  // owner can SEE plus every id selected, so off-screen selections surface.
  const summary = useMemo(
    () => summarizeSelection(rows, Array.from(selected)),
    [rows, selected],
  );

  function toggle(id: string) {
    setArmed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllMatched() {
    setArmed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) next.add(r.id);
      return next;
    });
  }

  function clearSelection() {
    setArmed(false);
    setSelected(new Set());
  }

  function doDelete() {
    setResult(null);
    setResultOk(null);
    setWarning(null);
    startTransition(async () => {
      const res = await deleteLeaflyMenuSelectionAction({
        ids: Array.from(selected),
        confirm: true,
      });
      if (res.ok) {
        setResultOk(true);
        setResult(res.message);
        setWarning(res.warning ?? null);
        setSelected(new Set());
        setArmed(false);
        load(); // Show the menu as it now IS, not as it was.
      } else {
        setResultOk(false);
        setResult(res.error);
        setArmed(false);
      }
    });
  }

  return (
    <Card>
      <h2 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
        What is on your Leafly menu
      </h2>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Search your live Leafly menu by product name, brand, vendor, strain, size or
        barcode, tick what you want gone, and remove it. You never need a product ID.
      </p>

      {!loaded && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={load}
          disabled={!configured || pending}
        >
          {pending ? "Loading your menu\u2026" : "Show me what is on the menu"}
        </Button>
      )}
      {!configured && (
        <p className="mt-2 text-xs text-[var(--admin-danger)]">
          Set your Leafly credentials first.
        </p>
      )}

      {loaded && (
        <>
          {/* Honesty about provenance -- see the header note. */}
          {data && (
            <div className="mb-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-2.5">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone={data.source === "leafly" ? "green" : "gold"}>
                  {data.source === "leafly" ? "Live from Leafly" : "From our records"}
                </Badge>
                <span className="text-[0.7rem] text-[var(--admin-text-muted)]">
                  {data.totalCount} product{data.totalCount === 1 ? "" : "s"} on the menu
                </span>
              </div>
              <p className="text-[0.7rem] leading-relaxed text-[var(--admin-text-muted)]">
                {data.sourceNote}
              </p>
              {data.readbackError && (
                <p className="mt-1 text-[0.7rem] text-[var(--admin-gold)]">
                  Live read-back was attempted and did not succeed: {data.readbackError}
                </p>
              )}
            </div>
          )}

          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search" htmlFor="leafly-menu-q">
              <Input
                id="leafly-menu-q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={"name, brand, vendor, barcode\u2026"}
              />
            </Field>
            <Field label="Brand" htmlFor="leafly-menu-brand">
              <Select
                id="leafly-menu-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              >
                <option value="">All brands</option>
                {(facets?.brands ?? []).map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.value} ({b.count})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor" htmlFor="leafly-menu-vendor">
              <Select
                id="leafly-menu-vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              >
                <option value="">All vendors</option>
                {(facets?.vendors ?? []).map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.value} ({v.count})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type" htmlFor="leafly-menu-type">
              <Select
                id="leafly-menu-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">All types</option>
                {(facets?.types ?? []).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.value} ({t.count})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort" htmlFor="leafly-menu-sort">
              <Select
                id="leafly-menu-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as MenuBrowserSort)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-[var(--admin-text-muted)]">
              <input
                type="checkbox"
                checked={orphanedOnly}
                onChange={(e) => setOrphanedOnly(e.target.checked)}
              />
              Only products no longer in our feed
              {facets ? ` (${facets.orphanedCount})` : ""}
            </label>
            <label className="flex items-center gap-1.5 text-[var(--admin-text-muted)]">
              <input
                type="checkbox"
                checked={hiddenOnly}
                onChange={(e) => setHiddenOnly(e.target.checked)}
              />
              Only products Leafly is hiding
              {facets ? ` (${facets.hiddenCount})` : ""}
            </label>
            <span className="ml-auto text-[var(--admin-text-muted)]">
              {data ? describeSelectAll(data.matchedCount, data.totalCount) : ""}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={selectAllMatched}
              disabled={pending || rows.length === 0}
            >
              Select all {rows.length} shown
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={clearSelection}
              disabled={pending || selected.size === 0}
            >
              Clear selection
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={load}
              disabled={pending}
            >
              Refresh
            </Button>
          </div>

          {error && (
            <p className="mb-3 text-xs text-[var(--admin-danger)]">{error}</p>
          )}

          <div className="max-h-[28rem] overflow-auto rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--admin-surface-2)]">
                <tr>
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-2 py-2">Product</th>
                  <th className="px-2 py-2">Vendor</th>
                  <th className="px-2 py-2">Sizes</th>
                  <th className="px-2 py-2">Barcode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: MenuBrowserRow) => {
                  const isSel = selected.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={`border-t border-[var(--admin-border)] ${
                        isSel ? "bg-[var(--admin-orange-soft)]" : ""
                      }`}
                    >
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${describeMenuRow(row)}`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="font-semibold text-[var(--admin-text)]">
                          {row.name ?? "Unnamed product"}
                        </div>
                        <div className="text-[0.68rem] text-[var(--admin-text-muted)]">
                          {[row.brand, row.strainName, row.type]
                            .filter((v) => v !== null && String(v).trim() !== "")
                            .join(" \u00b7 ")}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.orphaned && <Badge tone="gold">Not in our feed</Badge>}
                          {row.hidden === true && <Badge tone="neutral">Hidden</Badge>}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top text-[var(--admin-text-muted)]">
                        {row.vendor ?? "\u2014"}
                      </td>
                      <td className="px-2 py-2 align-top text-[var(--admin-text-muted)]">
                        {row.variants.length === 0
                          ? "\u2014"
                          : row.variants.map((v) => (
                              <div key={v.id}>
                                {v.sizeLabel ?? "\u2014"} {money(v.priceMinorUnits)}
                              </div>
                            ))}
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-[0.65rem] text-[var(--admin-text-muted)]">
                        {row.barcodes.length > 0 ? row.barcodes.join(", ") : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !pending && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-2 py-6 text-center text-[var(--admin-text-muted)]"
                    >
                      Nothing matches what you searched for.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* The destructive step. Two-stage arm/confirm, and the sentence the
              owner confirms is written by the pure core, in names. */}
          {selected.size > 0 && (
            <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-danger-soft)] p-3">
              <p className="mb-2 text-xs leading-relaxed text-[var(--admin-text)]">
                {summary.confirmation}
              </p>
              {!armed ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setArmed(true)}
                  disabled={pending}
                >
                  Remove these {summary.count} from Leafly
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={doDelete}
                    disabled={pending}
                  >
                    {pending ? "Removing\u2026" : "Yes, remove them now"}
                  </Button>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => setArmed(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}

          {result && (
            <p
              className={`mt-3 text-xs ${
                resultOk ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"
              }`}
            >
              {result}
            </p>
          )}
          {warning && (
            <p className="mt-1 text-xs text-[var(--admin-gold)]">{warning}</p>
          )}
        </>
      )}
    </Card>
  );
}
