"use client";

import { Button } from "@/components/admin/ui";

/** Print the handbook — the page's print styles strip the admin chrome. */
export function PrintHandbookButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      🖨 Print
    </Button>
  );
}
