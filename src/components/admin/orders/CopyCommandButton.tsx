"use client";

/**
 * CopyCommandButton — one copyable terminal command.
 *
 * WHY THIS IS ITS OWN COMPONENT
 * -----------------------------
 * The setup guide asks somebody to type commands into a Raspberry Pi terminal
 * while standing in a shop. Retyping a command by hand is where the mistakes
 * happen: a missing dash, a capital letter, a smart quote pasted from a
 * document. Those fail minutes later with errors that read like broken
 * hardware, which is exactly the confusion this whole guide exists to end.
 *
 * So every command gets a button that puts the exact bytes on the clipboard.
 *
 * The command is ALSO always visible as text. If the clipboard is blocked —
 * an insecure origin, a locked-down browser, a permissions prompt nobody
 * granted — the button quietly says so and the reader can still select the
 * text by hand. A copy button that fails silently and leaves an empty
 * clipboard would be worse than having no button at all.
 */
import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function CopyCommandButton({
  command,
  /**
   * What the copied text IS, for the screen-reader label only.
   *
   * SLICE M-2. This button is now also used for the six webhook addresses the
   * owner has to email Leafly, and "Copy command: https://…" read aloud is
   * simply wrong — it is an address, not a command. Defaulted so that every
   * existing call site renders and announces exactly as it did before.
   */
  describeAs = "command",
  /** Visible button text, when "Copy" is too vague (e.g. "Copy all six"). */
  idleLabel = "Copy",
}: {
  command: string;
  describeAs?: string;
  idleLabel?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      // Do not pretend. If it did not copy, say it did not copy, because the
      // reader is about to paste into a terminal and run whatever is there.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  const label =
    state === "copied" ? "✓ Copied" : state === "failed" ? "Select it above" : idleLabel;

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${describeAs}: ${command}`}
      className="admin-focus shrink-0 self-start rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-2,var(--admin-surface-1))] px-2.5 py-1 text-[0.7rem] font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
    >
      {label}
    </button>
  );
}
