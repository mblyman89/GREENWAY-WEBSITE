-- Rollback for 0352_media_library_v2.sql (D221 M1+M2).
-- Run MANUALLY only if needed.
--
-- What this does NOT undo: the duplicate copies that 0352 archived stay
-- archived, and the references 0352 moved onto the kept row stay there.
-- That is safe - every slot still shows the same picture (same file). The
-- copies are kept, never deleted; to bring one back, set its status to draft.
drop index if exists public.uq_media_assets_live_content_hash;
drop trigger if exists trg_media_search_refresh on public.media_assets;
drop table if exists public.media_ai_runs;
drop function if exists public.media_library_health();
drop function if exists public.media_search(text, uuid, uuid, text, text, text, text, integer, integer);
drop function if exists public.media_auto_publish();
drop function if exists public.media_backfill_provenance();
drop function if exists public.media_resolve_vendor(text, text);
drop function if exists public.media_norm_name(text);
drop function if exists public.media_canonicalize(boolean);
drop function if exists public.media_assets_search_refresh();
drop function if exists public.media_search_document(public.media_assets);
drop index if exists public.idx_media_usages_slot;

alter table public.media_assets
  drop column if exists vendor_id,
  drop column if exists brand_id,
  drop column if exists kb_product_id,
  drop column if exists platform,
  drop column if exists source_url,
  drop column if exists source_page_url,
  drop column if exists menu_item_ref,
  drop column if exists product_name,
  drop column if exists strain_name,
  drop column if exists captured_at,
  drop column if exists role,
  drop column if exists category,
  drop column if exists subcategory,
  drop column if exists pack_size,
  drop column if exists colors,
  drop column if exists background,
  drop column if exists orientation,
  drop column if exists quality_score,
  drop column if exists ai_description,
  drop column if exists ai_caption,
  drop column if exists visible_text,
  drop column if exists ai_tags,
  drop column if exists ai_confidence,
  drop column if exists ai_model,
  drop column if exists ai_described_at,
  drop column if exists ai_status,
  drop column if exists ai_error,
  drop column if exists seo_title,
  drop column if exists seo_alt,
  drop column if exists seo_description,
  drop column if exists seo_slug,
  drop column if exists seo_keywords,
  drop column if exists credit_text,
  drop column if exists copyright_notice,
  drop column if exists license_url,
  drop column if exists content_hash,
  drop column if exists canonical_id,
  drop column if exists duplicate_count,
  drop column if exists phash,
  drop column if exists publish_reason,
  drop column if exists published_at,
  drop column if exists published_by,
  drop column if exists review_state,
  drop column if exists review_note,
  drop column if exists field_provenance,
  drop column if exists search_tsv;

notify pgrst, 'reload schema';
