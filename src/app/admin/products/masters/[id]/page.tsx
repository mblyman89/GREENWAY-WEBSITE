import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Field, Input, Textarea, Button, Badge } from "@/components/admin/ui";
import { getMaster } from "@/lib/products/masters-store";
import {
  updateMasterAction,
  publishMasterAction,
  removeMemberAction,
  deleteMasterAction,
} from "../actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/products/masters";

export default async function MasterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; created?: string; accepted?: string; error?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const result = await getMaster(id);
  if (!result) notFound();
  const { master, members } = result;

  return (
    <div>
      <AdminPageHeader
        title={master.display_name}
        subtitle="A product master groups several menu items into one card. Tidy it, then publish to group them on your public menu."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Catalog" },
              { label: "Product Mastering", href: BASE },
              { label: master.display_name },
            ]}
          />
        }
        action={
          master.status === "published" ? (
            <form action={publishMasterAction}>
              <input type="hidden" name="id" value={master.id} />
              <input type="hidden" name="status" value="draft" />
              <Button type="submit" variant="neutral">Unpublish</Button>
            </form>
          ) : (
            <form action={publishMasterAction}>
              <input type="hidden" name="id" value={master.id} />
              <input type="hidden" name="status" value="published" />
              <Button type="submit">Publish to menu</Button>
            </form>
          )
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(sp.error)}</div>
        )}
        {(sp.saved || sp.created || sp.accepted) && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            {sp.accepted ? "Suggestion accepted — draft created. Review and publish below." : "Saved."}
          </div>
        )}

        <div className="flex items-center gap-3">
          {master.status === "published" ? (
            <Badge tone="green">published</Badge>
          ) : master.status === "draft" ? (
            <Badge tone="gold">draft</Badge>
          ) : (
            <Badge tone="neutral">archived</Badge>
          )}
          {master.created_origin === "ai_suggestion" && <Badge tone="outline">✨ from AI</Badge>}
        </div>

        {/* Edit master */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">Product details</h3>
          <form action={updateMasterAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={master.id} />
            <Field label="Display name" required>
              <Input name="display_name" defaultValue={master.display_name} required />
            </Field>
            <Field label="Brand">
              <Input name="brand_name" defaultValue={master.brand_name ?? ""} />
            </Field>
            <Field label="Category">
              <Input name="category" defaultValue={master.category ?? ""} />
            </Field>
            <Field label="Strain">
              <Input name="strain_name" defaultValue={master.strain_name ?? ""} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea name="notes" defaultValue={master.notes ?? ""} />
            </Field>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">Save details</Button>
            </div>
          </form>
        </div>

        {/* Members / variants */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h3 className="mb-1 text-sm font-semibold text-white">Variants in this product ({members.length})</h3>
          <p className="mb-4 text-xs text-white/40">
            These are the POS items grouped under this card. Remove any that don&apos;t belong.
          </p>
          {members.length === 0 ? (
            <p className="text-sm text-white/50">No variants yet.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
                >
                  <span className="flex-1 font-mono text-xs text-white/70">{m.pos_product_key}</span>
                  {m.variant_label && <Badge tone="outline">{m.variant_label}</Badge>}
                  <form action={removeMemberAction}>
                    <input type="hidden" name="member_id" value={m.id} />
                    <input type="hidden" name="master_id" value={master.id} />
                    <button type="submit" className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Danger zone */}
        <div className="rounded-[var(--admin-radius-lg)] border border-red-500/20 bg-red-500/5 p-5">
          <h3 className="mb-2 text-sm font-semibold text-red-300">Delete this master</h3>
          <p className="mb-3 text-xs text-white/40">
            Deleting only removes the grouping — your underlying menu items and sales history are untouched.
          </p>
          <form action={deleteMasterAction}>
            <input type="hidden" name="id" value={master.id} />
            <Button type="submit" variant="neutral">Delete master</Button>
          </form>
        </div>

        <Link href={BASE} className="inline-block text-sm text-white/50 hover:text-white/80">← Back to product mastering</Link>
      </div>
    </div>
  );
}
