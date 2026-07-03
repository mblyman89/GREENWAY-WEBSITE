"use client";

/**
 * NonCannabisIntakeForm — interactive intake form for non-cannabis merchandise.
 * Shows a LIVE preview of the convention name + smart SKU (computed client-side
 * from the same pure core the server uses), so staff see exactly what will be
 * saved before submitting. The actual SKU is finalized server-side (collision
 * check), so the preview SKU is a best-effort hint.
 */
import { useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { createNonCannabisDraftAction } from "./actions";
import {
  NONCANNABIS_TYPES,
  buildNonCannabisName,
  buildSku,
  validateNonCannabisName,
  type NonCannabisType,
  type Gender,
} from "@/lib/naming/noncannabis-core";

export function NonCannabisIntakeForm() {
  const [brand, setBrand] = useState("");
  const [type, setType] = useState<NonCannabisType>("pipe");
  const [size, setSize] = useState("");
  const [gender, setGender] = useState<Gender>("");
  const [color, setColor] = useState("");
  const [nameOverride, setNameOverride] = useState("");

  const preview = useMemo(() => {
    const built = buildNonCannabisName({ brand, type, size, gender, color });
    const name = nameOverride.trim() || built;
    const v = validateNonCannabisName(name);
    // Preview SKU with seq 1 (server assigns the real next sequence).
    const sku = buildSku({ type, size, color, gender }, 1);
    return { name, sku, ok: v.ok, issues: v.issues };
  }, [brand, type, size, gender, color, nameOverride]);

  return (
    <form action={createNonCannabisDraftAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand (optional)" htmlFor="brand">
          <Input
            id="brand"
            name="brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. RAW, Lookah, Sitka"
          />
        </Field>
        <Field label="Type" htmlFor="type" required>
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as NonCannabisType)}
          >
            {NONCANNABIS_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Size / joint size" htmlFor="size" help="e.g. 12in, 14mm, 18mm">
          <Input
            id="size"
            name="size"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="12in / 14mm"
          />
        </Field>
        <Field label="Gender (glass joint)" htmlFor="gender">
          <Select
            id="gender"
            name="gender"
            value={gender ?? ""}
            onChange={(e) => setGender(e.target.value as Gender)}
          >
            <option value="">— n/a —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </Select>
        </Field>
        <Field label="Color" htmlFor="color">
          <Input
            id="color"
            name="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="Blue, Amber, Clear"
          />
        </Field>
        <Field label="KB category (optional)" htmlFor="kb_category_slug" help="Connects this item to the Knowledge Base">
          <Input id="kb_category_slug" name="kb_category_slug" placeholder="accessories" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price ($)" htmlFor="price" required>
          <Input id="price" name="price" inputMode="decimal" placeholder="25.00" />
        </Field>
        <Field label="Cost ($)" htmlFor="cost">
          <Input id="cost" name="cost" inputMode="decimal" placeholder="12.00" />
        </Field>
        <Field label="Qty on hand" htmlFor="qty">
          <Input id="qty" name="qty" inputMode="numeric" placeholder="0" />
        </Field>
      </div>

      <Field
        label="Name override (optional)"
        htmlFor="name_override"
        help="Leave blank to use the auto-built convention name below."
      >
        <Input
          id="name_override"
          name="name_override"
          value={nameOverride}
          onChange={(e) => setNameOverride(e.target.value)}
          placeholder="Only if the auto name needs a manual tweak"
        />
      </Field>

      <Field label="Notes (optional)" htmlFor="notes">
        <Textarea id="notes" name="notes" placeholder="Anything staff should know" />
      </Field>

      {/* Live preview */}
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
          Preview (drafts-only — you confirm before it goes live)
        </p>
        <p className="mt-2 text-sm text-[var(--admin-text)]">
          <span className="text-[var(--admin-text-faint)]">Name:</span>{" "}
          <span className="font-semibold">{preview.name || "—"}</span>
        </p>
        <p className="mt-1 text-sm text-[var(--admin-text)]">
          <span className="text-[var(--admin-text-faint)]">SKU (hint):</span>{" "}
          <span className="font-mono">{preview.sku}</span>{" "}
          <span className="text-xs text-[var(--admin-text-faint)]">
            (server assigns the next free sequence)
          </span>
        </p>
        {!preview.ok ? (
          <p className="mt-2 text-xs text-[var(--admin-danger)]">
            {preview.issues.join(" ")}
          </p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" disabled={!preview.ok}>
        Stage draft
      </Button>
    </form>
  );
}
