/**
 * src/components/admin/ai/AiSection.tsx
 *
 * The consistent "✨ AI" panel used across the back office. Renders a titled,
 * green-tinted section with an optional "Not set up" badge when AI is
 * unconfigured, a short description, and either the children (the AI controls)
 * or a friendly "add an AI key" hint.
 *
 * Server-safe presentational wrapper so every AI surface looks identical.
 */
import type { ReactNode } from "react";

export function AiSection({
  id,
  title = "✨ AI assist",
  description,
  configured,
  children,
  notConfiguredHint = "Add an AI_API_KEY to enable AI drafting (see the email/AI setup docs).",
}: {
  id?: string;
  title?: string;
  description?: ReactNode;
  configured: boolean;
  children: ReactNode;
  notConfiguredHint?: ReactNode;
}) {
  return (
    <section
      id={id}
      className="space-y-4 rounded-xl border border-[#7ed957]/20 bg-[#7ed957]/[0.03] p-5"
    >
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span>{title}</span>
          {!configured && (
            <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">
              Not set up
            </span>
          )}
        </h2>
        {description && <p className="mt-1 text-xs text-white/50">{description}</p>}
      </div>

      {configured ? (
        children
      ) : (
        <p className="rounded-lg border border-[#ffd700]/20 bg-[#ffd700]/5 px-3 py-2 text-xs text-[#ffd700]">
          {notConfiguredHint}
        </p>
      )}
    </section>
  );
}
