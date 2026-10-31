import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
export function usePathState(initial) {
  const { pathname } = useLocation();
  const [state, setState] = useState(() => ({ pathname, value: initial }));
  const value = state.pathname === pathname ? state.value : initial;
  const setValue = useCallback(
    (next) =>
      setState((current) => ({
        pathname,
        value:
          typeof next === "function"
            ? next(current.pathname === pathname ? current.value : initial)
            : next,
      })),
    [pathname, initial],
  );
  return [value, setValue];
}
