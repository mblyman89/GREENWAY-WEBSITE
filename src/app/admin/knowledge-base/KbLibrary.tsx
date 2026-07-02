"use client";

import { useState } from "react";
import type { KbStrainFull, KbProductCategoryRow } from "@/lib/ai/kb/store";
import { StrainEditor } from "./StrainEditor";
import { ProductCategoryEditor } from "./ProductCategoryEditor";

// Unified KB library with a top-level switch between the two kinds of validated
// knowledge the store keeps:
//   • Strains        — genetics that back Flower / Joint / Blunt / Concentrate / RSO.
//   • Product types  — genuinely different products NOT represented by a strain
//                       (edibles, liquids, tinctures, topicals, vapes, …).
// Each view keeps its own filters/sort up top. This puts one clear switch at the
// top instead of two disconnected tables.

type View = "strains" | "product-types";

export function KbLibrary({
  strains,
  strainsMigrated,
  strainsTotal,
  productCategories,
  productCategoriesMigrated,
}: {
  strains: KbStrainFull[];
  strainsMigrated: boolean;
  strainsTotal: number;
  productCategories: KbProductCategoryRow[];
  productCategoriesMigrated: boolean;
}) {
  const [view, setView] = useState<View>("strains");

  const tabCls = (active: boolean) =>
    "px-4 py-2 text-sm font-medium transition-colors " +
    (active
      ? "bg-[var(--admin-accent-soft)] text-[var(--admin-text)]"
      : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]");

  return (
    <div className="space-y-3">
      {/* Master switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
          <button
            type="button"
            onClick={() => setView("strains")}
            className={tabCls(view === "strains")}
          >
            Strains ({strainsTotal})
          </button>
          <button
            type="button"
            onClick={() => setView("product-types")}
            className={tabCls(view === "product-types")}
          >
            Product types ({productCategories.length})
          </button>
        </div>
        <span className="text-xs text-[var(--admin-text-muted)]">
          {view === "strains"
            ? "Genetics behind flower, joints, blunts, concentrate and RSO."
            : "Edibles, liquids, tinctures, topicals, vapes and more — kept separate from strains."}
        </span>
      </div>

      {view === "strains" ? (
        <StrainEditor
          strains={strains}
          migrated={strainsMigrated}
          total={strainsTotal}
        />
      ) : (
        <ProductCategoryEditor
          categories={productCategories}
          migrated={productCategoriesMigrated}
        />
      )}
    </div>
  );
}
