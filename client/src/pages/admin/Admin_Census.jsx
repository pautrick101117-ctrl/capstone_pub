import { useReviewAction, useUnsavedForm, useUnsavedNavigation, reviewChanges } from "../../components/ActionReviewProvider";
import { AlertTriangle, Download, FileSpreadsheet, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL, api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMasterData } from "../../hooks/useMasterData";
import { formatDateTime } from "../../lib/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, SelectInput, TableShell, TextInput } from "../../components/ui";

const emptyForm = { id: "", householdRef: "", householdName: "", purok: "", members: 1, address: "", contactNumber:"", housingTenure:"", residencySince:"", status: "active" };
const pageSize = 8;

const downloadProtectedFile = async ({ url, token, filename }) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : { message: await response.text() };
    throw new Error(payload.message || "Download failed.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
};

const Admin_Census = () => {
  const { token } = useAuth();
  const reviewAction = useReviewAction();
  const toast = useToast();
  const [households, setHouseholds] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [formSnapshot, setFormSnapshot] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [importMode, setImportMode] = useState("append");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [memberHousehold,setMemberHousehold] = useState(null);
  const [householdMembers,setHouseholdMembers] = useState([]);
  const [memberForm,setMemberForm] = useState({firstName:'',middleName:'',lastName:'',suffix:'',relationship:'',isHead:false,birthdate:'',sex:'',occupation:'',userId:''});
  const [residents,setResidents]=useState([]);
  const fileInputRef = useRef(null);
  const { options: purokOptions } = useMasterData("purok");

  const formGuard = useUnsavedForm({ initial: formSnapshot, current: form, enabled: open });
  useUnsavedNavigation(formGuard.dirty);
  const closeEditor = () => formGuard.closeSafely(() => { setOpen(false); setForm(emptyForm); });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/admin/census_households", { token });
      setHouseholds(data.census_households || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load census records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); }, [token]);
  const openMembers=async(household)=>{
    setMemberHousehold(household);setHouseholdMembers([]);
    try{
      const [result,people]=await Promise.all([api(`/admin/census_households/${household.id}/members`,{token}),api('/admin/users',{token})]);
      setHouseholdMembers(result.members||[]);setResidents(people.users||[]);
    }catch(err){toast.error(err.message);}
  };
  const saveMember=async(event)=>{
    event.preventDefault();if(!memberHousehold)return;
    if(!householdMembers.length&&!memberForm.isHead)return toast.error('The first listed household member must be marked as Head.');
    if(!await reviewAction({title:'Add household member?',subject:`${memberForm.firstName} ${memberForm.lastName}`,after:memberForm,confirmLabel:'Add Member'}))return;
    setSaving(true);
    try{await api(`/admin/census_households/${memberHousehold.id}/members`,{method:'POST',token,body:memberForm});
      toast.success('Household member added. Member count recalculated.');
      const results=await api(`/admin/census_households/${memberHousehold.id}/members`,{token});setHouseholdMembers(results.members||[]);
      setMemberForm({firstName:'',middleName:'',lastName:'',suffix:'',relationship:'',isHead:false,birthdate:'',sex:'',occupation:'',userId:''});await load();
    }catch(err){toast.error(err.message);}finally{setSaving(false);}
  };
  const changeHead=async(member)=>{
    if(!await reviewAction({title:'Change head of household?',subject:`${member.first_name} ${member.last_name}`,confirmLabel:'Confirm Head'}))return;
    try{await api(`/admin/census_households/${memberHousehold.id}/members/${member.id}/head`,{method:'POST',token});
      const result=await api(`/admin/census_households/${memberHousehold.id}/members`,{token});setHouseholdMembers(result.members||[]);
      toast.success('Head of household changed.');
    }catch(err){toast.error(err.message);}
  };
  const removeMember=async(member)=>{
    if(!await reviewAction({title:'Remove member from household?',subject:`${member.first_name} ${member.last_name}`,confirmLabel:'Remove Member'}))return;
    try{await api(`/admin/census_households/${memberHousehold.id}/members/${member.id}`,{method:'DELETE',token});
      const results=await api(`/admin/census_households/${memberHousehold.id}/members`,{token});setHouseholdMembers(results.members||[]);await load();
    }catch(err){toast.error(err.message);}
  };

  const openCreate = () => {
    setForm(emptyForm);
    setFormSnapshot(emptyForm);
    setOpen(true);
  };

  const openEdit = (item) => {
    setFormSnapshot({ id: item.id, householdRef: item.household_ref || "", householdName: item.household_name || "", purok: item.purok || "", members: item.members ?? 1, address: item.address || item.house_number || "", contactNumber:item.contact_number||"",housingTenure:item.housing_tenure||"",residencySince:item.residency_since||"",status: item.status || "active" });
    setForm({
      id: item.id,
      householdRef: item.household_ref || "",
      householdName: item.household_name || "",
      purok: item.purok || "",
      members: item.members || 1,
      address: item.address || item.house_number || "",
      status: item.status || "active",
    });
    setOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    const members = Number(form.members);
    if (!Number.isInteger(members) || members < 0 || (!form.id && members < 1)) return toast.error("Enter a valid member count.");
    const previous = households.find((entry) => entry.id === form.id) || {};
    if (!await reviewAction({ title: form.id ? "Confirm Household Changes" : "Add Household?", description: "This updates the official Census records.", subject: form.householdName || form.household_name || "Household", before: previous, after: form, confirmLabel: form.id ? "Save Household" : "Add Household" })) return;
    setSaving(true);
    try {
      const path = form.id ? `/admin/census_households/${form.id}` : "/admin/census_households";
      const data = await api(path, {
        method: form.id ? "PATCH" : "POST",
        token,
        body: { ...form, members },
      });
      toast.success(data.message || (form.id ? "Household updated." : "Household added."));
      setForm(emptyForm);
      setOpen(false);
      await load();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteHousehold = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const data = await api(`/admin/census_households/${deleteTarget.id}`, { method: "DELETE", token });
      toast.success(data.message || "Household deleted.");
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      toast.error(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const validateBatch = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBatchLoading(true);
    setPendingFile(file);
    setValidation(null);
    setImportMode("append");
    setConfirmReplace(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api("/admin/census_households/batch?validateOnly=true", { method: "POST", token, body: formData });
      setValidation(data);
    } catch (validationError) {
      setPendingFile(null);
      toast.error(validationError.message);
    } finally {
      setBatchLoading(false);
    }
  };

  const confirmBatch = async () => {
    if (!pendingFile || !validation?.valid) return;
    if (importMode === "replace_all") return toast.error("Destructive replacement is disabled to protect household records and members.");
    setBatchLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("mode", importMode);
      const data = await api("/admin/census_households/batch", { method: "POST", token, body: formData });
      toast.success(data.message || "Census import completed.");
      setPendingFile(null);
      setValidation(null);
      setImportMode("append");
      setConfirmReplace(false);
      setPage(1);
      await load();
    } catch (uploadError) {
      toast.error(uploadError.message);
    } finally {
      setBatchLoading(false);
    }
  };

  const exportBackup = async () => {
    setExportLoading(true);
    try {
      await downloadProtectedFile({
        url: `${API_URL}/admin/census_households/export`,
        token,
        filename: `barangay-iba-census-backup-${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
      toast.success("Census backup exported as Excel.");
    } catch (exportError) {
      toast.error(exportError.message);
    } finally {
      setExportLoading(false);
    }
  };

  const downloadSample = async () => {
    setSampleLoading(true);
    try {
      await downloadProtectedFile({
        url: `${API_URL}/admin/census_households/sample`,
        token,
        filename: "barangay-iba-census-sample.xlsx",
      });
      toast.success("Excel sample downloaded.");
    } catch (sampleError) {
      toast.error(sampleError.message);
    } finally {
      setSampleLoading(false);
    }
  };

  const totalMembers = households.reduce((sum, item) => sum + Number(item.members || 0), 0);
  const needsUpdate = households.filter((item) => item.status !== "active").length;
  const totalPages = Math.max(1, Math.ceil(households.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedHouseholds = households.slice((safePage - 1) * pageSize, safePage * pageSize);

  const previewRows = useMemo(() => validation?.preview || [], [validation]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Census"
        title="Maintain household census records"
        description="Keep addresses and household members current, safely append Excel records, and export backups."
        actions={<>
          <Button type="button" variant="secondary" loading={sampleLoading} onClick={downloadSample}><FileSpreadsheet className="h-4 w-4" />Download Sample Excel</Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.txt" onChange={validateBatch} className="hidden" />
          <Button type="button" variant="secondary" loading={batchLoading && !pendingFile} onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" />Import Census</Button>
          <Button type="button" variant="secondary" loading={exportLoading} onClick={exportBackup}><Download className="h-4 w-4" />Export Backup</Button>
          <Button type="button" onClick={openCreate}><Plus className="h-4 w-4" />Add Household</Button>
        </>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm font-semibold text-stone-500">Households</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{households.length}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Residents Represented</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{totalMembers}</p></Card>
        <Card><p className="text-sm font-semibold text-stone-500">Needs Update</p><p className="mt-2 text-3xl font-black text-[var(--brand-900)]">{needsUpdate}</p></Card>
      </div>

      {error ? <ErrorState description={error} onRetry={load} /> : null}
      {!error ? <Card>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[var(--brand-900)]">Household List</h2>
          <p className="mt-1 text-sm text-stone-500">Excel columns: household_ref, household_name, purok, members, address, status. Household Ref may be left blank for new imports.</p>
        </div>
        {loading ? <LoadingState rows={5} /> : households.length === 0 ? <EmptyState title="No census households yet" description="Add a household manually or import a reviewed Excel file." /> : <>
          <TableShell>
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-500"><tr><th className="px-4 py-3 font-semibold">Household</th><th className="px-4 py-3 font-semibold">Purok</th><th className="px-4 py-3 font-semibold">Members</th><th className="px-4 py-3 font-semibold">Address</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Updated</th><th className="px-4 py-3 font-semibold">Actions</th></tr></thead>
              <tbody>{paginatedHouseholds.map((item) => <tr key={item.id} className="border-t border-stone-100 align-top transition hover:bg-stone-50/70">
                <td className="px-4 py-4"><p className="font-semibold text-[var(--brand-900)]">{item.household_name}</p>{item.household_ref ? <p className="mt-1 text-xs text-stone-400">{item.household_ref}</p> : null}</td>
                <td className="px-4 py-4 text-stone-600">{item.purok}</td>
                <td className="px-4 py-4 text-stone-600">{item.members}</td>
                <td className="max-w-sm px-4 py-4 text-stone-600">{item.address || item.house_number}</td>
                <td className="px-4 py-4"><Badge tone={item.status === "active" ? "success" : "warning"}>{item.status === "active" ? "Active" : "Needs Update"}</Badge></td>
                <td className="whitespace-nowrap px-4 py-4 text-stone-500">{formatDateTime(item.updated_at)}</td>
                <td className="px-4 py-4"><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="px-3" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" />Edit</Button><Button type="button" variant="secondary" onClick={()=>openMembers(item)}>Members</Button><Button type="button" variant="danger" className="px-3" onClick={() => setDeleteTarget(item)}><Trash2 className="h-4 w-4" />Delete</Button></div></td>
              </tr>)}</tbody>
            </table>
          </TableShell>
          <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </>}
      </Card> : null}

      <Modal open={open} onClose={() => !saving && closeEditor()} title={form.id ? "Edit Household" : "Add Household"} description={form.id ? "Update the household census record. The Updated date will refresh automatically." : "Add a household with a full address. The system creates a stable household reference automatically."}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <TextInput label="Household Name" required maxLength={120} className="sm:col-span-2" value={form.householdName} onChange={(event) => setForm((current) => ({ ...current, householdName: event.target.value }))} />
          <SelectInput label="Purok" required value={form.purok} onChange={(event) => setForm((current) => ({ ...current, purok: event.target.value }))}><option value="">Select Purok</option>{purokOptions.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</SelectInput>
          <TextInput label="Members" type="number" min="1" step="1" value={form.members} readOnly={Boolean(form.id && households.find(h=>h.id===form.id)?.membership_verified)} onKeyDown={(event) => { if (["-", "+", "e", "E", "."].includes(event.key)) event.preventDefault(); }} onChange={(event) => setForm((current) => ({ ...current, members: event.target.value === "" ? "" : Math.max(1, Number.parseInt(event.target.value, 10) || 1) }))} />
          <TextInput label="Household Contact Number" maxLength={30} value={form.contactNumber} onChange={e=>setForm(c=>({...c,contactNumber:e.target.value}))}/>
          <SelectInput label="Housing Tenure" value={form.housingTenure} onChange={e=>setForm(c=>({...c,housingTenure:e.target.value}))}><option value="">Not specified</option><option value="owned">Owned</option><option value="rented">Rented</option><option value="shared">Shared / Staying with family</option><option value="other">Other</option></SelectInput>
          <TextInput label="Resident Since" type="date" value={form.residencySince} onChange={e=>setForm(c=>({...c,residencySince:e.target.value}))}/>
          <TextInput label="Address" required maxLength={240} className="sm:col-span-2" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Example: 12 Rizal Street, Purok 1, Barangay Iba, Silang, Cavite" />
          <SelectInput label="Status" required value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="for update">Needs Update</option></SelectInput>
          {form.householdRef ? <TextInput label="Household Ref" readOnly value={form.householdRef} /> : <div />}
          <div className="sm:col-span-2 flex gap-3"><Button type="submit" loading={saving}>{form.id ? "Save Changes" : "Add Household"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={closeEditor}>Cancel</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(memberHousehold)} onClose={()=>!saving&&setMemberHousehold(null)} title={`Household Members — ${memberHousehold?.household_name||''}`} description="Manage individual household members. Counts are derived after membership is entered." widthClass="max-w-3xl">
        <div className="space-y-5">
          <div className="space-y-2">{householdMembers.map(member=><div key={member.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-3"><div><p className="font-semibold">{[member.first_name,member.middle_name,member.last_name,member.suffix].filter(Boolean).join(' ')}</p><p className="text-xs text-stone-500">{member.relationship}{member.is_head?' · Head of household':''}{member.user_id?' · Linked portal account':''}</p></div><div className="flex flex-wrap gap-2">{!member.is_head?<Button type="button" variant="secondary" onClick={()=>changeHead(member)}>Make Head</Button>:null}<Button variant="danger" type="button" onClick={()=>removeMember(member)}>Remove</Button></div></div>)}{!householdMembers.length?<Alert tone="info" title="No identified members"><p>This household has only a legacy manually entered count. Add member details to establish a verified count.</p></Alert>:null}</div>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveMember}>
            <TextInput label="First Name" required value={memberForm.firstName} onChange={e=>setMemberForm(c=>({...c,firstName:e.target.value}))}/>
            <TextInput label="Middle Name" value={memberForm.middleName} onChange={e=>setMemberForm(c=>({...c,middleName:e.target.value}))}/>
            <TextInput label="Last Name" required value={memberForm.lastName} onChange={e=>setMemberForm(c=>({...c,lastName:e.target.value}))}/>
            <TextInput label="Suffix" value={memberForm.suffix} onChange={e=>setMemberForm(c=>({...c,suffix:e.target.value}))}/>
            <TextInput label="Relationship to Head" required placeholder="Head, Spouse, Child, Parent..." value={memberForm.relationship} onChange={e=>setMemberForm(c=>({...c,relationship:e.target.value}))}/>
            <TextInput label="Birthdate" type="date" value={memberForm.birthdate} onChange={e=>setMemberForm(c=>({...c,birthdate:e.target.value}))}/>
            <SelectInput label="Sex" value={memberForm.sex} onChange={e=>setMemberForm(c=>({...c,sex:e.target.value}))}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></SelectInput>
            <TextInput label="Occupation (optional)" value={memberForm.occupation} onChange={e=>setMemberForm(c=>({...c,occupation:e.target.value}))}/>
            <SelectInput label="Link to resident account (optional)" value={memberForm.userId} onChange={e=>setMemberForm(c=>({...c,userId:e.target.value}))}><option value="">No account / minor</option>{residents.filter(u=>u.role==='resident').map(u=><option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>)}</SelectInput>
            <div className="sm:col-span-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{[
              ['isSenior','Senior citizen'],['isPwd','PWD'],['isSoloParent','Solo parent'],['is4ps','4Ps beneficiary'],['isRegisteredVoter','Registered voter']
            ].map(([key,label])=><label key={key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(memberForm[key])} onChange={e=>setMemberForm(c=>({...c,[key]:e.target.checked}))}/>{label}</label>)}</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={memberForm.isHead} onChange={e=>setMemberForm(c=>({...c,isHead:e.target.checked,relationship:e.target.checked?'Head':c.relationship}))}/>Head of household (one only)</label>
            <div className="sm:col-span-2"><Button type="submit" loading={saving}>Add Household Member</Button></div>
          </form>
        </div>
      </Modal>
      <Modal open={Boolean(deleteTarget)} onClose={() => !saving && setDeleteTarget(null)} closeDisabled={saving} title="Delete household record?" description="This removes the household from the current Census. The action will be recorded in Audit Logs.">
        {deleteTarget ? <div className="space-y-5"><Alert tone="danger" title={deleteTarget.household_name}><p>{deleteTarget.address || deleteTarget.house_number}</p></Alert><div className="flex justify-end gap-3"><Button variant="secondary" disabled={saving} onClick={() => setDeleteTarget(null)}>Keep Record</Button><Button variant="danger" loading={saving} onClick={deleteHousehold}><Trash2 className="h-4 w-4" />Delete Household</Button></div></div> : null}
      </Modal>

      <Modal open={Boolean(pendingFile && validation)} onClose={() => !batchLoading && (setPendingFile(null), setValidation(null))} closeDisabled={batchLoading} title="Review Census Import" description="Nothing has been changed yet. Review validation results and choose how this file should be applied to the Census.">
        {validation ? <div className="space-y-5">
          <Alert tone={validation.valid ? "success" : "danger"} title={validation.valid ? "File is ready for review" : "Fix the validation issues first"}>
            <p>{validation.rowCount} rows found · {validation.validCount ?? validation.rowCount} valid · {validation.duplicateCount || 0} possible duplicates · {validation.existingCount || 0} current records.</p>
          </Alert>
          <div><p className="text-sm font-semibold text-stone-700">File</p><p className="mt-1 text-sm text-stone-500">{pendingFile?.name}</p></div>
          {validation.errors?.length ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-center gap-2 font-bold text-rose-800"><AlertTriangle className="h-4 w-4" />Validation issues</div><div className="mt-3 space-y-1 text-sm text-rose-700">{validation.errors.slice(0, 10).map((item, index) => <p key={`${item.row}-${index}`}>Row {item.row}: {item.message}</p>)}</div></div> : null}
          <div><p className="mb-2 text-sm font-semibold text-stone-700">Preview</p><div className="max-h-72 space-y-2 overflow-y-auto">{previewRows.map((row) => <div key={`${row.rowNumber}-${row.household_ref}`} className={`rounded-2xl border p-3 text-sm ${row.valid ? "border-stone-200" : "border-rose-200 bg-rose-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--brand-900)]">{row.household_name}</p><p className="mt-1 text-stone-500">{row.purok} · {row.address} · {row.members} member{Number(row.members) === 1 ? "" : "s"}</p></div>{row.duplicateExisting ? <Badge tone="warning">Existing address</Badge> : <Badge tone={row.valid ? "success" : "danger"}>{row.valid ? "Valid" : "Check row"}</Badge>}</div></div>)}</div></div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => { setImportMode("append"); setConfirmReplace(false); }} className={`rounded-3xl border p-4 text-left transition ${importMode === "append" ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-2 ring-[var(--brand-100)]" : "border-stone-200"}`}><p className="font-bold text-[var(--brand-900)]">Add to Existing Records</p><p className="mt-2 text-sm leading-6 text-stone-600">Keep all current records and add new households. Existing address duplicates are skipped.</p></button>
            <button type="button" disabled title="Disabled to protect linked members" onClick={() => {}} className={`rounded-3xl border p-4 text-left transition ${importMode === "replace_all" ? "border-rose-500 bg-rose-50 ring-2 ring-rose-100" : "border-stone-200"}`}><p className="font-bold text-rose-800">Replace Entire Census (Disabled)</p><p className="mt-2 text-sm leading-6 text-stone-600">Disabled to protect household-member relationships. Use Add to Existing Records.</p></button>
          </div>

          {importMode === "replace_all" ? <label className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><input type="checkbox" className="mt-1" checked={confirmReplace} onChange={(event) => setConfirmReplace(event.target.checked)} /><span><strong>I understand all {validation.existingCount || 0} current Census records will be deleted.</strong><br />The uploaded file becomes the complete replacement Census.</span></label> : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={batchLoading} onClick={() => { setPendingFile(null); setValidation(null); }}>Cancel Import</Button><Button variant={importMode === "replace_all" ? "danger" : "primary"} disabled={!validation.valid || (importMode === "replace_all" && !confirmReplace)} loading={batchLoading} onClick={confirmBatch}>{importMode === "replace_all" ? "Replace All Census Records" : `Add ${validation.rowCount} Reviewed Rows`}</Button></div>
        </div> : null}
      </Modal>
    </div>
  );
};

export default Admin_Census;

