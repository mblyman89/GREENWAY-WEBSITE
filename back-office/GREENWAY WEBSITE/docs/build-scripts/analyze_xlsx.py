import pandas as pd
import json

for fname in ["PRODUCTS.xlsx", "INVENTORIES.xlsx"]:
    print("="*70)
    print("FILE:", fname)
    print("="*70)
    xl = pd.ExcelFile(fname)
    print("SHEETS:", xl.sheet_names)
    for sheet in xl.sheet_names:
        df = pd.read_excel(fname, sheet_name=sheet)
        print(f"\n--- SHEET: {sheet} ---")
        print("ROWS:", len(df), "COLS:", len(df.columns))
        print("COLUMNS:", list(df.columns))
        print("\nFIRST 3 ROWS:")
        print(df.head(3).to_string())
        print()
