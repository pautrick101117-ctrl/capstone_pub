import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export const useMasterData = (category) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!category) return;
    setLoading(true);
    try {
      const data = await api(`/master-data?category=${encodeURIComponent(category)}`);
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => setItems([]));
  }, [category]);

  const options = useMemo(() => items.map((item) => ({ ...item, optionValue: item.label })), [items]);
  return { items, options, loading, reload: load };
};
