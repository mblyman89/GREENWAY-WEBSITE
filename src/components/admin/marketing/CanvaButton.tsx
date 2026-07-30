import { Button } from "@/components/admin/ui/Button";
import { resolveCanvaUrl } from "@/lib/marketing/canva-core";

/**
 * CanvaButton — a "Jump to Canva" button for the Blog & Newsletter admin.
 *
 * SLICE 115. HONEST behavior (verified against Canva's docs, not guessed):
 *   - Canva can't be auto-logged-in from a URL or an env-var password. Login
 *     happens in the browser. This button simply OPENS Canva in a new tab; if
 *     Michael is already signed in (he stays signed in), it lands right there.
 *   - The destination is owner-configurable via the Vercel env var
 *     NEXT_PUBLIC_CANVA_URL (e.g. his team home, a brand kit, or a specific
 *     template). It defaults to the Canva dashboard and safely ignores any
 *     value that isn't an https canva.com URL.
 */
export function CanvaButton({ className }: { className?: string }) {
  const url = resolveCanvaUrl(process.env.NEXT_PUBLIC_CANVA_URL);
  return (
    <Button
      href={url}
      external
      variant="special"
      leftIcon={<span aria-hidden="true">🎨</span>}
      className={className}
    >
      Open Canva
    </Button>
  );
}
