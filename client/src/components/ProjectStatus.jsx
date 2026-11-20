import { CalendarClock, CheckCircle2, Construction, PauseCircle, XCircle } from "lucide-react";
import { getStatusMeta } from "../lib/status";
import { projectStatusDescriptions } from "../lib/projectStatus";
import { Badge } from "./ui";

const icons = { planned: CalendarClock, ongoing: Construction, on_hold: PauseCircle, completed: CheckCircle2, cancelled: XCircle };

export default function ProjectStatus({ status, compact = false }) {
  const meta = getStatusMeta(status);
  const Icon = icons[status] || CalendarClock;
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-stone-600"><Icon className="h-4 w-4" aria-hidden="true" />Project Status</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      {!compact ? <p className="mt-2 text-sm leading-6 text-stone-600">{projectStatusDescriptions[status]}</p> : null}
    </div>
  );
}
