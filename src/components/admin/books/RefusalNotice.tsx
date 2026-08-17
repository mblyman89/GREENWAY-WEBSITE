import type { GlRefusal } from "@/lib/accounting/gl-refusal-core";

/**
 * RefusalNotice — how the books say "no".
 *
 * The general ledger refuses things on purpose, and each refusal was written
 * carefully. This renders that refusal as an explanation and an instruction,
 * never as a stack trace.
 *
 * THE DESIGN RULE: a refusal we RECOGNISE and one we do NOT must look
 * different. A recognised refusal is the system working correctly and reads
 * calmly. An unrecognised failure is honestly labelled as unexpected and shows
 * the raw text, because pretending to understand an unknown error is how a
 * real problem gets shrugged off.
 */
export function RefusalNotice({ refusal }: { refusal: GlRefusal }) {
  const unknown = !refusal.recognised;

  const border = unknown
    ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/[0.06]"
    : refusal.isPermission
      ? "border-white/15 bg-white/[0.03]"
      : "border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06]";

  return (
    <div className={`rounded-2xl border p-5 ${border}`}>
      <p className="text-sm font-bold text-white">{refusal.title}</p>

      {/* THE SPECIFICS FIRST. The title says what kind of problem this is; this
          line says which journal, which account, which dates, how many cents.
          It comes from the database's own sentence. Before this was added the
          owner was told "that entry does not balance" and never told by how
          much, which made a recognised refusal LESS informative than an
          unrecognised one. */}
      {refusal.detail ? (
        <p className="mt-2 text-sm leading-relaxed text-white/85">{refusal.detail}</p>
      ) : null}

      {refusal.whatToDo ? (
        <p className="mt-2 text-sm leading-relaxed text-white/70">{refusal.whatToDo}</p>
      ) : null}

      {/* For an UNRECOGNISED failure the raw text is the most useful thing on
          screen, so it is shown plainly rather than tucked away. */}
      {unknown && refusal.raw ? (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-white/60">
          {refusal.raw}
        </pre>
      ) : null}

      {/* For a recognised refusal the code is kept, small, for the record. */}
      {!unknown && refusal.code ? (
        <p className="mt-3 text-[11px] uppercase tracking-wide text-white/30">
          {refusal.code}
        </p>
      ) : null}
    </div>
  );
}
