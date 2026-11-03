import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer } from "socket.io";
import { env } from "./config/env";
import { verifyAccessToken } from "./utils/jwt";

/**
 * Real-time push for the in-app notification system (see
 * modules/notifications/inAppNotifications.service.ts's `createNotification()`)
 * - a persistent per-user Socket.IO connection, authenticated with the same
 * short-lived JWT access token used for every other API request. There's no
 * cookie involved (unlike the refresh token), so `cors` here only needs an
 * `origin` allowlist, not `credentials: true`.
 *
 * `io` stays `null` until `initRealtime()` is called from `index.ts`'s
 * `app.listen()` callback - never from `app.ts` itself, so test files (which
 * import `app` directly and never run `index.ts`) never start a real socket
 * server. `emitToUser()`'s optional chaining makes every call site a safe
 * no-op in that case, so nothing calling it needs to know whether real-time
 * delivery is actually live.
 */
let io: SocketIoServer | null = null;

/**
 * Attaches a Socket.IO server to the given HTTP server and wires up
 * token-based auth: a client connects with `{ auth: { token: accessToken } }`
 * (Socket.IO's `EventSource`-free WebSocket transport can send this at
 * handshake time, unlike a plain `Authorization` header), which is verified
 * with the same `verifyAccessToken()` the `authenticate` HTTP middleware
 * uses. Each verified connection joins a room named `user:<id>`, so
 * `emitToUser()` reaches every open tab/device for that user and no one
 * else - this is what makes "only the corresponding user receives its
 * notification" true.
 *
 * Deliberately does not re-verify auth again after the initial handshake:
 * a connection rides on its access token's validity at connect time only,
 * same as most Socket.IO auth setups - it will naturally reconnect with a
 * fresh token the next time the client calls `connect()` (login/logout/page
 * reload), rather than being kicked mid-session when the original token's
 * TTL elapses.
 */
export function initRealtime(httpServer: HttpServer): void {
  io = new SocketIoServer(httpServer, {
    cors: { origin: env.clientOrigins },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") {
      return next(new Error("Missing access token"));
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
  });
}

/** Pushes a live event to every connected socket for one user; a no-op if that user has no open connection (or the server hasn't started `initRealtime()`, e.g. in tests). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
