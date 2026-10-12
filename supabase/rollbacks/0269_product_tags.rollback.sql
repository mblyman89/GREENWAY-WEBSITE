-- Rollback for 0269_product_tags.sql (R49-S5).
-- Safe for the live website: tags disappear from product cards, the Tags
-- filter hides itself, and Inventory > Tags says "apply migration 0269"
-- again. The owner's tags, hand-applied tags and first-seen dates are
-- deleted.
drop table if exists public.product_tag_assignments;
drop table if exists public.tag_definitions;
drop table if exists public.product_first_seen;
notify pgrst, 'reload schema';
