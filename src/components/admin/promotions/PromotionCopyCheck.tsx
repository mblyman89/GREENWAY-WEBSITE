"use client";

/**
 * D135 — live WARN-AND-SUGGEST wording check inside the promotion form.
 *
 * Reads the surrounding <form>'s current values on every change (the form is
 * server-rendered with plain inputs, so this island just listens) and runs
 * the pure checkPromotionCopy. It never blocks saving or publishing — owner:
 * "not block, just warn and suggest."
 */
import { useEffect, useRef, useState } from "react";
import { checkPromotionCopy, summarizeCopyFindings, type CopyFinding } from "@/lib/promotions/promotion-copy-core";
import { copyInputFromForm } from "@/lib/promotions/promotion-copy-form-core";

export function PromotionCopyCheck({ knownBrands }: { knownBrands: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [findings, setFindings] = useState<CopyFinding[]>([]);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const fd = new FormData(form);
      const input = copyInputFromForm(
        (k) => {
          const v = fd.get(k);
          return v == null ? null : String(v);
        },
        (k) => fd.getAll(k).map(String),
      );
      setFindings(checkPromotionCopy({ ...input, knownBrands }));
    };
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(run, 250);
    };
    run();
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    return () => {
      if (t) clearTimeout(t);
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
    };
  }, [knownBrands]);

  return (
    <div ref={ref} id="copy-check" data-testid="promotion-copy-check" className="space-y-2">
      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          findings.length ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-emerald-400/25 bg-emerald-400/5 text-emerald-200"
        }`}
        role="status"
        aria-live="polite"
      >
        <span className="font-semibold">Wording check: </span>
        {summarizeCopyFindings(findings)}
        {findings.length === 0 && (
          <span className="block text-white/45">
            Checks for &ldquo;free&rdquo;, health claims, anything aimed at kids, over-consumption, vendor sponsorship, and
            wording that doesn&apos;t match the deal&apos;s settings.
          </span>
        )}
      </div>
      {findings.length > 0 && (
        <ul className="space-y-1.5">
          {findings.map((f, n) => (
            <li key={`${f.label}-${f.found}-${n}`} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">
              <span className={`font-semibold ${f.kind === "legal" ? "text-amber-300" : "text-sky-200"}`}>
                {f.kind === "legal" ? "⚠ " : "ℹ "}
                {f.label}
              </span>{" "}
              <span className="text-white/50">
                found &ldquo;{f.found}&rdquo;{f.field !== "all" ? ` in ${f.field.replace("_", " ")}` : ""}
                {f.cite ? ` · ${f.cite}` : ""}
              </span>
              <span className="mt-0.5 block text-white/70">{f.why}</span>
              <span className="mt-0.5 block text-emerald-200/90">Suggestion: {f.suggest}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
