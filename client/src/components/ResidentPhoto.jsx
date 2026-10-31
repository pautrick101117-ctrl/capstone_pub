import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { documentBlob } from "../lib/documents";
import { useAuth } from "../context/auth";
import { Button } from "./ui";
export function PrivateImage({
  path,
  alt = "Resident photo",
  className = "h-32 w-28 rounded-xl object-contain",
}) {
  const { token } = useAuth();
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let url;
    documentBlob(path, token)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (live) {
          setSrc(url);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, token]);
  return error ? (
    <p role="status" className="text-sm text-stone-500">
      {error}
    </p>
  ) : src ? (
    <img src={src} alt={alt} className={className} />
  ) : (
    <p>Loading image…</p>
  );
}
export default function ResidentPhoto({ residentId, onChanged }) {
  const { token } = useAuth();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = residentId ? `/residents/${residentId}/photo` : "/profile/photo";
  const change = async (file) => {
    if (busy || !file) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG or WebP image up to 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("photo", file);
      await api(`/documents${path}`, { method: "POST", token, body });
      setVersion((v) => v + 1);
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/documents${path}`, { method: "DELETE", token });
      setVersion((v) => v + 1);
      await onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 p-4">
      <h3 className="font-semibold">Resident photo</h3>
      <PrivateImage key={`${residentId}-${version}`} path={path} />
      <label className="block text-sm font-semibold">
        Upload or replace photo
        <input
          disabled={busy}
          className="mt-2 block max-w-full text-sm"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => change(e.target.files?.[0])}
        />
      </label>
      <p className="text-xs text-stone-500">
        JPEG, PNG or WebP, up to 5 MB; 160–6000 pixels per side. A clear
        portrait is recommended.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="ghost" disabled={busy} onClick={remove}>
        Remove profile photo
      </Button>
    </div>
  );
}
