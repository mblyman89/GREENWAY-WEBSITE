"use client";

/**
 * useFluxJobs — browser-driven polling for FLUX tasks (R62).
 *
 * The server submits tasks and returns BFL polling URLs; this hook re-checks
 * every pending task through checkFluxTasksAction (one short server call per
 * round, so 8 images or a several-minute video never hit a function time
 * limit). Finished files are saved server-side to the media library as drafts.
 * A beforeunload guard warns before leaving while paid jobs are still running.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { checkFluxTasksAction } from "@/app/admin/marketing/midjourney/actions";

export type FluxJob = {
  key: string;
  batch: string;
  kind: "image" | "video";
  prompt: string;
  pollingUrl?: string;
  state: "pending" | "ready" | "failed";
  label?: string;
  progress?: number;
  asset?: { id: string; url: string; filename: string; title: string };
  draftCache?: string;
  error?: string;
  seed?: number;
  cost?: number;
  meta?: string;
  startedAt: number;
};

const BATCH = 8; // server action accepts up to 8 checks per round

export function useFluxJobs(opts: { intervalMs: number; onSettled?: () => void }) {
  const [jobs, setJobs] = useState<FluxJob[]>([]);
  const busy = useRef(false);
  const jobsRef = useRef<FluxJob[]>([]);
  const settledRef = useRef(opts.onSettled);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  useEffect(() => {
    settledRef.current = opts.onSettled;
  }, [opts.onSettled]);

  const pendingCount = jobs.filter((j) => j.state === "pending" && j.pollingUrl).length;

  const tick = useCallback(async () => {
    if (busy.current) return;
    const pending = jobsRef.current.filter((j) => j.state === "pending" && j.pollingUrl).slice(0, BATCH);
    if (pending.length === 0) return;
    busy.current = true;
    try {
      const results = await checkFluxTasksAction(pending.map((j) => ({ pollingUrl: j.pollingUrl as string, kind: j.kind, prompt: j.prompt })));
      let finished = false;
      setJobs((prev) =>
        prev.map((j) => {
          const i = pending.findIndex((p) => p.key === j.key);
          if (i < 0) return j;
          const r = results[i];
          if (!r) return j;
          if (r.state === "pending") return { ...j, label: r.label ?? j.label, progress: r.progress ?? j.progress };
          finished = true;
          if (r.state === "ready") return { ...j, state: "ready", asset: r.asset, draftCache: r.draftCache, label: "Ready" };
          return { ...j, state: "failed", error: r.error };
        }),
      );
      if (finished) settledRef.current?.();
    } catch {
      // transient (network/redeploy) — the next round retries
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (pendingCount === 0) return;
    const id = window.setInterval(() => void tick(), opts.intervalMs);
    return () => window.clearInterval(id);
  }, [pendingCount, opts.intervalMs, tick]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingCount]);

  const add = useCallback((list: FluxJob[]) => setJobs((prev) => [...list, ...prev]), []);
  const remove = useCallback((key: string) => setJobs((prev) => prev.filter((j) => j.key !== key)), []);
  const clearFinished = useCallback(() => setJobs((prev) => prev.filter((j) => j.state === "pending")), []);

  return { jobs, add, remove, clearFinished, pendingCount };
}

let seq = 0;
/** Unique-enough key for a job row. */
export function jobKey(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}
