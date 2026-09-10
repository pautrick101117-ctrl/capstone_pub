import { Eye, EyeOff, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

export const PageHeader = ({ eyebrow, title, description, actions }) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="space-y-2">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--brand-500)]">{eyebrow}</p> : null}
      <h1 className="text-3xl font-black tracking-tight text-[var(--brand-900)] sm:text-4xl">{title}</h1>
      {description ? <p className="max-w-2xl text-sm leading-6 text-stone-600 sm:text-base">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
  </div>
);

export const Card = ({ className = "", children }) => (
  <div className={`rounded-3xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-200/60 transition duration-300 hover:shadow-md hover:shadow-stone-300/60 ${className}`}>{children}</div>
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
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
};

export const TextInput = ({ label, className = "", ...props }) => (
  <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
    <span>{label}</span>
    <input
      {...props}
      className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-stone-400 focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
    />
  </label>
);

export const PasswordInput = ({ label, className = "", ...props }) => {
  const [visible, setVisible] = useState(false);

  return (
    <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
      {label ? <span>{label}</span> : null}
      <div className="flex items-center rounded-2xl border border-stone-200 bg-white px-4 py-3 transition focus-within:border-[var(--brand-400)] focus-within:ring-4 focus-within:ring-[var(--brand-100)]">
        <input
          {...props}
          type={visible ? "text" : "password"}
          className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400"
        />
        <button type="button" onClick={() => setVisible((current) => !current)} className="text-stone-400 transition hover:text-[var(--brand-600)]">
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
};

export const TextArea = ({ label, className = "", ...props }) => (
  <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
    <span>{label}</span>
    <textarea
      {...props}
      className="min-h-28 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-stone-400 focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
    />
  </label>
);

export const SelectInput = ({ label, className = "", children, ...props }) => (
  <label className={`flex flex-col gap-2 text-sm font-medium text-stone-700 ${className}`}>
    <span>{label}</span>
    <select
      {...props}
      className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand-400)] focus:ring-4 focus:ring-[var(--brand-100)]"
    >
      {children}
    </select>
  </label>
);

export const StatCard = ({ icon: Icon, label, value, hint }) => (
  <Card className="overflow-hidden bg-gradient-to-br from-white to-[var(--brand-50)]">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-stone-500">{label}</p>
        <p className="mt-3 text-3xl font-black text-[var(--brand-900)]">{value}</p>
        {hint ? <p className="mt-2 text-xs text-stone-500">{hint}</p> : null}
      </div>
      {Icon ? (
        <div className="rounded-2xl bg-[var(--brand-500)]/10 p-3 text-[var(--brand-600)]">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
    </div>
  </Card>
);

export const Badge = ({ tone = "neutral", children }) => {
  const tones = {
    neutral: "bg-stone-100 text-stone-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-rose-100 text-rose-700",
    info: "bg-[var(--brand-100)] text-[var(--brand-700)]",
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
};

export const TableShell = ({ children }) => (
  <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm transition duration-300 hover:shadow-md">
    <div className="overflow-x-auto">{children}</div>
  </div>
);

export const Skeleton = ({ className = "" }) => <div className={`animate-pulse rounded-2xl bg-stone-200 ${className}`} />;

export const EmptyState = ({ title, description }) => (
  <Card className="border-dashed text-center">
    <h3 className="text-lg font-bold text-[var(--brand-900)]">{title}</h3>
    <p className="mt-2 text-sm text-stone-500">{description}</p>
  </Card>
);

export const Modal = ({ open, onClose, title, description, children, widthClass = "max-w-3xl" }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm">
      <div className={`w-full ${widthClass} rounded-[2rem] border border-stone-200 bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-5">
          <div>
            <h3 className="text-2xl font-black text-[var(--brand-900)]">{title}</h3>
            {description ? <p className="mt-2 text-sm text-stone-500">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-stone-200 p-2 text-stone-500 transition hover:bg-stone-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
};

export const Pagination = ({ page, totalPages, onPageChange, className = "" }) => {
  if (totalPages <= 1) return null;

  return (
    <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="text-sm text-stone-500">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <Button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </Button>
      </div>
    </div>
  );
};
