import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ui";
import { reviewChanges } from "../lib/actionReview";

import { ActionReviewContext } from "../hooks/useActionReview";
export const ActionReviewProvider = ({ children }) => {
  const [pending, setPending] = useState(null);
  const resolver = useRef(null);
  const busy = useRef(false);
  const reviewAction = useCallback((config = {}) => {
    if (busy.current) return Promise.resolve(false);
    busy.current = true;
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPending({
        title: "Confirm this action?", description: "Review the details before continuing.",
        confirmLabel: "Confirm & Continue", tone: "primary", ...config,
        changes: config.changes || (config.after ? reviewChanges(config.before, config.after) : []),
      });
    });
  }, []);
  const settle = useCallback((answer) => {
    const done = resolver.current;
    resolver.current = null;
    busy.current = false;
    setPending(null);
    done?.(answer);
  }, []);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; busy.current = false; }, []);
  return <ActionReviewContext.Provider value={reviewAction}>
    {children}
    <ConfirmDialog stacked open={Boolean(pending)} onClose={() => settle(false)} onConfirm={() => settle(true)}
      title={pending?.title} description={pending?.description} tone={pending?.tone}
      confirmLabel={pending?.confirmLabel} cancelLabel={pending?.cancelLabel || "Go Back"}>
      {pending?.subject ? <div className="mb-4 rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-800">{pending.subject}</div> : null}
      {pending?.changes?.length ? <div className="max-h-60 overflow-auto rounded-2xl border border-stone-200">
        <table className="w-full table-fixed text-left text-xs"><thead className="bg-stone-50"><tr><th className="p-3">Field</th><th className="p-3">Before</th><th className="p-3">After</th></tr></thead>
          <tbody>{pending.changes.map((change) => <tr className="border-t border-stone-100" key={change.field}><th className="break-words p-3 font-semibold capitalize">{change.field}</th><td className="break-words p-3 text-stone-500">{change.before}</td><td className="break-words p-3 font-medium">{change.after}</td></tr>)}</tbody>
        </table></div> : null}
      {pending?.note ? <p className="mt-3 whitespace-pre-wrap text-sm">{pending.note}</p> : null}
    </ConfirmDialog>
  </ActionReviewContext.Provider>;
};
