"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  computePromotions,
  formatMoneyMinor,
  type EngineRule,
  type EngineCartLine,
} from "@/lib/promotions/discount-engine-core";

/**
 * POS discount SIMULATOR (client island).
 *
 * The manager assembles a sample basket from the published menu and instantly
 * sees the authoritative per-line discounts and totals the POS engine would
 * apply with the currently-active published promotions. This lets staff VALIDATE
 * a promotion against realistic baskets before trusting it at the register —
 * the same engine (discount-engine-core) runs here and in the cart.
 */
export type MenuPick = {
  key: string;
  name: string;
  brand: string;
  category: string;
  categories: string[];
  priceMinorUnits: number;
  variantLabel?: string | null;
};

type BasketEntry = { pick: MenuPick; quantity: number };

export function SimulatorClient({
  menu,
  rules,
}: {
  menu: MenuPick[];
  rules: EngineRule[];
}) {
  const [query, setQuery] = useState("");
  const [basket, setBasket] = useState<BasketEntry[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menu.slice(0, 25);
    return menu
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.brand.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [query, menu]);

  function addPick(pick: MenuPick) {
    setBasket((prev) => {
      const existing = prev.find((b) => b.pick.key === pick.key);
      if (existing) {
        return prev.map((b) => (b.pick.key === pick.key ? { ...b, quantity: b.quantity + 1 } : b));
      }
      return [...prev, { pick, quantity: 1 }];
    });
  }
  function setQty(key: string, qty: number) {
    setBasket((prev) =>
      prev
        .map((b) => (b.pick.key === key ? { ...b, quantity: Math.max(0, qty) } : b))
        .filter((b) => b.quantity > 0),
    );
  }
  function remove(key: string) {
    setBasket((prev) => prev.filter((b) => b.pick.key !== key));
  }

  const cartLines: EngineCartLine[] = basket.map((b) => ({
    lineId: b.pick.key,
    regularPriceMinorUnits: b.pick.priceMinorUnits,
    quantity: b.quantity,
    categories: b.pick.categories.length ? b.pick.categories : [b.pick.category.toLowerCase()],
    brand: b.pick.brand || null,
    productKey: b.pick.key,
    variantLabel: b.pick.variantLabel ?? null,
  }));

  const result = useMemo(() => computePromotions(cartLines, rules), [cartLines, rules]);
  const lineById = new Map(result.lines.map((l) => [l.lineId, l]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Product picker */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-stone-800">Add products to the sample basket</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the published menu by name, brand, or category…"
          className="mb-3 w-full rounded-[var(--admin-radius)] border border-stone-300 px-3 py-2 text-sm"
        />
        {menu.length === 0 ? (
          <p className="text-sm text-stone-500">
            No published menu version found. Publish a menu to simulate against real products.
          </p>
        ) : (
          <div className="max-h-[420px] divide-y divide-stone-100 overflow-y-auto rounded-[var(--admin-radius)] border border-stone-200">
            {filtered.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => addPick(m)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50"
              >
                <span>
                  <span className="font-medium text-stone-800">{m.name}</span>
                  <span className="block text-xs text-stone-500">
                    {[m.brand, m.category].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span className="text-stone-700">{formatMoneyMinor(m.priceMinorUnits)}</span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-stone-500">No matches.</p>
            ) : null}
          </div>
        )}
      </Card>

      {/* Basket + results */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-stone-800">Sample basket & computed discounts</h2>
        {basket.length === 0 ? (
          <p className="text-sm text-stone-500">Add products on the left to see the deals the POS engine applies.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                    <th className="px-2 py-1">Item</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Reg</th>
                    <th className="px-2 py-1 text-right">Sale</th>
                    <th className="px-2 py-1">Deal</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {basket.map((b) => {
                    const res = lineById.get(b.pick.key);
                    const saved = res ? res.unitSavingsMinorUnits > 0 : false;
                    return (
                      <tr key={b.pick.key} className="border-t border-stone-100">
                        <td className="px-2 py-2">
                          <div className="font-medium text-stone-800">{b.pick.name}</div>
                          <div className="text-xs text-stone-500">{b.pick.brand || "—"}</div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min={1}
                            value={b.quantity}
                            onChange={(e) => setQty(b.pick.key, Math.round(Number(e.target.value) || 0))}
                            className="w-16 rounded border border-stone-300 px-2 py-1 text-right text-sm"
                          />
                        </td>
                        <td className="px-2 py-2 text-right text-stone-500">
                          {formatMoneyMinor(b.pick.priceMinorUnits)}
                        </td>
                        <td className={`px-2 py-2 text-right font-medium ${saved ? "text-emerald-700" : "text-stone-700"}`}>
                          {res ? formatMoneyMinor(res.unitPriceMinorUnits) : formatMoneyMinor(b.pick.priceMinorUnits)}
                        </td>
                        <td className="px-2 py-2">
                          {res?.appliedLabel ? (
                            <Badge tone="green">{res.appliedLabel}</Badge>
                          ) : (
                            <span className="text-xs text-stone-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => remove(b.pick.key)}
                            className="text-xs text-stone-400 hover:text-red-600"
                            aria-label="Remove"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-1 border-t border-stone-200 pt-3 text-sm">
              <div className="flex justify-between text-stone-600">
                <span>Regular subtotal</span>
                <span>{formatMoneyMinor(result.totalRegularMinorUnits)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Total savings</span>
                <span>−{formatMoneyMinor(result.totalSavingsMinorUnits)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-stone-900">
                <span>Discounted total</span>
                <span>{formatMoneyMinor(result.totalDiscountedMinorUnits)}</span>
              </div>
            </div>

            {result.byRule.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Savings by promotion</h3>
                <ul className="space-y-1 text-sm">
                  {result.byRule.map((r) => (
                    <li key={r.ruleId} className="flex justify-between text-stone-700">
                      <span>{r.title}</span>
                      <span className="text-emerald-700">−{formatMoneyMinor(r.savingsMinorUnits)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <Button type="button" variant="subtle" size="sm" onClick={() => setBasket([])}>
                Clear basket
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
