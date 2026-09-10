import { verifyToken } from "../lib/jwt.js";
import { requireSupabase } from "../lib/supabase.js";
import { normalizeRole, roleMatches } from "../utils/helpers.js";

export const requireAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return next(Object.assign(new Error("Authentication required."), { status: 401 }));
  }

  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    next(Object.assign(new Error("Invalid or expired session."), { status: 401 }));
  }
};

export const requireRole = (...roles) => (req, _res, next) => {
  const liveRole = req.currentUser?.role ?? req.auth?.role;
  if (!liveRole || !roleMatches(liveRole, roles)) {
    return next(Object.assign(new Error("You do not have access to this action."), { status: 403 }));
  }

  next();
};

export const requireCurrentUser =
  ({ allowPasswordChange = false } = {}) =>
  async (req, _res, next) => {
    try {
      if (!req.auth?.sub) {
        throw Object.assign(new Error("Authentication required."), { status: 401 });
      }

      const db = requireSupabase();
      const { data: user, error } = await db.from("users").select("*").eq("id", req.auth.sub).single();
      if (error) throw error;

      if (!user.is_active) {
        throw Object.assign(new Error("This account is inactive. Please contact the barangay admin."), { status: 403 });
      }

      if (!allowPasswordChange && normalizeRole(user.role) === "resident" && user.must_change_password) {
        const err = Object.assign(new Error("Password change required before continuing."), { status: 403 });
        err.code = "PASSWORD_CHANGE_REQUIRED";
        throw err;
      }

      req.currentUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
