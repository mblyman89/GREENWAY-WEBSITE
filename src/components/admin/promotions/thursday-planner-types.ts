/**
 * thursday-planner-types.ts (PR-P6)
 *
 * Client-safe types + the pure percent clamp re-export for the ThursdayPlanner
 * island. A `"use server"` file may only export async functions, so the client
 * cannot import the action's `ThursdayPlanResult` type from it — we mirror the
 * shape here instead. `PlannedWeek` is re-exported from the pure planner core
 * (safe on the client). `clampGuidedPercent` is a pure helper reused for the
 * live preview.
 */
export type { PlannedWeek } from "@/lib/promotions/thursday-planner-core";
export { clampGuidedPercent } from "@/lib/promotions/guided-promotion-core";

/** Mirror of the server action's ThursdayPlanResult (client-safe). */
export type ThursdayPlanResultLike = {
  ok: boolean;
  scheduledCount: number;
  skippedCount: number;
  createdIds: string[];
  warnings: string[];
  error?: string;
};
