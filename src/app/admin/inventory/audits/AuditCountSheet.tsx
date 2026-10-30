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
 *
 * ---------------------------------------------------------------------------
 * FIX PHASE 4.1 (migration 0326): ONE COUNTER, EACH SCAN ADDS ONE
 * ---------------------------------------------------------------------------
 *   D56 "Only one employee per scoped count."  -> Start counting claims it.
 *   D60 each scan adds one.                    -> no number to type on a scan.
 *   F-06-5b a re-scan never silently becomes a second count -> the sheet asks.
 *   D55 I'm done                                -> locks the counts, to Michael.
 * The decisions are in audit-count-flow-core.ts (pure, self-tested); the
 * database refuses the same things in the 0326 RPCs.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Field, controlClassName } from "@/components/admin/ui";
import {
  matchLineByCode,
  normalizeScan,
  type ScanLine,
} from "@/lib/inventory/cycle-count-scan-core";
import { saveCountAction, claimCountAction, finishCountAction } from "./actions";
import { expiryStatus } from "@/lib/inventory/expiry-rules-core";
import {
  ALREADY_COUNTED_CHOICES,
  doneState,
  liveProgress,
  planScan,
  type CountAccess,
  type CountMode,
} from "@/lib/inventory/audit-count-flow-core";
import { buildCountChecklistFor } from "@/lib/inventory/inventory-audit-core";

export type SheetLine = {
  lotId: string;
  lotCode: string | null;
  productName: string | null;
  categorySlug: string | null;
  /** R34: expiration date - an expired lot should be pulled, not just counted. */
  expiresOn?: string | null;
  countedQty: number | null;
  recountQty: number | null;
  needsRecount: boolean;
  captureMethod: string | null;
};

type Feedback = { tone: "good" | "warn" | "bad"; text: string } | null;

/** What the typed-entry box is doing for the focused lot. */
type Entry = { target: "count" | "recount"; mode: CountMode; title: string };

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";

export function AuditCountSheet({
  sessionId,
  lines,
  readOnly,
  today,
  access,
}: {
  sessionId: string;
  lines: readonly SheetLine[];
  readOnly: boolean;
  /** R34: Pacific today (YYYY-MM-DD) from the server, for the expiry badge. */
  today?: string;
  /** Fix Phase 4.1 (D56): claim / count / locked, from countAccess on the server. */
  access?: CountAccess;
}) {
  const [focusLotId, setFocusLotId] = useState<string | null>(null);
  // HOW the number arrived is part of the evidence, not decoration. A count
  // typed by a person and a count read off a barcode are different in
  // reliability, and the lot-consolidation failure only happens on the typed
  // path. Recording every entry as "scan" because the scan box is on screen
  // would put a false quality stamp on the weakest records in the audit.
  const [captureMethod, setCaptureMethod] = useState<"scan" | "manual">("scan");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [askLotId, setAskLotId] = useState<string | null>(null);
  // Lots whose second count this person has started on this screen: further
  // scans keep adding to it instead of asking again.
  const [secondStarted, setSecondStarted] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [scanValue, setScanValue] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  // G-34: live progress from the lines themselves.
  const progress = liveProgress(lines);
  const done = progress.counted;
  const recountsOutstanding = lines.filter((l) => l.needsRecount && l.recountQty === null).length;
  const pct = lines.length === 0 ? 100 : Math.round((done / lines.length) * 100);
  const finish = doneState(lines);
  const canCount = !readOnly && (access === undefined || access.mode === "count");

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

  // G-39: the counting checklist, on the sheet itself. Batches per product
  // drives the loud "these look identical" step.
  const checklist = useMemo(() => {
    const byName = new Map<string, number>();
    for (const l of lines) {
      const k = l.productName ?? "this product";
      byName.set(k, (byName.get(k) ?? 0) + 1);
    }
    const multi = [...byName.entries()].filter(([, n]) => n > 1);
    return buildCountChecklistFor({
      name: multi.length === 1 ? multi[0]![0] : "each product on this sheet",
      batches: multi.length > 0 ? Math.max(...multi.map(([, n]) => n)) : 1,
    });
  }, [lines]);

  const focused = focusLotId ? lines.find((l) => l.lotId === focusLotId) ?? null : null;
  const asking = askLotId ? lines.find((l) => l.lotId === askLotId) ?? null : null;

  // The scan box holds focus so a wedge scanner's keystrokes always land
  // somewhere useful. A counter holding a handheld should never have to click.
  useEffect(() => {
    if (!canCount) return;
    const t = setInterval(() => {
      const el = document.activeElement;
      const typingElsewhere =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement;
      if (!typingElsewhere) scanRef.current?.focus();
    }, 1200);
    return () => clearInterval(t);
  }, [canCount]);

  /** Send one entry to the server (D60: a scan is qty 1, mode add). */
  const record = useCallback(
    (lotId: string, qty: number, target: "count" | "recount", mode: CountMode, method: "scan" | "manual", label: string) => {
      const form = new FormData();
      form.set("sessionId", sessionId);
      form.set("lotId", lotId);
      form.set("qty", String(qty));
      form.set("target", target);
      form.set("mode", mode);
      form.set("captureMethod", method);
      startTransition(async () => {
        await saveCountAction(form);
        setFeedback({ tone: "good", text: `${label} Scan the next package.` });
        window.setTimeout(() => scanRef.current?.focus(), 30);
      });
    },
    [sessionId],
  );

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
            `instead \u2014 a confident wrong answer on a traceability record is worse than a question.`,
        });
        setFocusLotId(null);
        return;
      }
      if (m.status !== "exact") {
        // A close match is never counted automatically: confirm by hand.
        setFocusLotId(m.line.lotId);
        setCaptureMethod("manual");
        setEntry({ target: "count", mode: "replace", title: "Close match \u2014 check the label, then type the total" });
        setFeedback({ tone: "warn", text: `Close match on ${m.line.lotCode ?? "this lot"}. Nothing was added.` });
        window.setTimeout(() => qtyRef.current?.focus(), 30);
        return;
      }

      const line = lines.find((l) => l.lotId === m.line.lotId);
      if (!line) return;
      setCaptureMethod("scan");
      setFocusLotId(line.lotId);
      const plan = planScan(line, secondStarted.has(line.lotId));
      const name = `${line.productName ?? "Lot"} \u2014 ${line.lotCode ?? "no lot code"}`;
      if (plan.kind === "add") {
        if (plan.target === "recount") setSecondStarted((s) => new Set(s).add(line.lotId));
        setEntry(null);
        record(line.lotId, 1, plan.target, "add", "scan", `${name}: +1${plan.target === "recount" ? " (second count)" : ""}.`);
        return;
      }
      if (plan.kind === "third") {
        setCaptureMethod("manual");
        setEntry({ target: "recount", mode: "third", title: "The two counts disagree \u2014 count once more and type the total" });
        setFeedback({ tone: "warn", text: `${name}: the first and second counts disagree. Count it a third time and type what you find.` });
        window.setTimeout(() => qtyRef.current?.focus(), 30);
        return;
      }
      setEntry(null);
      setAskLotId(line.lotId);
      setFeedback({ tone: "warn", text: `${name} already has a number. What should this scan do?` });
    },
    [scanLines, lines, secondStarted, record],
  );

  function chooseAlreadyCounted(mode: "add" | "replace" | "restart") {
    if (!asking) return;
    const lotId = asking.lotId;
    const name = `${asking.productName ?? "Lot"} \u2014 ${asking.lotCode ?? "no lot code"}`;
    const target: "count" | "recount" = asking.recountQty !== null || asking.needsRecount ? "recount" : "count";
    setAskLotId(null);
    if (mode === "add") {
      record(lotId, 1, target, "add", "scan", `${name}: +1.`);
    } else if (mode === "restart") {
      // Count again from zero: this scan is the first package of the fresh count.
      record(lotId, 1, "count", "restart", "scan", `${name}: started again from zero, 1 so far.`);
    } else {
      setFocusLotId(lotId);
      setCaptureMethod("manual");
      setEntry({ target, mode: "replace", title: "Type the right total" });
      window.setTimeout(() => qtyRef.current?.focus(), 30);
    }
  }

  function submitTyped(form: FormData) {
    startTransition(async () => {
      await saveCountAction(form);
      setFocusLotId(null);
      setEntry(null);
      setFeedback({ tone: "good", text: "Recorded. Scan the next package." });
      window.setTimeout(() => scanRef.current?.focus(), 30);
    });
  }

  return (
    <div className="space-y-5">
      {/* ── WHO IS COUNTING (D56) ─────────────────────────────────────── */}
      {access ? (
        <section
          className={`${CARD} ${access.mode === "count" ? "border-[var(--admin-accent)]/40" : "border-[var(--admin-gold)]/40"}`}
          data-testid="count-access"
        >
          <p className="text-sm text-white/90">{access.banner}</p>
          {access.mode === "claim" ? (
            <form action={claimCountAction} className="mt-3">
              <input type="hidden" name="sessionId" value={sessionId} />
              <Button type="submit" variant="confirm" size="md">
                Start counting
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}

      {/* ── PROGRESS ─────────────────────────────────────────────────── */}
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-white">
            {done} of {lines.length} lots counted
          </h2>
          <span className="text-xs text-[var(--admin-text-muted)]">
            {progress.blank} still blank
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
            the target is not a second count. Scan each package of that lot again; each scan adds
            one to the second count.
          </p>
        ) : null}
        {canCount ? (
          <form action={finishCountAction} className="mt-4 flex flex-wrap items-center gap-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" variant="confirm" size="md" disabled={!finish.enabled || pending}>
              I&apos;m done
            </Button>
            <span className="text-xs text-[var(--admin-text-muted)]">{finish.why}</span>
          </form>
        ) : null}
      </section>

      {/* ── SCAN ─────────────────────────────────────────────────────── */}
      {canCount ? (
        <section className={CARD}>
          <h2 className="text-sm font-bold text-white">Scan a package</h2>
          <p className={`mt-1 ${P}`}>
            Each scan adds one to that batch. Scan every package, one at a time. A Bluetooth or
            USB scanner types into this box and presses Enter for you. You can also type a lot
            code and press Enter.
          </p>
          <input
            ref={scanRef}
            value={scanValue}
            autoFocus
            disabled={pending}
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

          {/* F-06-5b: a lot that already has a number never silently becomes a
              second count. The counter picks what the scan means. */}
          {asking ? (
            <div className="mt-4 rounded-xl border border-[var(--admin-gold)]/40 bg-black/25 p-4" data-testid="already-counted">
              <p className="text-sm font-semibold text-white">
                {asking.productName ?? "Unnamed product"} already has a number
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {ALREADY_COUNTED_CHOICES.map((c) => (
                  <button
                    key={c.mode}
                    type="button"
                    disabled={pending}
                    onClick={() => chooseAlreadyCounted(c.mode)}
                    className="rounded-lg border border-white/15 px-3 py-2 text-left text-sm text-white hover:border-[var(--admin-accent)]/60"
                  >
                    <span className="block font-semibold">{c.label}</span>
                    <span className="block text-xs text-[var(--admin-text-muted)]">{c.hint}</span>
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setAskLotId(null);
                  setFeedback({ tone: "warn", text: "Cancelled. Nothing was recorded." });
                  scanRef.current?.focus();
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}

          {/* The entry box appears only once a specific lot is identified, so a
              number can never be typed against "whatever was selected last". */}
          {focused && entry ? (
            <form action={submitTyped} className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="lotId" value={focused.lotId} />
              <input type="hidden" name="captureMethod" value={captureMethod} />
              <input type="hidden" name="target" value={entry.target} />
              <input type="hidden" name="mode" value={entry.mode} />
              <p className="text-sm font-semibold text-white">
                {focused.productName ?? "Unnamed product"}
              </p>
              <p className="font-mono text-xs text-[var(--admin-text-muted)]">
                {focused.lotCode ?? "NO LOT CODE"}
              </p>
              <p className="mt-2 text-xs font-semibold text-[var(--admin-gold)]">{entry.title}</p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="How many are there in total" htmlFor="count-qty" required>
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
                  {pending ? "Saving..." : "Record this total"}
                </Button>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => {
                    setFocusLotId(null);
                    setEntry(null);
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

      {/* ── THE SHEET ────────────────────────────────────────────────── */}
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
                const disagree = l.recountQty !== null && l.countedQty !== null && l.recountQty !== l.countedQty;
                const secondOpen = l.needsRecount && l.recountQty === null && !outstanding;
                return (
                  <tr
                    key={l.lotId}
                    className={`border-b border-white/5 ${
                      focusLotId === l.lotId ? "bg-[var(--admin-accent)]/[0.07]" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 text-white/90">
                      {l.productName ?? "Unnamed product"}
                      {today ? <ExpiryChip expiresOn={l.expiresOn ?? null} today={today} /> : null}
                    </td>
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
                      {disagree ? (
                        <Badge tone="danger">Counts disagree</Badge>
                      ) : secondOpen ? (
                        <Badge tone="gold">Count again</Badge>
                      ) : outstanding ? (
                        <Badge tone="outline">Outstanding</Badge>
                      ) : (
                        <Badge tone="green">Done</Badge>
                      )}
                      {canCount ? (
                        <button
                          type="button"
                          onClick={() => {
                            // A label that will not scan: type the total by hand.
                            setFocusLotId(l.lotId);
                            setAskLotId(null);
                            setCaptureMethod("manual");
                            setEntry(
                              outstanding
                                ? { target: "count", mode: "replace", title: "Type how many you counted" }
                                : disagree
                                  ? { target: "recount", mode: "third", title: "Third count \u2014 type the total" }
                                  : secondOpen || l.recountQty !== null
                                    ? { target: "recount", mode: "replace", title: "Second count \u2014 type the total" }
                                    : { target: "count", mode: "replace", title: "Type the right total" },
                            );
                            setFeedback(null);
                            window.setTimeout(() => qtyRef.current?.focus(), 30);
                          }}
                          className="ml-2 text-xs text-[var(--admin-text-muted)] underline decoration-dotted underline-offset-2 hover:text-white"
                        >
                          {outstanding ? "enter by hand" : disagree ? "third count" : "type a total"}
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

      {/* ── HOW TO COUNT (G-39: the checklist on the sheet) ──────────── */}
      <section className={CARD} data-testid="count-checklist">
        <h2 className="text-sm font-bold text-white">How to count</h2>
        <ol className="mt-3 space-y-2">
          {checklist.map((step) => (
            <li key={step.n} className="text-sm text-white/85">
              <span className={`font-semibold ${step.critical ? "text-[var(--admin-gold)]" : "text-white"}`}>
                {step.n}. {step.title}
              </span>
              <span className={`block ${P}`}>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** R34: expired / expiring-soon chip (nothing shown for an ok or unknown date). */
function ExpiryChip({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  const st = expiryStatus(expiresOn, today);
  if (st.tone !== "expired" && st.tone !== "soon") return null;
  return (
    <span className="ml-2" data-testid="audit-line-expiry">
      <Badge tone={st.tone === "expired" ? "danger" : "gold"}>{st.label}</Badge>
    </span>
  );
}
