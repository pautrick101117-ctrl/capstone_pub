import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Card, PageHeader } from "../../components/ui";

const sections = [
  ["1. Information We Collect", "Personal data, government IDs, and portal usage activity."],
  ["2. How We Use Your Data", "To process requests, verify identity, and improve services."],
  ["3. Data Security", "We use encryption (SSL/TLS) and secure databases."],
  ["4. Data Sharing", "Data is only shared with authorized barangay officials or legal authorities."],
];

const PrivacyPolicy = () => {
  const [support, setSupport] = useState(null);

  useEffect(() => {
    api("/public/community-support").then(setSupport).catch(() => setSupport(null));
  }, []);

  const contact = support?.contact || support?.landingContent?.contact || {};

  return (
    <section className="section-shell py-12 sm:py-16">
      <PageHeader eyebrow="Legal" title="Privacy Policy" description="Data Privacy Act of 2012 (RA 10173) compliance information for the Barangay Iba Portal." />
      <div className="mt-8 grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
        <Card className="h-fit bg-[var(--brand-50)]">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--brand-600)]">Our Commitment</p>
          <h2 className="mt-3 text-2xl font-black text-[var(--brand-900)]">Your information should be handled responsibly.</h2>
          <p className="mt-3 text-sm leading-7 text-stone-600">We value your privacy and ensure your data is protected and used responsibly.</p>
        </Card>
        <Card>
          <div className="space-y-7">
            {sections.map(([title, body]) => <section key={title}><h2 className="font-bold text-[var(--brand-900)]">{title}</h2><p className="mt-2 text-sm leading-7 text-stone-600">{body}</p></section>)}
            <section><h2 className="font-bold text-[var(--brand-900)]">5. Your Rights</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-7 text-stone-600"><li>Access your data</li><li>Correct information</li><li>Request deletion, if applicable</li></ul></section>
            <section><h2 className="font-bold text-[var(--brand-900)]">6. Contact Us</h2><div className="mt-2 space-y-1 text-sm leading-7 text-stone-600">{contact.email ? <p>Email: {contact.email}</p> : null}{contact.phone ? <p>Phone: {contact.phone}</p> : null}{contact.address ? <p>Address: {contact.address}</p> : null}{!contact.email && !contact.phone && !contact.address ? <p>Contact the Barangay Iba office for privacy-related concerns.</p> : null}</div></section>
          </div>
        </Card>
      </div>
    </section>
  );
};

export default PrivacyPolicy;
