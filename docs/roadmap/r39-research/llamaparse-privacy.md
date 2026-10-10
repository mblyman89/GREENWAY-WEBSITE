# LlamaParse file types + data handling (fetched R39 S5)
Sources:
- https://developers.llamaindex.ai/llamaparse/general/supported_document_types
  Images: "jpg, jpeg, png, gif, bmp, tiff, webp, heic, heif"; Documents include pdf.
- https://developers.llamaindex.ai/llamaparse/general/data_retention/index.md
  "Uploaded source files (Parse) | 48 hours | Then permanently deleted"; Parse cache 48 hours;
  "disable_cache: true forces a fresh run".
- https://developers.llamaindex.ai/llamaparse/general/faq/index.md
  "Your data is kept private to you only and is used only to return your results, never for model
  training ... cached for 48 hours and then permanently deleted". SOC 2 Type 2 report via Trust Center;
  DPA request form available; BAAs only on Enterprise plan.
Decision (R39 S5):
- Our own fillable PDFs are read LOCALLY (AcroForm via unpdf getFieldObjects): no bank data leaves Greenway.
- Scans/photos go to LlamaParse ONLY when an admin presses "Read with LlamaParse", with the 48-hour
  retention disclosed on the button. The result only proposes a routing number (check-digit valid);
  account numbers are never taken from OCR. The blind re-key is the control.
- Suggest Michael request the LlamaIndex DPA (form link above) since bank documents are sent.
