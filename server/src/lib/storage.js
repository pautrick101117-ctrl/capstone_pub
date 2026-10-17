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
