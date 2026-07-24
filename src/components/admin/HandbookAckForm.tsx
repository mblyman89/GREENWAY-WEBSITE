"use client";

/**
 * src/components/admin/HandbookAckForm.tsx  (SLICE 36)
 *
 * The acknowledgment form at the bottom of the handbook gate screen: the
 * staff member types their full legal name, checks the box confirming they
 * READ the handbook and WILL ABIDE by it, and submits. On success the router
 * refreshes so the admin layout gate re-evaluates and lets them through.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/admin/ui";
import { acknowledgeHandbookAction, type HandbookAckResult } from "@/app/admin/handbook-ack-actions";

export function HandbookAckForm({ version }: { version: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<HandbookAckResult | null, FormData>(
    acknowledgeHandbookAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="Your full legal name"
        help="Typed in place of a signature — it is stored with your acknowledgment."
      >
        <Input name="acknowledged_name" required minLength={2} maxLength={120} placeholder="First Last" />
      </Field>
      <label className="flex items-start gap-3 text-sm leading-relaxed text-[var(--admin-text)]">
        <input type="checkbox" name="agree" required className="mt-1 h-4 w-4 accent-emerald-500" />
        <span>
          I confirm that I have read the Greenway Marijuana Employee Handbook (version {version}) in
          full, I understand it, and I agree to abide by its policies, standards, and rules as a
          condition of my access to the back office and the registers.
        </span>
      </label>
      {state && !state.ok && (
        <p className="text-sm text-red-400" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Recording…" : "I have read the handbook and agree"}
      </Button>
    </form>
  );
}
