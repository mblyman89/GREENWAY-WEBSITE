#!/usr/bin/env python3
"""
Refactor the books-12 hub onto the shared admin UI kit.

Michael asked for "our themes and styles and fonts and buttons". Hand-rolled
control classes drift the moment a token changes in globals.css: the kit reads
--admin-border-strong / --admin-surface-2 / --admin-text, the copies I wrote
read white/10 and black/30. They look close today and diverge on the first
theme edit.

Field/Input/Textarea also carry `admin-focus`, which is the back office's
keyboard focus ring. Hand-rolled controls dropped it, so the count sheet was
quietly less accessible than every other screen - and a count sheet is used
one-handed, standing at a shelf.

The radio in AuditVarianceReview is left raw ON PURPOSE: `controlClassName` is
w-full, which is right for a text box and wrong for a radio button.
"""

import pathlib
import sys

CHANGES = 0


def patch(rel: str, pairs: list[tuple[str, str]]) -> None:
    global CHANGES
    p = pathlib.Path(rel)
    s = p.read_text()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print(f"  !! {rel}: anchor appears {n}x (need 1): {old[:70]!r}")
            sys.exit(1)
        s = s.replace(old, new, 1)
        CHANGES += 1
    p.write_text(s)
    print(f"  patched {rel}")


AUD = "src/app/admin/inventory/audits"

# ---------------------------------------------------------------- new/page.tsx
patch(
    f"{AUD}/new/page.tsx",
    [
        (
            'import { Badge, Button } from "@/components/admin/ui";',
            'import { Badge, Button, Field, Input, Textarea } from "@/components/admin/ui";',
        ),
        (
            """              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  What to call this count
                </span>
                <input
                  name="label"
                  required
                  defaultValue={defaultLabel()}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]/60"
                  placeholder="Flower back stock, August"
                />
                <span className="mt-1 block text-xs text-[var(--admin-text-muted)]">
                  &ldquo;Flower back stock, August&rdquo; beats &ldquo;Audit 4&rdquo;.
                </span>
              </label>""",
            """              <Field
                label="What to call this count"
                htmlFor="audit-label"
                required
                help={"\\u201CFlower back stock, August\\u201D beats \\u201CAudit 4\\u201D."}
              >
                <Input
                  id="audit-label"
                  name="label"
                  required
                  defaultValue={defaultLabel()}
                  placeholder="Flower back stock, August"
                />
              </Field>""",
        ),
        (
            """              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Why these products &mdash; required
                </span>
                <textarea
                  name="scopeRationale"
                  required
                  minLength={10}
                  rows={3}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]/60"
                  placeholder="Highest value and longest since counted, plus every product holding more than one open lot."
                />
                <span className="mt-1 block text-xs text-[var(--admin-text-muted)]">
                  Written now, before any number is known. That is what makes the result evidence
                  instead of an opinion.
                </span>
              </label>""",
            """              <Field
                label="Why these products"
                htmlFor="audit-rationale"
                required
                help={
                  "Written now, before any number is known. That is what makes the result " +
                  "evidence instead of an opinion."
                }
              >
                <Textarea
                  id="audit-rationale"
                  name="scopeRationale"
                  required
                  minLength={10}
                  rows={3}
                  placeholder="Highest value and longest since counted, plus every product holding more than one open lot."
                />
              </Field>""",
        ),
    ],
)

# -------------------------------------------------------- AuditVarianceReview
patch(
    f"{AUD}/AuditVarianceReview.tsx",
    [
        (
            'import { Badge } from "@/components/admin/ui";',
            'import { Badge, Button, Textarea } from "@/components/admin/ui";',
        ),
        (
            """      <textarea
        name="reasonNote"
        rows={2}
        placeholder="One sentence of detail. 'Jar cracked in transit' is enough."
        className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-[var(--admin-accent)]/60"
      />""",
            """      <Textarea
        name="reasonNote"
        rows={2}
        placeholder="One sentence of detail. 'Jar cracked in transit' is enough."
        className="mt-2 text-xs"
      />""",
        ),
        (
            """      <button
        type="submit"
        className="mt-2 rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--admin-accent)]/25"
      >""",
            """      <Button type="submit" variant="confirm" size="sm" className="mt-2">""",
        ),
    ],
)

# ------------------------------------------------------------- AuditCountSheet
patch(
    f"{AUD}/AuditCountSheet.tsx",
    [
        (
            'import { Badge, Button } from "@/components/admin/ui";',
            'import { Badge, Button, Field, Input } from "@/components/admin/ui";',
        ),
        (
            """            placeholder="Scan or type a lot code, then press Enter"
            className="mt-3 w-full rounded-xl border border-[var(--admin-accent)]/40 bg-black/40 px-4 py-3 font-mono text-base text-white outline-none focus:border-[var(--admin-accent)]"
          />""",
            """            placeholder="Scan or type a lot code, then press Enter"
            className="mt-3 border-[var(--admin-accent)]/40 px-4 py-3 font-mono text-base"
          />""",
        ),
        (
            """          <input
            ref={scanRef}""",
            """          <Input
            ref={scanRef}""",
        ),
        (
            """                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    How many did you count
                  </span>
                  <input
                    ref={qtyRef}
                    name="qty"
                    type="number"
                    step="any"
                    min="0"
                    required
                    className="mt-1.5 w-40 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-base text-white outline-none focus:border-[var(--admin-accent)]/60"
                  />
                </label>""",
            """                <Field label="How many did you count" htmlFor="count-qty" required>
                  <Input
                    ref={qtyRef}
                    id="count-qty"
                    name="qty"
                    type="number"
                    step="any"
                    min="0"
                    required
                    className="w-40 text-base"
                  />
                </Field>""",
        ),
    ],
)

print(f"\\n{CHANGES} substitutions applied.")
