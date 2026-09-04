import express from "express";
import bcrypt from "bcryptjs";
import { requireSupabase } from "../lib/supabase.js";
import { signToken } from "../lib/jwt.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { comparePassword, createCode, normalizeRole, roleMatches, sanitizeUser } from "../utils/helpers.js";
import { logAudit } from "../utils/audit.js";
import { synchronizeElectionStatuses } from "../services/electionService.js";

const router = express.Router();
const SESSION_TIMEOUT_MINUTES = 30;
const RESET_CODE_MINUTES = 10;

const getPortalSetting = async (db, key, fallback) => {
  const { data, error } = await db.from("portal_settings").select("value").eq("key_name", key).maybeSingle();
  if (error) return fallback;
  return data?.value ?? fallback;
};

const getUserByIdentifier = async (db, rawIdentifier = "") => {
  const identifier = `${rawIdentifier}`.trim();
  if (!identifier) return null;

  const lowered = identifier.toLowerCase();
  const { data, error } = await db
    .from("users")
    .select("*")
    .or(`username.eq.${lowered},email.eq.${lowered},contact_number.eq.${identifier}`)
    .maybeSingle();
  if (error) throw error;
  return data;
};

router.post("/request-code", (_req, _res, next) => {
  next(Object.assign(new Error("Public registration has been disabled. Please contact your barangay admin."), { status: 410 }));
});

router.post("/register", (_req, _res, next) => {
  next(Object.assign(new Error("Public registration has been disabled. Please contact your barangay admin."), { status: 410 }));
});

router.post("/login", rateLimit({ key: "login", max: 10, windowMs: 15 * 60_000 }), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const rawIdentifier = `${req.body.usernameOrEmail || ""}`.trim();
    const identifier = rawIdentifier.toLowerCase();
    const password = `${req.body.password || ""}`;
    const adminOnly = Boolean(req.body.adminOnly);

    if (!identifier || !password) {
      throw Object.assign(new Error("Username and password are required."), { status: 400 });
    }

    const user = await getUserByIdentifier(db, rawIdentifier);

    if (!user) {
      throw Object.assign(new Error("Invalid credentials."), { status: 401 });
    }

    const valid = await comparePassword(bcrypt, password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error("Invalid credentials."), { status: 401 });
    }

    if (!user.is_active) {
      throw Object.assign(new Error("This account is inactive. Please contact the barangay admin."), { status: 403 });
    }

    if (normalizeRole(user.role) === "resident") {
      const [residentLoginEnabled, maintenanceMode] = await Promise.all([
        getPortalSetting(db, "resident_login_enabled", true),
        getPortalSetting(db, "maintenance_mode", false),
      ]);
      if (!residentLoginEnabled) {
        throw Object.assign(new Error("Resident portal login is temporarily disabled by the barangay administrator."), { status: 503 });
      }
      if (maintenanceMode) {
        throw Object.assign(new Error("The resident portal is currently under maintenance. Please try again later."), { status: 503 });
      }
    }

    if (user.status !== "approved" && normalizeRole(user.role) === "resident") {
      throw Object.assign(new Error("Your account is not active yet. Please contact the barangay admin."), { status: 403 });
    }

    if (adminOnly && !roleMatches(user.role, ["admin"])) {
      throw Object.assign(new Error("Admin access only."), { status: 403 });
    }

    const token = signToken({
      sub: user.id,
      role: normalizeRole(user.role),
      email: user.email,
      username: user.username,
    });

    await logAudit({
      actorId: user.id,
      actorRole: normalizeRole(user.role),
      action: "login",
      entityType: "user",
      entityId: user.id,
      details: { adminOnly },
    });

    res.json({
      token,
      user: sanitizeUser(user),
      sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password/request-code", rateLimit({ key: "forgot-password-request", max: 5, windowMs: 10 * 60_000 }), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const rawIdentifier = `${req.body.usernameOrEmail || ""}`.trim();
    if (!rawIdentifier) {
      throw Object.assign(new Error("Username, email, or contact number is required."), { status: 400 });
    }

    const user = await getUserByIdentifier(db, rawIdentifier);
    if (!user) {
      throw Object.assign(new Error("No account found for that login identifier."), { status: 404 });
    }

    if (!user.email) {
      throw Object.assign(new Error("This account has no email address on file. Please ask the barangay admin to add one."), { status: 400 });
    }

    const method = "email";
    const code = createCode();
    const codeKey = `${user.email}`.toLowerCase();
    const expiresAt = new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000).toISOString();

    const { error } = await db.from("verification_codes").insert({
      email: codeKey,
      code,
      sent_to: user.email,
      provider: "gmail_app_password",
      method,
      sent_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    if (error) throw error;

    await sendVerificationEmail({
      email: user.email,
      code,
      fullName: user.full_name || user.first_name,
    });

    console.log(`[FORGOT PASSWORD] Requested reset code for ${user.username || user.id} via email`);

    res.json({
      message: "A verification code was sent to the resident email on file.",
      method,
      expiresInMinutes: RESET_CODE_MINUTES,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password/reset", rateLimit({ key: "forgot-password-reset", max: 5, windowMs: 10 * 60_000 }), async (req, res, next) => {
  try {
    const db = requireSupabase();
    const rawIdentifier = `${req.body.usernameOrEmail || ""}`.trim();
    const code = `${req.body.code || ""}`.trim();
    const newPassword = `${req.body.newPassword || ""}`;

    if (!rawIdentifier || !code || !newPassword) {
      throw Object.assign(new Error("Identifier, verification code, and new password are required."), { status: 400 });
    }

    if (newPassword.length < 8) {
      throw Object.assign(new Error("New password must be at least 8 characters long."), { status: 400 });
    }

    const user = await getUserByIdentifier(db, rawIdentifier);
    if (!user) {
      throw Object.assign(new Error("No account found for that login identifier."), { status: 404 });
    }

    const codeKey = `${user.email}`.toLowerCase();
    const { data: codeRow, error } = await db
      .from("verification_codes")
      .select("*")
      .eq("email", codeKey)
      .eq("code", code)
      .is("verified_at", null)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!codeRow) {
      throw Object.assign(new Error("The verification code is invalid or expired."), { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { data: updatedUser, error: updateError } = await db
      .from("users")
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    await db
      .from("verification_codes")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", codeRow.id);

    await logAudit({
      actorId: user.id,
      actorRole: normalizeRole(user.role),
      action: "forgot_password_reset",
      entityType: "user",
      entityId: user.id,
      details: { method: codeRow.method },
    });

    console.log(`[FORGOT PASSWORD] Password reset completed for ${updatedUser.username || updatedUser.id}`);

    res.json({
      message: "Password reset successful. You can now log in with your new password.",
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, requireCurrentUser({ allowPasswordChange: true }), async (req, res, next) => {
  try {
    const db = requireSupabase();

    await synchronizeElectionStatuses(db);

    const { data: liveElections, error: liveElectionError } = await db
      .from("elections")
      .select("id")
      .eq("status", "live")
      .lte("starts_at", new Date().toISOString())
      .gt("ends_at", new Date().toISOString());
    if (liveElectionError) throw liveElectionError;

    let hasVoted = false;
    if ((liveElections || []).length) {
      const { data: votes, error: voteError } = await db
        .from("votes")
        .select("election_id")
        .in("election_id", liveElections.map((item) => item.id))
        .eq("user_id", req.currentUser.id);
      if (voteError) throw voteError;
      const votedElectionIds = new Set((votes || []).map((vote) => vote.election_id));
      hasVoted = liveElections.every((item) => votedElectionIds.has(item.id));
    }

    const { data: notifications, error: notificationError } = await db
      .from("notifications")
      .select("*")
      .or(`user_id.eq.${req.currentUser.id},broadcast.eq.true`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (notificationError) throw notificationError;

    res.json({
      user: sanitizeUser({ ...req.currentUser, has_voted: hasVoted }),
      notifications: notifications || [],
      sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/change-password", requireAuth, requireCurrentUser({ allowPasswordChange: true }), async (req, res, next) => {
  try {
    const { currentPassword = "", newPassword = "" } = req.body;
    if (!newPassword || newPassword.length < 8) {
      throw Object.assign(new Error("New password must be at least 8 characters long."), { status: 400 });
    }

    if (!req.currentUser.must_change_password) {
      const validCurrent = await comparePassword(bcrypt, currentPassword, req.currentUser.password_hash);
      if (!validCurrent) {
        throw Object.assign(new Error("Current password is incorrect."), { status: 400 });
      }
    }

    const db = requireSupabase();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { data, error } = await db
      .from("users")
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.currentUser.id)
      .select("*")
      .single();
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "change_password",
      entityType: "user",
      entityId: req.currentUser.id,
      details: {},
    });

    res.json({
      message: "Password updated successfully.",
      user: sanitizeUser(data),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
