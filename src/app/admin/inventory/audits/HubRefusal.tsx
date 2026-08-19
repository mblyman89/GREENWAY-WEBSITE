/**
 * src/app/admin/inventory/audits/HubRefusal.tsx   (slice books-12)
 *
 * A refusal, rendered as information rather than as an apology.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE BOOKS' `RefusalNotice`
 * ---------------------------------------------------------------------------
 * `RefusalNotice` takes a `GlRefusal` -- the general-ledger refusal shape. The
 * hub's store returns its own `{ code, message }` from
 * `explainHubRefusal()`. Passing one where the other is expected would either
 * need a cast (a lie that compiles) or a widening of the books' type to
 * accommodate a screen it has nothing to do with. Neither is worth it for a
 * component this small, so the hub keeps its own and says why.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 * It says WHAT could not be loaded. A red box reading "Something went wrong"
 * next to an empty table teaches the reader that empty means broken, and after
 * a few of those they stop trusting the zero that IS real. Naming the missing
 * piece keeps the rest of the page trustworthy.
 */

const P = "text-sm leading-relaxed text-white/70";

export function HubRefusal({
  refusal,
  context,
}: {
  refusal: { code: string; message: string };
  /** What could not be loaded, in plain words: "the list of audits". */
  context: string;
}) {
  return (
    <section className="rounded-2xl border border-[var(--admin-danger)]/35 bg-[var(--admin-danger)]/[0.06] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-white">
          {context.charAt(0).toUpperCase() + context.slice(1)} could not be loaded.
        </h2>
        {/* The code is shown small and last. It is useless to Michael and
            essential to whoever he forwards this to. */}
        <span className="rounded-full bg-black/30 px-2 py-0.5 font-mono text-[0.6rem] text-white/40">
          {refusal.code}
        </span>
      </div>

      <p className={`mt-2 ${P}`}>{refusal.message}</p>

      <p className="mt-2 text-xs leading-relaxed text-white/45">
        Nothing was changed. Anything else on this page that did load is still accurate &mdash; this
        notice is here so an empty space is never mistaken for a real zero.
      </p>
    </section>
  );
}
