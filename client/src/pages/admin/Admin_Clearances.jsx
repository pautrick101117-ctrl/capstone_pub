import { useState } from "react";
import {
  GreenBtn,
  Paginate,
  SearchBar,
  shellStyles,
  StatusBadge,
  Table,
  useAdminCollection,
} from "./adminShared";
import { api } from "../../lib/api";

const Admin_Clearances = () => {
  const { items: users, loading, reload, token } = useAdminCollection("/admin/users", "users", []);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 5;

  const filtered = users
    .filter((user) => user.role === "resident" && user.status === "pending")
    .filter(
      (user) =>
        `${user.first_name} ${user.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
        user.email.toLowerCase().includes(search.toLowerCase())
    );
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  const approveUser = async (userId, status) => {
    await api(`/admin/users/${userId}`, {
      method: "PATCH",
      token,
      body: { status },
    });
    await reload();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 22, color: "#2d7a3a" }}>Users To Approve</div>
        <div style={{ fontSize: 13, color: "#666" }}>Residents can only log in after you approve them here.</div>
      </div>
      <div style={shellStyles.card}>
        <SearchBar
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <Table
          cols={["ID", "Name", "Email", "Address", "Contact", "Status", "Actions"]}
          rows={paged}
          renderRow={(user) => (
            <>
              <td style={{ padding: "10px 10px" }}>{String(user.id).slice(0, 8)}</td>
              <td style={{ padding: "10px 10px" }}>
                {user.first_name} {user.last_name}
              </td>
              <td style={{ padding: "10px 10px" }}>{user.email}</td>
              <td style={{ padding: "10px 10px" }}>{user.address || "-"}</td>
              <td style={{ padding: "10px 10px" }}>{user.contact_number || "-"}</td>
              <td style={{ padding: "10px 10px" }}>
                <StatusBadge status="Pending" />
              </td>
              <td style={{ padding: "10px 10px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <GreenBtn small onClick={() => approveUser(user.id, "approved")}>
                    Approve
                  </GreenBtn>
                  <GreenBtn small danger onClick={() => approveUser(user.id, "rejected")}>
                    Reject
                  </GreenBtn>
                </div>
              </td>
            </>
          )}
        />
        {loading ? <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>Loading users to approve...</div> : null}
        <Paginate total={filtered.length} perPage={perPage} page={page} setPage={setPage} />
      </div>
    </div>
  );
};

export default Admin_Clearances;
