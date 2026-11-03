import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { User } from "../types";

/**
 * Shared axios instance for all API calls, plus the request/response
 * interceptors that attach the bearer token and transparently refresh it
 * on a 401 (via the HttpOnly refresh cookie) before retrying the request once.
 */
export const api = axios.create({ baseURL: "/api/v1", withCredentials: true });

// Access token lives in memory only (never localStorage) to keep it out of
// reach of XSS-read storage APIs; the refresh token is an HttpOnly cookie
// the browser sends automatically.
let accessToken: string | null = null;
let onAuthFailure: (() => void) | null = null;

/** Sets (or clears with `null`) the in-memory access token used on outgoing requests. */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Reads the current in-memory access token - used to authenticate the Socket.IO connection (see `notificationStore.ts`). */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Registers the callback invoked when a token refresh fails, e.g. to clear the logged-in user. */
export function setOnAuthFailure(callback: () => void) {
  onAuthFailure = callback;
}

let refreshPromise: Promise<{ accessToken: string; user: User }> | null = null;

/**
 * Refreshes the access token via the HttpOnly refresh cookie, sharing a
 * single in-flight request across every concurrent caller rather than
 * letting each fire its own `POST /auth/refresh`. Both `AuthContext.tsx`'s
 * mount effect and this file's own response interceptor call this instead
 * of hitting `/auth/refresh` directly - without the dedup, two calls
 * landing close together (React StrictMode double-invokes effects in dev,
 * so `AuthContext`'s mount effect alone can trigger this on every page
 * load; multiple components independently 401-ing around the same moment
 * is the other common trigger) would each present the *same* not-yet-
 * rotated refresh token. `auth.service.ts`'s `rotateRefreshToken()`
 * tolerates that specific race without harm (see its own doc comment), but
 * still only one of the two ever needs to hit the network - the other can
 * just await the same promise and get the same result.
 */
export function refreshAccessToken(): Promise<{ accessToken: string; user: User }> {
  if (!refreshPromise) {
    refreshPromise = api
      .post("/auth/refresh")
      .then((res) => res.data)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const isRefreshCall = config?.url?.includes("/auth/refresh");

    if (error.response?.status === 401 && config && !config._retried && !isRefreshCall) {
      config._retried = true;
      try {
        const data = await refreshAccessToken();
        setAccessToken(data.accessToken);
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${data.accessToken}`;
        return api.request(config);
      } catch (refreshError) {
        setAccessToken(null);
        onAuthFailure?.();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
