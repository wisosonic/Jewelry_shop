import "dotenv/config";

/**
 * Reads an environment variable, falling back to `fallback` if unset.
 * @throws {Error} if the variable is missing and no fallback is provided.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Placeholder secrets shipped in .env.example - refusing to boot in
// production with one of these (or anything implausibly short) catches the
// single most damaging deploy mistake this app could make: an attacker who
// knows a committed placeholder string can forge an admin-role JWT and
// bypass authentication entirely. Dev/test keep the softer `required()`
// check below (missing entirely is still an error there, just not this
// stricter one) so local setup isn't forced to generate real secrets.
const KNOWN_PLACEHOLDER_SECRETS = new Set(["change-me-access-secret", "change-me-refresh-secret"]);
const MIN_SECRET_LENGTH = 32;

function assertProductionSafeSecret(name: string, value: string): void {
  if (process.env.NODE_ENV !== "production") return;
  if (KNOWN_PLACEHOLDER_SECRETS.has(value) || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} is missing, a placeholder, or too short (< ${MIN_SECRET_LENGTH} chars) for a production deployment. ` +
        "Generate a real random secret (e.g. `openssl rand -hex 32`) before deploying."
    );
  }
}

const jwtAccessSecret = required("JWT_ACCESS_SECRET");
const jwtRefreshSecret = required("JWT_REFRESH_SECRET");
assertProductionSafeSecret("JWT_ACCESS_SECRET", jwtAccessSecret);
assertProductionSafeSecret("JWT_REFRESH_SECRET", jwtRefreshSecret);

/** Centralized, typed access to process environment configuration used across the app. */
export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // CORS allowlist - one or more comma-separated origins (e.g.
  // "http://localhost:5173,https://app.example.com,https://staging.example.com"),
  // trimmed and with any trailing slash stripped so a copy-pasted URL with
  // one doesn't silently fail to match. See app.ts's `cors()` setup for why
  // this is an explicit allowlist rather than reflecting every origin.
  clientOrigins: required("CLIENT_ORIGIN", "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),

  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),

  metalsApiKey: process.env.METALS_API_KEY ?? "",
  metalsApiBaseUrl: process.env.METALS_API_BASE_URL ?? "https://api.metals.dev/v1",
  metalsCurrency: process.env.METALS_CURRENCY ?? "USD",
  // How often the automatic refresh runs, and the minimum gap enforced
  // between any two refreshes, both used to be configured here
  // (METALS_REFRESH_CRON / METALS_MIN_REFRESH_INTERVAL_MINUTES) - now one
  // admin-editable `Settings.metalPriceRefreshFrequencyMinutes` (see its
  // schema comment) so a change takes effect immediately, with no restart.

  // Twilio (https://www.twilio.com) - sends the registration OTP via SMS.
  // Left empty (or with placeholder values), sms.service.ts falls back to
  // logging the code to the console instead of failing, the same "not
  // configured" convention metals.service.ts uses for METALS_API_KEY.
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioFromNumber: process.env.TWILIO_PHONE_NUMBER ?? "",

  // Registration OTP codes never expire (a deliberate product choice - see
  // the OtpCode model's doc comment) - this instead throttles how often a
  // shopper can request a *new* code, independent of the IP-based
  // otpResendRateLimiter on the route itself (middleware/rateLimit.ts).
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),

  // modules/accountCleanup - an unverified account is auto-deleted this
  // many days after registration, and warned (once) this many days before
  // that. Cron schedule for the daily job that does both - see
  // accountCleanup.scheduler.ts.
  unverifiedAccountTtlDays: Number(process.env.UNVERIFIED_ACCOUNT_TTL_DAYS ?? 14),
  unverifiedAccountWarningDaysBeforeDeletion: Number(
    process.env.UNVERIFIED_ACCOUNT_WARNING_DAYS_BEFORE_DELETION ?? 3
  ),
  accountCleanupCron: process.env.ACCOUNT_CLEANUP_CRON ?? "0 3 * * *",
};
