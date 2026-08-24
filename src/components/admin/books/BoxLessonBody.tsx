"use client";

/**
 * src/components/admin/books/BoxLessonBody.tsx   (books-48)
 *
 * ONE RENDERER FOR A `BoxLesson`, USED EVERYWHERE A LESSON IS SHOWN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS WAS EXTRACTED INSTEAD OF WRITTEN A SECOND TIME (standing rule 25)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This markup lived inside `FormBoxExplorer.tsx`, reachable only by clicking a
 * box on a form. The Form 941 confirmation step needs to show lessons too - but
 * its lessons are not boxes on a form, they are lessons about the ACT of
 * confirming, so they have no line number to click and cannot appear in the
 * explorer's box grid.
 *
 * The lazy move would have been to write a second, simpler renderer beside the
 * confirmation form. That is exactly the mistake standing rule 25 exists to
 * prevent, and the cost is specific rather than theoretical: `BoxLesson` has
 * eight display-bearing members, including `commonMistake` which is nullable
 * and `tiesTo` which carries the cross-form links. A second renderer starts by
 * showing six of them. Then a member gets added to the type - and one screen
 * teaches it while the other silently does not. Nothing errors. Nothing turns
 * red. Michael simply never learns the thing on one of the two screens, and
 * there is no way for him to know that is what happened.
 *
 * So there is one renderer. Both callers get every member, and a member added
 * to `BoxLesson` is either rendered in this file or rendered nowhere, which is
 * a state a person can actually verify.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE HEADER IS NOT IN HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The explorer titles a lesson `Box 5a - <headline>` and shows the printed
 * amount as a badge, because there a lesson IS a line on a return. The
 * confirmation step has no printed amount and "Box why" would be nonsense.
 *
 * The disagreement is real, so the header stays with each caller and only the
 * BODY - which is identical in both, and is where all eight members live - is
 * shared. Forcing a common header would mean a prop like `showBoxNumber`, and
 * a boolean that changes layout is the beginning of two renderers wearing one
 * name.
 */

import type { ScreenTone } from "@/lib/ui/screen-tone-core";
import type { BoxLesson } from "@/lib/payroll/form-box-core";

/* The panel and text palettes, matching FormBoxExplorer exactly. Kept here
   because this is now where the lesson body is drawn; the explorer keeps its
   own copies for the box grid and check rows it still draws itself. */
const PANEL: Record<ScreenTone, string> = {
  green: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]",
  gold: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]",
  orange: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]",
  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]",
  neutral: "border-white/12 bg-white/[0.03]",
};

const TEXT: Record<ScreenTone, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  danger: "text-[var(--admin-danger)]",
  neutral: "text-[var(--admin-text-muted)]",
};

function Panel({
  label,
  tone,
  children,
}: {
  readonly label: string;
  readonly tone: ScreenTone;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL[tone]}`}>
      <div className={`text-[0.65rem] font-semibold uppercase tracking-wide ${TEXT[tone]}`}>
        {label}
      </div>
      <p className="mt-1 text-[0.72rem] leading-relaxed">{children}</p>
    </div>
  );
}

/**
 * Every display-bearing member of a `BoxLesson`, in teaching order.
 *
 * The order is not cosmetic. It answers what this is, then where the number
 * came from, then what it tells you, then what goes wrong, then what to do -
 * which is the order the questions actually arrive in when somebody is looking
 * at a figure they do not recognise.
 *
 * `tiesTo` is last and is deliberately never suppressed, because the cross-form
 * links are the part that turns a stack of forms into a system.
 */
export function BoxLessonBody({ lesson }: { readonly lesson: BoxLesson }) {
  return (
    <>
      <div className="mt-3 space-y-3 text-xs leading-relaxed">
        <Panel label="What this box is" tone="neutral">
          {lesson.plainEnglish}
        </Panel>
        <Panel label="Where the figure comes from" tone="neutral">
          {lesson.whereItComesFrom}
        </Panel>
        <Panel label="How to read it as a tool" tone="green">
          {lesson.howToReadIt}
        </Panel>
        {lesson.commonMistake !== null && (
          <Panel label="The mistake people actually make" tone="orange">
            {lesson.commonMistake}
          </Panel>
        )}
        <Panel label="What to do" tone="gold">
          {lesson.whatToDo}
        </Panel>
      </div>

      {lesson.examples.length > 0 && (
        <div className="mt-4 space-y-3">
          <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Worked examples
          </h4>
          {lesson.examples.map((ex) => (
            <div
              key={ex.title}
              className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL.neutral}`}
            >
              <div className="text-xs font-semibold">{ex.title}</div>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-[0.7rem] text-[var(--admin-text-muted)]">
                {ex.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <div className="mt-2 font-mono text-xs text-[var(--admin-accent)]">
                = {ex.answer}
              </div>
              <div className="mt-1 text-[0.7rem] italic text-[var(--admin-text-muted)]">
                {ex.moral}
              </div>
            </div>
          ))}
        </div>
      )}

      {lesson.quotes.length > 0 && (
        <div className="mt-4 space-y-3">
          <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            The authority, word for word
          </h4>
          {lesson.quotes.map((q) => (
            <div
              key={q.cite}
              className={`rounded-[var(--admin-radius-sm)] border p-3 ${PANEL.gold}`}
            >
              <div className="text-[0.65rem] uppercase tracking-wide text-[var(--admin-gold)]">
                {q.cite}
              </div>
              <blockquote className="mt-2 border-l-2 border-[var(--admin-gold)]/50 pl-3 text-[0.72rem] italic">
                &ldquo;{q.quote}&rdquo;
              </blockquote>
              <div className="mt-2 text-[0.7rem]">
                <span className="font-semibold">What that means here: </span>
                {q.soWhat}
              </div>
              <a
                href={q.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-[0.65rem] text-[var(--admin-accent)] underline"
              >
                Read the source
              </a>
            </div>
          ))}
        </div>
      )}

      {lesson.tiesTo.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            What this box must agree with
          </h4>
          <ul className="mt-2 space-y-1 text-[0.7rem]">
            {lesson.tiesTo.map((t) => (
              <li key={`${t.formId}:${t.box}`} className="text-[var(--admin-text-muted)]">
                <span className="font-mono text-[var(--admin-accent)]">
                  {t.formId} box {t.box}
                </span>
                {" \u2014 "}
                {t.why}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.65rem] text-[var(--admin-text-muted)]">
            These links are what turn a stack of forms into a system. If two of them disagree, one
            of them is wrong, and finding out here costs minutes instead of waiting for a notice.
          </p>
        </div>
      )}
    </>
  );
}
