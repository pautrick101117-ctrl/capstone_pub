import { requireSupabase } from "./supabase.js";
import { broadcastSms, sendSms } from "./sms.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const runMaintenance = async () => {
  const db = requireSupabase();
  const nowIso = new Date().toISOString();
  const { data: residents, error: residentsError } = await db
    .from("users")
    .select("id, contact_number")
    .eq("role", "resident")
    .eq("is_active", true);
  if (residentsError) throw residentsError;

  const { data: expiredElections, error: expiredError } = await db
    .from("elections")
    .select("id, title")
    .eq("status", "live")
    .lt("ends_at", nowIso);
  if (expiredError) throw expiredError;

  for (const election of expiredElections || []) {
    await db.from("elections").update({ status: "closed" }).eq("id", election.id);
    if ((residents || []).length) {
      await db.from("notifications").insert(
        residents.map((resident) => ({
          user_id: resident.id,
          title: "Election closed",
          body: `${election.title} has automatically closed.`,
          kind: "info",
          broadcast: false,
        }))
      );
    }
  }

  const reminderDate = new Date(Date.now() + DAY_IN_MS).toISOString().slice(0, 10);
  const { data: idRequests, error: reminderError } = await db
    .from("id_requests")
    .select("id, preferred_date, time_slot, purpose, user_id, pickup_reminder_sent_at, users!id_requests_user_id_fkey(full_name, first_name, last_name, contact_number)")
    .eq("preferred_date", reminderDate)
    .is("pickup_reminder_sent_at", null)
    .in("status", ["confirmed", "rescheduled"]);
  if (reminderError) throw reminderError;

  for (const request of idRequests || []) {
    const resident = request.users;
    await sendSms({
      to: resident?.contact_number,
      message: `Reminder: Your Barangay ID pickup is scheduled on ${request.preferred_date} at ${request.time_slot || "the selected time"} for ${request.purpose}.`,
    });
    await db
      .from("id_requests")
      .update({ pickup_reminder_sent_at: nowIso })
      .eq("id", request.id);
  }

  const soonWindowStart = new Date(Date.now() + DAY_IN_MS).toISOString();
  const soonWindowEnd = new Date(Date.now() + DAY_IN_MS + 60 * 60 * 1000).toISOString();
  const { data: closingSoon, error: closingSoonError } = await db
    .from("elections")
    .select("id, title")
    .eq("status", "live")
    .is("closing_soon_notified_at", null)
    .gte("ends_at", soonWindowStart)
    .lte("ends_at", soonWindowEnd);
  if (closingSoonError) throw closingSoonError;

  if ((closingSoon || []).length) {
    for (const election of closingSoon) {
      if ((residents || []).length) {
        await db.from("notifications").insert(
          residents.map((resident) => ({
            user_id: resident.id,
            title: "Voting closes soon",
            body: `${election.title} will close within 24 hours.`,
            kind: "warning",
            broadcast: false,
          }))
        );
      }
      await broadcastSms(residents || [], `Voting closes soon: ${election.title} will end within 24 hours.`);
      await db
        .from("elections")
        .update({ closing_soon_notified_at: nowIso })
        .eq("id", election.id);
    }
  }
};
