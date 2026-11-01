import { documentProgress } from "../lib/documentProgress";

export default function DocumentProgress({ status }) {
  const { stages, step, message, tone, completed, stopped } = documentProgress(status);
  const alertColor = {
    info: "bg-sky-50 text-sky-900 border-sky-200",
    success: "bg-emerald-50 text-emerald-900 border-emerald-200",
    warning: "bg-amber-50 text-amber-900 border-amber-200",
    danger: "bg-rose-50 text-rose-900 border-rose-200",
    neutral: "bg-stone-50 text-stone-700 border-stone-200",
  }[tone];
  return (
    <div className="mt-4 space-y-3" aria-label="Document request progress">
      <ol className="grid gap-2 sm:grid-cols-3">
        {stages.map((stage, index) => {
          const reached = !stopped && index <= step;
          const current = !stopped && index === step && !completed;
          return (
            <li key={stage.label} aria-current={current ? "step" : undefined}
              className={`rounded-xl border p-3 ${current ? "border-[var(--brand-500)] bg-[var(--brand-50)]" : reached ? "border-emerald-200 bg-emerald-50/60" : "border-stone-200 bg-stone-50"}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${reached ? "bg-[var(--brand-600)] text-white" : "bg-stone-200 text-stone-600"}`}>
                  {reached ? "✓" : index + 1}
                </span>
                <span className="text-sm font-semibold text-stone-800">{stage.label}</span>
              </div>
              {current ? <p className="mt-2 text-xs text-stone-600">{stage.detail}</p> : null}
            </li>
          );
        })}
      </ol>
      <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${alertColor}`}>{message}</p>
    </div>
  );
}
