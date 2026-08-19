"use client";

/**
 * src/app/admin/inventory/audits/AuditCountSheet.tsx   (slice books-12)
 *
 * THE BLIND COUNT SCREEN.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY MISSING FROM THIS FILE
 * ---------------------------------------------------------------------------
 * There is no expected quantity anywhere in this component, and there is no way
 * to add one, because `CountSheetLine` HAS NO `systemQty` FIELD. The blind
 * count is enforced by the TYPE, not by remembering not to render something.
 *
 * That distinction matters. A rule enforced by discipline survives until the
 * first person in a hurry; a rule enforced by the type system survives until
 * somebody deliberately dismantles it, and has to explain why in a diff.
 *
 * If you show a counter the number they are supposed to find, you have not run
 * a count -- you have run a confirmation. People agree with the number on the
 * page: they count eleven, see twelve, assume they miscounted, and write
 * twelve. The single piece of information the count exists to produce is
 * destroyed by displaying it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCANNER MATTERS MORE THAN IT LOOKS
 * ---------------------------------------------------------------------------
 * Typing a lot code is the step where the lot-consolidation failure happens.
 * Two packages of one product from different batches are identical from the
 * outside; a human reading labels will eventually put the whole pile against
 * one batch. A scanner reads the batch off the label every time and does not
 * get bored on the ninetieth jar.
 *
 * The matching logic here is NOT new code. It is `matchLineByCode` from
 * `cycle-count-scan-core`, already in production and already covered by its own
 * self-tests. An ambiguous scan REFUSES and asks -- it never guesses which of
 * two candidate lots was meant, because a confident wrong answer on a
 * traceability record is worse than a question.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Field, controlClassName } from "@/components/admin/ui";
import {
  matchLineByCode,
  normalizeScan,
  type ScanLine,
} from "@/lib/inventory/cycle-count-scan-core";
import { saveCountAction } from "./actions";

export type SheetLine = {
  lotId: string;
  lotCode: string | null;
  productName: string | null;
  categorySlug: string | null;
  countedQty: number | null;
  recountQty: number | null;
  needsRecount: boolean;
  captureMethod: string | null;
};

type Feedback = { tone: "good" | "warn" | "bad"; text: string } | null;

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";

export function AuditCountSheet({
  sessionId,
  lines,
  readOnly,
}: {
  sessionId: string;
  lines: readonly SheetLine[];
  readOnly: boolean;
}) {
  const [focusLotId, setFocusLotId] = useState<string | null>(null);
  // HOW the number arrived is part of the evidence, not decoration. A count
  // typed by a person and a count read off a barcode are different in
  // reliability, and the lot-consolidation failure only happens on the typed
  // path. Recording every entry as "scan" because the scan box is on screen
  // would put a false quality stamp on the weakest records in the audit.
  const [captureMethod, setCaptureMethod] = useState<"scan" | "manual">("scan");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [scanValue, setScanValue] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  // A lot counts as done when a number exists. `0` is done -- somebody looked
  // and found nothing. Only `null` is outstanding.
  const done = lines.filter((l) => l.countedQty !== null).length;
  const recountsOutstanding = lines.filter((l) => l.needsRecount && l.recountQty === null).length;
  const pct = lines.length === 0 ? 100 : Math.round((done / lines.length) * 100);

  const scanLines: ScanLine[] = useMemo(
    () =>
      lines.map((l) => ({
        lineId: l.lotId,
        lotId: l.lotId,
        lotCode: l.lotCode,
        // The count sheet does not carry the POS key -- matching on lot code is
        // what keeps two batches of one product distinguishable. Matching on a
        // product key would collapse exactly the distinction being protected.
        posProductKey: null,
        productName: l.productName,
      })),
    [lines],
  );

  const focused = focusLotId ? lines.find((l) => l.lotId === focusLotId) ?? null : null;

  // The scan box holds focus so a wedge scanner's keystrokes always land
  // somewhere useful. A counter holding a handheld should never have to click.
  useEffect(() => {
    if (readOnly) return;
    const t = setInterval(() => {
      const el = document.activeElement;
      const typingElsewhere =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (!typingElsewhere) scanRef.current?.focus();
    }, 1200);
    return () => clearInterval(t);
  }, [readOnly]);

  const handleScan = useCallback(
    (raw: string) => {
      const code = normalizeScan(raw);
      setScanValue("");
      if (code === "") return;

      const m = matchLineByCode(scanLines, code);
      if (m.status === "none") {
        setFeedback({
          tone: "bad",
          text:
            `Nothing in this count matches "${code}". Either that package belongs to a lot ` +
            `outside this audit's scope, or the label will not read. Nothing was recorded.`,
        });
        setFocusLotId(null);
        return;
      }
      if (m.status === "ambiguous") {
        setFeedback({
          tone: "bad",
          text:
            `"${code}" matches ${m.candidates.length} different lots in this count, so the ` +
            `system will not guess which one you are holding. Pick it from the list below ` +
            `instead — a confident wrong answer on a traceability record is worse than a question.`,
        });
        setFocusLotId(null);
        return;
      }

      setFocusLotId(m.line.lotId);
      setCaptureMethod("scan");
      setFeedback({
        tone: m.status === "exact" ? "good" : "warn",
        text:
          m.status === "exact"
            ? `${m.line.productName ?? "Lot"} — ${m.line.lotCode ?? "no lot code"}. Enter what you counted.`
            : `Close match on ${m.line.lotCode ?? "this lot"}. Check the label agrees before entering a number.`,
      });
      window.setTimeout(() => qtyRef.current?.focus(), 30);
    },
    [scanLines],
  );

  function submitCount(form: FormData) {
    startTransition(async () => {
      await saveCountAction(form);
      setFocusLotId(null);
      setFeedback({ tone: "good", text: "Recorded. Scan the next package." });
      window.setTimeout(() => scanRef.current?.focus(), 30);
    });
  }

  return (
    <div className="space-y-5">
      {/* ── PROGRESS ───────────────────────────────────────────────────── */}
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-white">
            {done} of {lines.length} lots counted
          </h2>
          <span className="text-xs text-[var(--admin-text-muted)]">
            {lines.length - done} still blank
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[var(--admin-accent)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {recountsOutstanding > 0 ? (
          <p className="mt-3 rounded-lg border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] px-3 py-2 text-xs text-white/85">
            {/* The trailing space is inside the expression on purpose. JSX drops
                the newline between an expression and the text after it, which
                fused this into "...second count.You are told..." on screen. */}
            {recountsOutstanding === 1
              ? "1 lot needs a second count. "
              : `${recountsOutstanding} lots need a second count. `}
            You are told THAT they disagreed, never by how much &mdash; a second count that knows
            the target is not a second count. Ideally a different person does it.
          </p>
        ) : null}
      </section>

      {/* ── SCAN ───────────────────────────────────────────────────────── */}
      {!readOnly ? (
        <section className={CARD}>
          <h2 className="text-sm font-bold text-white">Scan a package</h2>
          <p className={`mt-1 ${P}`}>
            A Bluetooth or USB scanner types into this box and presses Enter for you &mdash;
            nothing to install, nothing to import afterwards. You can also type a lot code and
            press Enter.
          </p>
          <input
            ref={scanRef}
            value={scanValue}
            autoFocus
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScan(scanValue);
              }
            }}
            placeholder="Scan or type a lot code, then press Enter"
            className={`${controlClassName} mt-3 border-[var(--admin-accent)]/40 px-4 py-3 font-mono text-base`}
          />

          {feedback ? (
            <p
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                feedback.tone === "good"
                  ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.07] text-white/90"
                  : feedback.tone === "warn"
                    ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/[0.07] text-white/90"
                    : "border-[var(--admin-danger)]/45 bg-[var(--admin-danger)]/[0.08] text-white/90"
              }`}
            >
              {feedback.text}
            </p>
          ) : null}

          {/* The entry box appears only once a specific lot is identified, so a
              number can never be typed against "whatever was selected last". */}
          {focused ? (
            <form action={submitCount} className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="lotId" value={focused.lotId} />
              <input type="hidden" name="captureMethod" value={captureMethod} />
              <p className="text-sm font-semibold text-white">
                {focused.productName ?? "Unnamed product"}
              </p>
              <p className="font-mono text-xs text-[var(--admin-text-muted)]">
                {focused.lotCode ?? "NO LOT CODE"}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="How many did you count" htmlFor="count-qty" required>
                  <input
                    ref={qtyRef}
                    id="count-qty"
                    name="qty"
                    type="number"
                    step="any"
                    min="0"
                    required
                    className={`${controlClassName} w-40 text-base`}
                  />
                </Field>
                <Button type="submit" variant="confirm" size="md" disabled={pending}>
                  {pending ? "Saving..." : "Record this count"}
                </Button>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => {
                    setFocusLotId(null);
                    setFeedback(null);
                    scanRef.current?.focus();
                  }}
                >
                  Cancel
                </Button>
              </div>
              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                {captureMethod === "scan"
                  ? "Recorded as a scanned count."
                  : "Recorded as a hand-typed count \u2014 the label was not read by the scanner."}{" "}
                Found none? Type 0. That is a real count and it is useful. Leaving it blank tells
                the system nobody looked, which is a different thing entirely.
              </p>
            </form>
          ) : null}
        </section>
      ) : null}

      {/* ── THE SHEET ──────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-white">The count sheet</h2>
        <p className={`mt-1 ${P}`}>
          No expected quantities appear here, on purpose. They are not withheld by the screen
          &mdash; they are never sent to it.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="py-2 pr-3 font-semibold">Product</th>
                <th className="py-2 pr-3 font-semibold">Lot</th>
                <th className="py-2 pr-3 font-semibold">You counted</th>
                <th className="py-2 pr-3 font-semibold">Second count</th>
                <th className="py-2 font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const outstanding = l.countedQty === null;
                return (
                  <tr
                    key={l.lotId}
                    className={`border-b border-white/5 ${
                      focusLotId === l.lotId ? "bg-[var(--admin-accent)]/[0.07]" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 text-white/90">{l.productName ?? "Unnamed product"}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-white/70">
                      {l.lotCode ?? <span className="text-[var(--admin-orange)]">NO LOT CODE</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-white/90">
                      {l.countedQty === null ? (
                        <span className="text-[var(--admin-text-muted)]">not counted</span>
                      ) : (
                        l.countedQty.toLocaleString()
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-white/90">
                      {l.recountQty === null ? (
                        <span className="text-[var(--admin-text-muted)]">&mdash;</span>
                      ) : (
                        l.recountQty.toLocaleString()
                      )}
                    </td>
                    <td className="py-2">
                      {l.needsRecount && l.recountQty === null ? (
                        <Badge tone="gold">Count again</Badge>
                      ) : outstanding ? (
                        <Badge tone="outline">Outstanding</Badge>
                      ) : (
                        <Badge tone="green">Done</Badge>
                      )}
                      {!readOnly && outstanding ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFocusLotId(l.lotId);
                            setCaptureMethod("manual");
                            setFeedback(null);
                            window.setTimeout(() => qtyRef.current?.focus(), 30);
                          }}
                          className="ml-2 text-xs text-[var(--admin-text-muted)] underline decoration-dotted underline-offset-2 hover:text-white"
                        >
                          enter by hand
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
