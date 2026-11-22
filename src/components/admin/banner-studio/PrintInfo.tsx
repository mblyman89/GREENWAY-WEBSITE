"use client";

/** D263 S2 — print-mode dock label (replaces the computer/phone toggle). */
import type { DesignPrint } from "@/lib/cms/banner-design-core";
import { fmtIn } from "@/lib/printing/print-sizes-core";

export function PrintInfo({ print }: { print: DesignPrint }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/75">
      <span className="rounded-full bg-[var(--admin-accent)] px-3 py-1 font-bold text-black">
        🖨️ {fmtIn(print.w)} × {fmtIn(print.h)}
      </span>
      {print.bleed > 0 ? <span className="text-red-300">red dashes = cut line</span> : null}
      {print.safe > 0 ? <span className="text-emerald-300">green dashes = keep words inside</span> : null}
    </div>
  );
}
