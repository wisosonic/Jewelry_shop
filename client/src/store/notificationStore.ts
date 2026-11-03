import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import { fetchUnreadNotificationCount } from "../api/notifications";
import { getAccessToken } from "../lib/api";
import type { Notification } from "../types";

type NotificationState = {
  /** Hydrated from the server on login/silent-refresh (`load()`) and kept live afterward by the socket's `"notification"` event - never persisted client-side. */
  unreadCount: number;
  /** Notifications that arrived live and haven't been shown as a toast yet - drained one at a time by `NotificationToastBridge`. */
  toastQueue: Notification[];
  socket: Socket | null;
  /** Opens the real-time connection, authenticated with the current access token (no explicit URL - same-origin `/socket.io`, proxied by Vite in dev). */
  connect: () => void;
  disconnect: () => void;
  /** Fetches the current unread count once - the live count only ever increments after this via the socket. */
  load: () => Promise<void>;
  markAllReadLocally: () => void;
  decrementUnreadCount: () => void;
  dequeueToast: () => void;
};

/**
 * Real-time in-app notifications: unread count + a queue of live arrivals
 * for toast display. Not persisted to localStorage (like `wishlistStore`,
 * unlike `cartStore`) - this is live, per-session state, not something that
 * should survive across accounts on a shared browser. Wired into
 * `AuthContext.tsx` at the same four points `wishlistStore` already is:
 * `connect()`/`load()` on login, register, and silent-refresh success;
 * `disconnect()` on logout.
 *
 * Known simplification: the socket authenticates once at connect time and
 * is never re-authenticated when the access token later rotates - it rides
 * on the live connection rather than the token's stated TTL, same as most
 * Socket.IO auth setups. A fresh connection only happens on the next
 * login/logout or page reload.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  toastQueue: [],
  socket: null,

  connect: () => {
    get().socket?.disconnect();
    const token = getAccessToken();
    if (!token) return;

    const socket = io({ auth: { token } });
    socket.on("notification", (notification: Notification) => {
      set((state) => ({
        unreadCount: state.unreadCount + 1,
        toastQueue: [...state.toastQueue, notification],
      }));
    });
    set({ socket });
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null, unreadCount: 0, toastQueue: [] });
  },

  // Swallows its own failure (logging rather than throwing) since every
  // call site (`AuthContext.tsx`'s login/register/silent-refresh) calls
  // this without awaiting or catching it - a rejected promise here would
  // otherwise be a genuine unhandled rejection, and the unread badge would
  // just stay at its previous value (0 on a fresh session) rather than the
  // page breaking.
  load: async () => {
    try {
      const unreadCount = await fetchUnreadNotificationCount();
      set({ unreadCount });
    } catch {
      console.error("Failed to load unread notification count");
    }
  },

  markAllReadLocally: () => set({ unreadCount: 0 }),
  decrementUnreadCount: () => set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
  dequeueToast: () => set((state) => ({ toastQueue: state.toastQueue.slice(1) })),
}));
