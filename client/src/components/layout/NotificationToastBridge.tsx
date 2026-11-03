import { useEffect } from "react";
import { useToast } from "../../context/ToastContext";
import { useNotificationStore } from "../../store/notificationStore";

/**
 * Bridges `notificationStore`'s live socket arrivals into toasts. This has
 * to be a mounted component rather than a plain socket event handler
 * because `useToast()` is a React hook - the store itself lives outside
 * React and can't call it directly. Renders nothing; mount it once near the
 * app root (inside `ToastProvider`), alongside the other providers.
 */
export function NotificationToastBridge() {
  const queue = useNotificationStore((s) => s.toastQueue);
  const dequeueToast = useNotificationStore((s) => s.dequeueToast);
  const { showToast } = useToast();

  useEffect(() => {
    if (queue.length === 0) return;
    showToast(queue[0].message, "info");
    dequeueToast();
  }, [queue, showToast, dequeueToast]);

  return null;
}
