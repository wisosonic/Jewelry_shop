import cron from "node-cron";
import { env } from "../../config/env";
import { deleteExpiredUnverifiedAccounts, sendDeletionWarnings } from "./accountCleanup.service";

/**
 * Starts the recurring cron job that warns, then deletes, unverified
 * accounts (see accountCleanup.service.ts). Unlike
 * `metals.scheduler.ts`'s equivalent, there's no best-effort run on
 * process boot - a stale metals price actively breaks the storefront
 * immediately, but this job has no such urgency (a few hours' delay in
 * warning or deleting an unverified account is harmless), and running a
 * deletion pass every time a developer restarts the dev server would be a
 * surprising, needless side effect. Warnings are sent before deletions run
 * in the same tick so an account can't be deleted in the same pass it
 * would have first been warned in (their windows don't overlap anyway,
 * but the ordering is deliberate, not incidental).
 */
export function startAccountCleanupScheduler() {
  cron.schedule(env.accountCleanupCron, async () => {
    try {
      const warned = await sendDeletionWarnings();
      const deleted = await deleteExpiredUnverifiedAccounts();
      console.log(`[accountCleanup] warned ${warned} account(s), deleted ${deleted} account(s)`);
    } catch (err) {
      console.error("[accountCleanup] scheduled run failed", err);
    }
  });
}
