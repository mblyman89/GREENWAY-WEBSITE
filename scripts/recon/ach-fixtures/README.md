# ACH AcroForm fixtures (R39 S5)
`tests/fixtures/ach/*.fieldobjects.json` are unpdf `getFieldObjects()` dumps of our own
fillable PDFs (built outside this repo by /workspace/scripts/build_*.py), filled with TEST values only.

Regenerate:
1. `pip install pypdf` then `python3 fill-test-forms.py` (edit the two source paths) -> emp.pdf, ven.pdf
2. `node dump-field-objects.mjs emp.pdf tests/fixtures/ach/employee-filled.fieldobjects.json` (same for vendor / blank)

Routing numbers used are public test values (021000021, 011000015); account numbers are made up.
