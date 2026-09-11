import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, KeyRound, Megaphone, PackageCheck, Phone, Vote } from "lucide-react";
import { api } from "../../lib/api";
import { Card, EmptyState, PageHeader, TextInput } from "../../components/ui";

const guides = [
  { icon: FileText, category: "Requests & Documents", title: "Request a barangay document", steps: ["Open Requests & Documents.", "Choose the service you need.", "Enter the purpose and required details.", "Submit once, then follow the request timeline until completion."] },
  { icon: FileText, category: "Barangay ID", title: "Schedule a Barangay ID pickup", steps: ["Open Requests & Documents, then Barangay ID.", "Choose an available pickup date and time.", "Submit the schedule request.", "Wait for barangay confirmation or rescheduling before going to the barangay hall."] },
  { icon: PackageCheck, category: "Borrowing", title: "Borrow a facility or barangay item", steps: ["Choose the full borrowing and return schedule.", "Check availability for those dates.", "Choose the resource, quantity, purpose, and use location.", "Review responsibilities and submit.", "The resource is reserved only after barangay approval."] },
  { icon: Megaphone, category: "Community Concerns", title: "Report a community concern", steps: ["Open Community Concerns.", "Choose the correct concern category.", "Describe the issue and exact location clearly.", "Submit and follow the status and barangay response."] },
  { icon: Vote, category: "Voting", title: "Vote on a community project", steps: ["Open Project Voting during an active voting period.", "Review the approved project choices.", "Select one project and review your vote.", "Submit your final vote once. It cannot be changed afterward.", "Review published results after voting closes."] },
  { icon: KeyRound, category: "Account & Password", title: "Reset or change your password", steps: ["Use Forgot Password on Resident Login if you cannot sign in.", "If an admin issued a temporary password, sign in with it.", "Temporary-password accounts must create a permanent password before continuing to the portal."] },
];

const HelpCenter = () => {
  const [support, setSupport] = useState(null);
  const [search, setSearch] = useState("");
  useEffect(() => { api("/public/community-support").then(setSupport).catch(() => {}); }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return guides;
    return guides.filter((guide) => `${guide.category} ${guide.title} ${guide.steps.join(" ")}`.toLowerCase().includes(needle));
  }, [search]);

  return (
    <div className="section-shell space-y-8 py-10 sm:py-14">
      <PageHeader eyebrow="Resident Guide" title="Help Center" description="Find step-by-step guidance for common Barangay Iba Portal tasks." />

      <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-center"><div className="flex items-start gap-3"><div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]"><BookOpen className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">How can we help?</h2><p className="mt-1 text-sm leading-6 text-stone-600">Search by service, problem or task.</p></div></div><TextInput label="Search help" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Example: Barangay ID, borrowing, password..." /></div>
      </Card>

      {!filtered.length ? <EmptyState title="No matching help guide" description="Try a broader search such as requests, voting, borrowing or password." /> : <div className="grid gap-5 md:grid-cols-2">{filtered.map(({ icon: Icon, category, title, steps }) => <Card key={title}><div className="flex items-start gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Icon className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand-500)]">{category}</p><h2 className="mt-1 text-lg font-bold text-[var(--brand-900)]">{title}</h2></div></div><ol className="mt-5 space-y-3">{steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-stone-600"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-100)] text-xs font-bold text-[var(--brand-700)]">{index + 1}</span><span>{step}</span></li>)}</ol></Card>)}</div>}

      <Card className="border-rose-200 bg-rose-50/70"><div className="flex items-start gap-3"><div className="rounded-2xl bg-rose-100 p-3 text-rose-700"><Phone className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-stone-900">Need immediate barangay assistance?</h2><p className="mt-1 text-sm leading-6 text-stone-600">For urgent matters, contact the configured barangay hotline instead of submitting a normal concern and waiting for review.</p>{support?.hotline ? <p className="mt-3 font-bold text-rose-700">{support.hotline.title}: {support.hotline.phone} · {support.hotline.hours}</p> : null}{support?.contact?.email ? <p className="mt-1 text-sm text-stone-600">Email: {support.contact.email}</p> : null}</div></div></Card>
    </div>
  );
};
export default HelpCenter;
