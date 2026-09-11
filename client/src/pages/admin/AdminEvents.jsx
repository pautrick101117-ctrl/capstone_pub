import { CalendarPlus, Clock3, Edit3, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SegmentedTabs, SelectInput, TableShell, TextArea, TextInput } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useMasterData } from "../../hooks/useMasterData";

const pageSize = 8;
const emptyEvent = { id: "", title: "", date: "", time: "", location: "", description: "", type: "" };
const emptySlot = { id: "", slotDate: "", startTime: "", endTime: "", capacity: 1, isActive: true };

const parseSlotTimes = (value = "") => {
  const [startTime = "", endTime = ""] = `${value}`.split(" - ").map((item) => item.trim());
  return { startTime, endTime };
};

const AdminEvents = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [activeTab, setActiveTab] = useState("events");
  const [eventPage, setEventPage] = useState(1);
  const [slotPage, setSlotPage] = useState(1);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [slotForm, setSlotForm] = useState(emptySlot);
  const [eventOpen, setEventOpen] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const [deleteEvent, setDeleteEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { options: eventTypeOptions } = useMasterData("event_category");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [eventData, slotData] = await Promise.all([api("/admin/events", { token }), api("/admin/id_pickup_slots", { token })]);
      setEvents(eventData.events || []); setSlots(slotData.id_pickup_slots || []);
    } catch (loadError) { setError(loadError.message || "Unable to load events and pickup slots."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (token) load(); }, [token]);

  const visibleEvents = useMemo(() => events.slice((eventPage - 1) * pageSize, eventPage * pageSize), [events, eventPage]);
  const visibleSlots = useMemo(() => slots.slice((slotPage - 1) * pageSize, slotPage * pageSize), [slots, slotPage]);

  const openEventCreate = () => { setEventForm(emptyEvent); setEventOpen(true); };
  const openEventEdit = (item) => { setEventForm({ id: item.id, title: item.title || "", date: item.date ? `${item.date}`.slice(0, 10) : "", time: item.time || "", location: item.location || "", description: item.description || "", type: item.type || "" }); setEventOpen(true); };
  const openSlotCreate = () => { setSlotForm(emptySlot); setSlotOpen(true); };
  const openSlotEdit = (slot) => { const times = parseSlotTimes(slot.time_slot); setSlotForm({ id: slot.id, slotDate: slot.slot_date ? `${slot.slot_date}`.slice(0, 10) : "", ...times, capacity: slot.capacity || 1, isActive: slot.is_active ?? true }); setSlotOpen(true); };

  const saveEvent = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await api(eventForm.id ? `/admin/events/${eventForm.id}` : "/admin/events", { method: eventForm.id ? "PATCH" : "POST", token, body: eventForm });
      toast.success(eventForm.id ? "Event updated." : "Event published."); setEventOpen(false); setEventForm(emptyEvent); await load();
    } catch (saveError) { toast.error(saveError.message); } finally { setSaving(false); }
  };

  const removeEvent = async () => {
    if (!deleteEvent) return; setSaving(true);
    try { await api(`/admin/events/${deleteEvent.id}`, { method: "DELETE", token }); toast.success("Event deleted."); setDeleteEvent(null); await load(); }
    catch (deleteError) { toast.error(deleteError.message); } finally { setSaving(false); }
  };

  const saveSlot = async (event) => {
    event.preventDefault();
    if (!slotForm.slotDate || !slotForm.startTime || !slotForm.endTime) return toast.error("Date, start time, and end time are required.");
    if (slotForm.endTime <= slotForm.startTime) return toast.error("End time must be after the start time.");
    const capacity = Number(slotForm.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) return toast.error("Capacity must be a positive whole number.");
    setSaving(true);
    try {
      const body = { ...slotForm, capacity, timeSlot: `${slotForm.startTime} - ${slotForm.endTime}` };
      await api(slotForm.id ? `/admin/id_pickup_slots/${slotForm.id}` : "/admin/id_pickup_slots", { method: slotForm.id ? "PATCH" : "POST", token, body });
      toast.success(slotForm.id ? "Pickup slot updated." : "Pickup slot created."); setSlotOpen(false); setSlotForm(emptySlot); await load();
    } catch (saveError) { toast.error(saveError.message); } finally { setSaving(false); }
  };

  return <div className="space-y-8">
    <PageHeader eyebrow="Events and Scheduling" title="Manage events and ID pickup availability" description="Public community events and resident ID pickup windows are separated so each workflow stays easy to scan." actions={activeTab === "events" ? <Button onClick={openEventCreate}><Plus className="h-4 w-4" /> Add Event</Button> : <Button onClick={openSlotCreate}><Clock3 className="h-4 w-4" /> Add Pickup Slot</Button>} />
    <SegmentedTabs value={activeTab} onChange={setActiveTab} items={[{ value: "events", label: "Public Events", count: events.length }, { value: "slots", label: "ID Pickup Slots", count: slots.length }]} />
    {error ? <ErrorState description={error} onRetry={load} /> : null}
    {!error && loading ? <LoadingState rows={5} /> : null}

    {!error && !loading && activeTab === "events" ? <Card>
      <div className="mb-5 flex items-center gap-3"><CalendarPlus className="h-5 w-5 text-[var(--brand-600)]" /><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Public Events</h2><p className="mt-1 text-sm text-stone-500">Events can be created, edited, or deleted before/after publication. Deleting permanently removes the public calendar entry.</p></div></div>
      {!events.length ? <EmptyState title="No public events scheduled" description="Create an event when the barangay has an activity residents should see." action={<Button onClick={openEventCreate}>Add Event</Button>} /> : <><TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Event</th><th className="px-4 py-3 font-semibold">Schedule</th><th className="px-4 py-3 font-semibold">Location</th><th className="px-4 py-3 font-semibold">Actions</th></tr></thead><tbody>{visibleEvents.map((item) => <tr key={item.id} className="border-t border-stone-100"><td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{item.title}</p><p className="mt-1 text-xs text-stone-500">{item.type}</p></td><td className="px-4 py-4 text-stone-600">{formatDate(item.date)}{item.time ? ` · ${item.time}` : ""}</td><td className="px-4 py-4 text-stone-600">{item.location || "Not set"}</td><td className="px-4 py-4"><div className="flex gap-2"><Button variant="secondary" onClick={() => openEventEdit(item)}><Edit3 className="h-4 w-4" /> Edit</Button><Button variant="danger" onClick={() => setDeleteEvent(item)}><Trash2 className="h-4 w-4" /> Delete</Button></div></td></tr>)}</tbody></table></TableShell><Pagination page={eventPage} totalPages={Math.max(1, Math.ceil(events.length / pageSize))} onPageChange={setEventPage} /></>}
    </Card> : null}

    {!error && !loading && activeTab === "slots" ? <Card>
      <div className="mb-5"><h2 className="text-xl font-bold text-[var(--brand-900)]">ID Pickup Slots</h2><p className="mt-1 text-sm text-stone-500">Pickup slots are not deleted once used for scheduling. Edit them or deactivate them to stop new bookings while preserving appointment history.</p></div>
      {!slots.length ? <EmptyState title="No pickup slots configured" description="Add an available date and time before residents can schedule Barangay ID pickup." action={<Button onClick={openSlotCreate}>Add Pickup Slot</Button>} /> : <><TableShell><table className="min-w-full text-sm"><thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Time</th><th className="px-4 py-3 font-semibold">Capacity</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Action</th></tr></thead><tbody>{visibleSlots.map((slot) => <tr key={slot.id} className="border-t border-stone-100"><td className="px-4 py-4 text-stone-600">{formatDate(slot.slot_date)}</td><td className="px-4 py-4 text-stone-600">{slot.time_slot}</td><td className="px-4 py-4 text-stone-600">{slot.capacity}</td><td className="px-4 py-4"><Badge tone={slot.is_active ? "success" : "neutral"}>{slot.is_active ? "Active" : "Inactive"}</Badge></td><td className="px-4 py-4"><Button variant="secondary" onClick={() => openSlotEdit(slot)}><Edit3 className="h-4 w-4" /> Edit</Button></td></tr>)}</tbody></table></TableShell><Pagination page={slotPage} totalPages={Math.max(1, Math.ceil(slots.length / pageSize))} onPageChange={setSlotPage} /></>}
    </Card> : null}

    <Modal open={eventOpen} onClose={() => !saving && setEventOpen(false)} closeDisabled={saving} title={eventForm.id ? "Edit Public Event" : "Add Public Event"} description="This information is visible in the public calendar."><form className="grid gap-4 sm:grid-cols-2" onSubmit={saveEvent}><TextInput label="Title" required maxLength={120} value={eventForm.title} onChange={(e) => setEventForm((v) => ({ ...v, title: e.target.value }))} /><SelectInput label="Type" required value={eventForm.type} onChange={(e) => setEventForm((v) => ({ ...v, type: e.target.value }))}><option value="">Select event type</option>{eventTypeOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput><TextInput label="Date" required type="date" value={eventForm.date} onChange={(e) => setEventForm((v) => ({ ...v, date: e.target.value }))} /><TextInput label="Time" type="time" value={eventForm.time} onChange={(e) => setEventForm((v) => ({ ...v, time: e.target.value }))} /><TextInput label="Location" required className="sm:col-span-2" value={eventForm.location} onChange={(e) => setEventForm((v) => ({ ...v, location: e.target.value }))} /><TextArea label="Description" className="sm:col-span-2" value={eventForm.description} onChange={(e) => setEventForm((v) => ({ ...v, description: e.target.value }))} /><div className="sm:col-span-2 flex gap-3"><Button type="submit" loading={saving}>{eventForm.id ? "Save Changes" : "Publish Event"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setEventOpen(false)}>Cancel</Button></div></form></Modal>
    <Modal open={slotOpen} onClose={() => !saving && setSlotOpen(false)} closeDisabled={saving} title={slotForm.id ? "Edit Pickup Slot" : "Add Pickup Slot"} description="Deactivate an existing slot instead of deleting it so appointment history stays intact."><form className="grid gap-4 sm:grid-cols-2" onSubmit={saveSlot}><TextInput label="Date" required type="date" value={slotForm.slotDate} onChange={(e) => setSlotForm((v) => ({ ...v, slotDate: e.target.value }))} /><TextInput label="Capacity" required type="number" min="1" value={slotForm.capacity} onChange={(e) => setSlotForm((v) => ({ ...v, capacity: e.target.value }))} /><TextInput label="Start Time" required type="time" value={slotForm.startTime} onChange={(e) => setSlotForm((v) => ({ ...v, startTime: e.target.value }))} /><TextInput label="End Time" required type="time" value={slotForm.endTime} onChange={(e) => setSlotForm((v) => ({ ...v, endTime: e.target.value }))} /><SelectInput label="Status" value={slotForm.isActive ? "active" : "inactive"} onChange={(e) => setSlotForm((v) => ({ ...v, isActive: e.target.value === "active" }))}><option value="active">Active</option><option value="inactive">Inactive</option></SelectInput><div className="sm:col-span-2 flex gap-3"><Button type="submit" loading={saving}>{slotForm.id ? "Save Changes" : "Create Slot"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setSlotOpen(false)}>Cancel</Button></div></form></Modal>
    <ConfirmDialog open={Boolean(deleteEvent)} onClose={() => !saving && setDeleteEvent(null)} onConfirm={removeEvent} loading={saving} title="Delete this public event?" description={deleteEvent ? `“${deleteEvent.title}” will be permanently removed from the public calendar.` : ""} confirmLabel="Delete Event" />
  </div>;
};

export default AdminEvents;
