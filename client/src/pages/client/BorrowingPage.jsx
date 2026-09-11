import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Info,
  MapPin,
  PackageCheck,
  Phone,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  SelectInput,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { getBorrowingStatusMeta, isFacility, RETURN_CONDITION_LABELS } from "../../lib/borrowing";

const toLocalInput = (date) => {
  const d = new Date(date);
  const pad = (n) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const initialWindow = () => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setHours(8, 0, 0, 0);
  const due = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return { startAt: toLocalInput(start), dueAt: toLocalInput(due) };
};

const blankRequest = {
  assetId: "",
  quantity: 1,
  purpose: "",
  eventLocation: "",
  termsAccepted: false,
};

const guideSteps = [
  ["1", "Choose schedule", "Set when you need the resource and when it will be returned."],
  ["2", "Check availability", "Availability is calculated for your selected date and time."],
  ["3", "Select resource", "Choose a facility or item and the quantity you need."],
  ["4", "Review request", "Confirm your schedule, purpose, location, and borrowing rules."],
  ["5", "Wait for approval", "Submitting does not reserve a resource until the barangay approves it."],
  ["6", "Use / pick up", "Once released, the resource is recorded as currently in use."],
  ["7", "Return on time", "Return items by the due date so your request is not marked overdue."],
];

const BorrowingPage = () => {
  const { token, user, refreshNotifications } = useAuth();
  const toast = useToast();
  const [windowForm, setWindowForm] = useState(initialWindow);
  const [assets, setAssets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(blankRequest);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cancelRequest, setCancelRequest] = useState(null);
  const [mineLoading, setMineLoading] = useState(true);
  const [mineError, setMineError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");

  const minimumDateTime = useMemo(() => toLocalInput(new Date()), []);

  const loadMine = async () => {
    setMineLoading(true);
    setMineError("");
    try {
      const data = await api("/borrowing/mine", { token });
      setRequests(data.requests || []);
    } catch (loadError) {
      setMineError(loadError.message || "Unable to load your borrowing requests.");
    } finally {
      setMineLoading(false);
    }
  };

  const validateWindow = () => {
    const start = new Date(windowForm.startAt).getTime();
    const due = new Date(windowForm.dueAt).getTime();
    if (!windowForm.startAt || !windowForm.dueAt || Number.isNaN(start) || Number.isNaN(due)) {
      toast.error("Choose a valid borrowing start and return date.");
      return false;
    }
    if (start < Date.now() - 60_000) {
      toast.error("Borrowing start cannot be in the past.");
      return false;
    }
    if (due <= start) {
      toast.error("Return date must be after the borrowing start.");
      return false;
    }
    return true;
  };

  const checkAvailability = async () => {
    if (!validateWindow()) return;
    setChecking(true);
    setAvailabilityError("");
    try {
      const params = new URLSearchParams({
        startAt: new Date(windowForm.startAt).toISOString(),
        dueAt: new Date(windowForm.dueAt).toISOString(),
      });
      const data = await api(`/borrowing/assets?${params}`, { token });
      setAssets(data.assets || []);
      setAvailabilityChecked(true);
      if (form.assetId && !(data.assets || []).some((asset) => asset.id === form.assetId && asset.isAvailable)) {
        setForm((current) => ({ ...current, assetId: "", quantity: 1 }));
      }
    } catch (error) {
      setAvailabilityChecked(false);
      setAvailabilityError(error.message || "Unable to check resource availability.");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadMine();
    checkAvailability();
  }, [token]);

  const selected = useMemo(() => assets.find((asset) => asset.id === form.assetId) || null, [assets, form.assetId]);
  const facilities = useMemo(() => assets.filter((asset) => asset.category === "facility"), [assets]);
  const items = useMemo(() => assets.filter((asset) => asset.category === "item"), [assets]);

  const changeWindow = (key, value) => {
    setWindowForm((current) => ({ ...current, [key]: value }));
    setAvailabilityChecked(false);
    setForm((current) => ({ ...current, assetId: "", quantity: 1 }));
  };

  const selectAsset = (asset) => {
    if (!asset.isAvailable) return;
    setForm((current) => ({
      ...current,
      assetId: asset.id,
      quantity: isFacility(asset) ? 1 : Math.min(Math.max(Number(current.quantity) || 1, 1), asset.availableQuantity),
      eventLocation: isFacility(asset) ? asset.name : current.eventLocation,
    }));
  };

  const validateRequest = () => {
    if (!availabilityChecked) {
      toast.error("Check availability for your selected schedule first.");
      return false;
    }
    if (!selected || !selected.isAvailable) {
      toast.error("Choose an available facility or item.");
      return false;
    }
    const quantity = isFacility(selected) ? 1 : Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > selected.availableQuantity) {
      toast.error(`Enter a quantity between 1 and ${selected.availableQuantity}.`);
      return false;
    }
    if (form.purpose.trim().length < 5) {
      toast.error("Enter a short purpose for the borrowing request.");
      return false;
    }
    if (form.eventLocation.trim().length < 3) {
      toast.error("Enter where the facility or items will be used.");
      return false;
    }
    if (!form.termsAccepted) {
      toast.error("Please agree to the borrowing and return responsibility before continuing.");
      return false;
    }
    return validateWindow();
  };

  const openReview = (event) => {
    event.preventDefault();
    if (validateRequest()) setReviewOpen(true);
  };

  const submit = async () => {
    if (!validateRequest()) return;
    setSaving(true);
    try {
      const payload = {
        assetId: form.assetId,
        quantity: isFacility(selected) ? 1 : Number(form.quantity),
        purpose: form.purpose.trim(),
        eventLocation: form.eventLocation.trim(),
        termsAccepted: true,
        startAt: new Date(windowForm.startAt).toISOString(),
        dueAt: new Date(windowForm.dueAt).toISOString(),
      };
      const data = await api("/borrowing/requests", { method: "POST", token, body: payload });
      toast.success(data.message || "Borrowing request submitted for barangay review.");
      setForm(blankRequest);
      setReviewOpen(false);
      await Promise.all([loadMine(), checkAvailability(), refreshNotifications()]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelRequest) return;
    setSaving(true);
    try {
      const data = await api(`/borrowing/requests/${cancelRequest.id}/cancel`, { method: "POST", token });
      toast.success(data.message);
      setCancelRequest(null);
      await Promise.all([loadMine(), checkAvailability(), refreshNotifications()]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const resourceSection = (title, description, list) => (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--brand-900)]">{title}</h2>
        <p className="mt-1 text-sm text-stone-500">{description}</p>
      </div>
      {!list.length ? (
        <EmptyState title={`No ${title.toLowerCase()} available`} description="The barangay has no active resources in this category yet." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {list.map((asset) => {
            const selectedAsset = form.assetId === asset.id;
            return (
              <Card key={asset.id} className={`${!asset.isAvailable ? "opacity-70" : ""} ${selectedAsset ? "ring-2 ring-[var(--brand-400)]" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><PackageCheck className="h-5 w-5" /></div>
                  <Badge tone={asset.isAvailable ? "success" : "danger"}>{asset.isAvailable ? "Available" : "Unavailable"}</Badge>
                </div>
                <h3 className="mt-4 font-bold text-[var(--brand-900)]">{asset.name}</h3>
                <p className="mt-3 min-h-10 text-sm text-stone-600">{asset.description || "No description provided."}</p>
                <p className="mt-4 text-sm font-semibold text-[var(--brand-700)]">
                  {isFacility(asset)
                    ? (asset.isAvailable ? "Available for this schedule" : "Already reserved for this schedule")
                    : `${asset.availableQuantity} of ${asset.total_quantity} available`}
                </p>
                <Button
                  type="button"
                  variant={selectedAsset ? "primary" : "secondary"}
                  className="mt-4 w-full"
                  disabled={!asset.isAvailable}
                  onClick={() => selectAsset(asset)}
                >
                  {selectedAsset ? <><CheckCircle2 className="h-4 w-4" /> Selected</> : "Select"}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Barangay Resources"
        title="Borrow barangay facilities & equipment"
        description="Check availability and submit a borrowing request. A request is only reserved after it is approved by the barangay."
      />

      <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]"><Info className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-[var(--brand-900)]">How borrowing works</h2>
            <p className="mt-1 text-sm text-stone-600">Follow these steps so the barangay can confirm availability and keep resource records accurate.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {guideSteps.map(([number, title, description]) => (
            <div key={number} className="rounded-2xl border border-[var(--brand-100)] bg-white/90 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-500)] text-sm font-bold text-white">{number}</span>
                <p className="font-semibold text-[var(--brand-900)]">{title}</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-500">{description}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[var(--brand-900)]">1. Choose your borrowing schedule</h2>
          <p className="mt-1 text-sm text-stone-500">Select the full period you need the resource, including the expected return time.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
          <TextInput
            label="Borrow From *"
            type="datetime-local"
            min={minimumDateTime}
            value={windowForm.startAt}
            onChange={(event) => changeWindow("startAt", event.target.value)}
            required
          />
          <TextInput
            label="Return By *"
            type="datetime-local"
            min={windowForm.startAt || minimumDateTime}
            value={windowForm.dueAt}
            onChange={(event) => changeWindow("dueAt", event.target.value)}
            required
          />
          <Button type="button" onClick={checkAvailability} loading={checking}>
            <CalendarClock className="h-4 w-4" /> Check Availability
          </Button>
        </div>
        {!availabilityChecked && !availabilityError ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Schedule changed. Check availability before selecting a resource.
          </div>
        ) : availabilityChecked ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Availability shown below is for {formatDateTime(new Date(windowForm.startAt).toISOString())} to {formatDateTime(new Date(windowForm.dueAt).toISOString())}.
          </div>
        ) : null}
      </Card>

      {availabilityError ? <ErrorState title="We couldn't check resource availability" description={availabilityError} onRetry={checkAvailability} /> : null}
      {availabilityChecked ? (
        <div className="space-y-8">
          {resourceSection("Facilities", "Facilities are reserved as one whole resource for the selected schedule.", facilities)}
          {resourceSection("Equipment & Items", "For quantity-based resources, availability shows how many units remain for the selected schedule.", items)}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><ClipboardCheck className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">2. Complete your request</h2>
              <p className="mt-1 text-sm text-stone-500">You will review all details before the request is submitted.</p>
            </div>
          </div>

          <form className="mt-5 space-y-4" onSubmit={openReview}>
            <SelectInput
              label="Facility / Item *"
              value={form.assetId}
              onChange={(event) => {
                const asset = assets.find((item) => item.id === event.target.value);
                setForm((current) => ({
                  ...current,
                  assetId: event.target.value,
                  quantity: 1,
                  eventLocation: isFacility(asset) ? asset.name : (isFacility(selected) ? "" : current.eventLocation),
                }));
              }}
              required
              disabled={!availabilityChecked}
            >
              <option value="">Select an available resource</option>
              {assets.filter((asset) => asset.isAvailable).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}{isFacility(asset) ? "" : ` (${asset.availableQuantity} available)`}
                </option>
              ))}
            </SelectInput>

            {selected && !isFacility(selected) ? (
              <TextInput
                label={`Quantity * — ${selected.availableQuantity} available`}
                type="number"
                min="1"
                max={selected.availableQuantity}
                step="1"
                inputMode="numeric"
                value={form.quantity}
                onKeyDown={(event) => {
                  if (["-", "+", "e", "E", "."].includes(event.key)) event.preventDefault();
                }}
                onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                required
              />
            ) : selected ? (
              <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
                <strong>Facility reservation:</strong> {selected.name} is reserved as one whole facility, so no quantity is needed.
              </div>
            ) : null}

            <TextArea
              label="Purpose / Event *"
              value={form.purpose}
              maxLength={500}
              onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
              placeholder="Example: Family gathering for approximately 40 guests."
              required
            />
            <div className="-mt-2 text-right text-xs text-stone-400">{form.purpose.length}/500</div>

            {selected && isFacility(selected) ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
                <strong>Use location:</strong> {selected.name}. The facility itself is the reserved location.
              </div>
            ) : (
              <TextInput
                label="Event / Use Location *"
                value={form.eventLocation}
                maxLength={180}
                onChange={(event) => setForm((current) => ({ ...current, eventLocation: event.target.value }))}
                placeholder="Example: Purok 3, Barangay Iba"
                required
              />
            )}

            <div className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <Phone className="mt-0.5 h-4 w-4 text-[var(--brand-600)]" />
                <div><p className="font-semibold text-stone-700">Contact number</p><p className="mt-1 text-stone-500">{user?.contactNumber || "Not set in your profile"}</p></div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-[var(--brand-600)]" />
                <div><p className="font-semibold text-stone-700">Resident purok</p><p className="mt-1 text-stone-500">{user?.purok || "Not set in your profile"}</p></div>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200 p-4 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.termsAccepted}
                onChange={(event) => setForm((current) => ({ ...current, termsAccepted: event.target.checked }))}
              />
              <span>
                <strong>Borrowing responsibility *</strong><br />
                I agree to use barangay property responsibly and return borrowed items on or before the stated due date in the condition received.
              </span>
            </label>

            <Button type="submit" disabled={!availabilityChecked || !selected}>
              Review Borrowing Request
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">My borrowing requests</h2>
            <p className="mt-1 text-sm text-stone-500">Track approval, release, return deadlines, and any notes from the barangay.</p>
          </div>

          {mineLoading ? (
            <LoadingState rows={3} compact />
          ) : mineError ? (
            <ErrorState description={mineError} onRetry={loadMine} />
          ) : requests.length === 0 ? (
            <EmptyState title="No borrowing requests" description="Your borrowing history and request status will appear here." />
          ) : requests.map((item) => {
            const meta = getBorrowingStatusMeta(item.status, item.isLate);
            const facility = isFacility(item.asset);
            return (
              <Card key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[var(--brand-900)]">
                      {item.asset?.name || "Barangay resource"}{facility ? "" : ` × ${item.quantity}`}
                    </h3>
                    <p className="mt-1 text-sm text-stone-500">{formatDateTime(item.start_at)} → {formatDateTime(item.due_at)}</p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">{meta.description}</p>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Purpose</p><p className="mt-1 text-stone-700">{item.purpose}</p></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Use location</p><p className="mt-1 text-stone-700">{item.event_location || "Not provided"}</p></div>
                </div>
                {item.admin_note ? <p className="mt-4 rounded-2xl border border-[var(--brand-100)] bg-[var(--brand-50)] p-3 text-sm text-stone-700"><strong>Barangay note:</strong> {item.admin_note}</p> : null}
                {item.status === "returned" && !facility ? (
                  <div className="mt-4 rounded-2xl border border-stone-200 p-3 text-sm text-stone-600">
                    <strong>Return inspection:</strong> {item.returned_quantity ?? item.quantity} of {item.quantity} returned
                    {item.return_condition ? ` • ${RETURN_CONDITION_LABELS[item.return_condition] || item.return_condition}` : ""}
                    {item.return_note ? <p className="mt-1">{item.return_note}</p> : null}
                  </div>
                ) : null}
                {["pending", "approved"].includes(item.status) ? (
                  <Button className="mt-4" variant="secondary" onClick={() => setCancelRequest(item)}>
                    <RotateCcw className="h-4 w-4" /> Cancel Request
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      </div>

      <Modal
        open={reviewOpen}
        onClose={() => !saving && setReviewOpen(false)}
        title="Review borrowing request"
        description="Check these details carefully. Submitting sends the request for barangay approval; it does not reserve the resource until approved."
        widthClass="max-w-2xl"
      >
        {selected ? (
          <div className="space-y-5">
            <div className="rounded-3xl bg-[var(--brand-50)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">Resource</p>
              <h3 className="mt-2 text-2xl font-black text-[var(--brand-900)]">{selected.name}</h3>
              {!isFacility(selected) ? <p className="mt-1 text-sm text-stone-600">Quantity: {Number(form.quantity)}</p> : <p className="mt-1 text-sm text-stone-600">Whole facility reservation</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Borrow From</p><p className="mt-2 font-semibold text-stone-700">{formatDateTime(new Date(windowForm.startAt).toISOString())}</p></div>
              <div className="rounded-2xl border border-stone-200 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Return By</p><p className="mt-2 font-semibold text-stone-700">{formatDateTime(new Date(windowForm.dueAt).toISOString())}</p></div>
            </div>
            <div><p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Purpose</p><p className="mt-1 text-sm text-stone-700">{form.purpose}</p></div>
            <div><p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Use Location</p><p className="mt-1 text-sm text-stone-700">{form.eventLocation}</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              The barangay will review this request. Only an <strong>Approved</strong> request reserves the resource for your schedule.
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={submit} loading={saving}>Confirm & Submit Request</Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setReviewOpen(false)}>Back to Edit</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(cancelRequest)}
        onClose={() => !saving && setCancelRequest(null)}
        title="Cancel borrowing request?"
        description={cancelRequest ? `${cancelRequest.asset?.name || "Barangay resource"} • ${formatDateTime(cancelRequest.start_at)}` : ""}
        widthClass="max-w-xl"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-stone-600">This request will be marked Cancelled. If it was already approved, its reserved quantity or facility schedule will be released for other residents.</p>
          <div className="flex gap-3">
            <Button variant="danger" onClick={confirmCancel} loading={saving}>Yes, Cancel Request</Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setCancelRequest(null)}>Keep Request</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BorrowingPage;

