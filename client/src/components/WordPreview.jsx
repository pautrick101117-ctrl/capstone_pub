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
  const [zoom, setZoom] = useState(100);
  const [retryCount, setRetryCount] = useState(0);
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
        doc.body.style.zoom = `${zoom}%`;
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
  }, [file?.id, blob, token, retryCount]);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (doc) doc.body.style.zoom = `${zoom}%`;
  }, [zoom]);
  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        Preview of the generated Word document. Check pagination in Microsoft Word before printing.
      </p>
      {loading ? <p role="status" className="mb-2 text-xs text-stone-600">Rendering Word document…</p> : null}
      {error ? <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <span>Document preview failed: {error}</span>
        <button type="button" className="min-h-11 rounded-xl border border-rose-300 bg-white px-4 font-semibold" onClick={() => setRetryCount(n => n + 1)}>Try again</button>
      </div> : null}
      <div className="mb-3 flex items-center gap-3">
        <label className="text-sm font-semibold" htmlFor="document-zoom">Preview size</label>
        <select id="document-zoom" aria-label="Preview zoom" className="min-h-11 rounded-xl border border-stone-300 bg-white px-3" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {[75,100,125,150,200].map((n) => <option key={n} value={n}>{n}%</option>)}
        </select>
      </div>
      <iframe
        ref={frame}
        title={title || `Word preview version ${file?.version_number || "draft"}`}
        sandbox="allow-same-origin"
        className="h-[min(66vh,850px)] min-h-[450px] w-full rounded-xl border bg-stone-100"
      />
    </div>
  );
}
