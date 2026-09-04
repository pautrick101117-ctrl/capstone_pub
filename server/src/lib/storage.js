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

  const fallbackUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  console.log(
    `[UPLOAD FALLBACK] Bucket upload failed for ${file.originalname || "asset"} in ${folder}. Using inline data URL. Reason: ${error.message}`
  );
  return fallbackUrl;
};
