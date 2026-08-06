"use client";

/**
 * PromotionRuleBuilder — PR-P2. A client island inside the (server-rendered)
 * PromotionForm that lets the owner build a SelectionPredicate from attributes
 * (size, category, strain, brand, THC/CBD/price/weight ranges, cannabinoids,
 * ratio, low stock, on-sale, new arrival), resolve it against the LIVE menu via
 * resolvePredicateAction, and REVIEW the exact matched products WITH reasons
 * before applying — the validation table Michael asked for.
 *
 * "Apply as included products" writes hidden target_product inputs (same
 * mechanism as PromotionProductPicker) so the matched keys ride the normal form
 * submit. "Save as smart audience" persists the predicate by name for reuse.
 * Nothing prices anything until the form is submitted + published; the CCRS
 * below-cost hard block still runs server-side on publish.
 *
 * Deterministic only — resolution happens in promotion-selector-core, so the
 * matched list can never contain a product that isn't really in the menu.
 */
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  resolvePredicateAction,
  saveAudienceAction,
  listAudiencesAction,
} from "@/app/admin/promotions/actions";
import {
  SIZE_BUCKETS,
  SIZE_LABELS,
  CANNABINOIDS,
  CANNABINOID_LABELS,
  type SelectionPredicate,
  type SelectionMatch,
  type SizeBucket,
  type Cannabinoid,
} from "@/lib/promotions/promotion-selector-core";
import { formatMinorCurrency } from "@/lib/leafly/format";

type StrainOption = { value: string; label: string };
type SavedAudienceLite = { id: string; name: string; description: string | null; predicate: SelectionPredicate };

type Props = {
  categoryValues: string[];
  strainOptions: StrainOption[];
  brands: string[];
  /** Product keys already applied as includes (edit mode) — pre-seed hidden inputs. */
  initialAppliedKeys?: string[];
  initialAudiences?: SavedAudienceLite[];
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function numOrUndef(s: string): number | undefined {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

export function PromotionRuleBuilder({
  categoryValues,
  strainOptions,
  brands,
  initialAppliedKeys = [],
  initialAudiences = [],
}: Props) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // Predicate field state
  const [sizes, setSizes] = useState<SizeBucket[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [strainTypes, setStrainTypes] = useState<string[]>([]);
  const [brandSel, setBrandSel] = useState<string[]>([]);
  const [cannabinoids, setCannabinoids] = useState<Cannabinoid[]>([]);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [weightMin, setWeightMin] = useState("");
  const [weightMax, setWeightMax] = useState("");
  const [thcMin, setThcMin] = useState("");
  const [thcMax, setThcMax] = useState("");
  const [cbdMin, setCbdMin] = useState("");
  const [cbdMax, setCbdMax] = useState("");
  const [nameContains, setNameContains] = useState("");
  const [ratioOnly, setRatioOnly] = useState(false);
  const [lowStock, setLowStock] = useState(false);
  const [newArrival, setNewArrival] = useState(false);
  const [onSale, setOnSale] = useState<"" | "yes" | "no">("");

  // Results
  const [result, setResult] = useState<{ description: string; matched: SelectionMatch[]; totalMenu: number; warnings: string[] } | null>(null);

  // Applied keys (ride the form submit as target_product)
  const [appliedKeys, setAppliedKeys] = useState<string[]>(initialAppliedKeys);

  // Audiences
  const [audiences, setAudiences] = useState<SavedAudienceLite[]>(initialAudiences);
  const [audienceName, setAudienceName] = useState("");

  const predicate: SelectionPredicate = useMemo(() => {
    const p: SelectionPredicate = {};
    if (sizes.length) p.sizes = sizes;
    if (categories.length) p.categories = categories;
    if (strainTypes.length) p.strainTypes = strainTypes;
    if (brandSel.length) p.brands = brandSel;
    if (cannabinoids.length) p.hasCannabinoid = cannabinoids;
    const pMin = numOrUndef(priceMin);
    const pMax = numOrUndef(priceMax);
    if (pMin != null) p.priceMinCents = Math.round(pMin * 100);
    if (pMax != null) p.priceMaxCents = Math.round(pMax * 100);
    const wMin = numOrUndef(weightMin);
    const wMax = numOrUndef(weightMax);
    if (wMin != null) p.weightMinGrams = wMin;
    if (wMax != null) p.weightMaxGrams = wMax;
    const tMin = numOrUndef(thcMin);
    const tMax = numOrUndef(thcMax);
    if (tMin != null) p.thcMinPercent = tMin;
    if (tMax != null) p.thcMaxPercent = tMax;
    const cMin = numOrUndef(cbdMin);
    const cMax = numOrUndef(cbdMax);
    if (cMin != null) p.cbdMinPercent = cMin;
    if (cMax != null) p.cbdMaxPercent = cMax;
    const names = nameContains.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length) p.nameContains = names;
    if (ratioOnly) p.ratioProducts = true;
    if (lowStock) p.lowStock = true;
    if (newArrival) p.newArrival = true;
    if (onSale === "yes") p.onSaleAlready = true;
    if (onSale === "no") p.onSaleAlready = false;
    return p;
  }, [sizes, categories, strainTypes, brandSel, cannabinoids, priceMin, priceMax, weightMin, weightMax, thcMin, thcMax, cbdMin, cbdMax, nameContains, ratioOnly, lowStock, newArrival, onSale]);

  function loadAudience(a: SavedAudienceLite) {
    const p = a.predicate ?? {};
    setSizes((p.sizes as SizeBucket[]) ?? []);
    setCategories(p.categories ?? []);
    setStrainTypes(p.strainTypes ?? []);
    setBrandSel(p.brands ?? []);
    setCannabinoids((p.hasCannabinoid as Cannabinoid[]) ?? []);
    setPriceMin(p.priceMinCents != null ? String(p.priceMinCents / 100) : "");
    setPriceMax(p.priceMaxCents != null ? String(p.priceMaxCents / 100) : "");
    setWeightMin(p.weightMinGrams != null ? String(p.weightMinGrams) : "");
    setWeightMax(p.weightMaxGrams != null ? String(p.weightMaxGrams) : "");
    setThcMin(p.thcMinPercent != null ? String(p.thcMinPercent) : "");
    setThcMax(p.thcMaxPercent != null ? String(p.thcMaxPercent) : "");
    setCbdMin(p.cbdMinPercent != null ? String(p.cbdMinPercent) : "");
    setCbdMax(p.cbdMaxPercent != null ? String(p.cbdMaxPercent) : "");
    setNameContains((p.nameContains ?? []).join(", "));
    setRatioOnly(p.ratioProducts === true);
    setLowStock(p.lowStock === true);
    setNewArrival(p.newArrival === true);
    setOnSale(p.onSaleAlready === true ? "yes" : p.onSaleAlready === false ? "no" : "");
    setResult(null);
    toast({ tone: "info", message: `Loaded audience "${a.name}". Analyze to preview.` });
  }

  function analyze() {
    startTransition(async () => {
      try {
        const res = await resolvePredicateAction(predicate);
        setResult({ description: res.description, matched: res.matched, totalMenu: res.totalMenu, warnings: res.warnings });
      } catch {
        toast({ tone: "error", message: "Could not analyze the rule. Try again." });
      }
    });
  }

  function applyMatches() {
    if (!result) return;
    const keys = result.matched.map((m) => m.key);
    setAppliedKeys((prev) => Array.from(new Set([...prev, ...keys])));
    toast({ tone: "success", message: `Applied ${keys.length} product(s) as included. Review below, then save the promotion.` });
  }

  function clearApplied() {
    setAppliedKeys([]);
    toast({ tone: "info", message: "Cleared applied products." });
  }

  function saveAudience() {
    const name = audienceName.trim();
    if (!name) {
      toast({ tone: "error", message: "Give the audience a name first." });
      return;
    }
    startTransition(async () => {
      const res = await saveAudienceAction({ name, predicate });
      if (res.ok) {
        toast({ tone: "success", message: `Saved smart audience "${name}".` });
        setAudienceName("");
        try {
          const list = await listAudiencesAction();
          setAudiences(list.map((a) => ({ id: a.id, name: a.name, description: a.description, predicate: a.predicate })));
        } catch {
          /* non-fatal */
        }
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  const chip = "rounded-full px-2.5 py-1 text-xs font-medium transition";
  const chipOn = "bg-[var(--admin-accent)]/25 text-white ring-1 ring-[var(--admin-accent)]/60";
  const chipOff = "bg-white/10 text-white/70 hover:bg-white/20";
  const numCls = "w-full rounded-lg border border-white/10 bg-black px-2 py-1.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]";

  return (
    <div className="space-y-4 rounded-lg border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-4">
      {/* Applied keys ride the form submit as target_product. */}
      {appliedKeys.map((k) => (
        <input key={`ap-${k}`} type="hidden" name="target_product" value={k} />
      ))}

      <div>
        <p className="text-sm font-semibold text-white/80">Smart rule builder</p>
        <p className="text-xs text-white/50">
          Build a rule from product attributes, preview EXACTLY what it selects
          against the live menu, then apply those products to this deal. Nothing
          is saved until you save the promotion.
        </p>
      </div>

      {/* Saved audiences */}
      {audiences.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-white/50">Load a saved smart audience</p>
          <div className="flex flex-wrap gap-1.5">
            {audiences.map((a) => (
              <button key={a.id} type="button" onClick={() => loadAudience(a)} className={`${chip} ${chipOff}`} title={a.description ?? undefined}>
                {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sizes */}
      <Field label="Size">
        {SIZE_BUCKETS.map((b) => (
          <button key={b} type="button" onClick={() => setSizes((s) => toggle(s, b))} className={`${chip} ${sizes.includes(b) ? chipOn : chipOff}`}>
            {SIZE_LABELS[b]}
          </button>
        ))}
      </Field>

      {/* Categories */}
      <Field label="Category">
        {categoryValues.map((c) => (
          <button key={c} type="button" onClick={() => setCategories((s) => toggle(s, c))} className={`${chip} ${categories.includes(c) ? chipOn : chipOff}`}>
            {c}
          </button>
        ))}
      </Field>

      {/* Strain type */}
      <Field label="Strain type">
        {strainOptions.map((o) => (
          <button key={o.value} type="button" onClick={() => setStrainTypes((s) => toggle(s, o.value))} className={`${chip} ${strainTypes.includes(o.value) ? chipOn : chipOff}`}>
            {o.label}
          </button>
        ))}
      </Field>

      {/* Cannabinoids */}
      <Field label="Contains cannabinoid">
        {CANNABINOIDS.map((c) => (
          <button key={c} type="button" onClick={() => setCannabinoids((s) => toggle(s, c))} className={`${chip} ${cannabinoids.includes(c) ? chipOn : chipOff}`}>
            {CANNABINOID_LABELS[c]}
          </button>
        ))}
      </Field>

      {/* Brands */}
      {brands.length > 0 && (
        <Field label="Brand">
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {brands.map((b) => (
              <button key={b} type="button" onClick={() => setBrandSel((s) => toggle(s, b))} className={`${chip} ${brandSel.includes(b) ? chipOn : chipOff}`}>
                {b}
              </button>
            ))}
          </div>
        </Field>
      )}

      {/* Numeric ranges */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Range label="Price min ($)" value={priceMin} onChange={setPriceMin} cls={numCls} />
        <Range label="Price max ($)" value={priceMax} onChange={setPriceMax} cls={numCls} />
        <Range label="Weight min (g)" value={weightMin} onChange={setWeightMin} cls={numCls} />
        <Range label="Weight max (g)" value={weightMax} onChange={setWeightMax} cls={numCls} />
        <Range label="THC min (%)" value={thcMin} onChange={setThcMin} cls={numCls} />
        <Range label="THC max (%)" value={thcMax} onChange={setThcMax} cls={numCls} />
        <Range label="CBD min (%)" value={cbdMin} onChange={setCbdMin} cls={numCls} />
        <Range label="CBD max (%)" value={cbdMax} onChange={setCbdMax} cls={numCls} />
      </div>

      {/* Name + flags */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">Name contains (comma-separated)</span>
          <input value={nameContains} onChange={(e) => setNameContains(e.target.value)} placeholder="e.g. Live Rosin, Kush" className={numCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">Already on sale?</span>
          <select value={onSale} onChange={(e) => setOnSale(e.target.value as "" | "yes" | "no")} className={numCls}>
            <option value="">(any)</option>
            <option value="no">Only NOT already on sale</option>
            <option value="yes">Only already on sale</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-white/70">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={ratioOnly} onChange={(e) => setRatioOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--admin-accent)]" />
          Ratio products only (1:1 etc)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--admin-accent)]" />
          Low stock only
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={newArrival} onChange={(e) => setNewArrival(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--admin-accent)]" />
          New arrivals only
        </label>
      </div>

      {/* Analyze */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="save" onClick={analyze} disabled={pending}>
          {pending ? "Analyzing…" : "Analyze against live menu"}
        </Button>
        <input value={audienceName} onChange={(e) => setAudienceName(e.target.value)} placeholder="Name to save as smart audience…" className={`${numCls} max-w-xs`} />
        <Button type="button" variant="neutral" onClick={saveAudience} disabled={pending}>
          Save as smart audience
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <p className="text-xs text-white/60">{result.description}</p>
          {result.warnings.map((w, i) => (
            <p key={i} className="mt-1 rounded bg-[var(--admin-orange)]/15 px-2 py-1 text-xs text-[var(--admin-orange)]">
              ⚠ {w}
            </p>
          ))}
          <p className="mt-2 text-sm text-white/80">
            Matches <span className="font-semibold text-[var(--admin-accent)]">{result.matched.length}</span> of {result.totalMenu} products.
          </p>
          {result.matched.length > 0 && (
            <>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {result.matched.slice(0, 100).map((m) => (
                  <div key={m.key} className="rounded-md bg-white/5 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-white/80">
                        {m.brand ? `${m.brand} · ` : ""}
                        {m.name}
                      </span>
                      <span className="shrink-0 text-white/40">{formatMinorCurrency(m.priceMinorUnits)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {m.reasons.map((r, i) => (
                        <span key={i} className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/50">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {result.matched.length > 100 && (
                  <p className="text-[11px] text-white/40">…and {result.matched.length - 100} more (all will be applied).</p>
                )}
              </div>
              <div className="mt-2">
                <Button type="button" variant="confirm" onClick={applyMatches} disabled={pending}>
                  Apply these {result.matched.length} products as included
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Applied summary */}
      {appliedKeys.length > 0 && (
        <div className="rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/10 px-3 py-2 text-xs text-white/80">
          <span className="font-semibold text-[var(--admin-accent)]">{appliedKeys.length}</span> product(s)
          are applied to this deal from smart rules. They save with the promotion.
          <button type="button" onClick={clearApplied} className="ml-2 text-white/40 underline hover:text-white">
            clear
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-white/50">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Range({ label, value, onChange, cls }: { label: string; value: string; onChange: (v: string) => void; cls: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/50">{label}</span>
      <input type="number" step="any" min={0} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
    </label>
  );
}
