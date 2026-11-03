import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyNotificationPreferences, updateMyNotificationPreference } from "../api/notifications";
import { useToast } from "../context/ToastContext";
import type { CustomerEventType, NotificationPreference } from "../types";

const CATEGORY_LABELS: Record<CustomerEventType, { title: string; description: string }> = {
  ORDER_UPDATES: { title: "Order updates", description: "Confirmation and status changes for your orders." },
  ACCOUNT_ACTIVITY: { title: "Account activity", description: "Password changes, new logins, and profile edits." },
  PROMOTION: { title: "Promotions", description: "Sales and announcements from the store." },
  ACCOUNT_DELETION_WARNING: {
    title: "Account deletion warnings",
    description: "Warned before an unverified account is deleted.",
  },
  WISHLIST_BACK_IN_STOCK: { title: "Wishlist availability", description: "A wishlisted product comes back in stock." },
};

/**
 * Standalone page for the five customer-facing notification categories -
 * in-app only, so there's no channel select here (unlike the admin
 * equivalent on `AdminNotifications.tsx`). Reached from the gear icon on
 * `Notifications.tsx`, not linked from anywhere else - it's a sub-page of
 * the notifications feed, not a general account setting.
 */
export function NotificationPreferences() {
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    fetchMyNotificationPreferences()
      .then(setPreferences)
      .catch(() => setLoadError(true));
  };

  useEffect(load, []);

  async function handleToggle(eventType: CustomerEventType, enabled: boolean) {
    try {
      const updated = await updateMyNotificationPreference({ eventType, enabled });
      setPreferences(updated);
    } catch {
      showToast("Couldn't update that preference.", "error");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link to="/notifications" className="text-sm text-brand-600 hover:underline">
        &larr; Back to notifications
      </Link>

      <h1 className="mt-4 font-serif text-3xl text-ink-900 sm:text-4xl">Notification preferences</h1>
      <p className="mt-2 text-sm text-ink-900/60">
        Choose which notifications you want to receive. Disabling a category stops it entirely - you won't
        get it in-app either.
      </p>

      {loadError && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your preferences.{" "}
          <button onClick={load} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      {preferences && (
        <div className="mt-6 divide-y divide-brand-100 rounded-xl border border-brand-200 bg-white px-4">
          {preferences.map((pref) => (
            <label key={pref.eventType} className="flex items-center justify-between gap-3 py-4">
              <span>
                <span className="block text-sm font-medium text-ink-900">{CATEGORY_LABELS[pref.eventType].title}</span>
                <span className="block text-xs text-ink-900/50">{CATEGORY_LABELS[pref.eventType].description}</span>
              </span>
              <input
                type="checkbox"
                checked={pref.enabled}
                onChange={(e) => handleToggle(pref.eventType, e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-brand-300"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
