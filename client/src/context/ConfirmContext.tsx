import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  /** Styles the confirm button as destructive (red) instead of the default brand color. */
  danger?: boolean;
};

type ConfirmState = { message: string; options: ConfirmOptions };

/** Prompts the user with an accessible modal and resolves `true`/`false` with their choice. */
type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * App-wide confirmation dialog, replacing native `window.confirm()` calls.
 * Renders one modal at a time; `useConfirm()` returns a promise-based
 * function so call sites read almost identically to `window.confirm`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback<ConfirmFn>((message, options = {}) => {
    setState({ message, options });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function close(result: boolean) {
    resolveRef.current(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {state.options.title && <h2 className="font-serif text-lg text-ink-900">{state.options.title}</h2>}
            <p className="mt-1 text-sm text-ink-900/70">{state.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-lg border border-brand-300 px-4 py-2 text-sm text-ink-900/80 hover:bg-brand-50"
              >
                Cancel
              </button>
              <button
                onClick={() => close(true)}
                autoFocus
                className={`rounded-lg px-4 py-2 text-sm text-white ${
                  state.options.danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
                }`}
              >
                {state.options.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Hook returning a promise-based confirm function; throws if used outside `ConfirmProvider`. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
