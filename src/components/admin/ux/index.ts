/**
 * Greenway admin UX kit — shared, brand-styled building blocks for the
 * back office. Import from a single place:
 *
 *   import { Tooltip, StatusPill, EmptyState, useToast } from "@/components/admin/ux";
 *
 * These components encode the team's design principles: plain language,
 * helper-everything, never-a-scary-screen, and confidence-through-feedback.
 */
export { Tooltip } from "./Tooltip";
export { InfoHint } from "./InfoHint";
export { HelpPanel } from "./HelpPanel";
export { EmptyState } from "./EmptyState";
export { ErrorState } from "./ErrorState";
export { StatusPill } from "./StatusPill";
export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonRows,
} from "./Skeleton";
export { Breadcrumbs, type Crumb } from "./Breadcrumbs";
export { ToastProvider, useToast } from "./Toast";
export { ConfirmDialog } from "./ConfirmDialog";
export { StickyActionBar } from "./StickyActionBar";
