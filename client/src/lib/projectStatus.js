import { getStatusMeta } from "./status";

export const projectStatuses = ["planned", "ongoing", "on_hold", "completed", "cancelled"];
export const projectStatusFilters = [
  { value: "all", label: "All" },
  ...projectStatuses.map((value) => ({ value, label: getStatusMeta(value).label })),
];

export const projectStatusDescriptions = {
  planned: "The project is awaiting implementation.",
  ongoing: "Project implementation is underway.",
  on_hold: "Project implementation is temporarily suspended.",
  completed: "Project implementation has been completed.",
  cancelled: "The project has been cancelled.",
};

export const projectStatusNeedsReason = (current, next) => current !== next && (
  ["on_hold", "completed", "cancelled"].includes(next) || ["completed", "cancelled"].includes(current)
);
