Source: https://developers.llamaindex.ai/llamaparse/parse/guides/api-reference (fetched during R39 S5)
- POST https://api.cloud.llamaindex.ai/api/v2/parse/upload  multipart: file=@..., configuration='{"tier":"agentic","version":"latest"}'
  -> response id + status at TOP LEVEL
- GET  /api/v2/parse/{job_id}?expand=markdown,items,metadata -> fields NESTED under `job` (job.status, job.error_message)
  "When polling, read job.status — reusing the top-level .status path from the create response will always read empty."
- status values: PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
- expand text_full / markdown_full = whole document as a single string
- tiers: fast, cost_effective, agentic, agentic_plus (422 otherwise)
- Header: Authorization: Bearer $LLAMA_CLOUD_API_KEY
- options like page_ranges nest; bare max_pages -> 422 extra_forbidden
