# Greenway Back Office — Database Schema Reference

> Target: Postgres (Supabase recommended). Money stored as integer **minor units** (cents). All timestamps UTC. Every write logs to `audit_logs`.

## Auth & access
- **users** — id, email, name, role (`owner|admin|manager|content_editor|staff|readonly`), active, created_at, last_login_at
- **audit_logs** — id, actor_id, action, entity_type, entity_id, before_json, after_json, ip, user_agent, created_at

## Media
- **media_assets** — id, storage_key, public_url, filename, mime_type, size, width, height, alt_text, title, description, source, license_status, usage_type, tags[], status (`draft|published`), uploaded_by, created_at
- **media_usages** — id, media_asset_id, entity_type, entity_id, field_key

## Site content
- **site_settings** — key, value_json, draft_value_json, published_at, updated_by
- **content_blocks** — key, page, section, label, field_type, published_value, draft_value, validation_json, updated_by, published_by
- **seo_entries** — id, path/entity_type/entity_id, title, description, canonical, og_image_id, noindex, updated_by

## Blog / newsletter
- **blog_posts** — id, slug (unique), title, category, kind (`post|newsletter`), status (`draft|scheduled|published|archived`), excerpt, body, author, publish_date, hero_image_id, seo_title, seo_description, created_by, updated_by, published_by
- **newsletter_assets** — id, post_id, pdf_media_id, page_media_ids[], page_order

## Vendors / brands  (seed from `database/vendors/` folder DB)
- **vendors** — id, display_name, slug, legal_name, mission_statement, about, website, email, phone, social_json, internal_notes, vendor_day_notes, logo_media_id, hero_media_id, status
- **vendor_aliases** — id, vendor_id, source_name, source_system
- **brands** — id, display_name, slug, vendor_id, logo_media_id, about, mission_statement, website, social_json, status
- **brand_aliases** — id, brand_id, source_name, source_system

## Menu / POS import
- **pos_imports** — id, uploaded_by, products_file_asset_id, inventories_file_asset_id, products_file_hash, inventories_file_hash, status (`uploaded|processing|staged|published|failed`), started_at, completed_at, summary_json, error_message, published_at, published_by
- **pos_import_diagnostics** — id, import_id, severity (`error|warning|info`), code, message, context_json
- **menu_versions** — id, import_id, status (`staged|published|archived`), item_count, variant_count, vendor_count, published_at, published_by
- **menu_items** — id, menu_version_id, source_product_key, name, product_name, brand_name, vendor_name, category, filter_categories[], pos_inventory_type, pos_inventory_category, strain_type, strain_name, thc, cbd, compounds_json, description, price_minor_units, inventory_status, hidden, hidden_reason
- **menu_variants** — id, menu_item_id, source_variant_key, label, price_minor_units, inventory_level, medical
- **product_enrichments** — id, source_product_key (unique), display_name_override, description_override, image_media_id, gallery_media_ids[], brand_id, vendor_id, tags[], staff_pick, featured, hide_override, hide_reason, seo_title, seo_description

## Promotions
- **promotions** — id, name, slug, type, status (`draft|scheduled|active|expired`), starts_at, ends_at, recurrence_rule, discount_type (`percent|fixed|bogo|threshold|tier`), discount_value, disclaimer, priority, created_by, published_by
- **promotion_targets** — id, promotion_id, target_type (`brand|category|product|vendor|storewide`), target_id_or_value
- **promotion_exclusions** — id, promotion_id, target_type, target_id_or_value
- **promotion_audit_snapshots** — id, promotion_id, affected_product_count, affected_products_json, created_at

## Orders  (replace client sessionStorage)
- **orders** — id, order_number (`GWY-XXXXXX`), status (`new|acknowledged|preparing|ready|completed|canceled|no_show`), customer_first_name, customer_last_name, email, phone, birthday, placed_at, acknowledged_at, ready_at, completed_at, canceled_at, subtotal_minor_units, tax_minor_units, savings_minor_units, total_minor_units, menu_version_id, customer_notes, staff_notes
- **order_lines** — id, order_id, menu_item_id, variant_id, product_name_snapshot, brand_snapshot, variant_label_snapshot, quantity, price_minor_units, regular_price_minor_units, discount_json
- **order_events** — id, order_id, actor_id, event_type, message, metadata_json, created_at

## Loyalty  (migrate from storage/loyalty-signups.jsonl)
- **loyalty_signups** — id, first_name, last_name, birthday, phone, email, consent, signature, source, notification_status, pos_entry_status, entered_by, entered_at, notes, submitted_at

## Jobs / reports
- **jobs** — id, type, status, payload_json, result_json, error, started_at, completed_at
- **report_snapshots** — id, type, date_range, filters_json, data_json, created_by, created_at

## Seeding map (folder DB → tables)
| Folder DB source | Seeds table |
|---|---|
| `database/vendors/<v>/vendor.json` | `vendors` (+ `vendor_aliases` from `posAliases`) |
| `database/vendors/<v>/brands/<b>/brand.json` | `brands` (+ `brand_aliases`) |
| `database/vendors/.../products/<p>/product.json` | `menu_items` baseline + `product_enrichments` shell |
| `database/strains/STRAINS_MASTER.xlsx` | strain reference (lookup table or JSON) |
| `database/categories/*.json` | category taxonomy + POS mapping config |
| `media-library/**` + sidecar `*.meta.json` | `media_assets` |
