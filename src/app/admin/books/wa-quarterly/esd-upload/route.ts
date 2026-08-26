/**
 * GET /admin/books/wa-quarterly/esd-upload?kind=&year=&quarter=
 *
 * Downloads one of the two ESD quarterly upload files as a CSV: the EAMS
 * unemployment wage file, or the Paid Leave / WA Cares wage file. Books-gated
 * (`requireBooksAccess`, i.e. owner only), because the file contains every
 * employee's full social security number.
 */
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { recordAudit } from "@/lib/auth/audit";
import {
  buildEsdUpload,
  isEsdUploadKind,
  type EsdUploadKind,
} from "@/lib/payroll/esd-upload-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS ROUTE EXISTS AT ALL, WHICH IS A DEFECT REPORT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `buildPaidLeaveCsv` was written in books-56, 511 lines, correct, gate-covered
 * — and called from nowhere. `grep -rn "buildPaidLeaveCsv" src/` outside its own
 * module returned nothing for eight slices. Michael could not reach it. That is
 * D-11, and it is the same class as D-08.
 *
 * Standing rule 125(d): a run needs a way in that is not a URL. A pure function
 * with no caller is not a feature, it is a note to ourselves. So this route is
 * not an add-on to the CSV work; it is the half that makes the CSV work exist.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A ROUTE AND NOT A SERVER ACTION ON THE PAGE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A browser downloads a file when it gets Content-Disposition: attachment on a
 * plain GET. A server action would have to return the text and have client-side
 * JavaScript synthesise a Blob and a fake anchor click, which fails silently
 * with JavaScript disabled and puts the SSNs through the client bundle. The
 * house already made this decision once, for the Sage export
 * (src/app/admin/reports/accounting/sage-export/route.ts); this follows it
 * rather than inventing a second pattern (rule 25).
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read `year` and `quarter` from the query string.
 *
 * Deliberately NOT defaulted to "the current quarter". A wrong-quarter ESD
 * upload is not a rejected file — EAMS accepts it against whatever quarter the
 * session is open on, and the wages land on the wrong return. So an absent or
 * unparseable quarter is a 400 that says so, not a guess. The page always sends
 * both, so the only way to reach this branch is by hand-editing the URL.
 */
function readQuarter(
  url: URL,
): { ok: true; year: number; quarter: 1 | 2 | 3 | 4 } | { ok: false; why: string } {
  const rawYear = url.searchParams.get("year") ?? "";
  const rawQuarter = url.searchParams.get("quarter") ?? "";

  if (!/^\d{4}$/.test(rawYear)) {
    return {
      ok: false,
      why:
        `The year is missing or malformed (got ${JSON.stringify(rawYear)}). It is not ` +
        `defaulted to this year on purpose: an upload filed against the wrong period is ` +
        `accepted by EAMS and lands on the wrong return.`,
    };
  }
  if (!/^[1-4]$/.test(rawQuarter)) {
    return {
      ok: false,
      why:
        `The quarter is missing or malformed (got ${JSON.stringify(rawQuarter)}). ` +
        `It must be 1, 2, 3 or 4.`,
    };
  }
  return {
    ok: true,
    year: Number(rawYear),
    quarter: Number(rawQuarter) as 1 | 2 | 3 | 4,
  };
}

/**
 * Turn a refusal into a page a person can act on.
 *
 * NOT a JSON body and not a bare status code. The reader of this response is
 * Michael, in a browser, at a quarter-end deadline. A blocker list that names
 * three employees and the fact each one is missing is worth more than a 422,
 * and it is the whole reason `buildEsdUpload` returns named blockers instead of
 * a count.
 *
 * Status 422 rather than 500: the request was understood and the server is
 * fine. Something in the DATA is not ready, which is a different thing and
 * should not page anybody.
 */
function refusalPage(
  kind: EsdUploadKind,
  code: string,
  message: string,
  blockers: readonly { subject: string; missing: string; whatToDo: string }[],
): Response {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const which =
    kind === "eams_unemployment"
      ? "EAMS unemployment wage file"
      : "Paid Leave &amp; WA Cares wage file";

  const rows = blockers
    .map(
      (b) =>
        `<li><strong>${esc(b.subject)}</strong> &mdash; missing ${esc(b.missing)}` +
        `<div class="what">${esc(b.whatToDo)}</div></li>`,
    )
    .join("\n");

  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ESD upload not built</title>
<style>
  body { font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; color: #111; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  .code { font: 13px ui-monospace, Menlo, monospace; color: #666; }
  .msg { background: #fff8e1; border-left: 4px solid #f0ad00;
         padding: .85rem 1rem; margin: 1.25rem 0; }
  ul { padding-left: 1.15rem; }
  li { margin: .85rem 0; }
  .what { color: #444; font-size: .93rem; margin-top: .2rem; }
  a { color: #05620f; }
</style></head><body>
<h1>The ${which} was not built</h1>
<p class="code">${esc(code)}</p>
<div class="msg">${esc(message)}</div>
${blockers.length > 0 ? `<h2 style="font-size:1.05rem">What to fix</h2><ul>${rows}</ul>` : ""}
<p><a href="/admin/books/wa-quarterly">&larr; Back to the quarterly return</a></p>
</body></html>`;

  return new Response(body, {
    status: 422,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const session = await requireBooksAccess();

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  if (!isEsdUploadKind(kind)) {
    return new Response(
      `Unknown ESD upload kind ${JSON.stringify(kind)}. ` +
        `Expected "eams_unemployment" or "paid_leave_wa_cares".`,
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const q = readQuarter(url);
  if (!q.ok) {
    return new Response(q.why, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const built = await buildEsdUpload(kind, { year: q.year, quarter: q.quarter });

  if (!built.ok) {
    /*
     * A REFUSAL IS AUDITED TOO.
     *
     * The tempting version audits only successes, because a refusal "did not do
     * anything". But a refusal is exactly what somebody will later say did not
     * happen — "I tried to download it and nothing came out" — and the answer to
     * that question is worth having. Names are NOT copied into the audit row;
     * the count and the code are enough to reconstruct the event, and the audit
     * log is not the place to duplicate employee identity.
     */
    await recordAudit({
      actorId: session.profile.id,
      action: "esd.upload.refused",
      entityType: "payroll",
      entityId: `${kind}:${q.year}Q${q.quarter}`,
      after: { code: built.code, blockers: built.blockers.length },
    });
    return refusalPage(kind, built.code, built.message, built.blockers);
  }

  await recordAudit({
    actorId: session.profile.id,
    action: "esd.upload.downloaded",
    entityType: "payroll",
    entityId: built.fileName,
    after: {
      kind,
      year: q.year,
      quarter: q.quarter,
      rowsWritten: built.rowsWritten,
      omitted: built.omitted.length,
    },
  });

  return new Response(built.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${built.fileName}"`,
      /*
       * A FILE CONTAINING EVERY EMPLOYEE'S SSN MUST NOT SIT IN A CACHE.
       *
       * The Sage export does not set this, because a cash-receipts CSV is not
       * identity data. This one is: nine digits per person, in the clear,
       * because ESD requires it. So it is marked no-store, which keeps it out
       * of the browser's disk cache and out of any intermediary — the same
       * reasoning that made form-w2-store refuse to write an SSN reveal row.
       */
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
