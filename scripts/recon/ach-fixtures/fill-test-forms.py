from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
def fill(src,dst,vals,checks):
    r=PdfReader(src); w=PdfWriter(); w.append(r)
    for p in w.pages:
        w.update_page_form_field_values(p, vals, auto_regenerate=False)
        for a in p.get("/Annots",[]) or []:
            o=a.get_object(); t=o.get("/T")
            if t in checks:
                on=[k for k in o["/AP"]["/N"].keys() if k!="/Off"][0]
                o[NameObject("/V")]=NameObject(on); o[NameObject("/AS")]=NameObject(on)
                par=o.get("/Parent")
    w.set_need_appearances_writer(True)
    w.write(dst)
E=r"/workspace/ach/out/Greenway-Employee-Direct-Deposit-Authorization-FILLABLE.pdf"
V=r"/workspace/ach/out/Greenway-Vendor-ACH-Authorization-FILLABLE.pdf"
fill(E,"emp.pdf",{"e_legal_name":"Test Person","e_e_date":"2026-01-15","e_a1_bank":"Test Bank","e_a1_rtn":"021000021","e_a1_acct":"12345678","e_a1_amt":"$200.00","e_a2_bank":"Other Bank","e_a2_rtn":"011000015","e_a2_acct":"99990000"},{"e_rq_new","e_pay_dd","e_a1_chk","e_a2_sav","e_a2_rem"})
fill(V,"ven.pdf",{"v_legal_name":"Test Vendor LLC","v_v_date":"2026-01-15","v_bank":"Test Bank","v_rtn":"021000021","v_acct":"12345678","v_acct2":"12345678"},{"v_rq_new","v_at_chk"})
