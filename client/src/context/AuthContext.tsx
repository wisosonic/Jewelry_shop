import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshAccessToken, setAccessToken, setOnAuthFailure } from "../lib/api";
import { useNotificationStore } from "../store/notificationStore";
import { useWishlistStore } from "../store/wishlistStore";
import type { User } from "../types";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email?: string; password: string; name: string; phone: string; address?: string }) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provides the current authenticated user and auth actions (login, register,
 * logout, profile refresh) to the whole app. On mount it attempts a silent
 * token refresh so a returning visitor with a valid refresh cookie stays
 * signed in without re-entering credentials.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setOnAuthFailure(() => {
      setUser(null);
      useNotificationStore.getState().disconnect();
    });
  }, []);

  useEffect(() => {
    // Attempt a silent refresh on load so a returning visitor with a valid
    // refresh cookie doesn't have to log in again every page reload. Goes
    // through refreshAccessToken() (not api.post("/auth/refresh") directly)
    // so this shares its single in-flight request with any other concurrent
    // caller - notably itself: React StrictMode double-invokes this exact
    // effect in dev, which would otherwise fire two real /auth/refresh
    // requests back to back for the same not-yet-rotated cookie.
    (async () => {
      try {
        const data = await refreshAccessToken();
        setAccessToken(data.accessToken);
        setUser(data.user);
        useWishlistStore.getState().load();
        useNotificationStore.getState().connect();
        useNotificationStore.getState().load();
      } catch {
        setAccessToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  /** Logs in with email/password, storing the access token and user in state. */
  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    useWishlistStore.getState().load();
    useNotificationStore.getState().connect();
    useNotificationStore.getState().load();
    return data.user as User;
  }, []);

  /** Creates a new account and signs the user in immediately with the returned token. */
  const register = useCallback(
    async (input: { email?: string; password: string; name: string; phone: string; address?: string }) => {
      const { data } = await api.post("/auth/register", input);
      setAccessToken(data.accessToken);
      setUser(data.user);
      useWishlistStore.getState().load();
      useNotificationStore.getState().connect();
      useNotificationStore.getState().load();
      return data.user as User;
    },
    []
  );

  /** Logs out server-side and clears local auth state regardless of whether the request succeeds. */
  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setAccessToken(null);
      setUser(null);
      useWishlistStore.getState().clear();
      useNotificationStore.getState().disconnect();
    }
  }, []);

  /** Updates the in-memory user, e.g. after the profile page saves changes. */
  const refreshUser = useCallback((updated: User) => setUser(updated), []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout, refreshUser }),
    [user, isLoading, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook for accessing the auth context; throws if used outside `AuthProvider`. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
