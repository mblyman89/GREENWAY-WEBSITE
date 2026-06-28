/**
 * SafeData — a tiny wrapper so a failing database read (missing table, RLS
 * denial, network blip) NEVER crashes an admin page. Instead of throwing, the
 * page gets back `{ ok, data, error }` and can render a friendly ErrorState.
 *
 * This formalizes the defensive pattern applied to the menu-import pages
 * (PR #44) so every page can adopt it consistently.
 *
 * Usage (server component):
 *   const versions = await safeData(() => listVersions(30), []);
 *   if (!versions.ok) {
 *     return <ErrorState hint="Your menu tables aren't set up yet." detail={versions.error} />;
 *   }
 *   // versions.data is the value, or the fallback if it failed.
 *
 * For loading several reads at once and surfacing the first failure:
 *   const r = await safeAll({
 *     published: () => getPublishedVersion(),
 *     versions: () => listVersions(30),
 *     imports: () => listImports(30),
 *   }, { published: null, versions: [], imports: [] });
 *   if (!r.ok) return <ErrorState detail={r.error} />;
 *   const { published, versions, imports } = r.data;
 */

export type SafeResult<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

function toMessage(err: unknown, fallback = "Something went wrong loading this data."): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    // Supabase PostgrestError shape: { message, details, hint, code }
    const e = err as { message?: string; details?: string; hint?: string };
    if (e.message) return e.message;
    if (e.details) return e.details;
    if (e.hint) return e.hint;
  }
  return fallback;
}

/**
 * Run a single async read. On any throw, returns the fallback with ok=false.
 */
export async function safeData<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, error: null };
  } catch (err) {
    console.error("[safe-data] read failed:", err);
    return { ok: false, data: fallback, error: toMessage(err) };
  }
}

type ReaderMap = Record<string, () => Promise<unknown>>;
type ResolvedMap<M extends ReaderMap> = {
  [K in keyof M]: Awaited<ReturnType<M[K]>>;
};

/**
 * Run several reads in parallel. If ANY fails, ok=false and `error` holds the
 * first error message, but every key still resolves (to its real value or the
 * provided fallback) so the page can render partial data safely.
 */
export async function safeAll<M extends ReaderMap>(
  readers: M,
  fallbacks: ResolvedMap<M>,
): Promise<SafeResult<ResolvedMap<M>>> {
  const keys = Object.keys(readers) as (keyof M)[];
  const results = await Promise.all(
    keys.map((k) => safeData(readers[k], fallbacks[k])),
  );

  const data = {} as ResolvedMap<M>;
  let firstError: string | null = null;
  results.forEach((r, i) => {
    const key = keys[i];
    data[key] = r.data as ResolvedMap<M>[typeof key];
    if (!r.ok && firstError === null) firstError = r.error;
  });

  return { ok: firstError === null, data, error: firstError };
}
