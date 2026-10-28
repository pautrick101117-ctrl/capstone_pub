import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export const useMasterData = (category) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!category) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/master-data?category=${encodeURIComponent(category)}`);
      setItems(data.items || []);
    } catch (loadError) {
      setItems([]);
      setError(loadError.message || "Unable to load options.");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  const options = useMemo(() => items.map((item) => ({ ...item, optionValue: item.label })), [items]);
  return { items, options, loading, error, reload: load };
};


