"use client";

/**
 * SaleFlow (POS Slice B6) — the guided sale: ID gate → cart → cash tender.
 *
 * Compliance-first sequencing (owner decision, research §14): NOTHING enters
 * the cart until the ID gate passes. The gate accepts either a PDF417 scan
 * (keyboard-wedge scanners type the barcode text and press Enter) or an
 * audited manual verification (WAC 314-55-150 list; reason required; the
 * manual_id_verification event is enqueued BEFORE the sale and the sale
 * payload references its UUID).
 *
 * Pricing runs the SAME pure engine the website checkout and the server-side
 * completion gate use (sale-flow-core → discount-engine-core +
 * order-pricing-core), so an offline sale prices identically and the server's
 * money recompute (S-2b) can never disagree. The WAC 314-55-095 limit meter
 * updates live; a hard block disables checkout on-device AND would be
 * re-refused server-side if it somehow synced.
 */

import { useMemo, useRef, useState } from "react";
import {
  parseAamvaPdf417,
  evaluateScannedId,
  evaluateManualId,
  ACCEPTABLE_ID_TYPES,
  type IdGateVerdict,
} from "@/lib/pos/id-scan-core";
import {
  addToCart,
  setCartQuantity,
  searchProducts,
  priceCart,
  judgeLimits,
  limitLinesFor,
  buildSalePayload,
  type PosMenuBundle,
  type PosCartEntry,
} from "@/lib/pos/sale-flow-core";
import { evaluateSalesHours } from "@/lib/compliance/sales-hours-core";
import { pacificDayKey } from "@/lib/reports/timezone";

type Step = "idgate" | "cart" | "tender" | "done";

export type SaleFlowProps = {
  bundle: PosMenuBundle;
  drawerSessionId: string;
  /** Enqueue an event; returns the clientUuid assigned to it. */
  onEnqueue: (eventType: "sale" | "manual_id_verification", payload: Record<string, unknown>) => string;
  /** Sale finished (change given). The shell locks the register. */
  onComplete: () => void;
  onCancel: () => void;
};

export function SaleFlow({ bundle, drawerSessionId, onEnqueue, onComplete, onCancel }: SaleFlowProps) {
  const [step, setStep] = useState<Step>("idgate");
  const [verdict, setVerdict] = useState<Extract<IdGateVerdict, { allowed: true }> | null>(null);
  const [manualEventUuid, setManualEventUuid] = useState<string | null>(null);
  const [customerType, setCustomerType] = useState<"recreational" | "medical">("recreational");
  const [cart, setCart] = useState<PosCartEntry[]>([]);
  const [changeMinor, setChangeMinor] = useState<number | null>(null);

  // Sales hours (WAC 314-55-147) checked on-device with the owner's window;
  // the server completion gate re-checks with ITS clock at sync time.
  const hours = evaluateSalesHours(new Date(), bundle.hours);
  if (!hours.allowed && step !== "done") {
    return (
      <Frame title="Sales hours" onCancel={onCancel}>
        <p className="max-w-md rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-300">{hours.reason}</p>
      </Frame>
    );
  }

  if (step === "idgate") {
    return (
      <IdGateScreen
        onCancel={onCancel}
        onPassed={(v, manualUuid) => {
          setVerdict(v);
          setManualEventUuid(manualUuid);
          setStep("cart");
        }}
        onEnqueueManual={(payload) => onEnqueue("manual_id_verification", payload)}
      />
    );
  }

  if (step === "cart" && verdict) {
    return (
      <CartScreen
        bundle={bundle}
        cart={cart}
        setCart={setCart}
        customerType={customerType}
        setCustomerType={setCustomerType}
        verdict={verdict}
        onCancel={onCancel}
        onTender={() => setStep("tender")}
      />
    );
  }

  if (step === "tender" && verdict) {
    return (
      <TenderScreen
        bundle={bundle}
        cart={cart}
        onBack={() => setStep("cart")}
        onCancel={onCancel}
        onPaid={(tenderedMinor) => {
          const priced = priceCart(cart, bundle.rules);
          const built = buildSalePayload({
            lines: priced.lines,
            totals: priced.totals,
            tenderedMinor,
            drawerSessionId,
            idVerification:
              verdict.method === "manual" && manualEventUuid
                ? { method: "manual", manualEventUuid }
                : { method: "scan" },
          });
          if (!built.ok) return built.errors.join(" ");
          onEnqueue("sale", built.payload as unknown as Record<string, unknown>);
          setChangeMinor(built.changeMinor);
          setStep("done");
          return null;
        }}
      />
    );
  }

  // done
  return (
    <Frame title="Sale complete" onCancel={onComplete} cancelLabel="Lock register">
      <p className="text-5xl font-bold text-emerald-300">{money(changeMinor ?? 0)} change</p>
      <p className="mt-4 max-w-md text-sm text-neutral-400">
        Count the change back to the customer. The sale is queued and will sync to the back office —
        the register locks when you tap below.
      </p>
      <button
        type="button"
        onClick={onComplete}
        className="mt-8 rounded-2xl bg-emerald-600 px-10 py-5 text-xl font-bold text-white"
      >
        Done — lock register
      </button>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — ID gate
// ---------------------------------------------------------------------------

function IdGateScreen({
  onPassed,
  onCancel,
  onEnqueueManual,
}: {
  onPassed: (v: Extract<IdGateVerdict, { allowed: true }>, manualEventUuid: string | null) => void;
  onCancel: () => void;
  onEnqueueManual: (payload: Record<string, unknown>) => string;
}) {
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [scanBuffer, setScanBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scanRef = useRef<HTMLTextAreaElement | null>(null);

  // Manual form state
  const [idType, setIdType] = useState<string>("");
  const [dob, setDob] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [photoMatch, setPhotoMatch] = useState(false);

  const todayYmd = pacificDayKey(new Date());

  const submitScan = () => {
    setError(null);
    const parsed = parseAamvaPdf417(scanBuffer);
    if (!parsed.ok) {
      setError(`${parsed.error} If the barcode won't read, use manual verification.`);
      setScanBuffer("");
      return;
    }
    const v = evaluateScannedId(parsed.license, todayYmd);
    if (!v.allowed) {
      setError(v.reason);
      setScanBuffer("");
      return;
    }
    onPassed(v, null);
  };

  const submitManual = () => {
    setError(null);
    const v = evaluateManualId(
      { idType, dateOfBirth: dob.trim(), expirationDate: expiry.trim(), reason, photoMatchConfirmed: photoMatch },
      todayYmd,
    );
    if (!v.allowed) {
      setError(v.reason);
      return;
    }
    // Audit event FIRST (WAC 314-55-150 trail); the sale references its UUID.
    const uuid = onEnqueueManual({
      idType,
      dateOfBirth: dob.trim(),
      expirationDate: expiry.trim(),
      reason: reason.trim(),
    });
    onPassed(v, uuid);
  };

  return (
    <Frame title="Check ID — required before anything enters the cart" onCancel={onCancel}>
      {error ? (
        <p className="mb-4 w-full max-w-lg rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-300">{error}</p>
      ) : null}

      {mode === "scan" ? (
        <div className="w-full max-w-lg">
          <label htmlFor="pos-scan" className="text-sm text-neutral-400">
            Scan the barcode on the back of the license/ID. The scanner types into the box below —
            keep it focused. Scanner sends Enter when done.
          </label>
          <textarea
            id="pos-scan"
            ref={scanRef}
            value={scanBuffer}
            onChange={(e) => setScanBuffer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && scanBuffer.trim().length > 0) {
                e.preventDefault();
                submitScan();
              }
            }}
            autoFocus
            rows={4}
            className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 font-mono text-xs text-neutral-200"
            placeholder="@ … ANSI 636045 …"
          />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={submitScan}
              disabled={scanBuffer.trim().length === 0}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white disabled:opacity-40"
            >
              Check scan
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("manual");
                setError(null);
              }}
              className="rounded-xl bg-neutral-800 px-6 py-3 font-semibold"
            >
              Manual verification instead
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-4">
          <p className="text-sm text-amber-300">
            Manual verifications are audited. Only use when the barcode will not scan or the document
            has no barcode (passport, tribal, armed forces…).
          </p>
          <div>
            <label htmlFor="pos-idtype" className="text-sm text-neutral-400">Document type (WAC 314-55-150)</label>
            <select
              id="pos-idtype"
              value={idType}
              onChange={(e) => setIdType(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
            >
              <option value="">— select —</option>
              {ACCEPTABLE_ID_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pos-dob" className="text-sm text-neutral-400">Date of birth (YYYY-MM-DD)</label>
              <input
                id="pos-dob"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                inputMode="numeric"
                placeholder="1990-07-13"
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="pos-exp" className="text-sm text-neutral-400">Expiration date (YYYY-MM-DD)</label>
              <input
                id="pos-exp"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                inputMode="numeric"
                placeholder="2028-01-31"
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="pos-reason" className="text-sm text-neutral-400">Why manual? (audited, 3–500 chars)</label>
            <input
              id="pos-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Barcode scratched — visual check of WA DL"
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
            />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={photoMatch}
              onChange={(e) => setPhotoMatch(e.target.checked)}
              className="h-5 w-5"
            />
            The photo matches the customer in front of me.
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={submitManual}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white"
            >
              Verify manually
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("scan");
                setError(null);
              }}
              className="rounded-xl bg-neutral-800 px-6 py-3 font-semibold"
            >
              Back to scanning
            </button>
          </div>
        </div>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — cart with live limit meter
// ---------------------------------------------------------------------------

function CartScreen({
  bundle,
  cart,
  setCart,
  customerType,
  setCustomerType,
  verdict,
  onCancel,
  onTender,
}: {
  bundle: PosMenuBundle;
  cart: PosCartEntry[];
  setCart: (c: PosCartEntry[]) => void;
  customerType: "recreational" | "medical";
  setCustomerType: (t: "recreational" | "medical") => void;
  verdict: Extract<IdGateVerdict, { allowed: true }>;
  onCancel: () => void;
  onTender: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(
    () => searchProducts(bundle.products, query).slice(0, 30),
    [bundle.products, query],
  );
  const priced = useMemo(() => priceCart(cart, bundle.rules), [cart, bundle.rules]);
  const limits = useMemo(
    () => judgeLimits(limitLinesFor(priced.lines), customerType, bundle.limits),
    [priced.lines, customerType, bundle.limits],
  );

  const canTender = cart.length > 0 && priced.problems.length === 0 && !limits.blocked;

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 p-4 text-neutral-100 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Sale — ID verified ({verdict.method}, age {verdict.age})</h1>
          <p className="text-xs text-neutral-500">
            Menu as of {new Date(bundle.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleChip
            active={customerType === "recreational"}
            onClick={() => setCustomerType("recreational")}
            label="Recreational"
          />
          <ToggleChip
            active={customerType === "medical"}
            onClick={() => setCustomerType("medical")}
            label="Medical (DOH card)"
          />
          <button type="button" onClick={onCancel} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">
            Cancel sale
          </button>
        </div>
      </header>

      <div className="mt-4 grid flex-1 gap-4 lg:grid-cols-2">
        {/* Product search */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, brand, category, size…"
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
          />
          <ul className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto">
            {results.map((p) => (
              <li key={p.variantId}>
                <button
                  type="button"
                  onClick={() => setCart(addToCart(cart, p))}
                  className="flex w-full items-center justify-between rounded-xl bg-neutral-800 px-4 py-3 text-left active:bg-neutral-700"
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {p.name}
                      {p.variantLabel ? <span className="text-neutral-400"> · {p.variantLabel}</span> : null}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {p.brand ? `${p.brand} · ` : ""}
                      {p.category}
                      {p.inventoryStatus === "low-stock" ? " · LOW STOCK" : ""}
                    </span>
                  </span>
                  <span className="text-sm font-bold">{money(p.regularPriceMinor)}</span>
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-neutral-500">No products match.</li>
            ) : null}
          </ul>
        </section>

        {/* Cart + limits + totals */}
        <section className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Cart</h2>
          <ul className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {priced.lines.map((l) => (
              <li key={`${l.productId}-${l.variantLabel ?? ""}`} className="rounded-xl bg-neutral-800 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{l.productName}</span>
                  <span className="text-sm font-bold">{money(l.unitPriceMinor * l.quantity)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
                  <span>
                    {money(l.unitPriceMinor)} each
                    {l.appliedLabel ? <span className="text-emerald-300"> · {l.appliedLabel}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <QtyButton label="−" onClick={() => setCart(setCartQuantity(cart, cartVariantId(cart, l.productId, l.variantLabel), l.quantity - 1))} />
                    <span className="w-6 text-center text-sm font-semibold text-neutral-200">{l.quantity}</span>
                    <QtyButton label="+" onClick={() => setCart(setCartQuantity(cart, cartVariantId(cart, l.productId, l.variantLabel), l.quantity + 1))} />
                  </span>
                </div>
              </li>
            ))}
            {cart.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-neutral-500">Tap products to add them.</li>
            ) : null}
          </ul>

          {priced.problems.length > 0 ? (
            <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{priced.problems.join(" ")}</p>
          ) : null}

          {/* WAC 314-55-095 limit meter */}
          <div className="mt-3 space-y-1">
            {limits.evaluation.buckets
              .filter((b) => b.usedGrams > 0)
              .map((b) => (
                <div key={b.bucket} className="text-xs">
                  <div className="flex justify-between text-neutral-400">
                    <span>{b.label}</span>
                    <span className={b.exceeded ? "font-bold text-red-400" : ""}>
                      {b.usedGrams}g / {b.maxGrams}g
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded bg-neutral-800">
                    <div
                      className={`h-1.5 rounded ${b.exceeded ? "bg-red-500" : b.ratio > 0.8 ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, Math.round(b.ratio * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
          {limits.blocked ? (
            <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-xs font-semibold text-red-300">
              Over the WAC 314-55-095 single-transaction limit — remove items. {limits.evaluation.reasons.join(" ")}
            </p>
          ) : limits.softWarning ? (
            <p className="mt-2 rounded-lg bg-amber-950/60 px-3 py-2 text-xs font-semibold text-amber-300">
              Over the configured limit (soft warning). {limits.evaluation.reasons.join(" ")}
            </p>
          ) : null}

          <div className="mt-4 border-t border-neutral-800 pt-3 text-sm">
            <Row label="Subtotal (pre-tax)" value={money(priced.totals.subtotalMinorUnits)} />
            <Row label="Tax (excise + sales)" value={money(priced.totals.estimatedTaxMinorUnits)} />
            {priced.totals.savingsMinorUnits > 0 ? (
              <Row label="You saved" value={`−${money(priced.totals.savingsMinorUnits)}`} accent />
            ) : null}
            <div className="mt-1 flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{money(priced.totals.totalMinorUnits)}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={!canTender}
            onClick={onTender}
            className="mt-4 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white disabled:opacity-40"
          >
            Cash tender →
          </button>
        </section>
      </div>
    </main>
  );
}

/** Resolve the cart's variantId for a priced line (product + variant label). */
function cartVariantId(cart: PosCartEntry[], productId: string, variantLabel: string | null): string {
  const entry = cart.find(
    (e) => e.product.productId === productId && (e.product.variantLabel ?? null) === variantLabel,
  );
  return entry?.product.variantId ?? "";
}

// ---------------------------------------------------------------------------
// Step 3 — cash tender
// ---------------------------------------------------------------------------

const QUICK_BILLS = [500, 1000, 2000, 5000, 10000] as const;

function TenderScreen({
  bundle,
  cart,
  onBack,
  onCancel,
  onPaid,
}: {
  bundle: PosMenuBundle;
  cart: PosCartEntry[];
  onBack: () => void;
  onCancel: () => void;
  /** Returns an error string, or null when the sale was enqueued. */
  onPaid: (tenderedMinor: number) => string | null;
}) {
  const priced = useMemo(() => priceCart(cart, bundle.rules), [cart, bundle.rules]);
  const total = priced.totals.totalMinorUnits;
  const [tendered, setTendered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const exactUp = Math.ceil(total / 100) * 100; // next whole dollar
  const change = tendered - total;

  const pay = () => {
    const err = onPaid(tendered);
    if (err) setError(err);
  };

  return (
    <Frame title="Cash tender" onCancel={onCancel}>
      <p className="text-4xl font-bold">{money(total)}</p>
      <p className="mt-1 text-sm text-neutral-400">Total due — cash only at this store.</p>

      {error ? (
        <p className="mt-4 w-full max-w-md rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-300">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <TenderChip label={`Exact ${money(total)}`} onClick={() => setTendered(total)} active={tendered === total} />
        {exactUp > total ? (
          <TenderChip label={money(exactUp)} onClick={() => setTendered(exactUp)} active={tendered === exactUp} />
        ) : null}
        {QUICK_BILLS.filter((b) => b >= total).slice(0, 3).map((b) => (
          <TenderChip key={b} label={money(b)} onClick={() => setTendered(b)} active={tendered === b} />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="pos-tender" className="text-sm text-neutral-400">Custom $</label>
        <input
          id="pos-tender"
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => {
            const v = Math.round(parseFloat(e.target.value || "0") * 100);
            setTendered(Number.isFinite(v) && v > 0 ? v : 0);
          }}
          className="w-32 rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-right text-lg font-semibold"
        />
      </div>

      <p className={`mt-6 text-2xl font-bold ${change >= 0 ? "text-emerald-300" : "text-neutral-600"}`}>
        {change >= 0 ? `${money(change)} change` : `${money(-change)} more needed`}
      </p>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={pay}
          disabled={tendered < total}
          className="rounded-2xl bg-emerald-600 px-10 py-4 text-lg font-bold text-white disabled:opacity-40"
        >
          Complete sale
        </button>
        <button type="button" onClick={onBack} className="rounded-2xl bg-neutral-800 px-6 py-4 text-lg font-semibold">
          Back to cart
        </button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Frame({
  title,
  children,
  onCancel,
  cancelLabel = "Cancel sale",
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="mb-6 flex w-full max-w-lg items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <button type="button" onClick={onCancel} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">
          {cancelLabel}
        </button>
      </div>
      <div className="flex w-full max-w-lg flex-col items-center">{children}</div>
    </main>
  );
}

function ToggleChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300"}`}
    >
      {label}
    </button>
  );
}

function TenderChip({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-3 text-sm font-bold ${active ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-200"}`}
    >
      {label}
    </button>
  );
}

function QtyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 w-8 rounded-lg bg-neutral-700 text-lg font-bold text-neutral-100 active:bg-neutral-600"
    >
      {label}
    </button>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${accent ? "text-emerald-300" : "text-neutral-400"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}
