const BUTTON_VARIANTS = {
  primary: "bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)]",
  secondary: "bg-white text-[var(--brand-700)] ring-1 ring-[var(--brand-200)] hover:bg-[var(--brand-50)]",
  ghost: "bg-stone-100 text-stone-700 hover:bg-stone-200",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

export const buttonClasses = (variant = "primary", className = "") =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--brand-100)] disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary} ${className}`;

