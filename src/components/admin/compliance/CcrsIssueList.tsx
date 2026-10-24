/**
 * CcrsIssueList — CCRS Bible Part 17, slice S-17a.
 *
 * Renders the submit gate's errors or warnings WITH every affected row. Before
 * S-17a the hub printed "• [Inventory] 17 lot(s) were left out … Each row says
 * why … (17)" and no rows (Part 17 §C.4 defect 1). Now each issue shows:
 *   - the message, code and spec pin;
 *   - for ledger withholds (E41): one line per reason class with the next step;
 *   - a <details> list of EVERY row (never capped — Part 05 §H);
 *   - a copy button with the same text as plain text (for an email or a note).
 *
 * PURE: no I/O. The copy button is a client island; everything else is static,
 * so this renders with renderToStaticMarkup in the vitest harness.
 */
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import {
  groupRowsByReason,
  isWithholdIssue,
  issuePlainText,
  issuesPlainText,
  rowLine,
  type DisplayIssue,
} from "@/lib/compliance/ccrs-issue-display-core";
import { CopyCommandButton } from "@/components/admin/orders/CopyCommandButton";

type Props = {
  issues: readonly DisplayIssue[];
  env: LedgerEnv;
  tone: "error" | "warning" | "held";
  /** Title of the copy-all text (e.g. "CCRS blocking errors — week 2026-10-11"). */
  copyTitle: string;
};

export function CcrsIssueList({ issues, env, tone, copyTitle }: Props) {
  if (issues.length === 0) return null;
  const text = tone === "error" ? "text-red-200" : tone === "held" ? "text-amber-100" : "text-white/50";
  const anyRows = issues.some((i) => (i.rows?.length ?? 0) > 0);
  return (
    <div className={`space-y-1 text-xs ${text}`} data-testid={`ccrs-issues-${tone}`}>
      <ul className="space-y-2">
        {issues.map((e, i) => {
          const rows = e.rows ?? [];
          const groups = isWithholdIssue(e) && rows.length > 0 ? groupRowsByReason(rows, env) : [];
          return (
            <li key={i} data-code={e.code ?? ""} data-rows={rows.length}>
              <span>
                • [{e.file}] {e.message}
                {e.count ? ` (${e.count})` : ""}
              </span>
              {e.code ? <span className="ml-1 font-mono text-[10px] opacity-60">{e.code}</span> : null}
              {groups.length > 0 ? (
                <ul className="mt-1 space-y-1 pl-4" data-testid="reason-groups">
                  {groups.map((g) => (
                    <li key={g.cls} data-class={g.cls}>
                      <span className="font-semibold">
                        {g.count} × {g.label}.
                      </span>{" "}
                      <span className="opacity-90">Next step: {g.nextStep}</span>
                      {g.cls === "no-product-id" && env === "preprod" ? (
                        <>
                          {" "}
                          <a href="#ccrs-files" className="underline">
                            Go to PREprod set-up
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {rows.length > 0 ? (
                <details className="mt-1 pl-4">
                  <summary className="cursor-pointer opacity-80">Show all {rows.length} row(s)</summary>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 font-mono text-[11px]" data-testid="issue-rows">
                    {rows.map((r, j) => (
                      <li key={`${r.id}-${j}`}>{rowLine(r)}</li>
                    ))}
                  </ol>
                  <div className="mt-1">
                    <CopyCommandButton
                      command={issuePlainText(e, env).join("\n")}
                      describeAs="list of affected rows"
                      idleLabel="Copy these rows"
                    />
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
      {anyRows ? (
        <div className="pt-1">
          <CopyCommandButton
            command={issuesPlainText(issues, env, copyTitle)}
            describeAs={
              tone === "error"
                ? "every blocking error with its rows"
                : tone === "held"
                  ? "every held-back record (still owed to CCRS)"
                  : "every warning with its rows"
            }
            idleLabel={
              tone === "error"
                ? "Copy every error with its rows"
                : tone === "held"
                  ? "Copy every held-back record"
                  : "Copy every warning with its rows"
            }
          />
        </div>
      ) : null}
    </div>
  );
}
