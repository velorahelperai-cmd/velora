-- VEL-KNOWLEDGE-RELEASE-FIX-01
-- Attach existing invalidation helpers (from vel_knowledge_answer_foundation)
-- to storage.objects so owner INSERT/UPDATE/DELETE/move cannot leave approved text.
--
-- Why a new file: 20261005093000 is already applied as 20261005141747.
-- Do not edit the applied file. Do not apply 20261005160000 with this package.
--
-- Official pattern: AFTER ROW trigger on the table event
-- (https://supabase.com/docs/guides/database/postgres/triggers).
-- Database Webhooks are the same mechanism plus HTTP; not needed here.
-- This project already has triggers on storage.objects
-- (protect_objects_delete, update_objects_updated_at), so CREATE TRIGGER is allowed.
--
-- Restore (real): DROP TRIGGER IF EXISTS knowledge_invalidate_storage_objects ON storage.objects;
-- Helpers in private.* stay; answer eligibility then relies on app writes + read-time checks only.

drop trigger if exists knowledge_invalidate_storage_objects on storage.objects;

create trigger knowledge_invalidate_storage_objects
  after insert or update or delete on storage.objects
  for each row
  execute function private.knowledge_invalidate_for_storage_object();
