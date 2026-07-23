"use client";

/**
 * MediaAltField — the alt-text input on the media detail page plus a
 * "✨ Suggest alt text" button (drafts-only AI). The suggestion fills the field
 * for the staffer to review/edit; saving still happens via the existing
 * updateMediaMetaAction form this field lives inside.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
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
        const how = res.method === "vision" ? "AI looked at the image" : "AI used the image's details";
        toast({
          tone: res.complianceFlags.length > 0 ? "warning" : "success",
          message:
            res.complianceFlags.length > 0
              ? `${how} — ${res.complianceFlags.length} compliance flag(s) to review.`
              : `${how} — review and save.`,
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
          <Button type="button" onClick={onSuggest} disabled={pending} variant="special" size="sm">
            {pending ? "…thinking" : "✨ Suggest alt text"}
          </Button>
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
