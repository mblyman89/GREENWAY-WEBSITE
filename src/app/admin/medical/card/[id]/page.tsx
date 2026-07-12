import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getCustomerById } from "@/lib/customers/store";
import { getEndorsementConfig, type AuthorizationRow } from "@/lib/medical/store";
import { markCardPrintedAction } from "@/app/admin/medical/actions";
import { CardPrintButton } from "@/components/admin/medical/CardPrintButton";

export const dynamic = "force-dynamic";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return d;
  }
}

/**
 * Printable store companion card. Task P fix: this page used to render its own
 * <html>/<body> INSIDE the root layout's document — nested documents crash the
 * React render and produced the blank page the owner hit. It is now a normal
 * admin page; @media print rules strip the admin chrome (globals.css already
 * hides .admin-chrome) and size the page to the card.
 *
 * IMPORTANT (RCW 69.51A.230(3)): the OFFICIAL recognition card is generated,
 * printed, and laminated FROM THE MCR (it carries the patient photo and the
 * MCR card number). This page prints the store-side companion for the retained
 * record — it is not a substitute for the MCR-generated card.
 */
export default async function PrintCardPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("medical.manage");
  const { id } = await params;

  if (!isSupabaseServiceConfigured) notFound();
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("patient_authorizations").select("*").eq("id", id).maybeSingle();
  const card = (data as AuthorizationRow | null) ?? null;
  if (!card) notFound();

  const customer = await getCustomerById(card.customer_id);
  const config = await getEndorsementConfig();
  const name = customer ? `${customer.first_name} ${customer.last_name ?? ""}`.trim() : "—";

  return (
    <div className="space-y-4">
      <style>{`
        @page { size: 3.5in 2.25in; margin: 0; }
        .med-card { width: 3.5in; height: 2.25in; background: linear-gradient(135deg,#064e3b,#065f46);
          color: #fff; border-radius: 12px; padding: 14px 16px; position: relative;
          box-shadow: 0 6px 20px rgba(0,0,0,.2); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .med-card .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #a7f3d0; }
        .med-card .title { font-size: 14px; font-weight: 700; margin-top: 2px; }
        .med-card .name { font-size: 18px; font-weight: 800; margin-top: 10px; }
        .med-card .row { display: flex; justify-content: space-between; font-size: 10px; margin-top: 8px; }
        .med-card .label { color: #a7f3d0; text-transform: uppercase; letter-spacing: .06em; }
        .med-card .val { font-weight: 700; }
        .med-card .upid { font-family: ui-monospace, monospace; font-size: 13px; font-weight: 700;
          margin-top: 6px; letter-spacing: .08em; }
        .med-card .seal { position: absolute; right: 14px; bottom: 12px; font-size: 8px; color: #6ee7b7;
          text-align: right; max-width: 130px; }
        @media print {
          .med-card { margin: 0; box-shadow: none; border-radius: 0; }
        }
      `}</style>

      {/* Toolbar — hidden on paper */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <CardPrintButton />
        {!card.card_printed_at && (
          <form action={markCardPrintedAction}>
            <input type="hidden" name="authorization_row_id" value={card.id} />
            <button
              type="submit"
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-4 py-2 text-sm font-medium text-[var(--admin-text)] transition hover:border-[var(--admin-accent)]"
            >
              Mark printed &amp; laminated
            </button>
          </form>
        )}
        <p className="text-xs text-[var(--admin-text-faint)]">
          Print, then run through the Scotch Thermal Laminator. The OFFICIAL card (with photo) is
          generated in the MCR — this is the store companion copy.
        </p>
      </div>

      {/* The card */}
      <div className="med-card">
        <div className="brand">Greenway Marijuana · Port Orchard, WA</div>
        <div className="title">Medical Cannabis Recognition Card</div>
        <div className="name">{name}</div>
        <div className="upid">CARD {card.unique_patient_identifier ?? "—"}</div>
        <div className="row">
          <div>
            <div className="label">Holder</div>
            <div className="val">
              {card.holder_type === "designated_provider" ? "Designated Provider" : "Patient"}
            </div>
          </div>
          <div>
            <div className="label">Effective</div>
            <div className="val">{fmtDate(card.effective_on ?? card.issued_on)}</div>
          </div>
          <div>
            <div className="label">Expires</div>
            <div className="val">{fmtDate(card.expires_on)}</div>
          </div>
        </div>
        <div className="seal">
          RCW 69.51A.030
          {config?.endorsementNumber ? ` · Endorsement ${config.endorsementNumber}` : ""}
        </div>
      </div>
    </div>
  );
}
