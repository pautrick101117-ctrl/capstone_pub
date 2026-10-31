-- Read-only checks after applying the additive Phase 11 migration.
SELECT public.bgy_phase11_ready() AS phase11_ready;
SELECT status,count(*) FROM public.requests GROUP BY status ORDER BY status;
-- Historical completed records must remain unchanged; claimed_at was never backfilled.
SELECT count(*) AS historical_completed_with_claim_date FROM public.requests WHERE status='completed' AND claimed_at IS NOT NULL;
SELECT control_number,count(*) FROM public.requests WHERE control_number IS NOT NULL GROUP BY control_number HAVING count(*)>1;
SELECT id,name,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='barangay-documents';
SELECT document_type,version,approval_state,approved_by,approved_at FROM public.document_templates ORDER BY document_type,version;
SELECT conname,convalidated,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.requests'::regclass AND contype='c';
SELECT request_id,count(*) AS versions,max(version_number) AS latest_version FROM public.generated_documents GROUP BY request_id;
SELECT attempt_status,count(*) FROM public.notification_logs GROUP BY attempt_status;
SELECT proname,has_function_privilege('anon',oid,'EXECUTE') AS anon_can_execute,has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated_can_execute
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('bgy_document_transition','bgy_document_save_version','bgy_document_attach','bgy_document_remove_attachment');
SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('document_templates','document_number_counters','generated_documents','request_attachments','notification_logs');
-- Review anomalies rather than automatically rewriting historical data.
SELECT status,count(*) AS records FROM public.requests WHERE status NOT IN
 ('submitted','acknowledged','processing','completed','under_review','needs_revision','rejected','approved','document_prepared','ready_for_pickup','claimed','cancelled') GROUP BY status;
SELECT count(*) AS invalid_legacy_copy_counts FROM public.requests WHERE copies_requested NOT BETWEEN 1 AND 10;
