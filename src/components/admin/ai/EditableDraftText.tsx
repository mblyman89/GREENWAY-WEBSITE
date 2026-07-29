"use client";

/**
 * src/components/admin/ai/EditableDraftText.tsx
 *
 * SLICE 88: "edit it right in the vendor page before accepting it" (owner).
 *
 * The draft value inside an AiDraftCard, with an ✎ Edit toggle. Read mode is
 * the exact prose paragraph the card always showed. Edit mode swaps in a
 * textarea named `editedValue` that is associated with the card's Accept
 * <form> via the HTML `form` attribute — so pressing "Accept & save" submits
 * the reviewer's text without nesting forms. When the reviewer never opens
 * the editor, no `editedValue` field exists on the form at all and the accept
 * action saves the original draft, exactly as before.
 *
 * The compliance re-scan at accept (S-4 gate) runs on WHATEVER text is
 * submitted — edited or not — so an edit can fix a blocked draft, and can
 * never sneak past the gate.
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";

export function EditableDraftText({
  value,
  formId,
}: {
  /** The stored draft text. */
  value: string;
  /** id of the Accept <form> the textarea should submit with. */
  formId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const changed = text.trim() !== value.trim();

  if (!editing) {
    return (
      <div>
        <p className="whitespace-pre-wrap text-sm text-white/85">{text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="neutral" size="sm" onClick={() => setEditing(true)}>
            ✎ Edit before accepting
          </Button>
          {changed && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-gold)]">
              edited — Accept saves your version
            </span>
          )}
        </div>
        {/* Carry the reviewer's edit through submit even in read mode. */}
        {changed && <input type="hidden" name="editedValue" form={formId} value={text} />}
      </div>
    );
  }

  return (
    <div>
      <textarea
        name="editedValue"
        form={formId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
        className="admin-focus w-full rounded-lg border border-[var(--admin-gold)]/40 bg-black/60 p-3 text-sm text-white/90"
        aria-label="Edit draft text before accepting"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="neutral" size="sm" onClick={() => setEditing(false)}>
          Done editing
        </Button>
        <Button
          type="button"
          variant="neutral"
          size="sm"
          onClick={() => setText(value)}
          disabled={!changed}
        >
          ↺ Reset to original
        </Button>
        <span className="text-[10px] text-white/40">
          {text.trim().length.toLocaleString()} characters
          {changed ? " · your edit will be compliance-checked when you accept" : ""}
        </span>
      </div>
    </div>
  );
}
