import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resendOtp, verifyOtp } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

type ApiErrorResponse = {
  response?: {
    data?: { error?: string; details?: { requiresResend?: boolean; retryAfterSeconds?: number } };
  };
};

/**
 * Registration OTP verification page - reached right after `Register.tsx`
 * (and reachable again later, e.g. from `Checkout.tsx`'s verification
 * prompt). Requires an authenticated session (see the `/verify-otp` route
 * in `App.tsx`, gated by `ProtectedRoute`) since the verify/resend
 * endpoints act on the caller's own account.
 */
export function VerifyOtp() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Set when the server reports the code has used up its attempts, or
  // there's nothing pending at all (`details.requiresResend`) - codes never
  // expire in this app, but both of those are still cases where no amount
  // of retrying the input can succeed, so the form is replaced with a
  // dedicated "request a new code" prompt instead of just showing red text
  // next to a form that still invites another guess. The server never
  // issues a replacement code on its own here - resending only ever
  // happens when the shopper clicks a resend button themselves.
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  // Seconds left before another resend is allowed - the server enforces
  // this cooldown regardless, this is purely a display countdown so the
  // shopper isn't left guessing why a click did nothing.
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Nothing to verify once the account is already verified - send them home
  // instead of showing a stale/pointless code-entry form.
  useEffect(() => {
    if (user?.isVerified) navigate("/", { replace: true });
  }, [user, navigate]);

  // Ticks the cooldown display down to zero, one second at a time.
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setTimeout(() => setCooldownSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await verifyOtp(code);
      refreshUser(updated);
      showToast("Phone number verified.");
      navigate("/");
    } catch (err) {
      const data = (err as ApiErrorResponse)?.response?.data;
      setError(data?.error ?? "Incorrect code.");
      setNeedsNewCode(!!data?.details?.requiresResend);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setIsResending(true);
    try {
      const { cooldownSeconds: seconds } = await resendOtp();
      setNeedsNewCode(false);
      setCode("");
      setCooldownSeconds(seconds);
      showToast("A new code has been sent.");
    } catch (err) {
      const data = (err as ApiErrorResponse)?.response?.data;
      if (data?.details?.retryAfterSeconds) {
        setCooldownSeconds(data.details.retryAfterSeconds);
        showToast(data.error ?? "Please wait before requesting another code.", "error");
      } else {
        showToast("Couldn't resend the code. Try again.", "error");
      }
    } finally {
      setIsResending(false);
    }
  }

  if (!user || user.isVerified) return null;

  const resendLabel = isResending ? "Sending..." : cooldownSeconds > 0 ? `Resend available in ${cooldownSeconds}s` : "Send new code";
  const isResendDisabled = isResending || cooldownSeconds > 0;

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Verify your phone</h1>
      <p className="mt-2 text-sm text-ink-900/60">
        We sent a 5-digit code by text message to{" "}
        <span className="font-medium text-ink-900">{user.phone}</span>. Enter it below - until you verify, you can
        browse the shop but can't place an order.
      </p>

      {needsNewCode ? (
        <div role="alert" className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p>{error}</p>
          <button
            onClick={handleResend}
            disabled={isResendDisabled}
            className="mt-3 rounded-full bg-brand-600 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {resendLabel}
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block text-sm text-ink-900/70">
              Verification code
              <input
                required
                inputMode="numeric"
                pattern="\d{5}"
                maxLength={5}
                placeholder="00000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-center text-lg tracking-[0.5em]"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting || code.length !== 5}
              className="w-full rounded-full bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {isSubmitting ? "Verifying..." : "Verify"}
            </button>
          </form>

          <button
            onClick={handleResend}
            disabled={isResendDisabled}
            className="mt-4 text-sm text-brand-600 hover:underline disabled:opacity-60"
          >
            {cooldownSeconds > 0 ? resendLabel : isResending ? "Sending..." : "Didn't get a code? Resend"}
          </button>
        </>
      )}
    </div>
  );
}
