-- Rollback for 0281_merch_print_files_bucket.sql
-- Removes the policies. The bucket itself is left in place on purpose (it
-- may hold print files for live products); delete it in Supabase -> Storage
-- after emptying it if you really want it gone.
drop policy if exists merch_files_staff_read on storage.objects;
drop policy if exists merch_files_admin_delete on storage.objects;
