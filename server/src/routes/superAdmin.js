import express from "express";
import bcrypt from "bcryptjs";
import { requireSupabase } from "../lib/supabase.js";
import { sendAccountCreatedEmail } from "../lib/mailer.js";
import { requireAuth, requireCurrentUser, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";
import {
  buildUsername,
  createTemporaryPassword,
  normalizePhoneNumber,
  normalizeRole,
  sanitizeUser,
} from "../utils/helpers.js";

const router = express.Router();

const USER_SELECT =
  "id, first_name, middle_name, last_name, full_name, username, email, role, status, is_active, must_change_password, contact_number, address, purok, birthdate, created_at, updated_at, email_verified, email_verified_at, verification_provider, has_voted";

router.use(requireAuth, requireCurrentUser({ allowPasswordChange: true }), requireRole("super_admin"));

const ensure = (value, message) => {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
};

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return `${value}`.toLowerCase() !== "false";
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

const normalizeManagedRole = (role) => {
  const rawRole = `${role || ""}`.trim().toLowerCase();
  if (!["resident", "admin", "super_admin", "super-admin", "superadmin", "staff"].includes(rawRole)) {
    throw Object.assign(new Error("Invalid user role."), { status: 400 });
  }

  const normalizedRole = normalizeRole(role);
  if (!["resident", "admin", "super_admin"].includes(normalizedRole)) {
    throw Object.assign(new Error("Invalid user role."), { status: 400 });
  }
  return normalizedRole;
};

const hasAnotherActiveSuperAdmin = async (db, userId) => {
  const { data, error } = await db
    .from("users")
    .select("id")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .neq("id", userId)
    .limit(1);
  if (error) throw error;
  return Boolean((data || []).length);
};

router.get("/users", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const role = req.query.role && req.query.role !== "all" ? normalizeManagedRole(req.query.role) : null;
    const active = req.query.active;

    let query = db.from("users").select(USER_SELECT).order("created_at", { ascending: false });
    if (role) query = query.eq("role", role);
    if (active !== undefined && active !== "all") query = query.eq("is_active", parseBoolean(active));

    const { data, error } = await query;
    if (error) throw error;

    const search = `${req.query.search || ""}`.trim().toLowerCase();
    const users = (data || []).map(sanitizeUser).filter((user) => {
      if (!search) return true;
      return [user.fullName, user.username, user.email, user.role]
        .filter(Boolean)
        .some((value) => `${value}`.toLowerCase().includes(search));
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

router.post("/users", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const fullName = `${req.body.fullName || ""}`.trim();
    const email = `${req.body.email || ""}`.trim().toLowerCase();
    const role = normalizeManagedRole(req.body.role || "admin");
    const contactNumber = normalizePhoneNumber(req.body.contactNumber || req.body.phoneNumber || "");

    ensure(fullName, "Full name is required.");
    ensure(email, "Email is required for admin accounts.");
    if (!["admin", "super_admin"].includes(role)) {
      throw Object.assign(new Error("User maintenance can only create admin accounts."), { status: 400 });
    }

    const nameParts = splitName(fullName);
    const usernameBase = buildUsername({
      fullName,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
    });
    const username = await ensureUniqueUsername(db, usernameBase);
    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const now = new Date().toISOString();

    const payload = {
      full_name: fullName,
      first_name: nameParts.firstName,
      middle_name: nameParts.middleName,
      last_name: nameParts.lastName,
      email,
      password_hash: passwordHash,
      address: "",
      purok: "",
      contact_number: contactNumber,
      role,
      status: "approved",
      email_verified: true,
      email_verified_at: now,
      verification_provider: "super_admin_created",
      has_voted: false,
      username,
      must_change_password: true,
      is_active: true,
      updated_at: now,
    };

    const { data, error } = await db.from("users").insert(payload).select(USER_SELECT).single();
    if (error) throw error;

    let emailDelivery = { delivered: false };
    try {
      emailDelivery = await sendAccountCreatedEmail({
        email,
        fullName,
        username,
        temporaryPassword,
        role,
      });
    } catch (emailError) {
      console.warn("[EMAIL ACCOUNT ERROR]", emailError.message);
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: role === "super_admin" ? "create_super_admin_user" : "create_admin_user",
      entityType: "user",
      entityId: data.id,
      details: { username, role, emailDelivery: emailDelivery.delivered },
    });

    res.status(201).json({ user: sanitizeUser(data), temporaryPassword, emailDelivery });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:userId", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: targetUser, error: targetError } = await db
      .from("users")
      .select(USER_SELECT)
      .eq("id", req.params.userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!targetUser) throw Object.assign(new Error("User not found."), { status: 404 });

    const updates = {};
    const protectedSelfFields = ["role", "isActive", "mustChangePassword"];
    const touchesSelfProtection = protectedSelfFields.some((field) => req.body[field] !== undefined);
    if (targetUser.id === req.currentUser.id && touchesSelfProtection) {
      throw Object.assign(new Error("You cannot change your own role, active status, or password-change requirement here."), {
        status: 400,
      });
    }

    if (req.body.fullName !== undefined) {
      const fullName = `${req.body.fullName || ""}`.trim();
      ensure(fullName, "Full name is required.");
      const nameParts = splitName(fullName);
      updates.full_name = fullName;
      updates.first_name = nameParts.firstName;
      updates.middle_name = nameParts.middleName;
      updates.last_name = nameParts.lastName;
    }
    if (req.body.email !== undefined) updates.email = req.body.email ? `${req.body.email}`.trim().toLowerCase() : null;
    if (req.body.contactNumber !== undefined || req.body.phoneNumber !== undefined) {
      updates.contact_number = normalizePhoneNumber(req.body.contactNumber || req.body.phoneNumber || "");
    }
    if (req.body.role !== undefined) updates.role = normalizeManagedRole(req.body.role);
    if (req.body.isActive !== undefined) updates.is_active = parseBoolean(req.body.isActive, true);
    if (req.body.mustChangePassword !== undefined) updates.must_change_password = parseBoolean(req.body.mustChangePassword, false);
    if (req.body.status !== undefined) updates.status = `${req.body.status || ""}`.trim() || targetUser.status;

    const finalRole = updates.role || normalizeRole(targetUser.role);
    const finalEmail = updates.email !== undefined ? updates.email : targetUser.email;
    if (["admin", "super_admin"].includes(finalRole) && !finalEmail) {
      throw Object.assign(new Error("Admin accounts must have an email address."), { status: 400 });
    }

    const removesActiveSuperAdmin =
      normalizeRole(targetUser.role) === "super_admin" &&
      targetUser.is_active &&
      ((updates.role && updates.role !== "super_admin") || updates.is_active === false);
    if (removesActiveSuperAdmin && !(await hasAnotherActiveSuperAdmin(db, targetUser.id))) {
      throw Object.assign(new Error("At least one active super admin account is required."), { status: 400 });
    }

    if (!Object.keys(updates).length) {
      return res.json({ user: sanitizeUser(targetUser) });
    }

    updates.updated_at = new Date().toISOString();
    const { data, error } = await db.from("users").update(updates).eq("id", req.params.userId).select(USER_SELECT).single();
    if (error) throw error;

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "super_admin_update_user",
      entityType: "user",
      entityId: req.params.userId,
      details: updates,
    });

    res.json({ user: sanitizeUser(data) });
  } catch (error) {
    next(error);
  }
});

router.post("/users/:userId/reset-password", async (req, res, next) => {
  try {
    const db = requireSupabase();
    const { data: targetUser, error: targetError } = await db
      .from("users")
      .select(USER_SELECT)
      .eq("id", req.params.userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!targetUser) throw Object.assign(new Error("User not found."), { status: 404 });

    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const { data, error } = await db
      .from("users")
      .update({
        password_hash: passwordHash,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.userId)
      .select(USER_SELECT)
      .single();
    if (error) throw error;

    let emailDelivery = { delivered: false };
    try {
      emailDelivery = await sendAccountCreatedEmail({
        email: data.email,
        fullName: data.full_name,
        username: data.username,
        temporaryPassword,
        role: normalizeRole(data.role),
      });
    } catch (emailError) {
      console.warn("[EMAIL ACCOUNT ERROR]", emailError.message);
    }

    await logAudit({
      actorId: req.currentUser.id,
      actorRole: normalizeRole(req.currentUser.role),
      action: "super_admin_reset_user_password",
      entityType: "user",
      entityId: req.params.userId,
      details: { username: targetUser.username, emailDelivery: emailDelivery.delivered },
    });

    res.json({ user: sanitizeUser(data), temporaryPassword, emailDelivery });
  } catch (error) {
    next(error);
  }
});

export default router;
