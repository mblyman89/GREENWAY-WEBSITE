"use client";

/**
 * MediaAltField — the alt-text input on the media detail page plus a
 * "✨ Suggest alt text" button (drafts-only AI). The suggestion fills the field
 * for the staffer to review/edit; saving still happens via the existing
 * updateMediaMetaAction form this field lives inside.
 */
import { useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { suggestMediaAltAction } from "@/app/admin/media/actions";

export function MediaAltField({
  id,
  initial,
  aiEnabled,
  fieldClassName,
  labelClassName,
}: {
  id: string;
  initial: string;
  aiEnabled: boolean;
  fieldClassName: string;
  labelClassName: string;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();

  function onSuggest() {
    start(async () => {
      const res = await suggestMediaAltAction(id);
      if (res.ok) {
        setValue(res.value);
        toast({
          tone: res.complianceFlags.length > 0 ? "warning" : "success",
          message:
            res.complianceFlags.length > 0
              ? `Alt text suggested — ${res.complianceFlags.length} compliance flag(s) to review.`
              : "Alt text suggested — review and save.",
        });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className={labelClassName}>Alt text (for accessibility &amp; SEO)</span>
        {aiEnabled && (
          <button
            type="button"
            onClick={onSuggest}
            disabled={pending}
            className="rounded-md border border-[#ffd700]/40 px-2 py-0.5 text-[0.7rem] font-bold text-[#ffd700] transition hover:bg-[#ffd700]/10 disabled:opacity-50"
          >
            {pending ? "…thinking" : "✨ Suggest alt text"}
          </button>
        )}
      </span>
      <input
        name="alt_text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={fieldClassName}
      />
    </label>
  );
}
