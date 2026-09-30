"use client";

/**
 * ResetUpgradeBox - the one-time fix for the factory reset timing out (D-82).
 *
 * The owner does not use Supabase and should not have to find a file on
 * GitHub. This box puts the exact text of migration 0240 on his clipboard with
 * one click and opens the Supabase SQL editor in a new tab. The page shows it
 * only while the database still has the old reset (the preview does not
 * report reset_engine "truncate-0240"), and it disappears once the file has
 * been applied.
 *
 * If the clipboard is blocked the button says so and the text is still shown
 * in a box he can select by hand. A copy button that failed silently would
 * leave him pasting nothing, or something else, into the SQL editor.
 */
import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function ResetUpgradeBox({ sql }: { sql: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const [showText, setShowText] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setState("copied");
    } catch {
      setState("failed");
      setShowText(true);
    }
  }

  return (
    <section className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-5">
      <h2 className="text-sm font-semibold text-amber-100">One-time upgrade needed before the reset can run</h2>
      <p className="mt-1 text-sm text-amber-100/80">
        Your database still has the old, slow version of the reset. With your CCRS and Cultivera uploads in it, the
        old version runs out of time and shows &quot;statement timeout&quot;. The new version empties everything in
        well under a second, no matter how much data there is. Installing it takes about a minute and deletes
        nothing.
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-white/80">
        <li>
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-amber-400/60 bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-50 hover:bg-amber-500/30"
          >
            {state === "copied" ? "Copied - now do step 2" : state === "failed" ? "Copy blocked - select the text below" : "Copy the upgrade"}
          </button>
        </li>
        <li>
          <a
            href="https://supabase.com/dashboard/project/_/sql/new"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-amber-200 underline"
          >
            Open the Supabase SQL editor
          </a>{" "}
          (opens a new tab - sign in if asked, and pick the Greenway project if it asks which one).
        </li>
        <li>Click inside the big empty box, paste (Ctrl+V, or Cmd+V on a Mac), then click the green Run button.</li>
        <li>
          Supabase will pop up a warning that says <em>Potential issue detected</em> and{" "}
          <em>This query includes destructive operations</em>. That is expected: the upgrade contains the word
          &quot;truncate&quot; because that is how the new reset empties tables. Running the upgrade itself deletes
          nothing. Click <strong>Run query</strong>.
        </li>
        <li>
          It should say <strong>Success. No rows returned</strong>. Come back to this tab and refresh the page. This
          yellow box will be gone, and the button below will work.
        </li>
      </ol>
      <p className="mt-3 text-xs text-white/50">
        If it shows a red ERROR instead, nothing was changed. Copy the red message and send it to your developer.
      </p>
      <button
        type="button"
        onClick={() => setShowText((v) => !v)}
        className="mt-3 text-xs text-white/50 underline"
      >
        {showText ? "Hide the upgrade text" : "Show the upgrade text"}
      </button>
      {showText ? (
        <textarea
          readOnly
          value={sql}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-2 h-48 w-full rounded-lg border border-white/15 bg-black/50 p-2 font-mono text-[0.7rem] text-white/80"
        />
      ) : null}
    </section>
  );
}
