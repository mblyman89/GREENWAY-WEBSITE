"use client";

/**
 * SLICE L-14 — the blocking cancellation modal.
 *
 * This is point 3 and point 4 of the enterprise standard made physical:
 * "interrupt with a blocking acknowledgement" and "require an explicit human
 * disposition".
 *
 * ── WHAT MAKES THIS DIFFERENT FROM EVERY OTHER MESSAGE IN THE REGISTER ──────
 *
 * Almost every other notification in this app is a banner that can be ignored
 * and will eventually go away. This one cannot be, for a specific reason: by
 * the time it appears, a cashier may be seconds away from handing regulated
 * product to a customer for an order that no longer exists. A toast that fades
 * is a warning that arrives after the handover it was meant to prevent.
 *
 * So, deliberately:
 *
 *   - There is NO close button, NO backdrop-click dismissal, and NO escape
 *     key. The only ways out are the two dispositions.
 *   - It renders above everything (z-index above the sale flow) and covers the
 *     screen, because a cashier looking at a line-item list must not be able to
 *     keep working underneath it.
 *   - It does NOT touch the sale. Point 2 of the standard: never mutate an open
 *     till from a background event. This component reads and reports; the
 *     cashier's own choice is what changes anything.
 *
 * ── WHY THE BUTTONS ARE NOT SYMMETRICAL ─────────────────────────────────────
 *
 * "Void" and "Keep as walk-in" are both legitimate, and the system genuinely
 * does not know which applies — only the person who can see whether the
 * customer is standing there knows that. But they are not equally SAFE to press
 * by accident: voiding destroys a sale in progress. So the destructive one is
 * styled as destructive and neither is a default/autofocused button. A modal
 * that appears under someone's thumb mid-tap must not have a pre-selected
 * answer.
 */
import { useState } from "react";

/** Mirrors `CancelDisposition` in register-claim-core.ts. */
export type CancelDisposition = "void" | "walk_in";

export type RegisterInterruptView = {
  rowId: string;
  orderId: string;
  title: string;
  message: string;
  reasonCode: string | null;
  dispositionRequired: boolean;
  dispositions: CancelDisposition[];
  raisedAt: string;
};

/**
 * The label and the consequence of each choice.
 *
 * Duplicated in wording from `describeDisposition` in the core rather than
 * imported, because this file is a client component and the core is imported by
 * server code; what matters for correctness is the VALUE ("void" / "walk_in"),
 * which comes from the shared type. The wording is checked by the wiring gate.
 */
const CHOICES: Record<
  CancelDisposition,
  { label: string; detail: string; destructive: boolean }
> = {
  void: {
    label: "Void this sale",
    detail: "The customer is not taking it. Clear the sale and restock anything already bagged.",
    destructive: true,
  },
  walk_in: {
    label: "Keep it as a walk-in sale",
    detail:
      "The customer is here and still wants the products. Ring it up as a normal sale — it is no longer a Leafly order.",
    destructive: false,
  },
};

export function RegisterInterruptModal({
  interrupt,
  employeeName,
  onResolved,
  onSubmit,
}: {
  interrupt: RegisterInterruptView;
  /** Who is at the till. Recorded with the decision (point 5). */
  employeeName: string;
  /** Called after a disposition is successfully recorded. */
  onResolved: (disposition: CancelDisposition) => void;
  /** Posts the decision. Returns an error string, or null on success. */
  onSubmit: (rowId: string, disposition: CancelDisposition) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<CancelDisposition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (d: CancelDisposition) => {
    // Guard the double-tap. A cashier under pressure will press twice, and two
    // recorded dispositions for one collision is exactly the ambiguity this
    // whole feature exists to prevent.
    if (busy !== null) return;
    setBusy(d);
    setError(null);
    const err = await onSubmit(interrupt.rowId, d);
    if (err !== null) {
      // Stay open. A decision that was not recorded has not been made —
      // closing here would leave the cashier believing it had been.
      setBusy(null);
      setError(err);
      return;
    }
    onResolved(d);
  };

  const offered = interrupt.dispositions.length > 0 ? interrupt.dispositions : (["void", "walk_in"] as CancelDisposition[]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-interrupt-title"
      aria-describedby="pos-interrupt-message"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        // Deliberately near-opaque. A translucent scrim would let the cashier
        // keep reading the line items underneath and keep working around it.
        background: "rgba(15, 23, 42, 0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      // NOTE: no onClick handler. Clicking the backdrop must NOT dismiss this.
    >
      <div
        style={{
          width: "min(680px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "var(--pos-surface)",
          border: "3px solid var(--pos-danger-border)",
          borderRadius: 14,
          boxShadow: "var(--pos-shadow)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: 26,
              lineHeight: 1,
            }}
          >
            {"\u26A0\uFE0F"}
          </span>
          <h2
            id="pos-interrupt-title"
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: "var(--pos-danger)",
              letterSpacing: "-0.01em",
            }}
          >
            {interrupt.title}
          </h2>
        </div>

        <p
          id="pos-interrupt-message"
          style={{
            margin: "0 0 14px 0",
            fontSize: 16,
            lineHeight: 1.55,
            color: "var(--pos-text)",
          }}
        >
          {interrupt.message}
        </p>

        {/* The reason code, shown verbatim. Staff repeat this to customers and
            managers quote it back to Leafly, so it must be the real string and
            not a paraphrase. */}
        {interrupt.reasonCode ? (
          <p
            style={{
              margin: "0 0 14px 0",
              fontSize: 12,
              color: "var(--pos-text-muted)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            Leafly reason code: {interrupt.reasonCode}
          </p>
        ) : null}

        <div
          style={{
            borderTop: "1px solid var(--pos-border)",
            paddingTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--pos-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Choose one — this cannot be skipped
          </p>

          {offered.map((d) => {
            const c = CHOICES[d];
            const isBusy = busy === d;
            return (
              <button
                key={d}
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(d)}
                style={{
                  textAlign: "left",
                  padding: "13px 15px",
                  borderRadius: 10,
                  cursor: busy !== null ? "not-allowed" : "pointer",
                  opacity: busy !== null && !isBusy ? 0.5 : 1,
                  border: c.destructive
                    ? "2px solid var(--pos-danger-border)"
                    : "2px solid var(--pos-border-strong)",
                  background: c.destructive ? "var(--pos-danger-soft)" : "var(--pos-surface-2)",
                  color: "var(--pos-text)",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: 17,
                    fontWeight: 800,
                    marginBottom: 3,
                    color: c.destructive ? "var(--pos-danger)" : "var(--pos-text)",
                  }}
                >
                  {isBusy ? "Recording…" : c.label}
                </span>
                <span style={{ display: "block", fontSize: 13, color: "var(--pos-text-muted)" }}>
                  {c.detail}
                </span>
              </button>
            );
          })}

          {error ? (
            <p
              role="alert"
              style={{
                margin: "4px 0 0 0",
                padding: "9px 11px",
                borderRadius: 8,
                background: "var(--pos-danger-soft)",
                border: "1px solid var(--pos-danger-border)",
                color: "var(--pos-danger)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {error} — the decision was NOT recorded. Try again, or tell a manager.
            </p>
          ) : null}

          <p
            style={{
              margin: "6px 0 0 0",
              fontSize: 12,
              color: "var(--pos-text-faint)",
            }}
          >
            Recorded as {employeeName.trim() || "this register"}.
          </p>
        </div>
      </div>
    </div>
  );
}
