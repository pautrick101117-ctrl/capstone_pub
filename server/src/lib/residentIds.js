import { randomUUID } from 'node:crypto';
import { requireSupabase } from './supabase.js';

export const ID_BUCKET = 'barangay-resident-ids';
import { validateIdFiles } from './residentIdValidation.js';
export { validateIdFiles } from './residentIdValidation.js';
export const uploadPrivateIds = async (items, residentId, actorId) => {
  const db = requireSupabase();
  const uploaded = [];
  try {
    for (const item of items) {
      const storage_path = `resident-ids/${residentId}/${randomUUID()}.${item.ext}`;
      const result = await db.storage.from(ID_BUCKET).upload(storage_path, item.file.buffer, { contentType: item.mime, upsert:false });
      if (result.error) throw result.error;
      uploaded.push({ user_id: residentId, document_type_id: item.document_type_id,
        document_label: item.document_label, storage_path, content_type:item.mime,
        byte_size:item.file.size, uploaded_by:actorId });
    }
    const { error } = await db.from('resident_id_evidence').insert(uploaded);
    if (error) throw error;
    return uploaded;
  } catch (error) {
    await removePrivateIds(uploaded.map(item=>item.storage_path));
    throw Object.assign(new Error('Could not securely save the ID documents. Account was not created.'),
      { status:502, code:'ID_UPLOAD_FAILED', cause:error });
  }
};

export const removePrivateIds = async (paths) => {
  if (!paths?.length) return;
  const { error } = await requireSupabase().storage.from(ID_BUCKET).remove(paths);
  if (error) console.error('[PRIVATE ID CLEANUP]', error.message);
};
