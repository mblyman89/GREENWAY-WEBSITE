"use client";

/**
 * src/components/admin/compliance/PendingSubmit.tsx  (W-2, 2026-10-30)
 *
 * A submit button for the CCRS hub forms that SHOWS it is working. The hub's
 * server actions (record success, mark uploaded, settle duplicates, record a
 * week) take seconds; a plain <button> gives no sign anything happened, so the
 * owner pressed again or thought the page was broken. Same bug class as
 * SaveButton (orders/SaveButton.tsx); this one keeps each button's own
 * classes so nothing changes visually until it is pressed.
 *
 * While pending: disabled (no double submit), aria-busy, spinner + busy label.
 */
import { useFormStatus } from "react-dom";

export function PendingSubmit({
  children,
  busy,
  className,
  disabled = false,
  testId,
}: {
  children: React.ReactNode;
  /** What the button says while the action runs (required: see SaveButton). */
  busy: string;
  className?: string;
  /** Off for a reason other than pending (for example a blocked week). */
  disabled?: boolean;
  testId?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      disabled={disabled || pending}
      aria-busy={pending}
      data-testid={testId}
    >
      {pending ? (
        <>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
          />
          {busy}
        </>
      ) : (
        children
      )}
    </button>
  );
}
