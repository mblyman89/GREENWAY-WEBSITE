"use client";

/**
 * Phase 5 (G-54): the Terminate button asks once before it runs, and the
 * question names what will happen to the sign-in and the schedule based on
 * the boxes ticked at the moment of the click (owner D71; G-54 requirement 1
 * "default on, with a confirmation").
 */
import { Button } from "@/components/admin/ui";

export function TerminateSubmitButton({ name, signInEmail }: { name: string; signInEmail: string | null }) {
  return (
    <Button
      type="submit"
      size="sm"
      variant="danger"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLButtonElement).form;
        const deact = form?.querySelector<HTMLInputElement>('input[name="deactivate_sign_in"]')?.checked ?? false;
        const shifts = form?.querySelector<HTMLInputElement>('input[name="delete_shifts"]')?.checked ?? false;
        const lines = [`Terminate ${name}? Their clock PIN is cleared now.`];
        if (signInEmail) {
          lines.push(
            deact
              ? `Their sign-in ${signInEmail} will be deactivated and banned.`
              : `Their sign-in ${signInEmail} will stay ACTIVE (you unticked the box).`,
          );
        }
        if (shifts) lines.push("Scheduled shifts after the last day will be deleted.");
        if (!window.confirm(lines.join("\n\n"))) e.preventDefault();
      }}
    >
      Terminate
    </Button>
  );
}
