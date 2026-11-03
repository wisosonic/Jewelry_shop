import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Top-level catch-all for render/lifecycle errors anywhere in the tree below
 * it, so a bug in one page shows a recovery screen instead of a blank app.
 * Does not catch errors in event handlers or async code - those are handled
 * per-call-site (e.g. toasts on a failed API call).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in the React tree:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
          <h1 className="font-serif text-2xl text-ink-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-900/70">
            An unexpected error occurred. Try reloading the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-full bg-brand-600 px-6 py-2.5 text-sm text-white hover:bg-brand-700"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
