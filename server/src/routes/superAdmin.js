import express from "express";
import bcrypt from "bcryptjs";
import { requireSupabase } from "../lib/supabase.js";
import { sendAdminInvitationEmail, newInvitationToken, hashInvitationToken, invitationExpiry } from "../lib/adminInvitations.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { adminActivityMiddleware, logAudit } from "../utils/audit.js";
import { buildUsername, normalizePhoneNumber, sanitizeUser } from "../utils/helpers.js";

const router = express.Router();

const USER_SELECT =
  "id, first_name, middle_name, last_name, full_name, username, email, role, status, is_active, must_change_password, contact_number, created_at, updated_at";

router.use(requireAuth, requireCurrentUser(), requireRole("super_admin"));
router.use(adminActivityMiddleware("super_admin"));

const ensure = (value, message) => {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
};

const splitName = (fullName = "") => {
  const parts = `${fullName}`.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : parts[0] || "",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
  };
};

const ensureUniqueUsername = async (db, baseUsername) => {
  let candidate = baseUsername;
  let counter = 1;

  while (true) {
    const { data, error } = await db.from("users").select("id").eq("username", candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    counter += 1;
    candidate = `${baseUsername}.${counter}`;
  }
};

// Only actual admin accounts are listed here. The Super Admin bootstrap role is not editable.
router.get("/users", async (_req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: users, error } = await db.from("users")
      .select(USER_SELECT).eq("role", "admin").order("created_at", { ascending: false });
    if (error) throw error;
    const ids = (users || []).map((item) => item.id);
    const { data: invitations, error: inviteError } = ids.length
      ? await db.from("admin_invitations").select("user_id, delivery_status, expires_at, sent_at, accepted_at").in("user_id", ids)
      : { data: [], error: null };
    if (inviteError) throw inviteError;
    const byUser = new Map((invitations || []).map((item) => [item.user_id, item]));
    res.json({ users: (users || []).map((user) => ({
      ...sanitizeUser(user),
      invitation: byUser.get(user.id) || null,
    })) });
  } catch (error) { next(error); }
});

router.post("/users", async (req, res, next) => {
  try {
    if (req.body.role !== undefined && req.body.role !== "admin") {
      throw Object.assign(new Error("Only Admin accounts can be created through this portal."), { status: 403 });
    }
    const fullName = `${req.body.fullName || ""}`.trim().replace(/\s+/g, " ");
    const email = `${req.body.email || ""}`.trim().toLowerCase();
    const contactNumber = normalizePhoneNumber(req.body.contactNumber || "");
    ensure(fullName.length >= 3 && fullName.length <= 120 && fullName.split(" ").length >= 2, "Enter a valid first and last name.");
    ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 180, "Enter a valid email address.");
    if (req.body.contactNumber && !/^09\d{9}$/.test(contactNumber)) {
      throw Object.assign(new Error("Use an 11-digit Philippine mobile number."), { status: 400 });
    }
    const db = requireSupabase();
    const nameParts = splitName(fullName);
    const username = await ensureUniqueUsername(db, buildUsername({ fullName }));
    const token = newInvitationToken();
    const expiresAt = invitationExpiry();
    // Insert the pending account and invitation in one database transaction.
    const { data: accountId, error } = await db.rpc("bgy_create_admin_invitation", {
      p_full_name: fullName, p_first_name: nameParts.firstName, p_middle_name: nameParts.middleName,
      p_last_name: nameParts.lastName, p_email: email, p_username: username,
      p_contact_number: contactNumber, p_password_hash: await bcrypt.hash(newInvitationToken(), 12),
      p_token_hash: hashInvitationToken(token), p_expires_at: expiresAt,
    });
    if (error) {
      if (error.code === "23505") throw Object.assign(new Error("An account already uses this email or username."), { status: 409 });
      throw error;
    }
    let deliveryStatus = "sent";
    try {
      const delivery = await sendAdminInvitationEmail({ email, fullName, username, token });
      if (!delivery?.delivered) throw new Error("Email provider did not accept the invitation.");
    } catch (deliveryError) {
      deliveryStatus = "delivery_failed";
      console.warn("[ADMIN INVITATION EMAIL ERROR]", deliveryError.code || "send_failed");
    }
    const { error: statusError } = await db.from("admin_invitations")
      .update({ delivery_status: deliveryStatus, ...(deliveryStatus === "sent" ? { sent_at: new Date().toISOString() } : {}) })
      .eq("user_id", accountId);
    if (statusError) throw statusError;
    await logAudit({ actorId: req.currentUser.id, actorRole: req.currentUser.role,
      action: "admin_invitation_created", module: "admin_accounts", entityType: "user",
      entityId: accountId, eventCategory: "security", details: { deliveryStatus }, req });
    res.status(201).json({ userId: accountId, deliveryStatus,
      message: deliveryStatus === "sent" ? "Invitation accepted by Resend. Admin access stays inactive until password setup." : "Pending Admin account created, but the invitation email failed. Use Resend Invitation to retry." });
  } catch (error) { next(error); }
});

router.post("/users/:userId/resend-invitation", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: user, error: userError } = await db.from("users").select(USER_SELECT)
      .eq("id", req.params.userId).eq("role", "admin").eq("is_active", false).eq("status", "pending").maybeSingle();
    if (userError) throw userError;
    if (!user) throw Object.assign(new Error("Only pending Admin invitations may be resent."), { status: 409 });
    const { data: existing, error: existingError } = await db.from("admin_invitations")
      .select("sent_at, delivery_status").eq("user_id", user.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw Object.assign(new Error("This account has no pending invitation."), { status: 404 });
    // Rate-limit repeated Resend calls across server restarts, not just in-memory.
    if (existing.sent_at && Date.now() - new Date(existing.sent_at).getTime() < 2 * 60 * 1000) {
      throw Object.assign(new Error("Wait at least two minutes before resending an invitation."), { status: 429 });
    }
    const token = newInvitationToken();
    const { error } = await db.rpc("bgy_refresh_admin_invitation", {
      p_user_id: user.id, p_token_hash: hashInvitationToken(token), p_expires_at: invitationExpiry(),
    });
    if (error) throw error;
    let deliveryStatus = "sent";
    try {
      const delivery = await sendAdminInvitationEmail({ email: user.email, fullName: user.full_name, username: user.username, token });
      if (!delivery?.delivered) throw new Error("Email not accepted.");
    } catch (sendError) {
      deliveryStatus = "delivery_failed";
      console.warn("[ADMIN INVITATION RESEND ERROR]", sendError.code || "send_failed");
    }
    const { error: statusError } = await db.from("admin_invitations")
      .update({ delivery_status: deliveryStatus, ...(deliveryStatus === "sent" ? { sent_at: new Date().toISOString() } : {}) })
      .eq("user_id", user.id).eq("delivery_status", "pending_delivery");
    if (statusError) throw statusError;
    await logAudit({ actorId: req.currentUser.id, actorRole: req.currentUser.role,
      action: "admin_invitation_resent", module: "admin_accounts", entityType: "user",
      entityId: user.id, eventCategory: "security", details: { deliveryStatus }, req });
    res.json({ deliveryStatus, message: deliveryStatus === "sent" ? "Invitation accepted by Resend." : "Resend could not accept the invitation. You can retry." });
  } catch (error) { next(error); }
});

export default router;
