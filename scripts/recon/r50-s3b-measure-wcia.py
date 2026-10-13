"""R50 S3b: measure the vendors' WCIA transfer files Cultivera stored (read-only harvest).

Prints only counts (no prices, addresses, license numbers or URLs) so the result can go in the
public bible. Joins each WCIA line to the export lot by barcode (WCIA inventory_id == Cultivera
Barcode, verified on samples) and to the transfer line list.
"""
import json, collections, openpyxl

det = {}
for l in open('/workspace/cvh/runs/r2a/transfer_details.jsonl'):
    x = json.loads(l); det[x['Id']] = x

wb = openpyxl.load_workbook('/workspace/cvh/runs/r2a/export_inventories.xlsx', read_only=True)
ws = wb.worksheets[0]; rows = ws.iter_rows(values_only=True); h = list(next(rows))
bi = h.index('Barcode')
export_barcodes = {str(r[bi]).strip() for r in rows if r[bi]}

c = collections.Counter()
ver = collections.Counter(); cat = collections.Counter(); itype = collections.Counter()
labhost = collections.Counter(); coahost = collections.Counter(); pot_types = collections.Counter()
lab_ids = set(); lab_json_urls = set(); coa_urls = set()
wcia_barcodes = {}
field_present = collections.Counter()
terp_in_wcia = 0
for l in open('/workspace/r50/s3b/wcia_all.jsonl'):
    rec = json.loads(l)
    if not rec.get('ok'): c['fetch_failed'] += 1; continue
    raw = rec.get('JsonFile')
    try:
        j = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        c['unparseable'] += 1; continue
    if not isinstance(j, dict): c['not_object'] += 1; continue
    c['files'] += 1
    ver[j.get('document_schema_version')] += 1
    items = j.get('inventory_transfer_items') or []
    tid = rec['transferId']
    tb = {str(d['Barcode']) for d in det[tid]['Details']}
    ib = {str(i.get('inventory_id')) for i in items}
    c['lines'] += len(items)
    c['lines_on_transfer'] += len(ib & tb)
    c['transfer_lines'] += len(tb)
    if ib == tb: c['files_exact_line_set'] += 1
    for it in items:
        bc = str(it.get('inventory_id'))
        wcia_barcodes.setdefault(bc, []).append(tid)
        for k, v in it.items():
            if v not in (None, '', [], {}): field_present[k] += 1
        cat[it.get('inventory_category')] += 1
        itype[it.get('inventory_type')] += 1
        lr = it.get('lab_result_data') or {}
        if lr:
            c['with_lab'] += 1
            if lr.get('lab_result_id'): lab_ids.add(lr['lab_result_id'])
            if lr.get('coa'): c['with_coa_pdf'] += 1; coa_urls.add(lr['coa']); coahost[(lr['coa'].split('/')+['','',''])[2] or 'relative'] += 1
            link = it.get('lab_result_link') or lr.get('lab_result_detail')
            if link: c['with_lab_json'] += 1; lab_json_urls.add(link); labhost[(link.split('/')+['','',''])[2] or ('relative:'+link[:12])] += 1
            for p in lr.get('potency') or []: pot_types[p.get('type')] += 1
            if lr.get('terpenes') or lr.get('terpene'): terp_in_wcia += 1
            for L in lr.get('lab_result_list') or []:
                if L.get('coa_release_date'): c['with_release_date'] += 1; break
            if (lr.get('lab_result_status') or '').lower() == 'failed': c['lab_failed'] += 1

print('files', dict(c))
print('schema', dict(ver))
print('inventory_category', cat.most_common())
print('inventory_type', itype.most_common(25))
print('potency types', pot_types.most_common())
print('terpenes inside WCIA lab data', terp_in_wcia)
print('distinct lab ids', len(lab_ids), 'distinct lab json', len(lab_json_urls), 'distinct coa pdf', len(coa_urls))
print('coa hosts', coahost.most_common(6))
print('lab json hosts', labhost.most_common(6))
print('field presence', sorted(field_present.items()))
eb = export_barcodes
wb_ = set(wcia_barcodes)
print('export lots', len(eb), 'in a WCIA file', len(eb & wb_), 'barcodes on >1 WCIA file', sum(1 for v in wcia_barcodes.values() if len(set(v)) > 1))
