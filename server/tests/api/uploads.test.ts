import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;
const uploadedFilePaths: string[] = [];

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-uploads.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
  for (const file of uploadedFilePaths) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

// A minimal 1x1 PNG, used as valid image content for the upload tests.
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478da63f8cfc000000301010018dd8db00000000049454e44ae426082",
  "hex"
);

describe("uploads API", () => {
  it("requires admin auth and only accepts image files", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "shopper@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner@test.com", role: "ADMIN" });

    const unauthorized = await request(app).post("/api/v1/uploads/image").attach("image", TINY_PNG, "test.png");
    expect(unauthorized.status).toBe(401);

    const forbidden = await request(app)
      .post("/api/v1/uploads/image")
      .set("Authorization", `Bearer ${customerToken}`)
      .attach("image", TINY_PNG, "test.png");
    expect(forbidden.status).toBe(403);

    const rejected = await request(app)
      .post("/api/v1/uploads/image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", Buffer.from("not an image"), "notes.txt");
    expect(rejected.status).toBe(400);

    // A file whose *declared* type (extension + the mimetype supertest
    // derives from it) claims to be a PNG, but whose actual content isn't -
    // must still be rejected by the magic-byte content check, not just the
    // declared-mimetype allowlist (a spoofed Content-Type is exactly what a
    // real attacker controls; see uploads.routes.ts's detectImageExtension()).
    const spoofed = await request(app)
      .post("/api/v1/uploads/image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", Buffer.from("<script>alert(1)</script>"), "fake.png");
    expect(spoofed.status).toBe(400);

    const uploaded = await request(app)
      .post("/api/v1/uploads/image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", TINY_PNG, "test.png");
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.url).toMatch(/^\/uploads\/.+\.png$/);

    // Track the real file multer wrote to server/uploads/ so it's cleaned up in afterAll.
    uploadedFilePaths.push(path.join(__dirname, "..", "..", "uploads", path.basename(uploaded.body.url)));
  });
});
