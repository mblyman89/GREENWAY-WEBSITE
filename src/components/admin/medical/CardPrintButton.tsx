"use client";

/**
 * CardPrintButton — Task P. Opens the browser print dialog for the recognition
 * card companion page. Client island: window.print() can't run in a server
 * component, and the previous inline <script> approach required rendering a
 * nested <html> document which crashed the page (the "blank print page" bug).
 */
import { Button } from "@/components/admin/ui";

export function CardPrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} variant="confirm" size="sm">
      🖨 Print this card
    </Button>
  );
}
