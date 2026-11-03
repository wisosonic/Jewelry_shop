import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Points DATABASE_URL (and the required JWT secrets) at a fresh, isolated
 * SQLite file for one test file, and applies migrations to it. Must be
 * called from `beforeAll`, before any app module is dynamically imported —
 * static imports of app modules are hoisted above this call by the ES
 * module spec and would pick up the wrong DATABASE_URL. Each test file
 * should use its own `dbFileName` so files stay isolated even when Vitest
 * reuses worker threads across files.
 *
 * `config/env.ts` computes every value once, the first time it's imported -
 * and since a test file's dynamic `await import("../../src/app")` caches
 * that module for the file's whole lifetime, whatever env vars are set
 * *before* that first import is what the entire file gets, with no way to
 * change it mid-file. `otpResendCooldownSeconds` defaults to `0` here
 * (always set explicitly, never left to whatever a previous test file left
 * in `process.env`, in case Vitest reuses a worker) so most test files
 * aren't throttled between resends; pass a real value only in the one test
 * file that specifically exercises the cooldown. Same reasoning for
 * `clientOrigins`, always force-set (default a single
 * `http://localhost:5173`) rather than whatever a developer's real
 * `server/.env` happens to have - pass a real value only in the one test
 * file that specifically exercises multi-origin CORS.
 */
export function setupTestDatabase(
  dbFileName: string,
  options?: { otpResendCooldownSeconds?: number; clientOrigins?: string[] }
): string {
  const dbPath = path.join(__dirname, "..", dbFileName);
  removeDbFiles(dbPath);

  const databaseUrl = `file:${dbPath}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  // Force-clear this rather than letting the developer's real server/.env
  // leak in: metals.service only checks *presence*, so a placeholder value
  // there would make tests silently attempt a real network call instead of
  // exercising the deterministic "not configured" error path.
  process.env.METALS_API_KEY = "";
  // Same reasoning for Twilio: sms.service.ts only checks *presence*, so a
  // developer's real (or dummy-placeholder) server/.env would otherwise
  // make OTP tests attempt a real/garbage Twilio call instead of exercising
  // the deterministic "not configured" console-log fallback.
  process.env.TWILIO_ACCOUNT_SID = "";
  process.env.TWILIO_AUTH_TOKEN = "";
  process.env.TWILIO_PHONE_NUMBER = "";
  process.env.OTP_RESEND_COOLDOWN_SECONDS = String(options?.otpResendCooldownSeconds ?? 0);
  process.env.CLIENT_ORIGIN = (options?.clientOrigins ?? ["http://localhost:5173"]).join(",");

  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  return dbPath;
}

/** Deletes the SQLite file(s) created by {@link setupTestDatabase} for one test file. */
export function teardownTestDatabase(dbPath: string) {
  removeDbFiles(dbPath);
}

function removeDbFiles(dbPath: string) {
  for (const suffix of ["", "-journal"]) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
