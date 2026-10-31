import { useEffect, useRef, useState } from "react";
import { documentBlob } from "../lib/documents";
import { useAuth } from "../context/auth";
export default function WordPreview({ file }) {
  const { token } = useAuth();
  const frame = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const [blob, { renderAsync }] = await Promise.all([
          documentBlob(`/files/${file.id}`, token),
          import("docx-preview"),
        ]);
        if (cancelled) return;
        const doc = frame.current?.contentDocument;
        if (!doc) return;
        doc.body.replaceChildren();
        await renderAsync(await blob.arrayBuffer(), doc.body, undefined, {
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          ignoreLastRenderedPageBreak: true,
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [file.id, token]);
  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        Preview of this Word file. Check pagination in Microsoft Word before
        printing.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <iframe
        ref={frame}
        title={`Word preview version ${file.version_number}`}
        sandbox="allow-same-origin"
        className="h-[600px] w-full rounded-xl border bg-stone-100"
      />
    </div>
  );
}
