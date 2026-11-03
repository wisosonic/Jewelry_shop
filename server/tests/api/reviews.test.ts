import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-reviews.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("reviews API", () => {
  it("lists reviews and their average publicly, but requires auth to post one", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: aliceToken } = await createUserWithToken(prisma, { email: "reviewer1@test.com" });
    const { accessToken: bobToken } = await createUserWithToken(prisma, { email: "reviewer2@test.com" });

    const product = await prisma.product.create({
      data: {
        sku: "REVIEW-001",
        name: "Reviewed Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const emptyList = await request(app).get(`/api/v1/products/${product.id}/reviews`);
    expect(emptyList.status).toBe(200);
    expect(emptyList.body.reviews).toEqual([]);
    expect(emptyList.body.averageRating).toBeNull();

    const unauthenticated = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .send({ rating: 5 });
    expect(unauthenticated.status).toBe(401);

    const invalidRating = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ rating: 6 });
    expect(invalidRating.status).toBe(400);

    const aliceReview = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ rating: 4, comment: "Nice ring" });
    expect(aliceReview.status).toBe(201);

    const bobReview = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ rating: 2 });
    expect(bobReview.status).toBe(201);

    const afterTwo = await request(app).get(`/api/v1/products/${product.id}/reviews`);
    expect(afterTwo.body.reviewCount).toBe(2);
    expect(afterTwo.body.averageRating).toBe(3); // (4 + 2) / 2

    // Submitting again updates Alice's existing review rather than adding a second one.
    const aliceUpdate = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ rating: 5 });
    expect(aliceUpdate.status).toBe(201);

    const afterUpdate = await request(app).get(`/api/v1/products/${product.id}/reviews`);
    expect(afterUpdate.body.reviewCount).toBe(2); // still 2, not 3
    expect(afterUpdate.body.averageRating).toBe(3.5); // (5 + 2) / 2

    const deleteOwn = await request(app)
      .delete(`/api/v1/products/${product.id}/reviews`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(deleteOwn.status).toBe(204);

    const afterDelete = await request(app).get(`/api/v1/products/${product.id}/reviews`);
    expect(afterDelete.body.reviewCount).toBe(1);
  });
});
