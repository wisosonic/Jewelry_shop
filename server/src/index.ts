import http from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { startAccountCleanupScheduler } from "./modules/accountCleanup/accountCleanup.scheduler";
import { startMetalsScheduler } from "./modules/metals/metals.scheduler";
import { initRealtime } from "./realtime";

/**
 * Process entry point: starts the HTTP server and kicks off the background
 * metals price refresh and unverified-account cleanup schedulers once
 * listening. Built on a plain `http.Server` (rather than `app.listen()`
 * directly) so Socket.IO's `initRealtime()` can attach its own upgrade
 * handler to the same server for real-time notification delivery.
 */
const server = http.createServer(app);
initRealtime(server);

server.listen(env.port, () => {
  console.log(`[server] listening on http://localhost:${env.port}`);
  startMetalsScheduler();
  startAccountCleanupScheduler();
});
