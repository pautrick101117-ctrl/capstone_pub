import { useEffect, useRef, useState } from "react";
import { documentBlob } from "../lib/documents";
import { useAuth } from "../context/auth";

// Can show either a saved private version or an unsaved DOCX returned by
// the template-preview endpoint. Both use the same Word renderer.
export default function WordPreview({ file, blob, title }) {
  const { token } = useAuth();
  const frame = useRef(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      setError("");
      setLoading(true);
      try {
        const [source, { renderAsync }] = await Promise.all([
          blob ? Promise.resolve(blob) : documentBlob(`/files/${file.id}`, token),
          import("docx-preview"),
        ]);
        if (cancelled) return;
        const doc = frame.current?.contentDocument;
        if (!doc) throw new Error("Word preview frame is not available.");
        doc.body.replaceChildren();
        await renderAsync(await source.arrayBuffer(), doc.body, undefined, {
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          ignoreLastRenderedPageBreak: true,
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    render();
    return () => { cancelled = true; };
  }, [file?.id, blob, token]);
  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        Preview of the generated Word document. Check pagination in Microsoft Word before printing.
      </p>
      {loading ? <p role="status" className="mb-2 text-xs text-stone-600">Rendering Word document…</p> : null}
      {error ? <p role="alert" className="mb-2 text-sm text-rose-700">{error}</p> : null}
      <iframe
        ref={frame}
        title={title || `Word preview version ${file?.version_number || "draft"}`}
        sandbox="allow-same-origin"
        className="h-[min(66vh,850px)] min-h-[450px] w-full rounded-xl border bg-stone-100"
      />
    </div>
  );
}
