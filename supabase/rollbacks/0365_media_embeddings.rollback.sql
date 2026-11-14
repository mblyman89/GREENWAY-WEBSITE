-- Rollback for 0365_media_embeddings.sql (D244 R-4).
-- Run MANUALLY only if needed.
--
-- Put the code back to the pre-R-4 version first (the app then uses word
-- search alone, as before). Drops the embeddings table, its search
-- functions and the capability / health reads. The pgvector extension is
-- LEFT installed: other things may use it, and it holds no data.
drop function if exists public.media_vector_search(text, integer);
drop function if exists public.media_vector_neighbors(uuid, integer);
drop function if exists public.media_embedding_capability();
drop function if exists public.media_embedding_health();
drop table if exists public.media_embeddings;
delete from public.site_settings where key = 'media_embed_state';

notify pgrst, 'reload schema';
