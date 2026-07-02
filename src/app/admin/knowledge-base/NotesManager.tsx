"use client";

import { useState } from "react";
import { Button } from "@/components/admin/ui/Button";
import type { KbNoteRow } from "@/lib/ai/kb/store";
import { upsertKbNoteAction, toggleKbNoteAction } from "./actions";

const inputCls =
  "mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const labelCls = "block text-xs font-medium text-[var(--admin-text-muted)]";

export function NotesManager({
  notes,
  migrated,
}: {
  notes: KbNoteRow[];
  migrated: boolean;
}) {
  const [editing, setEditing] = useState<KbNoteRow | null>(null);

  if (!migrated) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
        Apply migration <code>0056_kb_notes.sql</code> in Supabase to enable owner-uploaded
        reference notes.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--admin-text-muted)]">
        Drop in your own reference material — house style, how you describe your exclusive drops,
        vendor quirks, store policy language. Leave <strong>tags</strong> blank for a general note
        (used on every product), or tag it with a strain, category, brand, or vendor so it only
        applies to matching products. Everything here still follows the same WA I-502 rules — keep
        it sensory / marketing / policy, never medical or effect claims.
      </p>

      {/* Add / edit form */}
      <form
        action={upsertKbNoteAction}
        className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
      >
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="note_title">
              Title <span className="text-[var(--admin-danger)]">*</span>
            </label>
            <input
              id="note_title"
              name="title"
              className={inputCls}
              maxLength={120}
              required
              defaultValue={editing?.title ?? ""}
              placeholder="e.g. House voice for exclusive drops"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="note_tags">
              Tags <span className="text-[var(--admin-text-faint)]">(optional, comma-separated)</span>
            </label>
            <input
              id="note_tags"
              name="tags"
              className={inputCls}
              defaultValue={(editing?.tags ?? []).join(", ")}
              placeholder="gelato, flower, constellation cannabis"
            />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="note_body">
            Note <span className="text-[var(--admin-danger)]">*</span>
          </label>
          <textarea
            id="note_body"
            name="body"
            rows={4}
            maxLength={4000}
            required
            className={inputCls}
            defaultValue={editing?.body ?? ""}
            placeholder="The reference text the AI is allowed to draw from…"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="note_source">
            Source <span className="text-[var(--admin-text-faint)]">(optional)</span>
          </label>
          <input
            id="note_source"
            name="source"
            className={inputCls}
            defaultValue={editing?.source ?? ""}
            placeholder="Where this came from (e.g. our brand guide)"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="save" size="sm">
            {editing ? "Save changes" : "Add note"}
          </Button>
          {editing ? (
            <Button type="button" variant="neutral" size="sm" onClick={() => setEditing(null)}>
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>

      {/* Existing notes */}
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--admin-text-faint)]">No reference notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--admin-text)]">{n.title}</span>
                    {!n.active ? (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">
                        hidden
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--admin-text-muted)]">{n.body}</p>
                  {(n.tags ?? []).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(n.tags ?? []).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-[var(--admin-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--admin-accent)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] italic text-[var(--admin-text-faint)]">
                      General note — applies to every product.
                    </p>
                  )}
                  {n.source ? (
                    <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">Source: {n.source}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Button type="button" variant="neutral" size="sm" onClick={() => setEditing(n)}>
                    Edit
                  </Button>
                  <form action={toggleKbNoteAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="active" value={(!n.active).toString()} />
                    <Button type="submit" variant="neutral" size="sm">
                      {n.active ? "Hide" : "Use"}
                    </Button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
