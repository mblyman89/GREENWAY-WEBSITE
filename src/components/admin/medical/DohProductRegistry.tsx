/**
 * DohProductRegistry — Task O (server component).
 *
 * Manage the durable DOH 246-70 product registry (migration 0113): which POS
 * products are verified compliant, and in which category. The category MUST
 * be read from the DOH logo on the PHYSICAL PACKAGE; the name-based hint here
 * is a suggestion only (drafts-only policy — a human confirms).
 *
 * Keyed by the STABLE POS product key so verification survives menu
 * re-imports. Search the live menu (?prodq=…), pick a product, pick the
 * category, save. Existing entries can be re-verified (upsert) or removed.
 */
import { Button, CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { listMedicalRegistry } from "@/lib/medical/sale-store";
import {
  DOH_CATEGORIES,
  DOH_CATEGORY_LABELS,
  DOH_CATEGORY_HELP,
  suggestDohCategory,
} from "@/lib/medical/medical-sale-core";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import { upsertDohProductAction, removeDohProductAction } from "@/app/admin/medical/actions";
import { Badge } from "@/components/admin/ui";

const CATEGORY_TONE: Record<string, "green" | "gold" | "neutral"> = {
  general_use: "green",
  high_thc: "gold",
  high_cbd: "neutral",
};

export async function DohProductRegistry({
  productQuery,
  errorMessage,
}: {
  productQuery: string;
  errorMessage: string | null;
}) {
  const registry = await listMedicalRegistry({ limit: 200 });
  const registeredKeys = new Set(registry.map((r) => r.pos_product_key));

  // Live-menu product search for the add form.
  let matches: { id: string; name: string; brand: string; category: string }[] = [];
  if (productQuery.trim()) {
    const menu = await loadLiveMenuAll();
    const needle = productQuery.trim().toLowerCase();
    matches = menu
      .filter(
        (m) =>
          m.name.toLowerCase().includes(needle) ||
          (m.brand ?? "").toLowerCase().includes(needle) ||
          m.id.toLowerCase().includes(needle),
      )
      .slice(0, 10)
      .map((m) => ({ id: m.id, name: m.name, brand: m.brand ?? "", category: m.category }));
  }

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          DOH-compliant products <span className="text-xs font-normal text-white/40">· chapter 246-70 WAC</span>
        </h2>
        <span className="text-xs text-white/40">{registry.length} verified</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-white/50">
        Verify the DOH logo + category on the PHYSICAL PACKAGE, then register the product here. Only registered
        products qualify for tax exemptions; High-THC products sell ONLY to cardholders. Verification is keyed by
        the stable POS product key and survives menu re-imports.
      </p>

      {errorMessage ? (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          {errorMessage}
        </p>
      ) : null}

      {/* Add / verify a product */}
      <div className="mt-4 rounded-lg border border-[var(--admin-border)] bg-black/20 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Register a product</p>
        <form method="GET" className="mt-2 flex gap-2">
          <input
            type="search"
            name="prodq"
            defaultValue={productQuery}
            placeholder="Search the live menu by product, brand, or key…"
            className="min-w-0 flex-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none"
          />
          <Button type="submit" variant="neutral" size="sm" className="shrink-0">
            Search
          </Button>
        </form>

        {productQuery.trim() ? (
          matches.length === 0 ? (
            <p className="mt-3 text-xs text-white/40">No menu products matched.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {matches.map((m) => {
                const hint = suggestDohCategory(m.name);
                const already = registeredKeys.has(m.id);
                return (
                  <li key={m.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white/90">{m.name}</p>
                        <p className="truncate text-xs text-white/40">
                          {m.brand || "no brand"} · {m.category} · <span className="font-mono">{m.id}</span>
                          {already ? " · already registered (saving re-verifies)" : ""}
                        </p>
                        {hint ? (
                          <p className="mt-1 text-xs text-[var(--admin-accent)]">
                            Suggestion: {DOH_CATEGORY_LABELS[hint.category]} — {hint.reason} Confirm from the
                            package.
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <form action={upsertDohProductAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="pos_product_key" value={m.id} />
                      <input type="hidden" name="product_name" value={m.name} />
                      <select
                        name="doh_category"
                        required
                        defaultValue={hint?.category ?? ""}
                        className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-2.5 py-1.5 text-xs text-[var(--admin-text)]"
                      >
                        <option value="" disabled>
                          DOH category (from the package)…
                        </option>
                        {DOH_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {DOH_CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        name="notes"
                        placeholder="Note (optional)"
                        className="min-w-0 flex-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-2.5 py-1.5 text-xs text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)]"
                      />
                      <button type="submit" className={`shrink-0 ${CHIP_ACTION}`}>
                        {already ? "Re-verify" : "Register"}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <div className="mt-3 grid gap-1 text-xs text-white/40">
            {DOH_CATEGORIES.map((c) => (
              <p key={c}>
                <span className="font-semibold text-white/60">{DOH_CATEGORY_LABELS[c]}:</span> {DOH_CATEGORY_HELP[c]}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Current registry */}
      {registry.length === 0 ? (
        <p className="mt-4 text-sm text-white/50">
          No products verified yet. Until a product is registered, its sales get NO medical tax exemption (and
          High-THC gating cannot apply).
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-white/40">
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">POS key</th>
                <th className="px-3 py-2 font-medium">DOH category</th>
                <th className="px-3 py-2 font-medium">Verified</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {registry.map((r) => (
                <tr key={r.id} className="border-b border-[var(--admin-border)]/50 last:border-0">
                  <td className="px-3 py-2 text-white/80">{r.product_name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-white/50">{r.pos_product_key}</td>
                  <td className="px-3 py-2">
                    <Badge tone={CATEGORY_TONE[r.doh_category] ?? "neutral"}>
                      {DOH_CATEGORY_LABELS[r.doh_category]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-white/50">
                    {new Date(r.verified_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <form action={removeDohProductAction}>
                      <input type="hidden" name="registry_id" value={r.id} />
                      <button type="submit" className={CHIP_NEUTRAL}>
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
