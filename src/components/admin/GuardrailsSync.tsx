"use client";

/**
 * D244 R-23: hands the owner's Compliance guardrails settings (Knowledge base
 * -> Compliance guardrails) to every check that runs in the browser - the
 * promotion copy check, the banner ad check, the newsletter canvas and
 * picture checks, the merch ad checks. The settings are the same for every
 * staff member (one site_settings row), so a module-level value is safe.
 *
 * It is rendered in the admin layout BEFORE the page, so React applies the
 * settings before any page component runs its checks.
 */
import { setActiveGuardrails, type GuardrailSettings } from "@/lib/ai/guardrails-state-core";

export function GuardrailsSync({ settings }: { settings: GuardrailSettings }) {
  setActiveGuardrails(settings);
  return null;
}
