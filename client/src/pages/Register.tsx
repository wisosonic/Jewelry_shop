import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Account creation page. `phone` is required (a registration OTP is texted
 * to it - see `VerifyOtp.tsx`, which this page redirects to on success);
 * `email` is optional.
 */
export function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  /**
   * Registers the account and sends the shopper to verify their phone
   * number - unless an admin has turned off OTP verification store-wide
   * (`Settings.otpVerificationEnabled`), in which case the account comes
   * back already verified and there's nothing to verify, so this goes
   * straight home instead.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const user = await register({ ...form, email: form.email.trim() || undefined });
      navigate(user.isVerified ? "/" : "/verify-otp");
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? "Could not create account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Returns a controlled-input `value`/`onChange` pair bound to one field of the registration form. */
  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Create an account</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-sm text-ink-900/70">
          Full name
          <input required value={form.name} onChange={update("name")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
        </label>
        <label className="block text-sm text-ink-900/70">
          Phone number
          <input
            required
            type="tel"
            placeholder="We'll text a verification code to this number"
            value={form.phone}
            onChange={update("phone")}
            className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm text-ink-900/70">
          Email (optional)
          <input type="email" placeholder="you@example.com" value={form.email} onChange={update("email")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
        </label>
        <label className="block text-sm text-ink-900/70">
          Password
          <input required type="password" minLength={10} placeholder="10+ characters" value={form.password} onChange={update("password")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
        </label>
        <label className="block text-sm text-ink-900/70">
          Address (optional)
          <input value={form.address} onChange={update("address")} className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={isSubmitting} className="w-full rounded-full bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-60">
          {isSubmitting ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-900/60">
        Already have an account? <Link to="/login" className="text-brand-600 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
