"use client";

/**
 * src/components/admin/books/FiledForm941ConfirmationPanel.tsx   (books-48)
 *
 * THE CONFIRMATION STEP, AND THE FOUR LESSONS THAT EXPLAIN WHY IT EXISTS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE TEACHING IS ON THIS SCREEN AND NOT IN A DOCUMENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, verbatim:
 *
 *   "if there are lessons to connect or use for the 941 confirmation step,
 *    please add them and make them easy to read and understand. explain why we
 *    are doing this."
 *
 * The four lessons could have gone in a markdown file. They did not, for the
 * same reason the field guidance sits beside the field rather than in a manual:
 * this form gets filled in four times a year, under mild time pressure, by
 * somebody who last saw a 941 three months ago. Teaching on another page is
 * teaching that will not be read at the moment it is needed.
 *
 * The specific confusions these lessons prevent all happen AT THE KEYSTROKE -
 * typing the employee half of social security tax instead of both halves,
 * expecting the W-3 to equal one quarter instead of four, wondering why line 7
 * exists at all, wondering why the software is asking for numbers it already
 * has. So the answers are here, one click away, permanently.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE LESSONS ARE COLLAPSED BY DEFAULT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A panel that opens with four essays above the form is a panel that gets
 * scrolled past, and the scrolling becomes a habit that also skips the
 * warnings. Collapsed, with a button that names what is inside, the teaching is
 * available the first time and out of the way the fifth time.
 *
 * The one thing NOT collapsed is the single sentence saying why the typing is
 * necessary, because that is the question a person has while they are deciding
 * whether to bother.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS COMPONENT COMPUTES NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It arranges two things that already exist: `FiledForm941EntryForm`, which
 * collects the typing, and `FORM_941_CONFIRMATION_LESSONS`, which is data in a
 * pure module the gate can read. There is no judgement here to get wrong, which
 * is deliberate - a `.tsx` file in this repository cannot be unit tested, so
 * anything decided in one is decided somewhere nothing checks.
 */

import { useState } from "react";

import { BoxLessonBody } from "@/components/admin/books/BoxLessonBody";
import { FiledForm941EntryForm } from "@/components/admin/books/FiledForm941EntryForm";
import { Button, Card, CardHeader } from "@/components/admin/ui";
import { FORM_941_CONFIRMATION_LESSONS } from "@/lib/payroll/form-941-confirmation-lessons";
import type {
  FiledForm941Draft,
  FiledForm941Refusal,
  FiledForm941Warning,
} from "@/lib/payroll/form-941-confirmation-core";

export type FiledForm941ConfirmationPanelProps = {
  readonly taxYear: number;
  readonly alreadyRecordedQuarters: readonly number[];
  readonly recordedUnavailableBecause: string | null;
  readonly onSubmit: (draft: FiledForm941Draft) => Promise<{
    readonly ok: boolean;
    readonly message: string;
    readonly refusals: readonly FiledForm941Refusal[];
    readonly warnings: readonly FiledForm941Warning[];
    readonly replacedExisting: boolean;
  }>;
};

export function FiledForm941ConfirmationPanel({
  taxYear,
  alreadyRecordedQuarters,
  recordedUnavailableBecause,
  onSubmit,
}: FiledForm941ConfirmationPanelProps) {
  const [openLesson, setOpenLesson] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* ── THE FOUR LESSONS ──────────────────────────────────────────────
          Rendered by the SAME component that renders a box lesson on the form
          itself, so a lesson here shows every member a lesson there shows. */}
      <Card>
        <CardHeader
          title="Why you are typing numbers the software already knows"
          subtitle="Four short lessons. Read them once; they are here whenever you want them again."
        />

        <p className="text-sm text-[var(--admin-text-muted)]">
          Because a check is only worth something if the two sides could disagree. The figures above
          came from your pay runs. The figures below come from the paper the IRS actually received.
          Two independent sources agreeing means something; the software agreeing with itself means
          nothing at all.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {FORM_941_CONFIRMATION_LESSONS.map((lesson) => (
            <Button
              key={lesson.box}
              type="button"
              variant={openLesson === lesson.box ? "primary" : "neutral"}
              size="sm"
              onClick={() =>
                setOpenLesson((cur) => (cur === lesson.box ? null : lesson.box))
              }
            >
              {lesson.headline}
            </Button>
          ))}
        </div>

        {FORM_941_CONFIRMATION_LESSONS.filter((l) => l.box === openLesson).map((lesson) => (
          <div key={lesson.box} className="mt-4 border-t border-white/10 pt-3">
            <h3 className="text-sm font-semibold text-[var(--admin-text)]">{lesson.headline}</h3>
            <BoxLessonBody lesson={lesson} />
            <button
              type="button"
              onClick={() => setOpenLesson(null)}
              className="mt-4 rounded-[var(--admin-radius-sm)] border border-white/12 px-3 py-1.5 text-xs text-[var(--admin-text-muted)] hover:border-white/25"
            >
              &larr; Close this lesson
            </button>
          </div>
        ))}
      </Card>

      <FiledForm941EntryForm
        taxYear={taxYear}
        alreadyRecordedQuarters={alreadyRecordedQuarters}
        recordedUnavailableBecause={recordedUnavailableBecause}
        onSubmit={onSubmit}
      />
    </div>
  );
}
