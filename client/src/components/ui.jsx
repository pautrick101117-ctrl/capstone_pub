import { Eye, EyeOff, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { getStatusMeta } from "../lib/status";

export const PageHeader = ({ eyebrow, title, description, actions }) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="space-y-2">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--brand-500)]">{eyebrow}</p> : null}
      <h1 className="text-2xl font-black tracking-tight text-[var(--brand-900)] sm:text-4xl">{title}</h1>
      {description ? <p className="max-w-3xl text-sm leading-6 text-stone-600 sm:text-base">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">{actions}</div> : null}
  </div>
);

export const Card = ({ className = "", children }) => (
  <div className={`rounded-3xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/60 transition duration-300 sm:p-6 ${className}`}>{children}</div>
);

export const Button = ({ className = "", variant = "primary", loading = false, children, ...props }) => {
  const variants = {
    primary: "bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)]",
    secondary: "bg-white text-[var(--brand-700)] ring-1 ring-[var(--brand-200)] hover:bg-[var(--brand-50)]",
    ghost: "bg-stone-100 text-stone-700 hover:bg-stone-200",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)] disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant] || variants.primary} ${className}`}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
};

export const TextInput = ({ label, hint, error, className = "", ...props }) => (
  <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
    <span>{label}</span>
    <input
      {...props}
      className={`rounded-2xl border bg-white px-4 py-3 text-sm outline-none transition placeholder:text-stone-400 focus:ring-4 ${error ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-stone-200 focus:border-[var(--brand-400)] focus:ring-[var(--brand-100)]"}`}
    />
    {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
  </label>
);

export const PasswordInput = ({ label, className = "", ...props }) => {
  const [visible, setVisible] = useState(false);
  return (
    <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
      {label ? <span>{label}</span> : null}
      <div className="flex items-center rounded-2xl border border-stone-200 bg-white px-4 py-3 transition focus-within:border-[var(--brand-400)] focus-within:ring-4 focus-within:ring-[var(--brand-100)]">
        <input {...props} type={visible ? "text" : "password"} className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400" />
        <button type="button" onClick={() => setVisible((current) => !current)} className="text-stone-400 transition hover:text-[var(--brand-600)]" aria-label={visible ? "Hide password" : "Show password"}>
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
};

export const TextArea = ({ label, hint, error, className = "", ...props }) => (
  <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
    <span>{label}</span>
    <textarea
      {...props}
      className={`min-h-28 rounded-2xl border bg-white px-4 py-3 text-sm outline-none transition placeholder:text-stone-400 focus:ring-4 ${error ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-stone-200 focus:border-[var(--brand-400)] focus:ring-[var(--brand-100)]"}`}
    />
    {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
  </label>
);

export const SelectInput = ({ label, hint, className = "", children, ...props }) => (
  <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
    <span>{label}</span>
    <select {...props} className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]">
      {children}
    </select>
    {hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
  </label>
);

export const StatCard = ({ icon: Icon, label, value, hint, className = "" }) => (
  <Card className={`overflow-hidden bg-gradient-to-br from-white to-[var(--brand-50)] ${className}`}>
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 text-sm font-medium text-stone-500">{label}</p>
      {Icon ? <div className="shrink-0 rounded-2xl bg-[var(--brand-500)]/10 p-2.5 text-[var(--brand-600)]"><Icon className="h-5 w-5" /></div> : null}
    </div>
    <p className="mt-3 break-words text-2xl font-black leading-tight text-[var(--brand-900)] sm:text-3xl">{value}</p>
    {hint ? <p className="mt-2 text-xs text-stone-500">{hint}</p> : null}
  </Card>
);

export const Badge = ({ tone = "neutral", children, title }) => {
  const tones = {
    neutral: "bg-stone-100 text-stone-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-rose-100 text-rose-700",
    info: "bg-[var(--brand-100)] text-[var(--brand-700)]",
  };
  return <span title={title} className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tones[tone] || tones.neutral}`}>{children}</span>;
};

export const StatusBadge = ({ status, showDescription = false }) => {
  const meta = getStatusMeta(status);
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Badge tone={meta.tone} title={meta.description}>{meta.label}</Badge>
      {showDescription && meta.description ? <span className="max-w-xs text-xs text-stone-500">{meta.description}</span> : null}
    </div>
  );
};

export const AlertBanner = ({ tone = "info", title, children, action }) => {
  const tones = {
    info: "border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-900)]",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-rose-200 bg-rose-50 text-rose-900",
  };
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${tones[tone] || tones.info}`} role={tone === "danger" ? "alert" : "status"}>
      <div><p className="font-semibold">{title}</p>{children ? <div className="mt-1 text-sm opacity-80">{children}</div> : null}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
};

export const Tabs = ({ tabs, value, onChange, className = "" }) => (
  <div className={`overflow-x-auto pb-1 ${className}`}>
    <div className="inline-flex min-w-full gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-1 sm:min-w-0" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${value === tab.value ? "bg-white text-[var(--brand-700)] shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
        >
          {tab.label}{tab.count !== undefined ? <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[11px]">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  </div>
);

export const TableShell = ({ children }) => (
  <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
    <div className="overflow-x-auto">{children}</div>
  </div>
);

export const ResponsiveListTable = ({ headers, rows, renderDesktopRow, renderMobileCard, rowKey = (row) => row.id }) => (
  <>
    <div className="hidden md:block">
      <TableShell>
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-500"><tr>{headers.map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => renderDesktopRow(row, index))}</tbody>
        </table>
      </TableShell>
    </div>
    <div className="space-y-3 md:hidden">{rows.map((row, index) => <div key={rowKey(row, index)}>{renderMobileCard(row, index)}</div>)}</div>
  </>
);

export const Skeleton = ({ className = "" }) => <div className={`animate-pulse rounded-2xl bg-stone-200 ${className}`} />;

export const EmptyState = ({ title, description, action }) => (
  <Card className="border-dashed text-center">
    <h3 className="text-lg font-bold text-[var(--brand-900)]">{title}</h3>
    <p className="mx-auto mt-2 max-w-xl text-sm text-stone-500">{description}</p>
    {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
  </Card>
);

export const PageError = ({ title = "We couldn't load this page", message = "Please try again.", onRetry }) => (
  <AlertBanner tone="danger" title={title} action={onRetry ? <Button variant="secondary" onClick={onRetry}><RefreshCw className="h-4 w-4" />Retry</Button> : null}>{message}</AlertBanner>
);

export const Modal = ({ open, onClose, title, description, children, widthClass = "max-w-3xl" }) => {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-stone-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`max-h-[92vh] w-full ${widthClass} overflow-hidden rounded-t-[2rem] border border-stone-200 bg-white shadow-2xl sm:rounded-[2rem]`}>
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4 sm:px-6 sm:py-5">
          <div><h3 id={titleId} className="text-xl font-black text-[var(--brand-900)] sm:text-2xl">{title}</h3>{description ? <p className="mt-2 text-sm text-stone-500">{description}</p> : null}</div>
          <button type="button" onClick={onClose} className="rounded-full border border-stone-200 p-2 text-stone-500 transition hover:bg-stone-100" aria-label="Close dialog"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[calc(92vh-6rem)] overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog = ({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", danger = false, loading = false }) => (
  <Modal open={open} onClose={onClose} title={title} description={description} widthClass="max-w-lg">
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
    </div>
  </Modal>
);

export const Pagination = ({ page, totalPages, onPageChange, className = "" }) => {
  if (totalPages <= 1) return null;
  return (
    <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="text-sm text-stone-500">Page {page} of {totalPages}</p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Previous</Button>
        <Button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>Next</Button>
      </div>
    </div>
  );
};
