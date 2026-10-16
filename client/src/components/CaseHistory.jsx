import { formatDateTime } from "../lib/format";

const LABELS = {
  submitted: "Submitted", status_changed: "Status updated", schedule_changed: "Pickup schedule changed", response_added: "New barangay response",
  internal_note: "Internal staff note", legacy_note: "Previous barangay note",
};
const readable = (value) => `${value || ""}`.replace(/_/g, " ");

// The server filters resident responses; never rely on client-side hiding for privacy.
export default function CaseHistory({ events = [], compact = false, title = "Activity & response history" }) {
  const ordered = [...(events || [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || `${a.id}`.localeCompare(`${b.id}`));
  return (
    <section aria-label={title} className={`rounded-2xl border border-stone-200 bg-white ${compact ? "mt-3 p-3" : "mt-5 p-4"}`}>
      <h3 className="text-sm font-bold text-[var(--brand-900)]">{title}</h3>
      {!ordered.length ? <p className="mt-3 text-sm text-stone-500">No updates recorded yet.</p> : (
        <ol className="mt-4 space-y-4 border-l-2 border-[var(--brand-100)] pl-4">
          {ordered.map((event) => (
            <li key={event.id} className="relative text-sm">
              <span aria-hidden="true" className="absolute -left-[1.35rem] top-1 h-2 w-2 rounded-full bg-[var(--brand-500)]" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="font-semibold text-stone-800">{LABELS[event.event_type] || readable(event.event_type)}</strong>
                <time dateTime={event.created_at} className="text-xs text-stone-500">{event.metadata?.original_time_unknown ? `Imported ${formatDateTime(event.created_at)}` : formatDateTime(event.created_at)}</time>
              </div>
              {event.event_type === "legacy_note" || event.metadata?.original_author_unknown ? (
                <p className="mt-1 text-xs text-amber-700">Imported earlier note — original author/time not recorded</p>
              ) : <p className="mt-1 text-xs text-stone-500">{event.actor_name_snapshot || (event.actor_role === "resident" ? "Resident" : "Barangay staff / system")}</p>}
              {event.previous_status !== event.new_status && event.new_status ? (
                <p className="mt-1 text-xs text-stone-600">{event.previous_status ? `${readable(event.previous_status)} → ` : ""}{readable(event.new_status)}</p>
              ) : null}
              {event.visibility === "internal" ? <span className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Staff only</span> : null}
              {event.message ? <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-stone-50 p-3 leading-6 text-stone-700">{event.message}</p> : null}
              {event.metadata?.return_condition ? <p className="mt-1 text-xs text-stone-600">Return condition: {readable(event.metadata.return_condition)} · Quantity: {event.metadata.returned_quantity ?? "—"}</p> : null}
              {event.metadata?.preferred_date ? <p className="mt-1 text-xs text-stone-600">Pickup: {event.metadata.previous_preferred_date ? `${event.metadata.previous_preferred_date} ${event.metadata.previous_time_slot || ""} → ` : ""}{event.metadata.preferred_date} {event.metadata.time_slot || ""}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
