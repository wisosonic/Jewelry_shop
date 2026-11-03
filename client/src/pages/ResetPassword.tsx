import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/auth";

/** Sets a new password using the one-time token from the emailed reset link (`?token=...`). */
export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await resetPassword(token, password);
      navigate("/login");
    } catch {
      setError("This reset link is invalid or has expired. Request a new one.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center sm:px-6">
        <h1 className="font-serif text-2xl text-ink-900">Invalid link</h1>
        <p className="mt-2 text-sm text-ink-900/70">This password reset link is missing its token.</p>
        <Link to="/forgot-password" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Reset password</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-sm text-ink-900/70">
          New password
          <input
            type="password"
            required
            minLength={10}
            placeholder="10+ characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Set new password"}
        </button>
      </form>
    </div>
  );
}
