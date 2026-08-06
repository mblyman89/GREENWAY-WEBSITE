"use client";

/**
 * NeverDiscountManager — PR-P4 client island for the global "never discount"
 * list. Products added here NEVER receive ANY promotion (storewide sales, daily
 * deals, brand sales, smart-selector targets — nothing); the discount engine
 * treats them as an exclusion on every rule and "exclusions win", so they keep
 * their regular price at the register and on the storefront.
 *
 * Add: pick a product from the live menu (searchable), optionally note a reason,
 * click Protect. Idempotent — re-adding a product is a no-op. Remove: one click.
 * Every change re-prices the store (the actions revalidate the layout).
 */

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  addNeverDiscountAction,
  removeNeverDiscountAction,
} from "@/app/admin/promotions/actions";
import type { MenuProductOption } from "@/lib/promotions/promotions-store";
import type { NeverDiscountEntry } from "@/lib/promotions/promotions-store";
import { formatMinorCurrency } from "@/lib/leafly/format";

type Props = {
  products: MenuProductOption[];
  initialList: NeverDiscountEntry[];
};

export function NeverDiscountManager({ products, initialList }: Props) {
  const { toast } = useToast();
  const [list, setList] = useState<NeverDiscountEntry[]>(initialList);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const listedKeys = useMemo(() => new Set(list.map((e) => e.productKey)), [list]);

  // Searchable, not-already-listed products (cap the dropdown for performance).
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = products.filter((p) => !listedKeys.has(p.key));
    if (!q) return pool.slice(0, 25);
    return pool
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.categories.some((c) => c.toLowerCase().includes(q)),
      )
      .slice(0, 25);
  }, [products, query, listedKeys]);

  const selected = useMemo(
    () => products.find((p) => p.key === selectedKey) ?? null,
    [products, selectedKey],
  );

  function add() {
    if (!selected) return;
    startTransition(async () => {
      const res = await addNeverDiscountAction({
        productKey: selected.key,
        productName: selected.name,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      if (res.alreadyListed) {
        toast({ tone: "info", message: `${selected.name} is already protected.` });
      } else {
        setList((prev) =>
          [
            {
              id: res.id,
              productKey: selected.key,
              productName: selected.name,
              reason: reason.trim() || null,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ].sort((a, b) => (a.productName ?? "").localeCompare(b.productName ?? "")),
        );
        toast({ tone: "success", message: `${selected.name} will never be discounted.` });
      }
      setSelectedKey("");
      setReason("");
      setQuery("");
    });
  }

  function remove(entry: NeverDiscountEntry) {
    startTransition(async () => {
      await removeNeverDiscountAction(entry.id);
      setList((prev) => prev.filter((e) => e.id !== entry.id));
      toast({
        tone: "info",
        message: `${entry.productName ?? "Product"} can be discounted again.`,
      });
    });
  }

  const inputCls =
    "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]";

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">
          Protect a product from all discounts
        </h2>
        <p className="mt-1 text-xs text-white/45">
          Search your live menu, pick a product, and it will keep its regular price under every deal
          — storewide sales, daily deals, brand sales, everything.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
              Find a product
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedKey("");
              }}
              placeholder="Search by name, brand, or category…"
              className={`mt-1 ${inputCls}`}
            />
            {query.trim() && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-black">
                {matches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-white/40">No matching products.</p>
                ) : (
                  matches.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        setSelectedKey(p.key);
                        setQuery(p.name);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-white/10 ${
                        selectedKey === p.key ? "bg-[var(--admin-accent)]/20" : ""
                      }`}
                    >
                      <span className="text-white/85">
                        {p.name}
                        {p.brand ? <span className="text-white/40"> · {p.brand}</span> : null}
                      </span>
                      <span className="text-white/50">{formatMinorCurrency(p.priceMinorUnits)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. vendor price protection, loss leader"
              className={`mt-1 ${inputCls}`}
            />
            <div className="mt-3">
              <Button
                type="button"
                onClick={add}
                disabled={pending || !selected}
                variant="confirm"
                size="sm"
              >
                {selected ? `Protect “${selected.name}”` : "Pick a product first"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Current list */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">
            Never-discount list
          </h2>
          <span className="text-xs text-white/40">
            {list.length} product{list.length === 1 ? "" : "s"} protected
          </span>
        </div>

        {list.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-white/45">
            No products are protected yet. Everything is eligible for promotions. Add a product above
            to always keep it at full price.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/40 text-white/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => (
                  <tr key={entry.id} className="border-t border-white/5">
                    <td className="px-3 py-2 text-white/85">
                      {entry.productName || <span className="font-mono text-white/50">{entry.productKey}</span>}
                    </td>
                    <td className="px-3 py-2 text-white/50">{entry.reason || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        onClick={() => remove(entry)}
                        disabled={pending}
                        variant="neutral"
                        size="sm"
                      >
                        Allow discounts
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
