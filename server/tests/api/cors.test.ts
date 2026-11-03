import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

// Verifies the CORS allowlist behavior in app.ts: multiple origins parsed
// from a comma-separated CLIENT_ORIGIN are each individually allowed, an
// unlisted origin is rejected, and a request with no Origin header (curl,
// server-to-server) is let through - all against `/api/health`, a route
// that needs no auth/DB state, since this is purely testing the CORS
// middleware itself.
const ALLOWED_ORIGINS = ["http://localhost:5173", "https://app.example.com"];

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-cors.db", { clientOrigins: ALLOWED_ORIGINS });
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("CORS", () => {
  it("allows every configured origin and reflects it back in Access-Control-Allow-Origin", async () => {
    const { app } = await import("../../src/app");

    for (const origin of ALLOWED_ORIGINS) {
      const res = await request(app).get("/api/health").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    }
  });

  it("rejects an origin that isn't in the allowlist", async () => {
    const { app } = await import("../../src/app");

    const res = await request(app).get("/api/health").set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.status).toBe(500);
  });

  it("allows requests with no Origin header at all (curl, server-to-server)", async () => {
    const { app } = await import("../../src/app");

    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
