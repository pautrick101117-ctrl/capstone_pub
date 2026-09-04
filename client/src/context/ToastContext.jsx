import { createContext, useContext, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const TOAST_STYLES = {
  success: {
    icon: CheckCircle2,
    frame: "border-emerald-200 bg-emerald-50 text-emerald-900",
    iconColor: "text-emerald-600",
  },
  error: {
    icon: CircleAlert,
    frame: "border-rose-200 bg-rose-50 text-rose-900",
    iconColor: "text-rose-600",
  },
  info: {
    icon: Info,
    frame: "border-stone-200 bg-white text-stone-900",
    iconColor: "text-[var(--brand-500)]",
  },
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const push = (message, type = "info") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  };

  const remove = (id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const value = useMemo(
    () => ({
      success: (message) => push(message, "success"),
      error: (message) => push(message, "error"),
      info: (message) => push(message, "info"),
    }),
    []
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => {
          const config = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
          const Icon = config.icon;
          return (
            <div key={toast.id} className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${config.frame}`}>
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconColor}`} />
              <p className="flex-1 text-sm font-medium">{toast.message}</p>
              <button type="button" onClick={() => remove(toast.id)} className="rounded-full p-1 text-stone-500 transition hover:bg-black/5">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
