import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { BellIcon, CheckIcon, CloseIcon } from "../components/icons/Icon";

// "info" is neutral - used for real-time notification-system toasts
// (`NotificationToastBridge.tsx`), which aren't a "success" or a failure of
// anything the viewer just did, unlike every other toast in this app.
type ToastKind = "success" | "error" | "info";
type ToastEntry = { id: number; message: string; kind: ToastKind };

type ToastContextValue = {
  showToast: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 0;

/**
 * App-wide toast/snackbar notifications, replacing ad hoc per-page save/error
 * feedback. Toasts auto-dismiss after 4s and stack bottom-right.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = "success") => {
      const id = nextToastId++;
      setToasts((current) => [...current, { id, message, kind }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto print:hidden">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
              toast.kind === "error" ? "bg-red-600" : toast.kind === "info" ? "bg-ink-900" : "bg-brand-700"
            }`}
          >
            {toast.kind === "success" ? (
              <CheckIcon className="h-4 w-4 shrink-0" />
            ) : toast.kind === "info" ? (
              <BellIcon className="h-4 w-4 shrink-0" />
            ) : (
              <CloseIcon className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 opacity-80 hover:opacity-100"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Hook for showing toast notifications; throws if used outside `ToastProvider`. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
