"use client";

/**
 * src/components/admin/registers/BagAtmPullFields.tsx  (D198e)
 *
 * The "Take $20s out for the ATM" part of the night bag forms. The person building the bag ticks the
 * box, types the NUMBER of $20 bills (never dollars), and the screen shows what stays in the bag. A
 * second employee's PIN is the witness (required / recommended by the owner's ATM setting). The
 * reason box is always there; the SERVER decides when it is required (no fresh ATM reading, more
 * than the ATM needs, ATM already full) and re-checks every figure - nothing typed here is trusted.
 */
import { useState } from "react";

import { Input } from "@/components/admin/ui";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function BagAtmPullFields({
  depositMinor,
  maxTwenties,
  witnessPolicy,
  terminalId,
  suggestedTwenties,
}: {
  /** What goes in the bag BEFORE the pull (the expected deposit / the ticked stacks). */
  depositMinor: number | null;
  maxTwenties: number;
  witnessPolicy: "required" | "recommended" | "off";
  terminalId: string;
  /** From the top-off banner (fresh reading, daily fill amount, $20s already taken since); null = unknown / check first. */
  suggestedTwenties: number | null;
}) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState("");
  const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  const pullMinor = n !== null ? n * 2000 : null;
  const after = depositMinor !== null && pullMinor !== null ? depositMinor - pullMinor : null;
  const tooMuch = after !== null && after <= 0;
  return (
    <fieldset className="space-y-2 rounded-lg border border-[var(--admin-gold)]/40 p-3" data-testid="bag-atm-pull">
      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-text)]">
        <input type="checkbox" name="atm_pull" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Take $20s out of this deposit for the ATM ({terminalId})
      </label>
      {!on ? (
        <p className="text-xs text-[var(--admin-text-faint)]">
          Only when the ATM needs cash. Check the ATM banner and the &ldquo;Cash in the ATM&rdquo; card above first
          {suggestedTwenties === null ? "." : suggestedTwenties === 0 ? " — they say the ATM is full for the day." : ` — they say the ATM needs ${suggestedTwenties} x $20 to reach the daily fill amount.`}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Number of $20 bills
              <Input
                name="atm_twenties"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={suggestedTwenties !== null ? String(suggestedTwenties) : "e.g. 40"}
                autoComplete="off"
                maxLength={4}
              />
            </label>
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Witness PIN ({witnessPolicy === "required" ? "required" : witnessPolicy === "recommended" ? "a second employee, strongly recommended" : "optional"})
              <Input
                name="atm_witness_pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={6}
                autoComplete="off"
                required={witnessPolicy === "required"}
                placeholder="Witness PIN"
              />
            </label>
            <label className="block grow text-xs text-[var(--admin-text-muted)]">
              Reason for the ATM pull (asked for when the ATM reading is old, or this is more than the ATM needs)
              <Input name="atm_pull_reason" maxLength={500} placeholder="e.g. ATM low before the weekend" />
            </label>
          </div>
          <p className={`text-sm font-semibold ${tooMuch ? "text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`} aria-live="polite">
            {pullMinor === null
              ? "Type the number of $20 bills."
              : n !== null && n > maxTwenties
                ? `More than the owner's limit of ${maxTwenties} bills for one ATM load.`
                : depositMinor === null
                  ? `${n} x $20 = ${money(pullMinor)} to the ATM.`
                  : tooMuch
                    ? `${n} x $20 = ${money(pullMinor)} is the whole deposit or more. The bag must still hold money for the bank.`
                    : `${n} x $20 = ${money(pullMinor)} to the ATM. Bag total after the ATM pull: ${money(after as number)}.`}
          </p>
          <p className="text-xs text-[var(--admin-text-faint)]">
            Count the $20s out in front of the witness, load them into the ATM, and keep the rest in the bag. The morning recount
            must find the bag total after the pull, and the owner&apos;s ATM page must find a PAI cash load of exactly these $20s.
            Once saved, the pull cannot be changed.
          </p>
        </>
      )}
    </fieldset>
  );
}
