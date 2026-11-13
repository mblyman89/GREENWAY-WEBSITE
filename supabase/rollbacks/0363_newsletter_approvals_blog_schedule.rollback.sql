-- Rollback for 0363_newsletter_approvals_blog_schedule.sql (D237 N-3).
-- Run MANUALLY only if needed.
--
-- Put the code back to the pre-N-3 version first. Open blog_post schedules
-- are cancelled (and done/failed ones removed) so the old kind constraint fits.
drop table if exists public.newsletter_approvals;

delete from public.content_schedule where target_kind = 'blog_post';
alter table public.content_schedule drop constraint if exists content_schedule_kind_chk;
alter table public.content_schedule
  add constraint content_schedule_kind_chk
  check (target_kind in ('carousel_slide', 'shop_slide', 'page_section', 'faq_item', 'content_block'));

notify pgrst, 'reload schema';
