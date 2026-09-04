import { CalendarDays, Edit3, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageError,
  PageHeader,
  Pagination,
  ResponsiveListTable,
  SelectInput,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDate } from "../../lib/format";

const emptyEvent = { id: "", title: "", date: "", time: "", location: "", description: "", type: "general" };
const pageSize = 8;

const AdminEvents = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [eventOpen, setEventOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const eventData = await api("/admin/events", { token });
      setEvents(eventData.events || []);
    } catch (loadError) {
      setError(loadError.message || "Could not load events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
  }, [token]);

  const orderedEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        const left = `${a.date || ""}T${a.time || "00:00"}`;
        const right = `${b.date || ""}T${b.time || "00:00"}`;
        return left.localeCompare(right);
      }),
    [events]
  );

  const totalPages = Math.max(1, Math.ceil(orderedEvents.length / pageSize));
  const paginatedEvents = orderedEvents.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openCreate = () => {
    setEventForm(emptyEvent);
    setEventOpen(true);
  };

  const openEdit = (item) => {
    setEventForm({
      id: item.id,
      title: item.title || "",
      date: item.date || "",
      time: item.time || "",
      location: item.location || "",
      description: item.description || "",
      type: item.type || "general",
    });
    setEventOpen(true);
  };

  const saveEvent = async (event) => {
    event.preventDefault();
    if (!eventForm.title.trim() || !eventForm.date) {
      toast.error("Event title and date are required.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        title: eventForm.title,
        date: eventForm.date,
        time: eventForm.time,
        location: eventForm.location,
        description: eventForm.description,
        type: eventForm.type,
      };
      if (eventForm.id) {
        await api(`/admin/events/${eventForm.id}`, { method: "PATCH", token, body });
        toast.success("Event updated.");
      } else {
        await api("/admin/events", { method: "POST", token, body });
        toast.success("Event posted.");
      }
      setEventForm(emptyEvent);
      setEventOpen(false);
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/admin/events/${deleteTarget.id}`, { method: "DELETE", token });
      toast.success("Event deleted.");
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      toast.error(deleteError.message);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Community Calendar"
        title="Manage barangay events"
        description="Create and maintain public community events here. Barangay ID pickup availability now lives under Requests → Pickup Slots."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        }
      />

      {error ? <PageError title="Could not load events" message={error} onRetry={load} /> : null}

      {!error ? (
        <Card>
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Events</h2>
              <p className="mt-1 text-sm text-stone-500">These records power the public calendar and upcoming-event previews.</p>
            </div>
          </div>

          {loading ? (
            <p className="py-8 text-sm text-stone-500">Loading events...</p>
          ) : !orderedEvents.length ? (
            <EmptyState title="No events yet" description="Create the first barangay event to publish it on the public calendar." />
          ) : (
            <>
              <ResponsiveListTable
                headers={["Event", "Schedule", "Location", "Actions"]}
                rows={paginatedEvents}
                rowKey={(item) => item.id}
                renderDesktopRow={(item) => (
                  <tr key={item.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-[var(--brand-900)]">{item.title}</p>
                      <p className="mt-1 text-xs text-stone-500">{item.type || "general"}</p>
                      {item.description ? <p className="mt-2 max-w-xl text-xs text-stone-500">{item.description}</p> : null}
                    </td>
                    <td className="px-4 py-4 text-stone-600">{formatDate(item.date)}{item.time ? ` · ${item.time}` : ""}</td>
                    <td className="px-4 py-4 text-stone-600">{item.location || "—"}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" className="px-3 py-2" onClick={() => openEdit(item)}>
                          <Edit3 className="h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" className="px-3 py-2 text-rose-700" onClick={() => setDeleteTarget(item)}>
                          <Trash2 className="h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
                renderMobileCard={(item) => (
                  <Card className="space-y-3 p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-500)]">{item.type || "general"}</p>
                      <h3 className="mt-1 text-lg font-bold text-[var(--brand-900)]">{item.title}</h3>
                    </div>
                    <div className="space-y-1 text-sm text-stone-600">
                      <p>{formatDate(item.date)}{item.time ? ` · ${item.time}` : ""}</p>
                      <p>{item.location || "Location not specified"}</p>
                    </div>
                    {item.description ? <p className="text-sm text-stone-500">{item.description}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => openEdit(item)}><Edit3 className="h-4 w-4" /> Edit</Button>
                      <Button variant="ghost" className="text-rose-700" onClick={() => setDeleteTarget(item)}><Trash2 className="h-4 w-4" /> Delete</Button>
                    </div>
                  </Card>
                )}
              />
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </Card>
      ) : null}

      <Modal
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        title={eventForm.id ? "Edit Public Event" : "Add Public Event"}
        description="Set the public details residents should see on the community calendar."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveEvent}>
          <TextInput label="Title" className="sm:col-span-2" value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} />
          <SelectInput label="Type" value={eventForm.type} onChange={(event) => setEventForm((current) => ({ ...current, type: event.target.value }))}>
            <option value="general">General</option>
            <option value="meeting">Meeting</option>
            <option value="health">Health</option>
            <option value="sports">Sports</option>
            <option value="community">Community</option>
            <option value="deadline">Deadline</option>
          </SelectInput>
          <TextInput label="Date" type="date" value={eventForm.date} onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))} />
          <TextInput label="Time" type="time" value={eventForm.time} onChange={(event) => setEventForm((current) => ({ ...current, time: event.target.value }))} />
          <TextInput label="Location" className="sm:col-span-2" value={eventForm.location} onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))} />
          <TextArea label="Description" className="sm:col-span-2" value={eventForm.description} onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))} />
          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>{eventForm.id ? "Save Changes" : "Save Event"}</Button>
            <Button type="button" variant="ghost" onClick={() => setEventOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteEvent}
        title="Delete event?"
        description={deleteTarget ? `“${deleteTarget.title}” will be removed from the public calendar.` : ""}
        confirmLabel="Delete Event"
        danger
      />
    </div>
  );
};

export default AdminEvents;
