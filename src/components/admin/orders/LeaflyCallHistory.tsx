/**
 * src/components/admin/orders/LeaflyCallHistory.tsx  (SLICE L-49)
 *
 * "What we sent Leafly, and what Leafly said (last 5)" on a Leafly order's
 * page. An async SERVER component: it reads `leaflyOrderId`'s newest rows of
 * `leafly_outbound_attempts` and renders them through the pure
 * `summarizeOutboundAttemptForDisplay`, which never renders a 2xx reply (a
 * Leafly Order carries the customer's name, phone and date of birth).
 *
 * Gated by `orders.manage` (the permission that can make these calls). Never
 * throws: a failed read shows one sentence and the rest of the page is intact.
 */
import { getStaffSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { loadRecentOutboundAttempts } from "@/lib/leafly/outbound-history-server";
import { summarizeOutboundAttemptForDisplay } from "@/lib/leafly/outbound-history-core";

function fmtPacific(iso: string | null): string {
  if (!iso) return "(time not recorded)";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export async function LeaflyCallHistory({ leaflyOrderId }: { leaflyOrderId: string }) {
  let allowed = false;
  try {
    const session = await getStaffSession();
    allowed = !!session && can(session.profile.role, "orders.manage");
  } catch {
    allowed = false;
  }
  if (!allowed) return null;

  const loaded = await loadRecentOutboundAttempts(leaflyOrderId, 5);

  return (
    <details className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-white/5 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-bold text-[var(--admin-text)]">
        What we sent Leafly, and what Leafly said (last 5)
      </summary>
      {!loaded.ok ? (
        <p className="mt-2 text-[var(--admin-text-muted)]">
          Could not load the call history just now ({loaded.problem}). Nothing else on this page is affected.
        </p>
      ) : loaded.rows.length === 0 ? (
        <p className="mt-2 text-[var(--admin-text-muted)]">No calls to Leafly are recorded for this order yet.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {loaded.rows.map((row, i) => {
            const d = summarizeOutboundAttemptForDisplay(row);
            return (
              <li key={`${row.attempted_at ?? "t"}-${i}`} className="rounded border border-white/10 bg-black/20 p-2">
                <p className="font-bold text-[var(--admin-text)]">
                  {fmtPacific(d.when)} · {d.operation} · {d.httpStatus === null ? "no HTTP status" : `HTTP ${d.httpStatus}`} ·{" "}
                  {d.outcome}
                </p>
                {d.leaflySaid ? (
                  <p className="mt-1 text-[var(--admin-gold)]">
                    <span className="font-bold">Leafly said:</span> {d.leaflySaid}
                  </p>
                ) : null}
                <p className="mt-1 text-[var(--admin-text-muted)]">{d.message}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[var(--admin-text-muted)]">What we sent</summary>
                  {d.sentIsBody ? (
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] text-white/80">
                      {d.sent}
                    </pre>
                  ) : (
                    <p className="mt-1 text-[var(--admin-text-muted)]">{d.sent}</p>
                  )}
                </details>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[var(--admin-text-muted)]">What Leafly replied</summary>
                  {d.repliedIsBody ? (
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] text-white/80">
                      {d.replied}
                    </pre>
                  ) : (
                    <p className="mt-1 text-[var(--admin-text-muted)]">{d.replied}</p>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}
