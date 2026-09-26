"use client";

/**
 * src/components/admin/orders/LeaflyCartEditor.tsx
 *
 * SLICE L-48 — "CHANGE ITEMS" ON A LEAFLY ORDER (THE DASHBOARD HALF).
 *
 * The owner, verbatim:
 *
 *   > "I want to be able to change update or modify (whatever it's called)
 *   >  on the dashboard, and on the front register."
 *
 * Leafly calls it "Update Order's Cart" (POST /orders/{id}/cart). It is the
 * whole cart, all at once: every line that should remain, with the lines to
 * drop simply left out. Leafly re-prices the order (deals, total) and tells
 * the customer itself.
 *
 * THREE STEPS, ON PURPOSE
 * -----------------------
 *   1. EDIT     quantities, remove, swap a line for another menu item, add an
 *               item, optionally set a per-unit price. Nothing leaves the
 *               browser.
 *   2. REVIEW   the server runs the SAME pure decision the send will run
 *               (`decideCartUpdate`) as a dry run and returns the plain-English
 *               sentences. Nothing is sent to Leafly, nothing is recorded.
 *   3. CONFIRM  a real <form> posts the EXACT cart that was reviewed — the
 *               rows are frozen into `reviewed` when Review is pressed and any
 *               further edit throws the review away. So the thing a person
 *               agreed to is the thing that is sent, never a later edit.
 *
 * The editor decides nothing. Whether the order can be changed at all, what
 * each change means, and whether it is safe are answered on the server by the
 * pure core; this file only collects intent and shows answers.
 *
 * STALE SCREENS
 * -------------
 * The editor carries the cart's signature from the moment it was opened. If
 * the order changed at Leafly in between (a second screen, the register, the
 * customer), the server refuses with "cart_changed_since_opened" rather than
 * overwriting a cart nobody here has seen.
 */

import { useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/admin/ui/Button";
import {
  dollarsToMinor,
  formatCartMoney,
  type DesiredCartLine,
} from "@/lib/leafly/order-cart-core";
import type {
  LeaflyCartEditorData,
  LeaflyCartPreview,
} from "@/lib/leafly/order-cart-server";

type Option = LeaflyCartEditorData["options"][number];

/** One row in the editor. `cartItemId` null = a line being ADDED. */
type Row = {
  key: string;
  cartItemId: string | null;
  /** The variant the line started on (null for an added line). */
  originalVariantId: string | null;
  originalLabel: string | null;
  integratorVariantId: string;
  label: string;
  quantity: number;
  /** Per-unit price the line will get with no override (display only). */
  defaultPriceMinor: number | null;
  /** Empty string = no override. Otherwise dollars, e.g. "12.50". */
  priceText: string;
};

export function optionLabel(o: Pick<Option, "productName" | "variantLabel" | "brand">): string {
  const base = [o.productName, o.variantLabel].filter(Boolean).join(" · ");
  return o.brand ? `${base} (${o.brand})` : base;
}

/**
 * The desired cart the server expects, built from the rows. Returns the lines
 * and, separately, every row whose price text is not a valid amount, so the
 * editor can refuse Review with a precise message instead of guessing.
 */
export function rowsToDesired(rows: readonly Row[]): {
  lines: DesiredCartLine[];
  badPriceRows: string[];
} {
  const lines: DesiredCartLine[] = [];
  const badPriceRows: string[] = [];
  for (const r of rows) {
    let packagePriceMinor: number | null = null;
    if (r.priceText.trim() !== "") {
      const m = dollarsToMinor(r.priceText);
      if (m === null || m < 1) {
        badPriceRows.push(r.label);
        continue;
      }
      packagePriceMinor = m;
    }
    lines.push({
      cartItemId: r.cartItemId,
      integratorVariantId: r.integratorVariantId,
      quantity: r.quantity,
      packagePriceMinor,
    });
  }
  return { lines, badPriceRows };
}

const box =
  "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-white/5";

export function LeaflyCartEditor({
  leaflyOrderId,
  load,
  preview,
  update,
  returnTo,
  back,
}: {
  leaflyOrderId: string;
  load: (leaflyOrderId: string) => Promise<LeaflyCartEditorData | null>;
  preview: (input: {
    leaflyOrderId: string;
    lines: DesiredCartLine[];
    signature: string;
  }) => Promise<LeaflyCartPreview | null>;
  update: (formData: FormData) => Promise<void>;
  returnTo: string;
  back?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LeaflyCartEditorData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [picker, setPicker] = useState<string | null>(null); // row key, or "__add"
  const [search, setSearch] = useState("");
  const [reviewed, setReviewed] = useState<{ lines: DesiredCartLine[]; result: LeaflyCartPreview } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [seq, setSeq] = useState(0);

  function fromData(d: LeaflyCartEditorData): Row[] {
    return d.reading.lines.map((l) => {
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

  function openEditor() {
    setOpen(true);
    setLoadError(null);
    setReviewed(null);
    setReviewError(null);
    startTransition(async () => {
      try {
        const d = await load(leaflyOrderId);
        if (!d) {
          setLoadError("You are not allowed to change Leafly orders, or your session has ended.");
          return;
        }
        setData(d);
        setRows(fromData(d));
      } catch {
        setLoadError("The order's items could not be loaded. Nothing was changed. Try again.");
      }
    });
  }

  /** Every edit invalidates the review, so a stale preview is never confirmed. */
  function edit(next: Row[]) {
    setRows(next);
    setReviewed(null);
    setReviewError(null);
  }

  const optionsById = useMemo(() => {
    const m = new Map<string, Option>();
    for (const o of data?.options ?? []) m.set(o.integratorVariantId, o);
    return m;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.options ?? [];
    const hits = q === "" ? all : all.filter((o) => optionLabel(o).toLowerCase().includes(q) || o.category.toLowerCase().includes(q));
    return hits.slice(0, 40);
  }, [data, search]);

  function choose(o: Option) {
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
          label: optionLabel(o),
          quantity: 1,
          defaultPriceMinor: o.priceMinorUnits,
          priceText: "",
        },
      ]);
    } else if (picker) {
      edit(
        rows.map((r) => {
          if (r.key !== picker) return r;
          const backToOriginal = r.originalVariantId === o.integratorVariantId;
          return {
            ...r,
            integratorVariantId: o.integratorVariantId,
            label: backToOriginal ? (r.originalLabel ?? optionLabel(o)) : optionLabel(o),
            defaultPriceMinor: backToOriginal
              ? (data?.reading.lines.find((l) => l.cartItemId === r.cartItemId)?.packagePriceMinor ?? o.priceMinorUnits)
              : o.priceMinorUnits,
            priceText: "",
          };
        }),
      );
    }
    setPicker(null);
    setSearch("");
  }

  function review() {
    if (!data) return;
    const { lines, badPriceRows } = rowsToDesired(rows);
    if (badPriceRows.length > 0) {
      setReviewError(
        `These prices are not valid amounts (use dollars like 12.50, at least $0.01): ${badPriceRows.join(", ")}.`,
      );
      return;
    }
    if (lines.length === 0) {
      setReviewError("Leafly needs at least one item on the order. To remove everything, cancel the order instead.");
      return;
    }
    setReviewError(null);
    startTransition(async () => {
      try {
        const result = await preview({ leaflyOrderId, lines, signature: data.signature });
        if (!result) {
          setReviewError("You are not allowed to change Leafly orders, or your session has ended.");
          return;
        }
        setReviewed({ lines, result });
      } catch {
        setReviewError("The review could not be run. Nothing was sent to Leafly. Try again.");
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button type="button" variant="neutral" size="sm" onClick={openEditor}>
          ✏️ Change items
        </Button>
        <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
          Change quantities, swap or remove items, or add something. Leafly re-prices the order and tells the customer.
        </p>
      </div>
    );
  }

  return (
    <section className={`mt-3 p-3 ${box}`} aria-label="Change this order's items">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-[var(--admin-text)]">Change items</h3>
        <Button type="button" variant="neutral" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Close
        </Button>
      </div>

      {busy && !data ? <p className="mt-2 text-xs text-[var(--admin-text-muted)]">Loading the order’s items…</p> : null}
      {loadError ? <p className="mt-2 text-xs font-bold text-[var(--admin-danger)]">{loadError}</p> : null}

      {data && !data.editable ? (
        <div className="mt-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--admin-danger)]">
          {data.blockedReason ?? "This order’s items cannot be changed right now."}
        </div>
      ) : null}

      {data && data.editable ? (
        <>
          {!data.menuLoaded ? (
            <p className="mt-2 text-xs font-bold text-[var(--admin-gold)]">
              The menu could not be loaded, so items cannot be swapped or added right now. Quantities can still be lowered or items removed.
            </p>
          ) : null}

          <ul className="mt-2 space-y-2">
            {rows.map((r) => {
              const changedVariant = r.originalVariantId !== null && r.integratorVariantId !== r.originalVariantId;
              const stock = optionsById.get(r.integratorVariantId)?.inventoryLevel;
              return (
                <li key={r.key} className={`p-2 ${box}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[var(--admin-text)]">
                        {r.label}
                        {r.cartItemId === null ? <span className="ml-2 text-[11px] font-black text-[var(--admin-green,#4ade80)]">NEW</span> : null}
                      </p>
                      {changedVariant ? (
                        <p className="text-[11px] text-[var(--admin-gold)]">Swapping out: {r.originalLabel}</p>
                      ) : null}
                      <p className="text-[11px] text-[var(--admin-text-faint)]">
                        {formatCartMoney(r.defaultPriceMinor)} each
                        {typeof stock === "number" ? ` · ${stock} in stock` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="neutral"
                        size="sm"
                        aria-label={`One fewer ${r.label}`}
                        disabled={r.quantity <= 1}
                        onClick={() => edit(rows.map((x) => (x.key === r.key ? { ...x, quantity: x.quantity - 1 } : x)))}
                      >
                        −
                      </Button>
                      <span className="w-8 text-center font-mono text-sm font-black text-[var(--admin-text)]" aria-live="polite">
                        {r.quantity}
                      </span>
                      <Button
                        type="button"
                        variant="neutral"
                        size="sm"
                        aria-label={`One more ${r.label}`}
                        onClick={() => edit(rows.map((x) => (x.key === r.key ? { ...x, quantity: x.quantity + 1 } : x)))}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {data.menuLoaded && r.cartItemId !== null ? (
                      <Button type="button" variant="neutral" size="sm" onClick={() => { setPicker(r.key); setSearch(""); }}>
                        Swap
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => edit(rows.filter((x) => x.key !== r.key))}
                    >
                      Remove
                    </Button>
                    <label className="flex items-center gap-1 text-[11px] text-[var(--admin-text-muted)]">
                      Price each $
                      <input
                        inputMode="decimal"
                        className="w-20 rounded border border-[var(--admin-border-strong)] bg-transparent px-1 py-0.5 text-xs text-[var(--admin-text)]"
                        placeholder={r.defaultPriceMinor !== null ? (r.defaultPriceMinor / 100).toFixed(2) : ""}
                        value={r.priceText}
                        onChange={(e) => edit(rows.map((x) => (x.key === r.key ? { ...x, priceText: e.target.value } : x)))}
                        aria-label={`Price each for ${r.label} (leave empty for the normal price)`}
                      />
                    </label>
                  </div>
                  {picker === r.key ? (
                    <Picker search={search} setSearch={setSearch} options={filtered} onChoose={choose} onCancel={() => setPicker(null)} />
                  ) : null}
                </li>
              );
            })}
          </ul>

          {rows.length === 0 ? (
            <p className="mt-2 text-xs font-bold text-[var(--admin-danger)]">
              Every item is removed. Leafly needs at least one item — to remove everything, cancel the order instead.
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {data.menuLoaded ? (
              <Button type="button" variant="neutral" size="sm" onClick={() => { setPicker("__add"); setSearch(""); }}>
                + Add an item
              </Button>
            ) : null}
            <Button type="button" variant="neutral" size="sm" onClick={() => edit(fromData(data))} disabled={busy}>
              Start over
            </Button>
            <Button type="button" variant="save" size="sm" onClick={review} disabled={busy}>
              {busy ? "Checking…" : "Review changes"}
            </Button>
          </div>
          {picker === "__add" ? (
            <Picker search={search} setSearch={setSearch} options={filtered} onChoose={choose} onCancel={() => setPicker(null)} />
          ) : null}

          {reviewError ? <p className="mt-2 text-xs font-bold text-[var(--admin-danger)]">{reviewError}</p> : null}

          {reviewed ? (
            <div className={`mt-3 p-3 ${box}`}>
              {reviewed.result.allowed ? (
                <>
                  <p className="text-xs font-black uppercase tracking-wide text-[var(--admin-text-muted)]">What will be sent to Leafly</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-[var(--admin-text)]">
                    {reviewed.result.changes
                      .filter((c) => c.kind !== "unchanged")
                      .map((c, i) => (
                        <li key={i}>{c.sentence}</li>
                      ))}
                  </ul>
                  {reviewed.result.estimatedTopLineMinor !== null ? (
                    <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                      Before deals: about {formatCartMoney(reviewed.result.estimatedTopLineMinor)}. Leafly applies its deals and sets the final total.
                    </p>
                  ) : null}
                  {reviewed.result.needsManagerApproval ? (
                    <p className="mt-2 text-xs font-bold text-[var(--admin-gold)]">
                      This includes a price you set by hand. Sending it records your name as approving that price.
                    </p>
                  ) : null}
                  <form action={update} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="leaflyOrderId" value={leaflyOrderId} />
                    <input type="hidden" name="cartSignature" value={data.signature} />
                    <input type="hidden" name="cartLines" value={JSON.stringify(reviewed.lines)} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    {back ? <input type="hidden" name="back" value={back} /> : null}
                    <ConfirmButton />
                    <span className="text-[11px] text-[var(--admin-text-faint)]">Leafly tells the customer about the change.</span>
                  </form>
                </>
              ) : (
                <p className="text-sm font-bold text-[var(--admin-danger)]">{reviewed.result.reason}</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Picker({
  search,
  setSearch,
  options,
  onChoose,
  onCancel,
}: {
  search: string;
  setSearch: (s: string) => void;
  options: Option[];
  onChoose: (o: Option) => void;
  onCancel: () => void;
}) {
  return (
    <div className={`mt-2 p-2 ${box}`}>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className="w-full rounded border border-[var(--admin-border-strong)] bg-transparent px-2 py-1 text-sm text-[var(--admin-text)]"
          placeholder="Search the menu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the menu"
        />
        <Button type="button" variant="neutral" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {options.length === 0 ? (
          <li className="px-2 py-1 text-xs text-[var(--admin-text-faint)]">Nothing on the menu matches that, or it is out of stock.</li>
        ) : (
          options.map((o) => (
            <li key={o.integratorVariantId}>
              <button
                type="button"
                className="admin-focus flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm text-[var(--admin-text)] hover:bg-white/10"
                onClick={() => onChoose(o)}
              >
                <span className="min-w-0 truncate">{optionLabel(o)}</span>
                <span className="shrink-0 font-mono text-xs text-[var(--admin-text-muted)]">
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

/** Its own component: useFormStatus only reports the form it is rendered INSIDE. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="confirm" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Sending to Leafly…" : "Send these changes to Leafly"}
    </Button>
  );
}
