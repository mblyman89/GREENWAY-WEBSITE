import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Button — the one button used across the back office.
 *
 * Variants encode brand intent (research: green = go/publish, gold = save/draft,
 * subtle = secondary, ghost = tertiary, danger = destructive). Renders as a
 * <button> by default, or an <a>/<Link> when `href` is passed. Server-component
 * friendly (no client hooks).
 */

export type ButtonVariant =
  | "primary" // green — go / publish / confirm
  | "save" // gold — save draft
  | "subtle" // bordered neutral — secondary
  | "ghost" // text only — tertiary
  | "danger"; // destructive

export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "admin-focus inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

const SIZES: Record<ButtonSize, string> = {
  sm: "rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs",
  md: "rounded-[var(--admin-radius)] px-4 py-2 text-sm",
  lg: "rounded-[var(--admin-radius)] px-5 py-2.5 text-sm",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--admin-accent)] text-black hover:brightness-110 active:brightness-95 shadow-[var(--admin-shadow-sm)]",
  save: "bg-[var(--admin-gold)] text-black hover:brightness-110 active:brightness-95 shadow-[var(--admin-shadow-sm)]",
  subtle:
    "border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]",
  ghost:
    "text-[var(--admin-text-muted)] hover:bg-white/5 hover:text-[var(--admin-text)]",
  danger:
    "border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)] hover:bg-[var(--admin-danger)]/20",
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
