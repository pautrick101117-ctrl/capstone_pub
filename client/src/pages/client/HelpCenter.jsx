import { useEffect, useState } from "react";
import { BookOpen, FileText, KeyRound, Megaphone, PackageCheck, Phone, Vote } from "lucide-react";
import { api } from "../../lib/api";
import { Card, PageHeader } from "../../components/ui";

const guides = [
  { icon: FileText, title: "Request a barangay document", steps: ["Open My Requests.", "Choose the document or service you need.", "Complete the required information and submit.", "Track the status until it is ready or completed."] },
  { icon: PackageCheck, title: "Borrow a facility or barangay item", steps: ["Choose your full borrowing and return schedule.", "Check availability for the selected dates.", "Choose the facility/item, quantity, purpose, and use location.", "Review and submit. The resource is reserved only after barangay approval.", "Return released items on or before the due date."] },
  { icon: Megaphone, title: "Report a community concern", steps: ["Open Community Concerns.", "Choose the correct concern category.", "Describe the issue and exact location clearly.", "Submit and track the barangay response/status below your report."] },
  { icon: Vote, title: "Vote on a community project", steps: ["Open Community Project Voting during an active voting period.", "Review the approved project choices.", "Select one project and review your vote.", "Submit your final vote once. It cannot be changed afterward.", "Review published results after voting closes."] },
  { icon: KeyRound, title: "Reset or change your password", steps: ["Use Forgot Password on the resident login page if you cannot sign in.", "If an admin issued a temporary password, sign in with it.", "Newly created/reset resident accounts must create a permanent password before using the portal."] },
];

const HelpCenter = () => {
  const [support, setSupport] = useState(null);
  useEffect(() => { api("/public/community-support").then(setSupport).catch(() => {}); }, []);

  return (
    <div className="mx-auto mt-24 max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Resident Guide" title="Help Center" description="Step-by-step guidance for the most common Barangay Iba Portal tasks. Each transaction page also explains what happens before and after submission." />

      <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
        <div className="flex items-start gap-3"><div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]"><BookOpen className="h-5 w-5" /></div><div><h2 className="text-xl font-bold text-[var(--brand-900)]">Before you start</h2><p className="mt-1 text-sm leading-6 text-stone-600">Use your own resident account, keep your contact information current, review details before submitting, and check the status/history section instead of submitting duplicate requests.</p></div></div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {guides.map(({ icon: Icon, title, steps }) => (
          <Card key={title}>
            <div className="flex items-center gap-3"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)]"><Icon className="h-5 w-5" /></div><h2 className="text-lg font-bold text-[var(--brand-900)]">{title}</h2></div>
            <ol className="mt-5 space-y-3">
              {steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-stone-600"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-100)] text-xs font-bold text-[var(--brand-700)]">{index + 1}</span><span>{step}</span></li>)}
            </ol>
          </Card>
        ))}
      </div>

      <Card className="border-rose-200 bg-rose-50/70">
        <div className="flex items-start gap-3"><div className="rounded-2xl bg-rose-100 p-3 text-rose-700"><Phone className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-stone-900">Need immediate barangay assistance?</h2><p className="mt-1 text-sm text-stone-600">For urgent matters, contact the configured barangay hotline rather than submitting a normal concern and waiting for review.</p>{support?.hotline ? <p className="mt-3 font-bold text-rose-700">{support.hotline.title}: {support.hotline.phone} · {support.hotline.hours}</p> : null}{support?.contact?.email ? <p className="mt-1 text-sm text-stone-600">Email: {support.contact.email}</p> : null}</div></div>
      </Card>
    </div>
  );
};

export default HelpCenter;
