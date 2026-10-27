"use client";

/**
 * SLICE L-48 — "CHANGE ITEMS" AT THE FRONT REGISTER.
 *
 * The owner, verbatim:
 *
 *   > "I want to be able to change update or modify (whatever it's called)
 *   >  on the dashboard, and on the front register."
 *
 * This is the register half of Leafly's "Update Order's Cart". It lives in its
 * own file rather than inside RegisterShell.tsx (already 5,600 lines) and is
 * opened from the pickup queue's detail pane for Leafly orders.
 *
 * EVERYTHING IS DECIDED ON THE SERVER. The flow is:
 *
 *   1. OPEN     POST { orderId, cartLoad: {} } → current items, whether they
 *               can be changed (and why not, in words), the cart signature,
 *               and the in-stock menu to swap or add from.
 *   2. REVIEW   POST { orderId, cart: { ..., review: true } } → the SAME pure
 *               decision the send will make, as a dry run. Nothing is sent.
 *   3. SEND     POST { orderId, cart: { ..., pin? } } → the server re-checks
 *               everything and sends. The rows sent are the rows REVIEWED:
 *               any edit after Review discards the review.
 *
 * WHO CAN PRESS IT. Any budtender, for changes at the menu price — the same
 * people who can Confirm or Mark ready. A price typed by hand needs a manager
 * or lead PIN. The PIN box appears only when the server's review says a price
 * was set by hand, and the server refuses the override without a verified PIN
 * whatever this screen does.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { posFetch } from "@/lib/pos/pos-fetch";
import { dollarsToMinor, formatCartMoney, type CartChange, type DesiredCartLine } from "@/lib/leafly/order-cart-core";

type CartLine = {
  cartItemId: string;
  integratorVariantId: string;
  name: string;
  brandName: string | null;
  variantLabel: string | null;
  quantity: number;
  packagePriceMinor: number;
};

type MenuOption = {
  integratorVariantId: string;
  productName: string;
  brand: string | null;
  variantLabel: string | null;
  category: string;
  priceMinorUnits: number;
  inventoryLevel: number;
};

type CartEditorPayload = {
  orderNumber: string;
  displayName: string;
  editable: boolean;
  blockedReason: string | null;
  signature: string;
  menuLoaded: boolean;
  lines: CartLine[];
  totalMinor: number | null;
  options: MenuOption[];
};

type CartReview = {
  allowed: boolean;
  code: string;
  reason: string;
  changes: CartChange[];
  estimatedTopLineMinor: number | null;
  needsManagerApproval: boolean;
};

type Row = {
  key: string;
  cartItemId: string | null;
  originalVariantId: string | null;
  originalLabel: string | null;
  integratorVariantId: string;
  label: string;
  quantity: number;
  defaultPriceMinor: number | null;
  priceText: string;
};

function menuLabel(o: MenuOption): string {
  const base = [o.productName, o.variantLabel].filter(Boolean).join(" · ");
  return o.brand ? `${base} (${o.brand})` : base;
}

function rowsFrom(lines: CartLine[]): Row[] {
  return lines.map((l) => {
    const label = [l.name, l.variantLabel].filter(Boolean).join(" · ");
    return {
      key: `item-${l.cartItemId}`,
      cartItemId: l.cartItemId,
      originalVariantId: l.integratorVariantId,
      originalLabel: label,
      integratorVariantId: l.integratorVariantId,
      label,
      quantity: l.quantity,
      defaultPriceMinor: l.packagePriceMinor,
      priceText: "",
    };
  });
}

const tile = "pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-3 py-2 text-sm disabled:opacity-40";

export function RegisterCartEditor({
  orderId,
  headers,
  employeeName,
  onClose,
  onUpdated,
}: {
  orderId: string;
  headers: Record<string, string>;
  employeeName: string;
  onClose: () => void;
  /** The change reached Leafly: the parent re-reads the order and the queue. */
  onUpdated: (message: string) => void;
}) {
  const [data, setData] = useState<CartEditorPayload | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewed, setReviewed] = useState<{ lines: DesiredCartLine[]; review: CartReview } | null>(null);
  const [pin, setPin] = useState("");
  const [seq, setSeq] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setReviewed(null);
    setPin("");
    try {
      const res = await posFetch("/api/pos/pickup", {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId, cartLoad: {} }),
      });
      const body = (await res.json().catch(() => null)) as { cartEditor?: CartEditorPayload; error?: string } | null;
      if (!res.ok || !body?.cartEditor) {
        setError(body?.error ?? "The order's items could not be loaded.");
        return;
      }
      setData(body.cartEditor);
      setRows(rowsFrom(body.cartEditor.lines));
    } catch {
      setError("Could not reach the server - nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  }, [headers, orderId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const edit = (next: Row[]) => {
    setRows(next);
    setReviewed(null);
    setPin("");
    setError(null);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.options ?? [];
    return (q === "" ? all : all.filter((o) => menuLabel(o).toLowerCase().includes(q) || o.category.toLowerCase().includes(q))).slice(0, 30);
  }, [data, search]);

  const choose = (o: MenuOption) => {
    if (picker === "__add") {
      setSeq((s) => s + 1);
      edit([
        ...rows,
        {
          key: `add-${seq}`,
          cartItemId: null,
          originalVariantId: null,
          originalLabel: null,
          integratorVariantId: o.integratorVariantId,
          label: menuLabel(o),
          quantity: 1,
          defaultPriceMinor: o.priceMinorUnits,
          priceText: "",
        },
      ]);
    } else if (picker) {
      edit(
        rows.map((r) => {
          if (r.key !== picker) return r;
          const original = r.originalVariantId === o.integratorVariantId;
          const originalLine = data?.lines.find((l) => l.cartItemId === r.cartItemId);
          return {
            ...r,
            integratorVariantId: o.integratorVariantId,
            label: original ? (r.originalLabel ?? menuLabel(o)) : menuLabel(o),
            defaultPriceMinor: original ? (originalLine?.packagePriceMinor ?? o.priceMinorUnits) : o.priceMinorUnits,
            priceText: "",
          };
        }),
      );
    }
    setPicker(null);
    setSearch("");
  };

  const desired = (): DesiredCartLine[] | string => {
    const out: DesiredCartLine[] = [];
    for (const r of rows) {
      let price: number | null = null;
      if (r.priceText.trim() !== "") {
        const m = dollarsToMinor(r.priceText);
        if (m === null || m < 1) return `"${r.priceText}" is not a valid price for ${r.label}. Use dollars like 12.50.`;
        price = m;
      }
      out.push({ cartItemId: r.cartItemId, integratorVariantId: r.integratorVariantId, quantity: r.quantity, packagePriceMinor: price });
    }
    if (out.length === 0) return "Leafly needs at least one item. To remove everything, cancel the order instead.";
    return out;
  };

  const post = async (lines: DesiredCartLine[], extra: Record<string, unknown>) => {
    const res = await posFetch("/api/pos/pickup", {
      method: "POST",
      headers,
      body: JSON.stringify({
        orderId,
        cart: { lines, signature: data?.signature ?? "", employeeName, ...extra },
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      cartReview?: CartReview;
      cartUpdated?: { message: string };
      error?: string;
      code?: string;
      needsManagerApproval?: boolean;
    } | null;
    return { res, body };
  };

  const review = async () => {
    if (!data || busy) return;
    const lines = desired();
    if (typeof lines === "string") {
      setError(lines);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { res, body } = await post(lines, { review: true });
      if (!res.ok || !body?.cartReview) {
        setError(body?.error ?? "The change could not be checked.");
        return;
      }
      setReviewed({ lines, review: body.cartReview });
    } catch {
      setError("Could not reach the server - nothing was sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!reviewed || busy) return;
    if (reviewed.review.needsManagerApproval && pin.trim() === "") {
      setError("A price was set by hand. A manager or lead must enter their PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { res, body } = await post(reviewed.lines, reviewed.review.needsManagerApproval ? { pin } : {});
      if (!res.ok || !body?.cartUpdated) {
        setPin("");
        setError(body?.error ?? "Leafly did not accept the change. Nothing was changed.");
        if (body?.code === "cart_changed_since_opened") {
          setReviewed(null);
        }
        return;
      }
      onUpdated(body.cartUpdated.message);
    } catch {
      setError("Could not reach the server - the change was NOT confirmed. Close this and check the order before trying again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--pos-info-border)] bg-[var(--pos-surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">Change items</h4>
        <button type="button" onClick={onClose} disabled={busy} className={tile}>
          Close
        </button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{error}</p>
      ) : null}
      {!data && busy ? <p className="mt-2 text-sm text-[var(--pos-text-muted)]">Loading the order&rsquo;s items…</p> : null}

      {data && !data.editable ? (
        <div className="mt-2 space-y-2">
          <p className="rounded-lg bg-[var(--pos-warn-soft)] px-3 py-2 text-sm text-[var(--pos-warn)]">
            {data.blockedReason ?? "This order's items cannot be changed right now."}
          </p>
          <button type="button" onClick={() => void load()} disabled={busy} className={tile}>
            Check again
          </button>
        </div>
      ) : null}

      {data && data.editable ? (
        <>
          {!data.menuLoaded ? (
            <p className="mt-2 text-xs text-[var(--pos-warn)]">
              The menu could not be loaded, so items cannot be swapped or added. Quantities can still be lowered and items removed.
            </p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface)] p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {r.label}
                      {r.cartItemId === null ? <span className="ml-2 text-xs text-[var(--pos-ok)]">NEW</span> : null}
                    </p>
                    {r.originalVariantId && r.originalVariantId !== r.integratorVariantId ? (
                      <p className="text-xs text-[var(--pos-warn)]">Swapping out: {r.originalLabel}</p>
                    ) : null}
                    <p className="text-xs text-[var(--pos-text-muted)]">{formatCartMoney(r.defaultPriceMinor)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`One fewer ${r.label}`}
                      disabled={busy || r.quantity <= 1}
                      onClick={() => edit(rows.map((x) => (x.key === r.key ? { ...x, quantity: x.quantity - 1 } : x)))}
                      className={`${tile} min-w-[3rem] text-lg`}
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-mono text-lg font-bold">{r.quantity}</span>
                    <button
                      type="button"
                      aria-label={`One more ${r.label}`}
                      disabled={busy}
                      onClick={() => edit(rows.map((x) => (x.key === r.key ? { ...x, quantity: x.quantity + 1 } : x)))}
                      className={`${tile} min-w-[3rem] text-lg`}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {data.menuLoaded && r.cartItemId !== null ? (
                    <button type="button" disabled={busy} onClick={() => { setPicker(r.key); setSearch(""); }} className={tile}>
                      Swap
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => edit(rows.filter((x) => x.key !== r.key))}
                    className="pos-tile rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)] disabled:opacity-40"
                  >
                    Remove
                  </button>
                  <label className="flex items-center gap-1 text-xs text-[var(--pos-text-muted)]">
                    Price each $
                    <input
                      inputMode="decimal"
                      value={r.priceText}
                      placeholder={r.defaultPriceMinor !== null ? (r.defaultPriceMinor / 100).toFixed(2) : ""}
                      onChange={(e) => edit(rows.map((x) => (x.key === r.key ? { ...x, priceText: e.target.value } : x)))}
                      aria-label={`Price each for ${r.label} (leave empty for the normal price; a manager PIN is needed)`}
                      className="w-24 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-2 py-2 text-sm"
                    />
                  </label>
                </div>
                {picker === r.key ? (
                  <MenuPicker search={search} setSearch={setSearch} options={filtered} onChoose={choose} onCancel={() => setPicker(null)} />
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap gap-2">
            {data.menuLoaded ? (
              <button type="button" disabled={busy} onClick={() => { setPicker("__add"); setSearch(""); }} className={tile}>
                + Add an item
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => edit(rowsFrom(data.lines))} className={tile}>
              Start over
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void review()}
              className="pos-tile rounded-lg bg-[var(--pos-info-solid)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy && !reviewed ? "Checking…" : "Review changes"}
            </button>
          </div>
          {picker === "__add" ? (
            <MenuPicker search={search} setSearch={setSearch} options={filtered} onChoose={choose} onCancel={() => setPicker(null)} />
          ) : null}

          {reviewed ? (
            <div className="mt-3 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">What will be sent to Leafly</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {reviewed.review.changes
                  .filter((c) => c.kind !== "unchanged")
                  .map((c, i) => (
                    <li key={i}>{c.sentence}</li>
                  ))}
              </ul>
              {reviewed.review.estimatedTopLineMinor !== null ? (
                <p className="mt-1 text-xs text-[var(--pos-text-muted)]">
                  Before deals: about {formatCartMoney(reviewed.review.estimatedTopLineMinor)}. Leafly applies its deals and sets the final total.
                </p>
              ) : null}
              {reviewed.review.needsManagerApproval ? (
                <label className="mt-2 block text-sm text-[var(--pos-warn)]">
                  A price was set by hand. Manager or lead PIN:
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="mt-1 block w-40 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 font-mono text-lg"
                    aria-label="Manager or lead PIN"
                  />
                </label>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="mt-3 pos-tile w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
              >
                {busy ? "Sending to Leafly…" : "Send these changes to Leafly"}
              </button>
              <p className="mt-1 text-center text-xs text-[var(--pos-text-faint)]">
                Leafly re-prices the order and tells the customer. Put any removed items back on the shelf.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MenuPicker({
  search,
  setSearch,
  options,
  onChoose,
  onCancel,
}: {
  search: string;
  setSearch: (s: string) => void;
  options: MenuOption[];
  onChoose: (o: MenuOption) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-2">
      <div className="flex gap-2">
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the menu…"
          aria-label="Search the menu"
          className="w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-3 py-2 text-sm"
        />
        <button type="button" onClick={onCancel} className={tile}>
          Cancel
        </button>
      </div>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {options.length === 0 ? (
          <li className="px-2 py-2 text-sm text-[var(--pos-text-faint)]">Nothing in stock matches that.</li>
        ) : (
          options.map((o) => (
            <li key={o.integratorVariantId}>
              <button
                type="button"
                onClick={() => onChoose(o)}
                className="pos-tile flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm"
              >
                <span className="min-w-0 truncate">{menuLabel(o)}</span>
                <span className="shrink-0 font-mono text-xs text-[var(--pos-text-muted)]">
                  {formatCartMoney(o.priceMinorUnits)} · {o.inventoryLevel} left
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
