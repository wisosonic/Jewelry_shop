import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-business.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("business info API", () => {
  it("is publicly readable, defaults sensibly, and lets an admin edit contact info and the override banner", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "biz-customer@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "biz-admin@test.com", role: "ADMIN" });

    const initial = await request(app).get("/api/v1/business");
    expect(initial.status).toBe(200);
    expect(initial.body.overrideActive).toBe(false);
    expect(initial.body.hours).toHaveLength(7);

    const forbidden = await request(app)
      .patch("/api/v1/business")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ address: "hacked" });
    expect(forbidden.status).toBe(403);

    const missingMessage = await request(app)
      .patch("/api/v1/business")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ overrideActive: true });
    expect(missingMessage.status).toBe(400);

    const updated = await request(app)
      .patch("/api/v1/business")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        address: "1 New Address",
        phone: "+1-555-0000",
        overrideActive: true,
        overrideMessage: "Closed today for a private event.",
      });
    expect(updated.status).toBe(200);
    expect(updated.body.address).toBe("1 New Address");
    expect(updated.body.overrideActive).toBe(true);
    expect(updated.body.overrideMessage).toBe("Closed today for a private event.");

    const afterUpdate = await request(app).get("/api/v1/business");
    expect(afterUpdate.body.overrideActive).toBe(true);
  });

  it("lets an admin replace the whole week's hours together and rejects an incomplete week", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "hours-admin@test.com", role: "ADMIN" });

    const fullWeek = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isOpen: dayOfWeek !== 0,
      openTime: "08:00",
      closeTime: "20:00",
    }));

    const incomplete = await request(app)
      .put("/api/v1/business/hours")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(fullWeek.slice(0, 6));
    expect(incomplete.status).toBe(400);

    const badTime = await request(app)
      .put("/api/v1/business/hours")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(fullWeek.map((d) => (d.dayOfWeek === 1 ? { ...d, openTime: "9am" } : d)));
    expect(badTime.status).toBe(400);

    const saved = await request(app)
      .put("/api/v1/business/hours")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(fullWeek);
    expect(saved.status).toBe(200);
    expect(saved.body.hours).toHaveLength(7);
    expect(saved.body.hours.find((h: { dayOfWeek: number }) => h.dayOfWeek === 0).isOpen).toBe(false);
    expect(saved.body.hours.find((h: { dayOfWeek: number }) => h.dayOfWeek === 1).openTime).toBe("08:00");
  });

  it("lets an admin add and remove holiday exceptions", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "holiday-admin@test.com", role: "ADMIN" });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "holiday-customer@test.com" });

    const forbidden = await request(app)
      .post("/api/v1/business/holidays")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ date: "2026-12-31", label: "New Year's Eve", isClosed: true });
    expect(forbidden.status).toBe(403);

    const missingHours = await request(app)
      .post("/api/v1/business/holidays")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ date: "2026-12-31", label: "New Year's Eve - early close", isClosed: false });
    expect(missingHours.status).toBe(400);

    const created = await request(app)
      .post("/api/v1/business/holidays")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ date: "2026-12-31", label: "New Year's Eve - early close", isClosed: false, openTime: "10:00", closeTime: "14:00" });
    expect(created.status).toBe(201);
    expect(created.body.holiday.label).toBe("New Year's Eve - early close");
    const holidayId = created.body.holiday.id;

    const listed = await request(app).get("/api/v1/business");
    expect(listed.body.holidays.some((h: { id: string }) => h.id === holidayId)).toBe(true);

    const removed = await request(app)
      .delete(`/api/v1/business/holidays/${holidayId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);

    const afterRemoval = await request(app).get("/api/v1/business");
    expect(afterRemoval.body.holidays.some((h: { id: string }) => h.id === holidayId)).toBe(false);
  });
});
