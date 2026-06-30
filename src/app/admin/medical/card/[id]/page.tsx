import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getCustomerById } from "@/lib/customers/store";
import { getEndorsementConfig, type AuthorizationRow } from "@/lib/medical/store";

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
 * Printable medical recognition card. Print-friendly: a credit-card-sized panel
 * laid out with @page rules; staff print and laminate. (The official card is
 * also produced in the MCR; this is the store-facing print companion.)
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
    <html lang="en">
      <head>
        <title>Recognition Card — {name}</title>
        <style>{`
          @page { size: 3.5in 2.25in; margin: 0; }
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f3f4f6; }
          .toolbar { padding: 16px; text-align: center; }
          .toolbar button { padding: 8px 18px; font-size: 14px; border-radius: 8px; border: none;
            background: #166534; color: #fff; cursor: pointer; }
          .card { width: 3.5in; height: 2.25in; margin: 24px auto; background: linear-gradient(135deg,#064e3b,#065f46);
            color: #fff; border-radius: 12px; padding: 14px 16px; position: relative;
            box-shadow: 0 6px 20px rgba(0,0,0,.2); }
          .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #a7f3d0; }
          .title { font-size: 14px; font-weight: 700; margin-top: 2px; }
          .name { font-size: 18px; font-weight: 800; margin-top: 10px; }
          .row { display: flex; justify-content: space-between; font-size: 10px; margin-top: 8px; }
          .label { color: #a7f3d0; text-transform: uppercase; letter-spacing: .06em; }
          .val { font-weight: 700; }
          .upid { font-family: ui-monospace, monospace; font-size: 13px; font-weight: 700; margin-top: 6px;
            letter-spacing: .08em; }
          .seal { position: absolute; right: 14px; bottom: 12px; font-size: 8px; color: #6ee7b7;
            text-align: right; max-width: 130px; }
          @media print { .toolbar { display: none; } body { background: #fff; } .card { margin: 0; box-shadow: none; } }
        `}</style>
      </head>
      <body>
        <div className="toolbar">
          <button data-print="true">Print this card</button>
        </div>
        <div className="card">
          <div className="brand">Greenway Marijuana · Port Orchard, WA</div>
          <div className="title">Medical Cannabis Recognition Card</div>
          <div className="name">{name}</div>
          <div className="upid">UPID {card.unique_patient_identifier ?? "—"}</div>
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
        {/* Auto-trigger the browser print dialog. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.querySelector('[data-print]')?.addEventListener('click',function(){window.print();});",
          }}
        />
      </body>
    </html>
  );
}
