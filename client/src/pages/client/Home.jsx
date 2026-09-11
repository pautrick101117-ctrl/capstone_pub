import { LANDING_BG_URL } from "../../lib/assets";
import { ArrowRight, CalendarDays, CircleAlert, FileText, IdCard, Landmark, Newspaper, PackageCheck, Vote, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Skeleton } from "../../components/ui";
import { formatCurrency, formatDate, formatDateTime } from "../../lib/format";

const emptyLandingData = {
  statistics: {},
  hero: { hero: { title: "Barangay Iba Digital Services", description: "Access barangay services and community updates online." } },
  fundSummary: { total: 0, spent: 0, remaining: 0 },
  liveElection: null,
  upcomingEvents: [],
  news: [],
  announcements: [],
};

const services = [
  { icon: FileText, title: "Request Documents", description: "Barangay Clearance, Residency, Indigency and other resident requests.", to: "/portal/requests", publicTo: "/login", cta: "Start Request" },
  { icon: IdCard, title: "Barangay ID", description: "Choose an available pickup schedule and track confirmation.", to: "/portal/requests", publicTo: "/login", cta: "Schedule ID" },
  { icon: CircleAlert, title: "Report a Concern", description: "Send a non-emergency community concern to barangay staff.", to: "/portal/complaints", publicTo: "/login", cta: "Report Concern" },
  { icon: PackageCheck, title: "Borrow Resources", description: "Check and request barangay facilities, equipment and items.", to: "/portal/borrowing", publicTo: "/login", cta: "Check Availability" },
  { icon: Vote, title: "Community Voting", description: "Review approved community project choices and participate in voting.", to: "/portal/voting", publicTo: "/login", cta: "View Voting" },
];

const Home = () => {
  const { isAuthenticated, user } = useAuth();
  const [data, setData] = useState(emptyLandingData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api("/public/landing"));
    } catch (err) {
      setError(err.message);
      setData(emptyLandingData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const statistics = data?.statistics || {};
  const hero = data?.hero?.hero || emptyLandingData.hero.hero;
  const contact = data?.hero?.contact || {};
  const fundSummary = data?.fundSummary || emptyLandingData.fundSummary;
  const liveElection = data?.liveElection || null;
  const upcomingEvents = data?.upcomingEvents || [];
  const news = data?.news || [];
  const announcements = data?.announcements || [];
  const portalPath = ["admin", "super_admin"].includes(user?.role) ? "/admin" : "/portal";

  return (
    <div>
      <section className="relative overflow-hidden">
        <img src={LANDING_BG_URL} alt="Barangay Iba community" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(15,41,21,0.94)_0%,rgba(15,41,21,0.78)_48%,rgba(15,41,21,0.42)_100%)]" />
        <div className="section-shell relative grid gap-10 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div className="space-y-7">
            <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-50 backdrop-blur">Barangay Iba Portal</div>
            <div className="space-y-5"><h1 className="max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">{hero.title}</h1><p className="max-w-2xl text-base leading-8 text-emerald-50/85 sm:text-lg">{hero.description}</p></div>
            <div className="flex flex-wrap gap-3">
              <NavLink to={isAuthenticated ? portalPath : "/login"} className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-500)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--brand-600)]">{isAuthenticated ? "Go to My Dashboard" : "Open Resident Portal"}<ArrowRight className="h-4 w-4" /></NavLink>
              <a href="#services" className="rounded-full border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur">Explore Services</a>
              <NavLink to="/fund_transparency" className="rounded-full px-5 py-3 text-sm font-semibold text-emerald-50 hover:bg-white/10">Public Transparency</NavLink>
            </div>
            {liveElection ? <div className="max-w-2xl rounded-3xl border border-white/15 bg-white/10 p-5 text-white backdrop-blur"><div className="flex flex-wrap items-center gap-2"><Badge tone="success">Voting Open</Badge><span className="text-xs text-emerald-50/75">Ends {formatDateTime(liveElection.endsAt)}</span></div><h2 className="mt-3 text-xl font-bold">{liveElection.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 text-emerald-50/80">{liveElection.description}</p><div className="mt-4 flex gap-3"><NavLink to={isAuthenticated && user?.role === "resident" ? "/portal/voting" : "/login"} className="text-sm font-bold text-white underline underline-offset-4">Vote now</NavLink><NavLink to="/voting-result" className="text-sm font-bold text-white underline underline-offset-4">View results</NavLink></div></div> : null}
          </div>
          <div className="hidden items-end justify-end lg:flex"><div className="w-full max-w-sm rounded-[2rem] border border-white/20 bg-white/10 p-6 text-white backdrop-blur"><p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-100">One portal for residents</p><div className="mt-5 space-y-4">{["Request barangay documents online", "Track concerns and barangay responses", "Check resource borrowing schedules", "Participate in community project voting"].map((item) => <div key={item} className="flex items-start gap-3"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-300 text-[10px] font-black text-emerald-950">✓</span><p className="text-sm leading-6 text-emerald-50/90">{item}</p></div>)}</div></div></div>
        </div>
      </section>

      <section id="services" className="section-shell py-14 sm:py-16">
        <div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--brand-500)]">Popular Services</p><h2 className="mt-2 text-3xl font-black text-[var(--brand-900)] sm:text-4xl">What can we help you with?</h2><p className="mt-3 text-sm leading-7 text-stone-600 sm:text-base">Choose a resident service directly. If you're not signed in yet, we'll take you to Resident Login first.</p></div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">{services.map(({ icon: Icon, title, description, to, publicTo, cta }) => <NavLink key={title} to={isAuthenticated && user?.role === "resident" ? to : publicTo}><Card className="h-full hover:-translate-y-1 hover:border-[var(--brand-200)] hover:shadow-md"><div className="rounded-2xl bg-[var(--brand-50)] p-3 text-[var(--brand-600)] w-fit"><Icon className="h-6 w-6" /></div><h3 className="mt-4 text-lg font-bold text-[var(--brand-900)]">{title}</h3><p className="mt-2 text-sm leading-6 text-stone-600">{description}</p><p className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-[var(--brand-600)]">{cta}<ArrowRight className="h-4 w-4" /></p></Card></NavLink>)}</div>
      </section>

      {error ? <section className="section-shell pb-8"><ErrorState title="Some public information couldn't be loaded." description={error} onRetry={load} /></section> : null}

      <section className="section-shell pb-14">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]">
            <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Important Updates</p><h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">Barangay announcements</h2></div><NavLink to="/announcements" className="text-sm font-bold text-[var(--brand-600)]">View all</NavLink></div>
            <div className="mt-6 space-y-3">{loading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />) : announcements.length ? announcements.map((item) => <button key={item.id} type="button" onClick={() => setSelectedItem({ ...item, modalType: "announcement" })} className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-left transition hover:border-[var(--brand-200)]"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{formatDate(item.createdAt)}</p><h3 className="mt-1 font-bold text-[var(--brand-900)]">{item.title}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">{item.body}</p></button>) : <EmptyState title="No announcements published" description="Barangay notices will appear here when they are published." />}</div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Coming Up</p><h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">Upcoming events</h2></div><NavLink to="/calendar" className="text-sm font-bold text-[var(--brand-600)]">Full calendar</NavLink></div>
            <div className="mt-6 space-y-3">{loading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />) : upcomingEvents.length ? upcomingEvents.map((event) => <button key={event.id} type="button" onClick={() => setSelectedItem({ ...event, modalType: "event" })} className="flex w-full gap-4 rounded-2xl border border-stone-200 p-4 text-left transition hover:border-[var(--brand-200)]"><div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-[var(--brand-50)] text-[var(--brand-700)]"><CalendarDays className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand-500)]">{formatDate(event.date)}</p><h3 className="mt-1 font-bold text-[var(--brand-900)]">{event.title}</h3><p className="mt-1 text-sm text-stone-500">{event.time || "Time TBA"}{event.location ? ` · ${event.location}` : ""}</p></div></button>) : <EmptyState title="No upcoming events" description="Public barangay events will appear here when scheduled." />}</div>
          </Card>
        </div>
      </section>

      <section className="border-y border-stone-200 bg-white py-14">
        <div className="section-shell">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Public Transparency</p><h2 className="mt-2 text-3xl font-black text-[var(--brand-900)]">Barangay fund snapshot</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">See total allocations, recorded spending and remaining public funds, then review detailed project records.</p></div><NavLink to="/fund_transparency"><Button variant="secondary"><WalletCards className="h-4 w-4" /> View Full Transparency</Button></NavLink></div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Allocated Funds", formatCurrency(fundSummary.total)], ["Funds Spent", formatCurrency(fundSummary.spent)], ["Remaining", formatCurrency(fundSummary.remaining)], ["Completed Projects", statistics.completedProjects || 0]].map(([label, value]) => <Card key={label} className="bg-[var(--brand-50)]"><p className="text-sm font-medium text-stone-500">{label}</p><p className="mt-3 text-2xl font-black text-[var(--brand-900)]">{value}</p></Card>)}</div>
        </div>
      </section>

      <section className="section-shell py-14">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Latest News</p><h2 className="mt-2 text-2xl font-black text-[var(--brand-900)]">What's happening now</h2></div><NavLink to="/news" className="text-sm font-bold text-[var(--brand-600)]">View all</NavLink></div>
            <div className="mt-6 space-y-3">{news.length ? news.map((item) => <button key={item.id} type="button" onClick={() => setSelectedItem({ ...item, modalType: "news" })} className="flex w-full gap-4 rounded-2xl border border-stone-200 p-4 text-left transition hover:border-[var(--brand-200)]"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-50)] text-[var(--brand-600)]"><Newspaper className="h-5 w-5" /></div><div><p className="text-xs text-stone-400">{formatDate(item.createdAt)}</p><h3 className="mt-1 font-bold text-[var(--brand-900)]">{item.title}</h3><p className="mt-1 line-clamp-2 text-sm leading-6 text-stone-600">{item.body}</p></div></button>) : <EmptyState title="No news published yet" description="Community stories and program updates will appear here." />}</div>
          </Card>
          <Card className="bg-gradient-to-br from-white to-[var(--brand-50)]"><div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)] w-fit"><Landmark className="h-6 w-6" /></div><h2 className="mt-4 text-2xl font-black text-[var(--brand-900)]">Know your barangay officials</h2><p className="mt-3 text-sm leading-7 text-stone-600">View the currently serving officials, positions and public contact information.</p><NavLink to="/officials" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--brand-600)]">View Barangay Officials<ArrowRight className="h-4 w-4" /></NavLink><div className="mt-6 rounded-2xl bg-white p-4 text-sm text-stone-600"><p className="font-semibold text-stone-900">Registered residents</p><p className="mt-1 text-2xl font-black text-[var(--brand-900)]">{statistics.totalRegisteredResidents || 0}</p></div></Card>
        </div>
      </section>

      <section className="section-shell pb-16">
        <Card className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4 p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand-500)]">Visit Barangay Hall</p><h2 className="text-3xl font-black text-[var(--brand-900)]">Barangay Iba Hall</h2><p className="text-sm leading-7 text-stone-600">Visit for document claiming, meetings and in-person barangay services.</p><div className="rounded-2xl bg-[var(--brand-50)] p-4 text-sm text-stone-600">{contact.address || "Barangay Iba, Silang, Cavite"}</div>{contact.phone ? <p className="text-sm text-stone-600">Phone: {contact.phone}</p> : null}</div>
            <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4643.835245633062!2d120.97364057493353!3d14.219861245191764!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x33bd7ea2bc5effa9%3A0x4d615506a927c30d!2sIba%20Barangay%20Hall!5e0!3m2!1sen!2sph!4v1777452608339!5m2!1sen!2sph" className="min-h-[340px] w-full border-0" allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Barangay Iba Hall Location" />
          </div>
        </Card>
      </section>

      <Modal open={Boolean(selectedItem)} onClose={() => setSelectedItem(null)} title={selectedItem?.title || "Details"} description={selectedItem ? selectedItem.modalType === "event" ? `${formatDate(selectedItem.date)}${selectedItem.time ? ` · ${selectedItem.time}` : ""}` : formatDate(selectedItem.createdAt) : ""} widthClass="max-w-4xl">
        {selectedItem ? <div className="space-y-5">{selectedItem.imageUrl ? <img src={selectedItem.imageUrl} alt={selectedItem.title} className="h-72 w-full rounded-3xl object-cover" /> : null}{selectedItem.location ? <div className="inline-flex rounded-full bg-[var(--brand-50)] px-4 py-2 text-sm font-semibold text-[var(--brand-700)]">{selectedItem.location}</div> : null}<p className="whitespace-pre-wrap text-sm leading-7 text-stone-700">{selectedItem.description || selectedItem.body}</p></div> : null}
      </Modal>
    </div>
  );
};

export default Home;
