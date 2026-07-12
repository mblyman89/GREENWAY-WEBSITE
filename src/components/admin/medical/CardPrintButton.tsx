"use client";

/**
 * CardPrintButton — Task P. Opens the browser print dialog for the recognition
 * card companion page. Client island: window.print() can't run in a server
 * component, and the previous inline <script> approach required rendering a
 * nested <html> document which crashed the page (the "blank print page" bug).
 */
export function CardPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
    >
      🖨 Print this card
    </button>
  );
}
