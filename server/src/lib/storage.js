import { requireSupabase } from "./supabase.js";
import { env } from "./env.js";

export const uploadAsset = async ({ file, folder = "uploads", prefix = "asset" }) => {
  if (!file) return null;

  const db = requireSupabase();
  const extension = (file.originalname?.split(".").pop() || "bin").toLowerCase();
  const safePrefix = `${prefix}`.replace(/[^a-z0-9_-]/gi, "_");
  const safeFolder = `${folder}`.replace(/[^a-z0-9/_-]/gi, "_");
  const path = `${safeFolder}/${Date.now()}-${safePrefix}.${extension}`;

  const { error } = await db.storage.from(env.supabaseStorageBucket).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (!error) {
    const { data } = db.storage.from(env.supabaseStorageBucket).getPublicUrl(path);
    return data.publicUrl;
  }

  throw Object.assign(new Error('Image upload is unavailable. Please retry later; no record has been saved.'),
    {status:503,code:'UPLOAD_STORAGE_UNAVAILABLE',cause:error});
};


// Cleanup only an image URL minted by this server, never an arbitrary URL supplied by a client.
export const cleanupNewPublicAsset = async (url) => {
  if (!url) return;
  try {
    const target = new URL(url);
    const prefix = new URL(`/storage/v1/object/public/${env.supabaseStorageBucket}/`, env.supabaseUrl);
    if (target.origin !== prefix.origin || !target.pathname.startsWith(prefix.pathname)) return;
    const path = decodeURIComponent(target.pathname.slice(prefix.pathname.length));
    if (!path.startsWith('project-suggestions/') || path.includes('..')) return;
    const {error} = await requireSupabase().storage.from(env.supabaseStorageBucket).remove([path]);
    if (error) console.warn('[UPLOAD CLEANUP FAILED]',error.code || error.message);
  } catch(e) { console.warn('[UPLOAD CLEANUP FAILED]',e.message); }
};
