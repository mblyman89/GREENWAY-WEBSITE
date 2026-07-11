"use server";

/**
 * "Ask the analyst" server actions (Task I, I7) — free-text Q&A over the SAME
 * persisted rollups the benchmarks pages render.
 *
 *  - askStatewideAnalystAction → the CCRS Benchmarks page's data (statewide
 *    benchmark rows + month-over-month history + per-type top movers).
 *  - askLocalAnalystAction → the Local Benchmarks report's data (per-competitor
 *    rollups + shared suppliers + statewide supplier benchmarks).
 *
 * HONESTY: the digest is built by the PURE benchmarks-ai-core module from
 * persisted rows only; no digest → an honest "nothing to analyze" message,
 * never a fabricated answer. Advisory only — nothing is changed.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getDataset } from "@/lib/discovery/ingest";
import { listBenchmarks } from "@/lib/discovery/benchmarks";
import {
  listCompetitorStats,
  listMarketSignals,
  listSupplierStats,
  listTransformerDatasets,
} from "@/lib/discovery/market-rollups";
import { listCompetitors } from "@/lib/discovery/competitors";
import { buildTransformerHistory } from "@/lib/discovery/benchmarks-history-core";
import { groupTypeMovers } from "@/lib/discovery/type-movers-core";
import { buildLocalBenchmarks } from "@/lib/discovery/local-benchmarks-core";
import { buildSupplierLeads } from "@/lib/discovery/market-leads-core";
import {
  buildStatewideAnalystDigest,
  buildLocalAnalystDigest,
  sanitizeAnalystQuestion,
  type AnalystAnswerResult,
  type AnalystHistoryRowLike,
  type AnalystTypeMoverGroupLike,
  type AnalystSupplierStatLike,
} from "@/lib/discovery/benchmarks-ai-core";
import {
  generateAnalystAnswer,
  isAiConfigured as isAnalystAiConfigured,
} from "@/lib/discovery/benchmarks-ai";

const NOT_CONFIGURED =
  "AI isn't set up yet. Add an AI_API_KEY (or OPENAI_API_KEY) in your environment to enable the analyst. The benchmarks work without it.";

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : "The analyst hit an unexpected error.";
  return message;
}

export async function askStatewideAnalystAction(
  formData: FormData,
): Promise<AnalystAnswerResult> {
  const session = await requirePermission("inventory.manage");

  if (!isAnalystAiConfigured) return { ok: false, error: NOT_CONFIGURED };

  const question = sanitizeAnalystQuestion(formData.get("question"));
  if (!question) return { ok: false, error: "Type a question first." };

  const datasetId = String(formData.get("dataset_id") ?? "").trim();
  if (!datasetId) return { ok: false, error: "Missing dataset id." };
  const dataset = await getDataset(datasetId);
  if (!dataset) return { ok: false, error: "Dataset not found." };

  try {
    const benchmarks = await listBenchmarks(dataset.id);

    // Month-over-month history + per-type movers — best-effort, like the page.
    let history: AnalystHistoryRowLike[] = [];
    try {
      const datasets = await listTransformerDatasets();
      const overallRows = (
        await Promise.all(datasets.map((d) => listBenchmarks(d.id, { scope: "overall" })))
      ).flat();
      history = buildTransformerHistory(datasets, overallRows);
    } catch {
      history = [];
    }
    let typeMovers: AnalystTypeMoverGroupLike[] = [];
    try {
      typeMovers = groupTypeMovers(await listMarketSignals(dataset.id, "type_mover"));
    } catch {
      typeMovers = [];
    }

    const digest = buildStatewideAnalystDigest({ dataset, benchmarks, history, typeMovers });
    if (!digest) {
      return {
        ok: false,
        error:
          "This dataset has no persisted benchmark rollups to analyze yet. Compute benchmarks (or re-upload the monthly zip) first.",
      };
    }

    const answer = await generateAnalystAnswer(question, digest, {
      actorId: session.userId,
      actorEmail: session.email,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "discovery.benchmarks_analyst",
      entityType: "discovery_datasets",
      entityId: dataset.id,
      after: { surface: "statewide", model: answer.model, question },
    });

    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

export async function askLocalAnalystAction(formData: FormData): Promise<AnalystAnswerResult> {
  const session = await requirePermission("reports.view");

  if (!isAnalystAiConfigured) return { ok: false, error: NOT_CONFIGURED };

  const question = sanitizeAnalystQuestion(formData.get("question"));
  if (!question) return { ok: false, error: "Type a question first." };

  const datasetId = String(formData.get("dataset_id") ?? "").trim();
  if (!datasetId) return { ok: false, error: "Missing dataset id." };
  const dataset = await getDataset(datasetId);
  if (!dataset) return { ok: false, error: "Dataset not found." };

  try {
    const [stats, roster] = await Promise.all([
      listCompetitorStats(dataset.id),
      listCompetitors(),
    ]);
    const { competitors, areas } = buildLocalBenchmarks(stats, roster);
    const sharedSuppliers = buildSupplierLeads(stats, roster).filter(
      (s) => s.suppliesMultipleCompetitors,
    );

    // S10 statewide supplier benchmarks — best-effort (pre-0109 has no rows).
    let supplierStats: AnalystSupplierStatLike[] = [];
    try {
      supplierStats = await listSupplierStats(dataset.id);
    } catch {
      supplierStats = [];
    }

    const digest = buildLocalAnalystDigest({
      dataset,
      areas,
      competitors,
      sharedSuppliers,
      supplierStats,
    });
    if (!digest) {
      return {
        ok: false,
        error:
          "This dataset has no persisted local competitor rollups to analyze. Upload a monthly CCRS zip in Product Discovery → CCRS Benchmarks first.",
      };
    }

    const answer = await generateAnalystAnswer(question, digest, {
      actorId: session.userId,
      actorEmail: session.email,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "discovery.benchmarks_analyst",
      entityType: "discovery_datasets",
      entityId: dataset.id,
      after: { surface: "local", model: answer.model, question },
    });

    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}
