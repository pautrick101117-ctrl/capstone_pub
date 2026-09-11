import { Card, PageHeader } from "../../components/ui";

const sections = [
  ["1. Acceptance of Terms", "By using the E-Barangay Portal, you agree to follow all rules and policies."],
  ["2. Eligibility", "You must be a registered resident of Barangay IBA and at least 18 years old."],
  ["3. Account Responsibilities", "You are responsible for maintaining the confidentiality of your account."],
  ["5. Document Requests", "All requests are subject to verification and must be claimed within 30 days."],
  ["6. Limitation of Liability", "The Barangay is not liable for system downtime or delays beyond control."],
  ["7. Changes to Terms", "Terms may be updated anytime without prior notice."],
];

const TermsOfUse = () => (
  <section className="section-shell py-12 sm:py-16">
    <PageHeader eyebrow="Legal" title="Terms of Use" description="Rules and responsibilities for using the Barangay Iba digital portal." />
    <Card className="mt-8 mx-auto max-w-4xl">
      <p className="mb-7 text-sm text-stone-500">Last updated: October 29, 2025</p>
      <div className="space-y-7">
        {sections.slice(0, 3).map(([title, body]) => <section key={title}><h2 className="font-bold text-[var(--brand-900)]">{title}</h2><p className="mt-2 text-sm leading-7 text-stone-600">{body}</p></section>)}
        <section><h2 className="font-bold text-[var(--brand-900)]">4. Acceptable Use</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-7 text-stone-600"><li>No illegal activities</li><li>No false information</li><li>No impersonation</li><li>No system interference</li></ul></section>
        {sections.slice(3).map(([title, body]) => <section key={title}><h2 className="font-bold text-[var(--brand-900)]">{title}</h2><p className="mt-2 text-sm leading-7 text-stone-600">{body}</p></section>)}
      </div>
    </Card>
  </section>
);

export default TermsOfUse;
