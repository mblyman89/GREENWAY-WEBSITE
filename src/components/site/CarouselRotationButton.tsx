/**
 * R45-S1: the W3C APG carousel "rotation control". It is a plain button whose
 * LABEL says what it will do ("Stop slide rotation" or "Start slide rotation").
 * APG says it carries no aria-pressed. It renders INLINE: the carousels put it at
 * the start of the bottom-centre dot row, and that row comes first in the DOM,
 * so the button is first in Tab order (APG) without covering slide text or the
 * banner-video pause button (top-right by default, BannerVideo.tsx).
 * 24x24 px meets WCAG 2.2 SC 2.5.8 Target Size (Minimum).
 */
export function CarouselRotationButton({
  rotating,
  onClick,
  "aria-label": label,
  type = "button",
}: {
  rotating: boolean;
  onClick: () => void;
  "aria-label": string;
  type?: "button";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-gw-rotation={rotating ? "on" : "off"}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold,#d4af37)]"
    >
      {rotating ? (
        // Pause bars: rotation is on, so pressing stops it.
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
          <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
          <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
        </svg>
      ) : (
        // Play triangle: rotation is off, so pressing starts it.
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
          <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
