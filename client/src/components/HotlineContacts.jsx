import { Phone } from "lucide-react";

// Only render backend-configured active numbers. The API canonicalizes them
// to 09XXXXXXXXX and excludes inactive lines before sending public data.
export default function HotlineContacts({ hotlines = [], compact = false }) {
  const visible = (Array.isArray(hotlines) ? hotlines : []).filter((item) =>
    item && item.is_active !== false && /^09\d{9}$/.test(String(item.phone || ""))
  );
  if (!visible.length) return null;
  return (
    <div className={compact ? "flex flex-wrap gap-3" : "mt-4 grid gap-3 sm:grid-cols-2"}>
      {visible.map((item) => (
        <div key={item.id || item.phone} className={compact
          ? "min-w-0 space-y-1 text-sm"
          : "min-w-0 rounded-2xl border border-rose-200 bg-white p-4 shadow-sm"}>
          <p className="font-semibold text-stone-800">{item.label || "Barangay Hotline"}</p>
          <a href={`tel:${item.phone}`} aria-label={`Call ${item.label || "barangay hotline"} at ${item.phone}`}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-200">
            <Phone className="h-4 w-4" aria-hidden="true" />{item.phone}
          </a>
          {item.hours ? <p className="mt-2 text-xs text-stone-600">Availability: {item.hours}</p> : null}
          {item.note ? <p className="mt-1 text-xs leading-5 text-stone-600">{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}
