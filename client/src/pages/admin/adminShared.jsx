import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";

export const LOGO_URL =
  "https://raw.githubusercontent.com/pautrick101117-ctrl/capstone/HEAD/client/public/logo.png";

export const shellStyles = {
  page: {
    minHeight: "100vh",
    background: "#f4f6f4",
    fontFamily: '"Segoe UI", sans-serif',
  },
  body: {
    display: "flex",
    minHeight: "calc(100vh - 64px)",
  },
  main: {
    flex: 1,
    padding: "28px 32px",
    minWidth: 0,
  },
  card: {
    background: "#fff",
    borderRadius: 8,
    border: "1px solid #e0e0e0",
    padding: 20,
  },
};

export const GreenBtn = ({ children, onClick, small, danger, outline, type = "button" }) => (
  <button
    type={type}
    onClick={onClick}
    style={{
      background: danger ? "#c0392b" : outline ? "transparent" : "#2d7a3a",
      color: danger || !outline ? "#fff" : "#2d7a3a",
      border: outline ? "1px solid #2d7a3a" : "none",
      borderRadius: 5,
      padding: small ? "4px 12px" : "8px 20px",
      fontWeight: 600,
      fontSize: small ? 12 : 13,
      cursor: "pointer",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </button>
);

export const StatusBadge = ({ status }) => {
  const map = {
    Approved: ["#1a7a3a", "#e6f7ed"],
    Disapproved: ["#c0392b", "#fdeaea"],
    Pending: ["#c0392b", "#fdeaea"],
    Resolved: ["#1a7a3a", "#e6f7ed"],
    Active: ["#1a7a3a", "#e6f7ed"],
    "For Update": ["#3a5fb0", "#e6eeff"],
    rejected: ["#c0392b", "#fdeaea"],
  };
  const [fg, bg] = map[status] || ["#555", "#eee"];

  return (
    <span style={{ background: bg, color: fg, borderRadius: 4, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
};

export const Table = ({ cols, rows, renderRow }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#e8e8e8" }}>
          {cols.map((col) => (
            <th key={col} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "#444" }}>
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
            {renderRow(row, i)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const Paginate = ({ total, perPage, page, setPage }) => {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, fontSize: 13, color: "#555", flexWrap: "wrap" }}>
      <span>
        Showing {start} to {end} of {total} entries
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        <span onClick={() => setPage(Math.max(1, page - 1))} style={{ cursor: "pointer", padding: "2px 8px" }}>Previous</span>
        {Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((p) => (
          <span key={p} onClick={() => setPage(p)} style={{ cursor: "pointer", padding: "2px 8px", background: p === page ? "#2d7a3a" : "transparent", color: p === page ? "#fff" : "#333", borderRadius: 3 }}>
            {p}
          </span>
        ))}
        <span onClick={() => setPage(Math.min(pages, page + 1))} style={{ cursor: "pointer", padding: "2px 8px" }}>Next</span>
      </div>
    </div>
  );
};

export const SearchBar = ({ value, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f5f5f5", borderRadius: 6, padding: "6px 12px", width: "min(220px, 100%)", marginBottom: 16 }}>
    <span style={{ color: "#888", fontSize: 14 }}>Search</span>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search..." style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: "100%" }} />
  </div>
);

export const SmallInput = ({ value, onChange, placeholder, type = "text" }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{ background: "#f5f5f5", border: "1px solid #d8d8d8", borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%" }} />
);

export const StatCard = ({ label, value }) => (
  <div style={{ background: "#2d7a3a", color: "#fff", borderRadius: 6, padding: "12px 20px", minWidth: 150, flex: 1 }}>
    <div style={{ fontSize: 12, opacity: 0.85 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700 }}>{typeof value === "number" && value > 100 ? value.toLocaleString() : value}</div>
  </div>
);

export const useAdminCollection = (path, key, fallback = []) => {
  const { token } = useAuth();
  const [items, setItems] = useState(fallback);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api(path, { token });
      setItems(data[key] || fallback);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  return { items, setItems, loading, reload: load, token };
};
