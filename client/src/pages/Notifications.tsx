import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  deleteAllNotifications,
  deleteNotification,
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../api/notifications";
import { Pagination } from "../components/common/Pagination";
import { NotificationListSkeleton } from "../components/common/Skeleton";
import { CloseIcon, SettingsIcon } from "../components/icons/Icon";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useNotificationStore } from "../store/notificationStore";
import type { Notification } from "../types";
import { formatRelativeTime } from "../lib/format";

const PAGE_SIZE = 20;

/** Standalone notifications page for the logged-in user, linked from the navbar bell and the profile page. */
export function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const markAllReadLocally = useNotificationStore((s) => s.markAllReadLocally);
  const decrementUnreadCount = useNotificationStore((s) => s.decrementUnreadCount);

  const loadNotifications = useCallback(() => {
    setLoadError(false);
    fetchMyNotifications({ page, pageSize: PAGE_SIZE })
      .then((result) => {
        setNotifications(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        setNotifications([]);
        setLoadError(true);
      });
  }, [page]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  async function handleOpen(notification: Notification) {
    if (!notification.isRead) {
      try {
        await markNotificationRead(notification.id);
        decrementUnreadCount();
        setNotifications((current) =>
          current ? current.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)) : current
        );
      } catch {
        showToast("Couldn't mark this as read.", "error");
      }
    }
    if (notification.link) navigate(notification.link);
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      markAllReadLocally();
      setNotifications((current) => (current ? current.map((n) => ({ ...n, isRead: true })) : current));
      showToast("All notifications marked as read.");
    } catch {
      showToast("Couldn't mark everything as read.", "error");
    }
  }

  /** Deletes a single notification - no confirmation, matching the "small x" quick-action affordance rather than a full destructive-action prompt. */
  async function handleDelete(notification: Notification) {
    try {
      await deleteNotification(notification.id);
      setNotifications((current) => (current ? current.filter((n) => n.id !== notification.id) : current));
      setTotal((t) => Math.max(0, t - 1));
      if (!notification.isRead) decrementUnreadCount();
    } catch {
      showToast("Couldn't delete this notification.", "error");
    }
  }

  /** Confirms with the user, then deletes every one of their notifications at once. */
  async function handleClearAll() {
    const confirmed = await confirm("Delete all notifications? This cannot be undone.", {
      title: "Clear all notifications",
      confirmLabel: "Clear all",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteAllNotifications();
      setNotifications([]);
      setTotal(0);
      markAllReadLocally(); // nothing left, so the unread count is 0 too - reuses the same store action `handleMarkAllRead` already relies on.
      showToast("All notifications cleared.");
    } catch {
      showToast("Couldn't clear notifications.", "error");
    }
  }

  const hasUnread = notifications?.some((n) => !n.isRead) ?? false;
  const hasNotifications = (notifications?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link to="/profile" className="text-sm text-brand-600 hover:underline">
        &larr; Back to my account
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Notifications</h1>
        <div className="flex items-center gap-3">
          {hasUnread && (
            <button onClick={handleMarkAllRead} className="text-sm text-brand-600 hover:underline">
              Mark all as read
            </button>
          )}
          {hasNotifications && (
            <button onClick={handleClearAll} className="text-sm text-red-600 hover:underline">
              Clear all
            </button>
          )}
          {user?.role === "CUSTOMER" && (
            <Link
              to="/notifications/preferences"
              aria-label="Notification preferences"
              title="Notification preferences"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-900/60 hover:bg-brand-100 hover:text-brand-700"
            >
              <SettingsIcon className="h-5 w-5" />
            </Link>
          )}
        </div>
      </div>

      {notifications === null ? (
        <NotificationListSkeleton />
      ) : loadError ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your notifications.{" "}
          <button onClick={loadNotifications} className="font-medium underline">
            Try again
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <p className="mt-6 text-ink-900/60">You have no notifications yet.</p>
      ) : (
        <>
          <ul className="mt-6 space-y-2">
            {notifications.map((notification) => (
              <li key={notification.id}>
                {/* A plain div, not a button - the "open" button and the
                    delete "x" button below are siblings inside it, not
                    nested inside each other (a <button> inside a <button>
                    is invalid HTML and breaks click handling/accessibility). */}
                <div
                  className={`flex items-start gap-1 rounded-xl border p-4 transition-colors ${
                    notification.isRead
                      ? "border-brand-200 bg-white hover:border-brand-300"
                      : "border-brand-400 bg-brand-50 hover:border-brand-500"
                  }`}
                >
                  <button
                    onClick={() => handleOpen(notification)}
                    className="flex flex-1 items-start justify-between gap-3 text-left"
                  >
                    <div>
                      <p className={`text-sm ${notification.isRead ? "text-ink-900/70" : "font-medium text-ink-900"}`}>
                        {notification.message}
                      </p>
                      <p className="mt-1 text-xs text-ink-900/50">{formatRelativeTime(notification.createdAt)}</p>
                    </div>
                    {!notification.isRead && (
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(notification)}
                    aria-label="Delete notification"
                    title="Delete notification"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-900/40 hover:bg-red-50 hover:text-red-600"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
