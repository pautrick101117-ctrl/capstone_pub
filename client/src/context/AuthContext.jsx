import {
  startTransition,
  useEffect,
  useCallback,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api";

import { AuthContext } from "./auth";
const STORAGE_KEY = "barangay-iba-auth";
const SESSION_MINUTES = 30;
const SESSION_MS = SESSION_MINUTES * 60 * 1000;

const blankSession = {
  token: "",
  user: null,
  notifications: [],
  expiresAt: null,
  lastActivityAt: null,
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : blankSession;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return blankSession;
    }
  });
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef(null);
  const lastBumpRef = useRef(0);
  const justSignedInTokenRef = useRef(null);
  const loginInFlightRef = useRef(false);

  const persist = useCallback(value => setSession(value), []);
  useEffect(() => {
    if (session.token) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  const clearSession = useCallback(() => {
    startTransition(() => setSession(blankSession));
  }, []);

  const extendSession = useCallback(() => {
    const now = Date.now();
    if (now - lastBumpRef.current < 60_000) return;
    lastBumpRef.current = now;
    setSession(current => current.token ? { ...current, expiresAt: now + SESSION_MS, lastActivityAt: now } : current);
  }, []);

  useEffect(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    if (!session.expiresAt) return undefined;

    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      clearSession();
      return undefined;
    }

    timeoutRef.current = window.setTimeout(() => clearSession(), remaining);
    return () => window.clearTimeout(timeoutRef.current);
  }, [session.expiresAt, clearSession]);

  useEffect(() => {
    if (!session.token) return undefined;

    const handler = () => extendSession();
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, handler, { passive: true }));
    return () => events.forEach((eventName) => window.removeEventListener(eventName, handler));
  }, [session.token, extendSession]);

  const activeToken = session.token;
  useEffect(() => {
    if (!activeToken) return;
    // The login response already contains the authenticated user. Do not immediately
    // request /auth/me again or allow that redundant request to cancel a fresh login.
    if (justSignedInTokenRef.current === activeToken) {
      justSignedInTokenRef.current = null;
      return;
    }
    let cancelled = false;
    api("/auth/me", { token: activeToken }).then(data => {
      if (!cancelled) setSession(current => current.token === activeToken ? { ...current,
        user: data.user, notifications: data.notifications || [],
      } : current);
    }).catch(error => {
      // A timeout or a temporary outage does not prove the current token is invalid.
      if (!cancelled && [401, 403].includes(error?.status)) clearSession();
    });
    return () => { cancelled = true; };
  }, [activeToken, clearSession]);

  const login = async ({ usernameOrEmail, password, adminOnly = false }) => {
    if (loginInFlightRef.current) throw new Error("Sign-in is already in progress.");
    loginInFlightRef.current = true;
    setLoading(true);
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: { usernameOrEmail, password, adminOnly, portal: adminOnly ? "admin" : "resident" },
        // Render Free may need about a minute to wake. Do not replay POST automatically.
        timeoutMs: 90_000,
      });
      if (!data?.token || !data?.user) throw new Error("Invalid login response from server.");
      const now = Date.now();
      const expiresAt = now + (data.sessionTimeoutMinutes || SESSION_MINUTES) * 60 * 1000;
      justSignedInTokenRef.current = data.token;
      persist({
        token: data.token,
        user: data.user,
        notifications: [],
        expiresAt,
        lastActivityAt: now,
      });
      return data.user;
    } finally {
      loginInFlightRef.current = false;
      setLoading(false);
    }
  };

  const logout = () => {
    const activeToken = session.token;
    if (activeToken) api("/auth/logout", { method: "POST", token: activeToken }).catch(() => {});
    clearSession();
  };
  const keepSessionAlive = () => extendSession();

  const refreshProfile = async () => {
    if (!session.token) return null;
    const data = await api("/auth/me", { token: session.token });
    persist({
      ...session,
      user: data.user,
      notifications: data.notifications || session.notifications,
      expiresAt: Date.now() + (data.sessionTimeoutMinutes || SESSION_MINUTES) * 60 * 1000,
      lastActivityAt: Date.now(),
    });
    return data.user;
  };

  const refreshNotifications = async () => {
    if (!session.token) return [];
    const data = await api("/notifications", { token: session.token });
    persist({ ...session, notifications: data.notifications || [] });
    return data.notifications || [];
  };

  const changePassword = async ({ currentPassword, newPassword }) => {
    if (!session.token) return null;
    const data = await api("/auth/change-password", {
      method: "POST",
      token: session.token,
      body: { currentPassword, newPassword },
    });
    persist({
      ...session,
      user: data.user,
      expiresAt: Date.now() + SESSION_MS,
      lastActivityAt: Date.now(),
    });
    return data.user;
  };

  const markNotificationRead = async (notificationId) => {
    if (!session.token) return;
    await api(`/notifications/${notificationId}/read`, { method: "POST", token: session.token });
    persist({
      ...session,
      notifications: session.notifications.map((note) =>
        note.id === notificationId
          ? {
              ...note,
              is_read: true,
              read_at: note.read_at || new Date().toISOString(),
            }
          : note
      ),
    });
  };

  const markAllNotificationsRead = async () => {
    if (!session.token) return;
    await api("/notifications/read-all", { method: "POST", token: session.token });
    const readAt = new Date().toISOString();
    persist({
      ...session,
      notifications: session.notifications.map((note) => ({
        ...note,
        is_read: true,
        read_at: note.read_at || readAt,
      })),
    });
  };

  const value = {
      token: session.token,
      user: session.user,
      notifications: session.notifications,
      unreadCount: session.notifications.filter((note) => !note.is_read).length,
      sessionExpiresAt: session.expiresAt,
      isAuthenticated: Boolean(session.token && session.user),
      isPasswordChangeRequired: Boolean(session.user?.mustChangePassword),
      loading,
      login,
      logout,
      keepSessionAlive,
      refreshProfile,
      refreshNotifications,
      changePassword,
      markNotificationRead,
      markAllNotificationsRead,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
