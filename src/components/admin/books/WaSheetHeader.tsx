/**
 * src/components/admin/books/WaSheetHeader.tsx   (books-65)
 *
 * The top of the Washington "as it prints" page: whose returns these are, and
 * an honest statement of why the ESD artwork is not underneath the figures.
 *
 * ═══ WHY THIS IS ITS OWN COMPONENT ═══
 *
 * Standing rule 130c asks for one visual check per new surface, and the house
 * pattern (established books-64) is to render the REAL presentational component
 * to static HTML and photograph that — because `next dev` in this sandbox has
 * no `.env` and serves the setup notice instead of the page. A harness can only
 * photograph what the owner sees if the page and the harness share ONE
 * component. So the markup lives here and the page composes it (rule 25).
 *
 * ═══ WHY IT NAMES WHAT IS MISSING RATHER THAN GOING QUIET ═══
 *
 * A Washington return with no ES reference number is not a return ESD can post,
 * and a blank field reads as a form nobody has started rather than one that is
 * blocked. The same reasoning as the federal sheets' "the top of this form is
 * incomplete" banner, applied to the two identifiers the ESD forms ask for that
 * no federal form does: the ES REFERENCE NUMBER (box 6 on the 5208A) and the
 * UBI (box 3).
 */

export type WaSheetHeaderProps = {
  readonly quarterLabel: string;
  readonly ein: string | null;
  readonly legalName: string | null;
  readonly tradeName: string | null;
  readonly esdAccount: string | null;
  readonly ubi: string | null;
  readonly ratesResolved: boolean;
  readonly missingRates: readonly string[];
  /**
   * TRUE only when the DATABASE READ failed — not when the quarter is simply
   * empty. Kept as its own prop rather than derived from "there are no
   * figures", because those two states render the same blank boxes and mean
   * opposite things: one is a fault, the other is an honest answer.
   */
  readonly readFailed: boolean;
};

/** One identifier as the paper asks for it, or a plain statement that it is absent. */
function Identifier({
  label,
  value,
  whyItMatters,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly whyItMatters: string;
}) {
  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      {value === null ? (
        <>
          <p className="mt-1 text-sm font-semibold text-[var(--admin-gold)]">not on file</p>
          <p className="mt-1 text-[11px] leading-snug text-white/45">{whyItMatters}</p>
        </>
      ) : (
        <p className="mt-1 font-mono text-sm font-semibold text-white/90">{value}</p>
      )}
    </div>
  );
}

export function WaSheetHeader({
  quarterLabel,
  ein,
  legalName,
  tradeName,
  esdAccount,
  ubi,
  ratesResolved,
  missingRates,
  readFailed,
}: WaSheetHeaderProps) {
  return (
    <section>
      <h1 className="mt-3 text-lg font-semibold tracking-tight text-white">
        Washington quarterly returns ({quarterLabel}) &mdash; box by box
      </h1>

      {/* ── WHY THERE IS NO PAPER UNDER THESE FIGURES ──────────────────────
          Said out loud, with the measurement in it, because an unexplained
          difference between this page and the 941's reads as an unfinished
          feature. It is not: it is a refusal. */}
      <p className="mt-2 max-w-3xl rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-white/55">
        <strong className="text-white/75">
          These are the real boxes, but not the printed paper &mdash; and that is deliberate.
        </strong>{" "}
        The federal sheets can show the IRS&rsquo;s own artwork because every IRS fillable PDF
        carries an exact rectangle for each box; there are 116 of them on the 941. The two ESD
        PDFs carry <strong className="text-white/75">none</strong> &mdash; zero fillable fields
        between them &mdash; so there is no agency answer to where a figure belongs, and placing
        one by eye would be a guess at the precise spot where a mistake looks completely correct.
        Worse, the blank 5208A published as a PDF is the 2011 draft: it numbers the wage lines 12,
        13 and 14 and prints a $37,300 wage base. Your own filed returns show today&rsquo;s form
        numbers them 13, 14 and 16, and the 2026 base is $78,200. Printing your figures onto that
        artwork would produce a convincing document with the wrong line numbers on it. So the
        boxes, the lessons and the figures are all here; the 2011 picture is not.
      </p>

      {/* ── WHOSE RETURNS ─────────────────────────────────────────────────── */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Identifier
          label="Legal name (5208A box 5)"
          value={legalName}
          whyItMatters="ESD posts these returns to the name it registered the account under."
        />
        <Identifier
          label="Trade name"
          value={tradeName}
          whyItMatters="The name over the door. Recorded for your own reference."
        />
        <Identifier
          label="Federal ID number (5208A box 2)"
          value={ein}
          whyItMatters="The same EIN as your 941. If these two disagree you are two taxpayers."
        />
        <Identifier
          label="UBI number (5208A box 3)"
          value={ubi}
          whyItMatters="Twelve digits, issued by the state. ESD asks for it on every return."
        />
        <Identifier
          label="ES reference number (5208A box 6)"
          value={esdAccount}
          whyItMatters="Nine digits, ESD's own account number for you. The form says that without it you must file a Business Change Form (5208C-1) first."
        />
      </div>

      {/* ── WHY A FIGURE MIGHT BE ABSENT ───────────────────────────────────
          Three different reasons, told apart on purpose. "No rate on file" and
          "no payroll yet" produce the same blank box and mean entirely
          different things. */}
      {!ratesResolved ? (
        <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs leading-relaxed">
          <strong>No figures below are yours.</strong> {missingRates.length} of the rates these
          returns are built from have no evidenced entry covering this quarter
          {missingRates.length > 0 ? `: ${missingRates.join("; ")}` : ""}. These returns are
          percentages of your payroll, so without the rate that was in force there is no honest
          figure to show. Nothing was carried forward from last year, because a stale rate
          produces a confident wrong number instead of an obvious missing one.
        </p>
      ) : readFailed ? (
        <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs leading-relaxed">
          <strong>This quarter could not be read.</strong> The boxes below are explained but
          carry no figures. This is a problem reading the records &mdash; not a problem with your
          payroll, and not a problem with a return you have already filed.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-white/45">
          Where a box reads <strong className="text-white/70">not computed yet</strong>, no pay run
          for {quarterLabel} has produced a figure for it. That is not a zero. A zero on a
          Washington return is a positive claim that nothing was paid, and it is not a claim this
          system will make on your behalf. Nothing on this page can be typed into: every figure
          comes from the books, and a correction is a correcting journal entry with an audit trail
          behind it.
        </p>
      )}
    </section>
  );
}
