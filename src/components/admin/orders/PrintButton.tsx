"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-black px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-black print:hidden"
    >
      Print
    </button>
  );
}
