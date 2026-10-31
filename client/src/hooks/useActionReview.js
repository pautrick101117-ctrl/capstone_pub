import { createContext, useContext, useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";
import { reviewChanges } from "../lib/actionReview";
export const ActionReviewContext = createContext(null);
export const useReviewAction = () => {
  const review = useContext(ActionReviewContext);
  if (!review) throw new Error("useReviewAction requires ActionReviewProvider");
  return review;
};

// Dialog-dismissal safety. Page-level route guarding is registered once per page.
export const useUnsavedForm = ({ initial = null, current = null, enabled = false }) => {
  const review = useReviewAction();
  const dirty = Boolean(enabled && initial && current && reviewChanges(initial, current).length);
  const closeSafely = async (close) => {
    if (!dirty || await review({ title: "Discard unsaved changes?", description: "Your unsaved changes will be lost.", tone: "danger", confirmLabel: "Discard Changes", cancelLabel: "Keep Editing" })) close();
  };
  return { dirty, closeSafely };
};

// Exactly ONE useBlocker registration per page, even if that page has several forms.
export const useUnsavedNavigation = (dirty) => {
  const review = useReviewAction();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => Boolean(dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)));
  const handling = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || handling.current) return;
    handling.current = true;
    review({ title: "Discard unsaved changes?", description: "Your edits have not been saved. Leaving this page will discard them.", tone: "danger", confirmLabel: "Discard Changes", cancelLabel: "Keep Editing" })
      .then((ok) => { if (ok) blocker.proceed(); else blocker.reset(); })
      .finally(() => { handling.current = false; });
  }, [blocker, review]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
};
