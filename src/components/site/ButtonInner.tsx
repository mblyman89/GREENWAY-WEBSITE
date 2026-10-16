import type { ButtonFx } from "@/lib/cms/button-fx-core";

/**
 * R56-S4 — what goes inside a designed button: optional icon (left / right /
 * icon-only) + the label. Shared by the public banner and the Studio canvas so
 * both look identical. Icon-only buttons keep the label for screen readers
 * (visually hidden), so the link always has an accessible name.
 */
export function ButtonInner({ btn }: { btn: ButtonFx & { label: string } }) {
  const icon = btn.iconPath ? (
    <svg viewBox="0 0 256 256" width="1.25em" height="1.25em" style={{ display: "block", flexShrink: 0 }} aria-hidden="true" focusable="false">
      <path d={btn.iconPath} fill="currentColor" />
    </svg>
  ) : null;
  if (icon && btn.iconPos === "only")
    return (
      <>
        {icon}
        <span className="sr-only">{btn.label}</span>
      </>
    );
  return (
    <>
      {btn.iconPos !== "right" ? icon : null}
      <span>{btn.label}</span>
      {btn.iconPos === "right" ? icon : null}
    </>
  );
}
