import { BellRing, ClipboardCheck, Vote, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, EmptyState, PageHeader, Pagination, StatCard } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

const pageSize = 4;

const UserDashboard = () => {
  const { token, user, notifications } = useAuth();
  const [requests, setRequests] = useState([]);
  const [elections, setElections] = useState([]);
  const [notificationPage, setNotificationPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);

  useEffect(() => {
    if (!token) return;
    Promise.all([api("/requests/mine", { token }), api("/voting/current", { token })]).then(([requestData, votingData]) => {
      setRequests(requestData.requests || []);
      setElections(votingData.elections || (votingData.election ? [votingData.election] : []));
    });
  }, [token]);

  const completedRequests = requests.filter((item) => item.status === "completed").length;
  const visibleNotifications = notifications || [];
  const notificationTotalPages = Math.max(1, Math.ceil(visibleNotifications.length / pageSize));
  const requestTotalPages = Math.max(1, Math.ceil(requests.length / pageSize));

  useEffect(() => {
    if (notificationPage > notificationTotalPages) setNotificationPage(notificationTotalPages);
  }, [notificationPage, notificationTotalPages]);

  useEffect(() => {
    if (requestPage > requestTotalPages) setRequestPage(requestTotalPages);
  }, [requestPage, requestTotalPages]);

  const paginatedNotifications = useMemo(
    () => visibleNotifications.slice((notificationPage - 1) * pageSize, notificationPage * pageSize),
    [visibleNotifications, notificationPage]
  );

  const paginatedRequests = useMemo(
    () => requests.slice((requestPage - 1) * pageSize, requestPage * pageSize),
    [requests, requestPage]
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Resident Overview"
        title={`Welcome back, ${user?.firstName || "Resident"}`}
        description="Keep an eye on your active requests, resident notifications, and current voting activity."
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label="Total Requests" value={requests.length} />
        <StatCard icon={Wallet} label="Completed Requests" value={completedRequests} />
        <StatCard icon={BellRing} label="Unread Notifications" value={visibleNotifications.filter((item) => !item.is_read).length} />
        <StatCard icon={Vote} label="Live Elections" value={elections.length} hint={elections.length ? "Open for resident voting" : "No live voting"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <div>
            <h2 className="text-xl font-bold text-[var(--brand-900)]">Current Voting</h2>
            <p className="mt-1 text-sm text-stone-500">A quick summary of the election currently visible in your portal.</p>
          </div>
          {elections.length ? (
            <div className="mt-5 space-y-4">
              {elections.slice(0, 3).map((election) => (
                <div key={election.id} className="rounded-3xl border border-stone-200 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone="success">live</Badge>
                    <span className="text-sm text-stone-500">Ends: {formatDateTime(election.endsAt)}</span>
                  </div>
                  <h3 className="mt-4 text-xl font-black text-[var(--brand-900)]">{election.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-600">{election.description}</p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    {[
                      ["Votes Cast", Number.isFinite(Number(election.totalVotes)) ? Number(election.totalVotes) : 0],
                      ["Eligible Residents", Number.isFinite(Number(election.eligibleVoters)) ? Number(election.eligibleVoters) : 0],
                      ["Participation", `${Number.isFinite(Number(election.participationRate)) ? Number(election.participationRate) : 0}%`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-[var(--brand-50)] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-500)]">{label}</p>
                        <p className="mt-2 text-lg font-bold text-[var(--brand-900)]">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {elections.length > 3 ? <p className="text-sm text-stone-500">+ {elections.length - 3} more live election(s). Open Voting to view all.</p> : null}
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState title="No election right now" description="Current voting details will appear here when an election is available." />
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[var(--brand-900)]">Latest Notifications</h2>
              <p className="mt-1 text-sm text-stone-500">Updates from the barangay administration and system activity.</p>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {!visibleNotifications.length ? (
              <EmptyState title="No notifications yet" description="Resident updates will show here when there is activity." />
            ) : (
              paginatedNotifications.map((note) => (
                <div key={note.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--brand-900)]">{note.title}</p>
                      <p className="mt-2 text-sm text-stone-600">{note.body}</p>
                    </div>
                    {!note.is_read ? <Badge tone="info">new</Badge> : null}
                  </div>
                  <p className="mt-3 text-xs text-stone-400">{formatDateTime(note.created_at)}</p>
                </div>
              ))
            )}
          </div>
          <Pagination
            page={notificationPage}
            totalPages={notificationTotalPages}
            onPageChange={setNotificationPage}
          />
        </Card>
      </div>

      <Card>
        <h2 className="text-xl font-bold text-[var(--brand-900)]">Recent Requests</h2>
        <div className="mt-5 space-y-4">
          {!requests.length ? (
            <EmptyState title="No requests yet" description="Start with a barangay document or service request from the Requests page." />
          ) : (
            paginatedRequests.map((request) => (
              <div key={request.id} className="flex flex-col gap-3 rounded-2xl border border-stone-200 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-[var(--brand-900)]">{request.request_type}</p>
                  <p className="mt-1 text-sm text-stone-500">{request.details}</p>
                </div>
                <Badge tone={request.status === "completed" ? "success" : request.status === "processing" ? "warning" : "info"}>
                  {request.status}
                </Badge>
              </div>
            ))
          )}
        </div>
        <Pagination
          page={requestPage}
          totalPages={requestTotalPages}
          onPageChange={setRequestPage}
        />
      </Card>
    </div>
  );
};

export default UserDashboard;
