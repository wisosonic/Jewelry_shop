import { Link } from "react-router-dom";

/** Catch-all page for any route that doesn't match, rendered via `App.tsx`'s `path="*"` route. */
export function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="font-serif text-5xl text-brand-600">404</p>
      <h1 className="mt-2 font-serif text-2xl text-ink-900">Page not found</h1>
      <p className="mt-2 text-sm text-ink-900/70">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Link
        to="/"
        className="mt-6 rounded-full bg-brand-600 px-6 py-2.5 text-sm text-white hover:bg-brand-700"
      >
        Back to home
      </Link>
    </div>
  );
}
