"use client";

/**
 * src/components/admin/orders/SaveButton.tsx
 *
 * SLICE L-18 — the second half of "the settings save hangs".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE BUG CLASS, FOR THE THIRD TIME IN THIS REPO
 * ───────────────────────────────────────────────────────────────────────────
 * The Announcer panel is a SERVER component. Its three save forms were:
 *
 *     <form action={announcerUpdateSettingsAction}>
 *       ...
 *       <Button type="submit" variant="save" size="sm">Save settings</Button>
 *     </form>
 *
 * A plain submit button against a `Promise<void>` server action. It has no
 * pending state, no disabled state, and the action returns nothing to render.
 * Pressing it produces ZERO visible change until the whole page has
 * re-rendered on the server and streamed back.
 *
 * On this particular page that round trip was slow for a reason that had
 * nothing to do with saving — /admin/orders is force-dynamic and rebuilt the
 * entire published Leafly menu on every render (fixed in the other half of
 * this slice). So the owner pressed Save, the button did not move, and
 * several seconds of nothing followed. That is indistinguishable from a hang,
 * and calling it one was correct.
 *
 * This is the SAME defect already documented twice in this codebase:
 *   - AnnouncerTestButton.tsx — "the back office test speaker button does
 *     nothing, it hangs." Fixed with useActionState.
 *   - LeaflyOrderActions.tsx (slice L-17) — the acknowledge button. Fixed
 *     with useFormStatus.
 *
 * House rule 11 says do not re-implement a judgement that already has a home,
 * so this file is the third application of the same pattern, extracted so
 * there is not a fourth copy.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY useFormStatus AND NOT useActionState
 * ───────────────────────────────────────────────────────────────────────────
 * useActionState is the right tool when the RETURN VALUE matters — that is why
 * AnnouncerTestButton uses it, because "how many speakers did it reach?" is
 * the answer the operator needs. These three actions return `void` and
 * communicate by revalidating the page: the saved values reappear in the
 * form's own defaultValues. Nothing needs rendering from the result, so the
 * pending flag is the whole requirement.
 *
 * CRITICAL CONSTRAINT: useFormStatus reads the status of the nearest enclosing
 * <form>, and ONLY from a component rendered INSIDE that form. A hook called
 * in the same component that renders the <form> always reports pending:false.
 * That is why this is its own component rather than a few lines inline, and
 * the compliance test asserts it is never called in a file that also renders
 * the form element it is meant to be watching.
 */

import { useFormStatus } from "react-dom";

import { Button, type ButtonVariant } from "@/components/admin/ui/Button";

export function SaveButton({
  /** The idle label. What the button says when nothing is happening. */
  label,
  /**
   * The busy label. What it says while the action is in flight.
   *
   * Required, not defaulted. A default would let a caller ship a button that
   * says "Save settings" during both states, which is the bug this component
   * exists to prevent, and it would do so silently.
   */
  busyLabel,
  /** Matches the variant the plain buttons used, so nothing changes visually. */
  variant = "save",
}: {
  label: string;
  busyLabel: string;
  /**
   * The REAL ButtonVariant union, imported rather than retyped.
   *
   * The first draft of this file hand-copied the list and immediately got it
   * wrong -- it offered "secondary", which this design system does not have
   * (the dark chip is called "neutral"). Importing the type means a variant
   * added or renamed in Button.tsx cannot leave a stale copy behind here.
   */
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      // Disabled is not decoration. Without it, an owner who sees no response
      // presses again, and a second submit fires the same action twice.
      disabled={pending}
      // aria-busy, not just a spinner: the spinner is invisible to a screen
      // reader, and this panel is operated at a counter.
      aria-busy={pending}
    >
      {pending ? (
        <>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
          />
          {busyLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
