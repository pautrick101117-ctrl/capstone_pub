import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);
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
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : blankSession;
  });
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef(null);
  const lastBumpRef = useRef(0);

  const persist = (value) => {
    setSession(value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  };

  const clearSession = useEffectEvent(() => {
    startTransition(() => {
      setSession(blankSession);
      localStorage.removeItem(STORAGE_KEY);
    });
  });

  const extendSession = useEffectEvent(() => {
    if (!session.token) return;
    const now = Date.now();
    if (now - lastBumpRef.current < 60_000) return;
    lastBumpRef.current = now;
    persist({
      ...session,
      expiresAt: now + SESSION_MS,
      lastActivityAt: now,
    });
  });

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

  useEffect(() => {
    if (!session.token) return;

    api("/auth/me", { token: session.token })
      .then((data) => {
        persist({
          ...session,
          user: data.user,
          notifications: data.notifications || [],
          expiresAt: Date.now() + (data.sessionTimeoutMinutes || SESSION_MINUTES) * 60 * 1000,
          lastActivityAt: Date.now(),
        });
      })
      .catch(() => clearSession());
  }, []);

  const login = async ({ usernameOrEmail, password, adminOnly = false }) => {
    setLoading(true);
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: { usernameOrEmail, password, adminOnly },
      });

      const expiresAt = Date.now() + (data.sessionTimeoutMinutes || SESSION_MINUTES) * 60 * 1000;
      persist({
        token: data.token,
        user: data.user,
        notifications: [],
        expiresAt,
        lastActivityAt: Date.now(),
      });

      const me = await api("/auth/me", { token: data.token });
      persist({
        token: data.token,
        user: me.user,
        notifications: me.notifications || [],
        expiresAt: Date.now() + (me.sessionTimeoutMinutes || SESSION_MINUTES) * 60 * 1000,
        lastActivityAt: Date.now(),
      });

      return me.user;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => clearSession();

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

  const value = useMemo(
    () => ({
      token: session.token,
      user: session.user,
      notifications: session.notifications,
      unreadCount: session.notifications.filter((note) => !note.is_read).length,
      isAuthenticated: Boolean(session.token && session.user),
      isPasswordChangeRequired: Boolean(session.user?.mustChangePassword && session.user?.role === "resident"),
      loading,
      login,
      logout,
      refreshProfile,
      refreshNotifications,
      changePassword,
      markNotificationRead,
      markAllNotificationsRead,
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
