import { randomUUID } from 'node:crypto';
import { requireSupabase } from './supabase.js';
import { identifyImage } from './residentIdValidation.js';

export const CONCERN_BUCKET = 'barangay-concern-evidence';
export const saveConcernPhoto = async ({ complaintId, uploaderId, file }) => {
  const type = identifyImage(file?.buffer);
  if (!file || !type || type[0] !== file.mimetype || file.size > 5 * 1024 * 1024 || file.size < 100)
    throw Object.assign(new Error('Upload a genuine JPG, PNG or WebP photo, up to 5 MB.'), {status:400});
  const db = requireSupabase();
  const {data:exists,error:lookupError}=await db.from('concern_evidence').select('id').eq('complaint_id',complaintId).maybeSingle();
  if(lookupError)throw lookupError;
  if(exists)throw Object.assign(new Error('An incident photo is already attached to this concern.'), {status:409});
  const storage_path=`concerns/${complaintId}/${randomUUID()}.${type[1]}`;
  const result=await db.storage.from(CONCERN_BUCKET).upload(storage_path,file.buffer,{contentType:type[0],upsert:false});
  if(result.error)throw Object.assign(new Error('Could not upload incident photo.'),{status:503,cause:result.error});
  const {data,error}=await db.from('concern_evidence').insert({complaint_id:complaintId,uploaded_by:uploaderId,storage_path,content_type:type[0],byte_size:file.size}).select('id,complaint_id,created_at').single();
  if(error){
    await db.storage.from(CONCERN_BUCKET).remove([storage_path]);
    if(error.code==='23505')throw Object.assign(new Error('An incident photo was already attached.'),{status:409});
    throw error;
  }
  return data;
};
export const getConcernPhotoUrl = async (complaintId) => {
  const db=requireSupabase();
  const {data,error}=await db.from('concern_evidence').select('id,storage_path,content_type').eq('complaint_id',complaintId).maybeSingle();
  if(error)throw error;
  if(!data)return null;
  const signed=await db.storage.from(CONCERN_BUCKET).createSignedUrl(data.storage_path,60);
  if(signed.error)throw signed.error;
  return {id:data.id,url:signed.data.signedUrl,expiresIn:60};
};
