/**
 * Greenway admin UI kit — token-driven, brand-styled primitives for the back
 * office. One import site:
 *
 *   import { Button, Card, CardHeader, Field, Input, Section, Badge } from "@/components/admin/ui";
 *
 * These read the --admin-* design tokens in globals.css so the whole back
 * office stays visually consistent. For status pills, empty/error/loading
 * states, toasts, tooltips, etc. see the companion kit @/components/admin/ux.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { Card, CardHeader, type CardPadding } from "./Card";
export {
  Field,
  Input,
  Textarea,
  Select,
  controlClassName,
  labelClassName,
} from "./Field";
export { Section } from "./Section";
export { Badge, type BadgeTone } from "./Badge";
