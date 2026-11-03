import { useEffect, useState } from "react";
import { fetchUsers } from "../../api/admin";
import {
  fetchAdminNotificationPreferences,
  sendBroadcastNotification,
  updateAdminNotificationPreference,
  updateNotificationMessagingEnabled,
} from "../../api/notifications";
import { CheckIcon } from "../../components/icons/Icon";
import { useToast } from "../../context/ToastContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type { AdminEventType, AdminNotificationPreference, User } from "../../types";

const EVENT_LABELS: Record<AdminEventType, { title: string; description: string }> = {
  USER_SIGNUP: { title: "New sign-ups", description: "A new customer registers an account." },
  LOW_STOCK: { title: "Low stock", description: "A product's stock crosses the low-stock threshold (Settings)." },
  CRITICAL_ERROR: { title: "Critical errors", description: "An unhandled server error occurs." },
  NEW_ORDER: { title: "New orders", description: "A customer places a new order." },
};

const CHANNELS = ["NONE", "EMAIL", "SMS"] as const;

/**
 * Admin page for (1) this admin account's own notification preferences -
 * per-event on/off plus a channel, gated by a master email/SMS switch - and
 * (2) a lightweight broadcast tool for sending a one-off notification to a
 * specific customer or every customer, since there's no marketing/coupon
 * engine to auto-generate "promotion" notifications from. Two independent
 * sections, each saving its own changes immediately (mirrors
 * `AdminUsers.tsx`'s immediate-save role dropdown, not a batched form with
 * one submit button, since every control here is independent of the others).
 */
export function AdminNotifications() {
  const { showToast } = useToast();
  const [messagingEnabled, setMessagingEnabled] = useState(false);
  const [preferences, setPreferences] = useState<AdminNotificationPreference[]>([]);

  const [message, setMessage] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const debouncedUserSearch = useDebouncedValue(userSearch, 300);
  const [userResults, setUserResults] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [loadError, setLoadError] = useState(false);

  function load() {
    setLoadError(false);
    fetchAdminNotificationPreferences()
      .then(({ messagingEnabled, preferences }) => {
        setMessagingEnabled(messagingEnabled);
        setPreferences(preferences);
      })
      .catch(() => setLoadError(true));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!debouncedUserSearch.trim()) {
      setUserResults([]);
      return;
    }
    fetchUsers({ search: debouncedUserSearch, role: "CUSTOMER", pageSize: 5 })
      .then((result) => setUserResults(result.items))
      .catch(() => showToast("Couldn't search customers.", "error"));
  }, [debouncedUserSearch, showToast]);

  /** Toggles the master email/SMS switch, saving immediately. */
  async function handleMessagingToggle() {
    try {
      const result = await updateNotificationMessagingEnabled(!messagingEnabled);
      setMessagingEnabled(result.messagingEnabled);
      showToast(result.messagingEnabled ? "Email/SMS messaging enabled." : "Email/SMS messaging disabled.");
    } catch {
      showToast("Couldn't update that setting.", "error");
    }
  }

  /** Updates one event type's enabled/channel preference, saving immediately. */
  async function handlePreferenceChange(eventType: AdminEventType, changes: Partial<AdminNotificationPreference>) {
    const current = preferences.find((p) => p.eventType === eventType);
    if (!current) return;
    try {
      const result = await updateAdminNotificationPreference({ ...current, ...changes, eventType });
      setPreferences(result.preferences);
    } catch {
      showToast("Couldn't update that preference.", "error");
    }
  }

  /** Sends the composed message to the selected customer, or broadcasts to every customer if none is selected. */
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setIsSending(true);
    try {
      const notifiedCount = await sendBroadcastNotification({
        message: message.trim(),
        userId: selectedUser?.id,
      });
      showToast(
        selectedUser
          ? `Sent to ${selectedUser.name}.`
          : `Sent to ${notifiedCount} customer${notifiedCount === 1 ? "" : "s"}.`
      );
      setMessage("");
      setSelectedUser(null);
      setUserSearch("");
    } catch {
      showToast("Couldn't send that notification.", "error");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Notifications</h1>

      {loadError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your notification preferences.{" "}
          <button onClick={load} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">My notification preferences</h2>
        <p className="mt-1 text-xs text-ink-900/50">
          Every event below always shows up in your in-app notifications when enabled. The switch controls
          whether it's *also* emailed/texted to you, using each event's chosen channel.
        </p>

        <button
          type="button"
          role="switch"
          aria-checked={messagingEnabled}
          onClick={handleMessagingToggle}
          className="mt-4 flex items-center gap-3 text-sm text-ink-900/80"
        >
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              messagingEnabled ? "bg-brand-600" : "bg-brand-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                messagingEnabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </span>
          Enable email/SMS messaging
        </button>

        <div className="mt-5 divide-y divide-brand-100">
          {preferences.map((pref) => (
            <div key={pref.eventType} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
                  <input
                    type="checkbox"
                    checked={pref.enabled}
                    onChange={(e) => handlePreferenceChange(pref.eventType, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-brand-300"
                  />
                  {EVENT_LABELS[pref.eventType].title}
                </label>
                <p className="mt-0.5 text-xs text-ink-900/50">{EVENT_LABELS[pref.eventType].description}</p>
              </div>
              <select
                value={pref.channel}
                disabled={!pref.enabled}
                onChange={(e) =>
                  handlePreferenceChange(pref.eventType, { channel: e.target.value as (typeof CHANNELS)[number] })
                }
                className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="NONE">In-app only</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Send a notification</h2>
        <p className="mt-1 text-xs text-ink-900/50">
          Sends an in-app notification to one customer, or to every customer if none is selected below.
        </p>
        <form onSubmit={handleSend} className="mt-4 space-y-3">
          <textarea
            required
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. 15% off everything this weekend!"
            className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
          />

          {selectedUser ? (
            <div className="flex items-center justify-between rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm">
              <span>
                Sending to <strong>{selectedUser.name}</strong> ({selectedUser.email})
              </span>
              <button type="button" onClick={() => setSelectedUser(null)} className="text-brand-600 hover:underline">
                Clear (send to all)
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search a customer by name or email to target just them..."
                className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm"
              />
              {userResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-brand-200 bg-white py-1 shadow-lg">
                  {userResults.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUser(u);
                          setUserResults([]);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                      >
                        {u.name} <span className="text-ink-900/50">({u.email})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isSending}
            className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" />
            {isSending ? "Sending..." : selectedUser ? "Send to customer" : "Send to all customers"}
          </button>
        </form>
      </section>
    </div>
  );
}
