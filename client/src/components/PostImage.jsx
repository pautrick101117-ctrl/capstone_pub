import { Eye } from "lucide-react";
import { useState } from "react";
import { Modal } from "./ui";

/**
 * Keep the whole uploaded photograph or poster visible in its frame.
 * When clickable, use the existing accessible modal with a full-size view.
 * Set interactive={false} for images inside links or buttons.
 */
export default function PostImage({
  src,
  alt = "Post image",
  frameClassName = "",
  imageClassName = "",
  interactive = true,
  compact = false,
  loading = "lazy",
}) {
  const [fullImageOpen, setFullImageOpen] = useState(false);
  const [failedSource, setFailedSource] = useState(null);
  if (!src) return null;
  const failed = failedSource === src;

  const image = (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setFailedSource(src)}
      className={`block h-full w-full object-contain ${imageClassName}`}
    />
  );

  return (
    <>
      <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 ${frameClassName}`}>
        {failed ? (
          <p className="flex h-full min-h-20 items-center justify-center px-3 text-center text-xs text-stone-500" role="status">
            Image unavailable. Please check the uploaded file or image link.
          </p>
        ) : interactive ? (
          <button
            type="button"
            className="group relative flex h-full w-full items-center justify-center text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--brand-200)]"
            onClick={() => setFullImageOpen(true)}
            aria-label={`View full image: ${alt}`}
            title="View full image"
          >
            {image}
            <span className={`absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/95 p-2 text-xs font-semibold text-stone-800 shadow-sm transition group-hover:bg-white ${compact ? "" : "sm:bottom-3 sm:right-3 sm:px-3"}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />{compact ? null : <span>View full image</span>}
            </span>
          </button>
        ) : image}
      </div>
      {interactive && !failed ? (
        <Modal
          open={fullImageOpen}
          onClose={() => setFullImageOpen(false)}
          title="Full image"
          description="The complete uploaded picture is shown below."
          widthClass="max-w-6xl"
          stacked
        >
          <div className="flex min-h-32 items-center justify-center rounded-2xl bg-stone-50 p-2 sm:p-4">
            <img
              src={src}
              alt={alt}
              className="block h-auto max-h-[calc(100vh-16rem)] w-auto max-w-full object-contain"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-stone-500">Open the original image for a closer view of small text.</p>
            <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-[var(--brand-200)] px-4 py-2 text-sm font-semibold text-[var(--brand-700)] hover:bg-[var(--brand-50)]">
              Open original image
            </a>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
