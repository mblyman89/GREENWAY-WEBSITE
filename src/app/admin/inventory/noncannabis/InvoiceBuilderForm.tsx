"use client";

/**
 * InvoiceBuilderForm — key a vendor's PAPER invoice into the system (Task N).
 *
 * Owner's flow (verbatim intent): the glass vendor comes in with stock, we
 * pick out what we want, they write a paper invoice. Staff copy that invoice
 * here: header (vendor / invoice # / date) + one row per line. Each row is
 * either a NEW item (staged as a catalog draft to confirm) or a restock of an
 * EXISTING item (+received adjustment). The saved invoice becomes a payable
 * source document on the Accounts Payable page.
 *
 * A live running total is shown; if staff enter the total PRINTED on the
 * paper, the server blocks a mismatch (typo catcher). Dollars in the UI,
 * cents on the server.
 */
import { useActionState, useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { NONCANNABIS_TYPES } from "@/lib/naming/noncannabis-core";
import { submitNonCannabisInvoiceAction, type InvoiceSubmitResult } from "./actions";

export type InvoiceProductOption = {
  id: string;
  sku: string;
  name: string;
};

type Row = {
  id: number;
  kind: "new" | "existing";
  productId: string;
  description: string;
  qty: string;
  unitCost: string;
  type: string;
  price: string;
};

const blankRow = (id: number): Row => ({
  id,
  kind: "new",
  productId: "",
  description: "",
  qty: "",
  unitCost: "",
  type: "pipe",
  price: "",
});

function rowCents(row: Row): number {
  const qty = Number.parseInt(row.qty, 10);
  const cost = Number.parseFloat(row.unitCost.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost)) return 0;
  return Math.round(qty * Math.round(cost * 100));
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function InvoiceBuilderForm({ products }: { products: InvoiceProductOption[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [rows, setRows] = useState<Row[]>([blankRow(1)]);
  const [nextId, setNextId] = useState(2);
  const [statedTotal, setStatedTotal] = useState("");
  const [state, formAction, pending] = useActionState<InvoiceSubmitResult | null, FormData>(
    submitNonCannabisInvoiceAction,
    null,
  );

  const setRow = (id: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const addRow = () => {
    setRows((r) => [...r, blankRow(nextId)]);
    setNextId((n) => n + 1);
  };
  const removeRow = (id: number) =>
    setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));

  const runningTotal = rows.reduce((s, r) => s + rowCents(r), 0);
  const statedCents = (() => {
    const n = Number.parseFloat(statedTotal.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  })();
  const totalsDisagree =
    statedCents != null && statedTotal.trim() !== "" && statedCents !== runningTotal;

  const productLabel = (p: InvoiceProductOption) => `${p.name} · ${p.sku}`;

  return (
    <form action={formAction} className="space-y-4">
      {/* Header — copied from the top of the paper invoice */}
      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <Field label="Vendor" required help="As written on the invoice">
            <Input name="vendorName" placeholder="e.g. Glass Guy Distribution" />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="Invoice #" required help="Printed on the paper">
            <Input name="invoiceNumber" placeholder="e.g. GG-1042" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Invoice date" required>
            <Input type="date" name="invoiceDate" defaultValue={today} />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field
            label="Paper total ($)"
            help="Optional typo-catcher — must match the lines"
          >
            <Input
              name="statedTotal"
              inputMode="decimal"
              placeholder="0.00"
              value={statedTotal}
              onChange={(e) => setStatedTotal(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Lines — one row per line on the paper invoice */}
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3"
          >
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="sm:col-span-2">
                <Field label={`Line ${i + 1}`} help="New or restock?">
                  <Select
                    name="lineKind"
                    value={row.kind}
                    onChange={(e) =>
                      setRow(row.id, {
                        kind: e.target.value === "existing" ? "existing" : "new",
                        productId: "",
                      })
                    }
                  >
                    <option value="new">New item</option>
                    <option value="existing">Restock existing</option>
                  </Select>
                </Field>
              </div>

              {row.kind === "existing" ? (
                <div className="sm:col-span-4">
                  <Field label="Product" required>
                    <Select
                      name="lineProductId"
                      value={row.productId}
                      onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value);
                        setRow(row.id, {
                          productId: e.target.value,
                          description: p ? productLabel(p) : row.description,
                        });
                      }}
                    >
                      <option value="">Select the product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {productLabel(p)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {/* Description snapshot posted for existing lines too. */}
                  <input type="hidden" name="lineDescription" value={row.description} />
                  <input type="hidden" name="lineType" value="" />
                  <input type="hidden" name="linePrice" value="" />
                </div>
              ) : (
                <>
                  <div className="sm:col-span-4">
                    <Field label="Description" required help="Becomes the draft's name">
                      <Input
                        name="lineDescription"
                        placeholder="e.g. Blue Dot 6in Spoon Pipe"
                        value={row.description}
                        onChange={(e) => setRow(row.id, { description: e.target.value })}
                      />
                    </Field>
                    <input type="hidden" name="lineProductId" value="" />
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Type" help="Drives the SKU">
                      <Select
                        name="lineType"
                        value={row.type}
                        onChange={(e) => setRow(row.id, { type: e.target.value })}
                      >
                        {NONCANNABIS_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </>
              )}

              <div className="sm:col-span-1">
                <Field label="Qty" required>
                  <Input
                    name="lineQty"
                    inputMode="numeric"
                    placeholder="0"
                    value={row.qty}
                    onChange={(e) => setRow(row.id, { qty: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Unit cost ($)" required>
                  <Input
                    name="lineUnitCost"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={row.unitCost}
                    onChange={(e) => setRow(row.id, { unitCost: e.target.value })}
                  />
                </Field>
              </div>
              {row.kind === "new" ? (
                <div className="sm:col-span-2">
                  <Field label="Retail ($)" help="Optional shelf price">
                    <Input
                      name="linePrice"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={row.price}
                      onChange={(e) => setRow(row.id, { price: e.target.value })}
                    />
                  </Field>
                </div>
              ) : (
                <div className="sm:col-span-2 flex items-end pb-1 text-xs text-[var(--admin-text-faint)]">
                  +{Number.parseInt(row.qty, 10) || 0} on hand when saved
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-[var(--admin-text-faint)]">
                Line total: <strong className="text-[var(--admin-text)]">{usd(rowCents(row))}</strong>
              </span>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="text-[var(--admin-text-faint)] hover:text-[var(--admin-danger)]"
              >
                Remove line
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="neutral" size="sm" onClick={addRow}>
          + Add line
        </Button>
        <span className="text-sm text-[var(--admin-text-muted)]">
          Running total:{" "}
          <strong className="text-[var(--admin-text)]">{usd(runningTotal)}</strong>
        </span>
        {totalsDisagree ? (
          <span className="text-xs text-[var(--admin-danger)]">
            ⚠ Paper total {usd(statedCents ?? 0)} ≠ lines {usd(runningTotal)} — fix before saving.
          </span>
        ) : null}
      </div>

      <Field label="Note" help="Optional — anything worth remembering about this visit">
        <Textarea name="invoiceNote" rows={1} placeholder="e.g. Vendor day drop-in; net 30." />
      </Field>

      <div>
        <Button type="submit" variant="confirm" disabled={pending}>
          {pending ? "Saving…" : "Save invoice"}
        </Button>
      </div>

      {state && !state.ok && state.problems.length > 0 && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
          <ul className="space-y-1">
            {state.problems.map((p, k) => (
              <li key={k}>• {p}</li>
            ))}
          </ul>
        </div>
      )}

      {state?.ok && state.message && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          ✓ {state.message}
        </div>
      )}
    </form>
  );
}
