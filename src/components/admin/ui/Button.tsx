import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Button — the one button used across the back office.
 *
 * DESIGN (owner-approved, grounded in the public site's button DNA):
 *   - SOLID fills only. No transparent / ghost / bordered-outline buttons.
 *   - Pill shape (rounded-full), UPPERCASE, bold — mirrors the public site's
 *     signature CTA (`rounded-full bg-[var(--orange)] text-black font-black
 *     uppercase tracking-[0.14em]`).
 *   - Only the four brand colors carry meaning; a neutral SOLID dark chip is
 *     used for plain secondary/navigation actions (never white, never
 *     transparent).
 *
 * COLOR MAPPING (binding — see docs/TODO_BEAUTIFICATION.md):
 *   primary  → ORANGE : the main call-to-action (the thing you came to do).
 *   confirm  → GREEN  : positive / publish / approve / go / start.
 *   save     → GOLD   : save draft / save settings (persist without publishing).
 *   danger   → RED    : destructive (delete, reject, discard).
 *   neutral  → solid dark chip : secondary / cancel / back navigation.
 *
 * Renders as a <button> by default, or an <a>/<Link> when `href` is passed.
 * Server-component friendly (no client hooks).
 */

export type ButtonVariant =
  | "primary" // orange — main CTA
  | "confirm" // green — publish / approve / go
  | "save" // gold — save draft / settings
  | "danger" // red — destructive
  | "neutral"; // solid dark chip — secondary / cancel / back

export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "admin-focus inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-black uppercase tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-40";

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-[0.7rem]",
  md: "px-5 py-2.5 text-xs",
  lg: "px-7 py-3 text-sm",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--admin-orange)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110 active:brightness-95",
  confirm:
    "bg-[var(--admin-accent)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110 active:brightness-95",
  save: "bg-[var(--admin-gold)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110 active:brightness-95",
  danger:
    "bg-[var(--admin-danger)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110 active:brightness-95",
  neutral:
    "bg-[var(--admin-surface-2)] text-[var(--admin-text)] shadow-[var(--admin-shadow-sm)] hover:bg-[var(--admin-surface-hover)] active:brightness-95",
};

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof CommonProps | "type"> & {
    href?: undefined;
    type?: "button" | "submit" | "reset";
  };

type ButtonAsLink = CommonProps &
  Omit<ComponentPropsWithoutRef<"a">, keyof CommonProps | "href"> & {
    href: string;
    external?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function classes(p: CommonProps) {
  return [
    BASE,
    SIZES[p.size ?? "md"],
    VARIANTS[p.variant ?? "primary"],
    p.fullWidth ? "w-full" : "",
    p.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button(props: ButtonProps) {
  const { variant, size, fullWidth, leftIcon, rightIcon, className, children } =
    props;
  const inner = (
    <>
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span>{children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </>
  );
  const cls = classes({ variant, size, fullWidth, className, children });

  if ("href" in props && props.href !== undefined) {
    const { href, external, ...rest } = props as ButtonAsLink;
    // strip the styling-only keys so they don't leak onto the anchor
    delete (rest as Record<string, unknown>).variant;
    delete (rest as Record<string, unknown>).size;
    delete (rest as Record<string, unknown>).fullWidth;
    delete (rest as Record<string, unknown>).leftIcon;
    delete (rest as Record<string, unknown>).rightIcon;
    delete (rest as Record<string, unknown>).className;
    if (external) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className={cls} {...rest}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} {...rest}>
        {inner}
      </Link>
    );
  }

  const { type = "button", ...rest } = props as ButtonAsButton;
  delete (rest as Record<string, unknown>).variant;
  delete (rest as Record<string, unknown>).size;
  delete (rest as Record<string, unknown>).fullWidth;
  delete (rest as Record<string, unknown>).leftIcon;
  delete (rest as Record<string, unknown>).rightIcon;
  delete (rest as Record<string, unknown>).className;
  return (
    <button type={type} className={cls} {...rest}>
      {inner}
    </button>
  );
}
