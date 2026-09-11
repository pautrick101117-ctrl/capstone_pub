import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { requireSupabase } from "../lib/supabase.js";
import { signToken } from "../lib/jwt.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth, requireCurrentUser } from "../middleware/auth.js";
import { comparePassword, createCode, ensureStrongPassword, normalizeRole, roleMatches, sanitizeUser } from "../utils/helpers.js";
import { logAudit } from "../utils/audit.js";

const router = express.Router();
const SESSION_TIMEOUT_MINUTES = 30;
const RESET_CODE_MINUTES = 10;
const RESET_CODE_MAX_ATTEMPTS = 5;

const hashVerificationCode = (code) => createHash("sha256").update(`${code}`).digest("hex");
const safeHashEqual = (left, right) => {
  try {
    const a = Buffer.from(`${left || ""}`, "hex");
    const b = Buffer.from(`${right || ""}`, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  } catch {
    return false;
  }
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
    const portal = `${req.body.portal || (adminOnly ? "admin" : "resident")}`.trim().toLowerCase();

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

    if (user.status !== "approved" && normalizeRole(user.role) === "resident") {
      throw Object.assign(new Error("Your account is not active yet. Please contact the barangay admin."), { status: 403 });
    }

    if (portal === "admin" && !roleMatches(user.role, ["admin"])) {
      throw Object.assign(new Error("This account does not have access to the admin portal."), { status: 403 });
    }

    if (portal === "resident" && normalizeRole(user.role) !== "resident") {
      throw Object.assign(new Error("This is an administrator account. Please use the Admin Login page."), { status: 403 });
    }

    const token = signToken({
      sub: user.id,
      role: normalizeRole(user.role),
      email: user.email,
      username: user.username,
    });

    await logAudit({
      actorId: user.id,
      actorName: user.full_name || user.username,
      actorRole: normalizeRole(user.role),
      action: portal === "admin" ? "admin_login" : "login",
      module: portal === "admin" ? "authentication" : "resident_authentication",
      entityType: "user",
      entityId: user.id,
      details: { portal },
      req,
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

    const portal = `${req.body.portal || "resident"}`.trim().toLowerCase();
    if (portal === "resident" && normalizeRole(user.role) !== "resident") {
      throw Object.assign(new Error("Password recovery for administrator accounts is managed through the admin portal."), { status: 403 });
    }

    if (!user.email) {
      throw Object.assign(new Error("This account has no email address on file. Please ask the barangay admin to add one."), { status: 400 });
    }

    const method = "email";
    const code = createCode();
    const codeKey = `${user.email}`.toLowerCase();
    const expiresAt = new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000).toISOString();

    await db.from("verification_codes").update({ verified_at: new Date().toISOString() }).eq("email", codeKey).is("verified_at", null);

    const { data: codeRow, error } = await db.from("verification_codes").insert({
      email: codeKey,
      code: "protected",
      code_hash: hashVerificationCode(code),
      attempt_count: 0,
      sent_to: user.email,
      provider: "resend",
      method,
      sent_at: new Date().toISOString(),
      expires_at: expiresAt,
    }).select("id").single();
    if (error) throw error;

    try {
      await sendVerificationEmail({ email: user.email, code, fullName: user.full_name || user.first_name });
    } catch (emailError) {
      await db.from("verification_codes").update({ verified_at: new Date().toISOString() }).eq("id", codeRow.id);
      throw Object.assign(new Error("The verification email could not be delivered. Please try again shortly or contact the barangay admin."), { status: 503, code: emailError.code || "EMAIL_DELIVERY_FAILED" });
    }

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

    ensureStrongPassword(newPassword);

    const user = await getUserByIdentifier(db, rawIdentifier);
    if (!user) {
      throw Object.assign(new Error("No account found for that login identifier."), { status: 404 });
    }

    const portal = `${req.body.portal || "resident"}`.trim().toLowerCase();
    if (portal === "resident" && normalizeRole(user.role) !== "resident") {
      throw Object.assign(new Error("Password recovery for administrator accounts is managed through the admin portal."), { status: 403 });
    }

    const codeKey = `${user.email}`.toLowerCase();
    const { data: codeRow, error } = await db
      .from("verification_codes")
      .select("*")
      .eq("email", codeKey)
      .is("verified_at", null)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!codeRow || Number(codeRow.attempt_count || 0) >= RESET_CODE_MAX_ATTEMPTS) {
      throw Object.assign(new Error("The verification code is invalid or expired."), { status: 400 });
    }

    const submittedHash = hashVerificationCode(code);
    const validCode = codeRow.code_hash
      ? safeHashEqual(codeRow.code_hash, submittedHash)
      : codeRow.code === code;
    if (!validCode) {
      const attempts = Number(codeRow.attempt_count || 0) + 1;
      await db.from("verification_codes").update({ attempt_count: attempts, ...(attempts >= RESET_CODE_MAX_ATTEMPTS ? { verified_at: new Date().toISOString() } : {}) }).eq("id", codeRow.id);
      throw Object.assign(new Error(attempts >= RESET_CODE_MAX_ATTEMPTS ? "Too many incorrect verification attempts. Request a new code." : "The verification code is invalid or expired."), { status: 400 });
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

    const { data: liveElection } = await db
      .from("elections")
      .select("id")
      .eq("status", "live")
      .gt("ends_at", new Date().toISOString())
      .maybeSingle();

    let hasVoted = false;
    if (liveElection) {
      const { data: vote } = await db
        .from("votes")
        .select("id")
        .eq("election_id", liveElection.id)
        .eq("user_id", req.currentUser.id)
        .maybeSingle();
      hasVoted = Boolean(vote);
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
    ensureStrongPassword(newPassword);

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

