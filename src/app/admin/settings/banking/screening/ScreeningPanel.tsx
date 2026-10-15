/**
 * R41 S11: the Sanctions screening panel (pure render; the page reads).
 *
 *   1. Status: when the last screen ran, whether it is stale, the lists'
 *      date and fingerprint check, and a Screen now button.
 *   2. Possible matches: each payee whose name scored at or above the
 *      threshold, with the OFAC list entries (name, list, program, remarks),
 *      and the review form (not a match / true match + what you compared).
 *   3. How to review, in OFAC's own words (FAQ 5), and what is NOT screened.
 *   4. Run history.
 *
 * Says plainly, at the top: screening never blocks a payment.
 */
import { Badge } from "@/components/admin/ui";
import { MATCH_THRESHOLD, OFAC_QUOTES, staleness } from "@/lib/payments/ofac-screening-core";
import type { ScreeningItem, ScreeningView } from "@/lib/payments/ofac-screening-store";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";

const pct = (x: number) => `${Math.round(x * 100)}`;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })} Pacific`;
}

function StatusBadge({ item }: { item: ScreeningItem }) {
  const s = item.status.status;
  if (s === "true_match") return <Badge tone="danger">True match (recorded)</Badge>;
  if (s === "needs_review") return <Badge tone="orange">Needs your review</Badge>;
  if (s === "covered") return <Badge tone="green">Reviewed earlier: not a match</Badge>;
  if (s === "reviewed") return <Badge tone="green">Reviewed: {item.status.status === "reviewed" && item.status.review.decision === "true_match" ? "true match" : "not a match"}</Badge>;
  return <Badge tone="neutral">Clear</Badge>;
}

export function ScreeningPanel({
  view,
  now,
  isOwner,
  screenNow,
  review,
}: {
  view: ScreeningView;
  now: Date;
  isOwner: boolean;
  screenNow: () => Promise<void>;
  review: (fd: FormData) => Promise<void>;
}) {
  if (!view.ok) {
    return (
      <p role="alert" className="rounded-[var(--admin-radius)] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
        {view.error}
      </p>
    );
  }
  const stale = staleness(view.lastOk?.ranAt ?? null, now);
  const lastRun = view.runs[0] ?? null;
  const pending = view.items.filter((i) => i.status.status === "needs_review");
  const trueMatches = view.items.filter((i) => i.status.status === "true_match");
  return (
    <div className="space-y-6">
      <p id="never-blocks" className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-200">
        <strong>Screening never blocks a payment.</strong> Payroll and vendor files run as usual whatever this page says. A possible match is something
        for you to look at and record here. OFAC FAQ 5: &ldquo;{OFAC_QUOTES.faq5FalsePositives}&rdquo;
      </p>

      <section id="status" className={card}>
        <h2 className={h2}>Last screen</h2>
        {view.lastOk ? (
          <ul className="space-y-1 text-sm text-white/80">
            <li>
              {when(view.lastOk.ranAt)}: {view.lastOk.payeesCount} payee(s) screened, {view.clearCount} clear, {view.items.length} with a possible match.
            </li>
            <li>OFAC&apos;s lists last changed: {view.lastOk.listLastModified ?? "not stated by OFAC"}.</li>
            <li>
              {view.lastOk.digestVerified
                ? "SDN.CSV matched OFAC's published fingerprint."
                : "OFAC's fingerprint for SDN.CSV was not available; the files were checked by structure (exact field counts, ASCII, the end-of-file mark)."}
            </li>
            {view.lastOk.unscreenable > 0 ? <li className="text-amber-200">{view.lastOk.unscreenable} payee(s) have no name to screen. Add their names.</li> : null}
          </ul>
        ) : (
          <p className="text-sm text-white/70">No screen has finished yet.</p>
        )}
        {stale.stale ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-amber-200">
            {stale.text}
          </p>
        ) : (
          <p className="mt-2 text-sm text-white/60">{stale.text}</p>
        )}
        {lastRun && lastRun.status === "failed" ? (
          <p role="alert" className="mt-2 text-sm text-red-300">
            The latest attempt ({when(lastRun.ranAt)}) failed: {lastRun.error}
          </p>
        ) : null}
        <form action={screenNow} className="mt-3">
          <button type="submit" className={btnPrimary}>
            Screen now
          </button>
          <span className="ml-3 text-xs text-white/50">Downloads OFAC&apos;s lists and screens every payee (about a minute). It also runs by itself every morning.</span>
        </form>
      </section>

      <section id="matches" className={card}>
        <h2 className={h2}>
          Possible matches {pending.length > 0 ? <Badge tone="orange">{pending.length} to review</Badge> : null}{" "}
          {trueMatches.length > 0 ? <Badge tone="danger">{trueMatches.length} true match</Badge> : null}
        </h2>
        {view.items.length === 0 ? (
          <p className="text-sm text-white/70">{view.lastOk ? "No payee name scored a possible match in the last screen." : "Nothing yet."}</p>
        ) : (
          <ul className="space-y-4">
            {view.items.map((item) => (
              <li key={item.result.id} id={`result-${item.result.id}`} className="rounded-[var(--admin-radius)] border border-white/10 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{item.result.label}</span>
                  <span className="text-xs text-white/50">{item.result.payeeType === "employee" ? "Employee" : "Vendor"}</span>
                  <StatusBadge item={item} />
                </div>
                <p className="mb-2 text-xs text-white/50">Names screened: {item.result.namesScreened.join(" \u00b7 ")}</p>
                <table className="w-full text-left text-xs text-white/80">
                  <thead className="text-white/50">
                    <tr>
                      <th className="py-1 pr-2">Score</th>
                      <th className="py-1 pr-2">OFAC list name</th>
                      <th className="py-1 pr-2">List / type / program</th>
                      <th className="py-1">Remarks (dates of birth, places, IDs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.result.matches.map((m) => (
                      <tr key={`${m.key}|${m.screenedName}`} className="border-t border-white/5 align-top">
                        <td className="py-1 pr-2">{pct(m.score)}</td>
                        <td className="py-1 pr-2">
                          {m.listName}
                          {m.kind !== "primary" ? <span className="text-white/40"> ({m.kind})</span> : null}
                          <div className="text-white/40">matched &ldquo;{m.screenedName}&rdquo;</div>
                        </td>
                        <td className="py-1 pr-2">
                          {`${m.list === "SDN" ? "SDN" : "Consolidated"} #${m.entNum} \u00b7 ${m.sdnType ?? "entity"} \u00b7 ${m.program ?? "\u2014"}`}
                        </td>
                        <td className="py-1">{m.remarks ?? "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {item.status.status === "needs_review" ? (
                  <form action={review} className="mt-3 space-y-2">
                    <input type="hidden" name="result_id" value={item.result.id} />
                    <fieldset className="flex flex-wrap gap-4 text-sm text-white/80">
                      <legend className="sr-only">Your decision</legend>
                      <label>
                        <input type="radio" name="decision" value="not_a_match" required /> Not a match
                      </label>
                      <label>
                        <input type="radio" name="decision" value="true_match" /> True match
                      </label>
                    </fieldset>
                    <textarea
                      name="note"
                      required
                      minLength={20}
                      maxLength={2000}
                      rows={2}
                      className={inputCls}
                      placeholder="What you compared, e.g. 'List entry born 1961 in Iran; our employee born 1994 in Tacoma, WA (I-9 on file).' No SSNs or account numbers."
                    />
                    <button type="submit" className={btnPrimary}>
                      {isOwner ? "Record decision" : "Send to Michael for approval"}
                    </button>
                  </form>
                ) : item.status.status !== "clear" ? (
                  <p className="mt-2 text-xs text-white/60">
                    Decision on {when(item.status.review.reviewedAt)}: {item.status.review.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="how" className={card}>
        <h2 className={h2}>How to review a possible match (OFAC FAQ 5)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-white/80">
          <li>
            Compare the list entry with what you know: full name, date of birth, nationality, address, and for a business its registration and location. The
            Remarks column holds OFAC&apos;s details.
          </li>
          <li>
            &ldquo;{OFAC_QUOTES.faq5Proceed}&rdquo; Record <em>Not a match</em> with what you compared.
          </li>
          <li>
            If several details match (for example name and date of birth), record <em>True match</em>, do not send them money, and call your attorney and Timberland
            (1-800-562-8761). &ldquo;{OFAC_QUOTES.faq5Report}&rdquo;.
          </li>
          <li>&ldquo;{OFAC_QUOTES.faq5Records}&rdquo; Every decision and note here is kept and never changed.</li>
        </ol>
        <p className="mt-3 text-xs text-white/50">
          Method: OFAC&apos;s own data files, downloaded each morning (FAQ 287: the search website &ldquo;{OFAC_QUOTES.faq287}&rdquo;). Each name is scored the way
          FAQ 249 describes: Jaro-Winkler on the whole name and on each part with Soundex, the higher score kept. A score of {pct(MATCH_THRESHOLD)} or more is
          shown. OFAC sets no threshold: &ldquo;{OFAC_QUOTES.faq250}&rdquo; Not screened: weak aliases (&ldquo;{OFAC_QUOTES.weakAka.replace(/\n/g, " ")}&rdquo;) and
          vessel or aircraft entries (a payee is a person or a business). Vendors already vetted by the WSLCB are screened as well; it costs nothing and keeps the
          record complete.
        </p>
      </section>

      <section id="runs" className={card}>
        <h2 className={h2}>Recent screens</h2>
        {view.runs.length === 0 ? (
          <p className="text-sm text-white/70">None yet.</p>
        ) : (
          <table className="w-full text-left text-xs text-white/80">
            <thead className="text-white/50">
              <tr>
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">How</th>
                <th className="py-1 pr-2">Result</th>
                <th className="py-1">Payees / possible matches</th>
              </tr>
            </thead>
            <tbody>
              {view.runs.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="py-1 pr-2">{when(r.ranAt)}</td>
                  <td className="py-1 pr-2">{r.trigger === "manual" ? "Screen now" : "Daily"}</td>
                  <td className="py-1 pr-2">{r.status === "ok" ? "OK" : <span className="text-red-300">Failed: {r.error}</span>}</td>
                  <td className="py-1">{r.status === "ok" ? `${r.payeesCount} / ${r.possibleMatches}` : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
