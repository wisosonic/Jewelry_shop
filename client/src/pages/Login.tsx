import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isAdminRole } from "../lib/roles";

/** Sign-in page; on success redirects back to the page the user was on, or to the admin/home landing based on role. */
export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  /** Logs the user in and navigates to the originally-requested page, or a role-based default. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const user = await login(email, password);
      const from = (location.state as { from?: Location })?.from;
      navigate(from?.pathname ?? (isAdminRole(user.role) ? "/admin" : "/"));
    } catch {
      setError("Invalid email or password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Sign in</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-sm text-ink-900/70">
          Email or phone number
          <input
            type="text"
            required
            placeholder="you@example.com or your phone number"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm text-ink-900/70">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
          />
        </label>
        <div className="text-right">
          <Link to="/forgot-password" className="text-sm text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
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
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-900/60">
        No account? <Link to="/register" className="text-brand-600 hover:underline">Register</Link>
      </p>
    </div>
  );
}
