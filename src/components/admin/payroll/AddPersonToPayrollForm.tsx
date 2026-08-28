"use client";

/**
 * src/components/admin/payroll/AddPersonToPayrollForm.tsx   (books-87)
 *
 * ADD SOMEBODY WHO WORKS HERE — WITHOUT GIVING THEM A LOGIN.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "I would rather users be people who have access to the system, and be
 *    separate from employees. I want to create the employee in payroll/ W-4
 *    setup, then I will give them access to the back office if they need
 *    access to it."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FORM ASKS FOR A NAME AND NOTHING ELSE
 * ─────────────────────────────────────────────────────────────────────────
 * Because everything else it could ask for is already asked, properly, on the
 * screen this form sits on. Adding a second place to enter a Social Security
 * number, a work code or a pay rate would create two front doors to the same
 * record, and the two would drift.
 *
 * A name is the minimum that makes a person exist. The moment they exist, the
 * W-4 form on this page can be opened on them, and that form already has the
 * checklist, the highlighting and the refusals Michael asked for in books-25.
 * So this control does one thing and then gets out of the way.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────
 * It does not offer a "also give them a login" checkbox. That would rebuild the
 * exact coupling migration 0210 removes, in a friendlier costume. Granting
 * access is a separate decision on a separate screen with its own audit trail,
 * and the note under this form says so in plain words rather than leaving the
 * absence of the option to be discovered.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, Card, Field, Input } from "@/components/admin/ui";
import { addPersonAction } from "@/app/admin/books/payroll-setup/actions";

export function AddPersonToPayrollForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addPersonAction({ fullName: name });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Straight into their paperwork. Adding a person and then having to hunt
      // for them in a list is the kind of small friction that makes a screen
      // feel like it was built for the database rather than for the person
      // using it.
      setName("");
      router.push(`/admin/books/payroll-setup?employee=${result.employeeId}`);
    });
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            label="Full legal name"
            help="Exactly as it appears on their Social Security card — this is the name that goes on their W-2."
          >
            <Input
              name="full_name"
              value={name}
              placeholder="e.g. Jordan A. Smith"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </Field>
        </div>
        <Button
          variant="primary"
          onClick={submit}
          disabled={pending || name.trim().length === 0}
        >
          {pending ? "Adding…" : "Add person"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-3 py-2 text-sm leading-relaxed text-[var(--admin-text)]">
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-[var(--admin-text-faint)]">
        This adds somebody you employ and can pay. It does{" "}
        <strong className="text-[var(--admin-text-muted)]">not</strong> give them a login to
        this back office — being on payroll and being able to sign in are separate
        things. If this person also needs access, grant it afterwards under{" "}
        <span className="font-semibold text-[var(--admin-text-muted)]">Users</span>, where
        it is recorded as its own decision.
      </p>
    </Card>
  );
}
