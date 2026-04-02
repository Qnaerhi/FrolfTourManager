import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import type { Express } from "express";

let mongoServer: MongoMemoryServer;
let app: Express;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.JWT_SECRET = "test-secret";
  process.env.NODE_ENV = "test";

  const [{ connectToDatabase }, { createApp }] = await Promise.all([import("./db.js"), import("./app.js")]);
  await connectToDatabase();
  app = createApp();
});

afterEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

async function registerAndVerify(name: string, email: string) {
  const registerResponse = await request(app).post("/api/auth/register").send({
    name,
    email,
    password: "password123",
  });

  expect(registerResponse.status).toBe(201);

  const verifyResponse = await request(app).post("/api/auth/verify-email").send({
    token: registerResponse.body.verificationToken,
  });

  expect(verifyResponse.status).toBe(200);

  return {
    token: verifyResponse.body.token as string,
    user: verifyResponse.body.user as { id: string; roles: string[]; emailVerified: boolean },
  };
}

async function createTour(adminToken: string) {
  const response = await request(app)
    .post("/api/tours")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Cluster Alumni Frolf Tour",
      seasonLabel: "2026",
      description: "Season standings for local competitions.",
      scoring: {
        pointsTable: [
          { place: 1, points: 15 },
          { place: 2, points: 12 },
          { place: 3, points: 10 },
        ],
        countedResultsLimit: 3,
        resultOrder: "lower-is-better",
      },
    });

  expect(response.status).toBe(201);
  return response.body.tour as { id: string };
}

function competitionPayload(tourId: string, organizerName: string) {
  return {
    tourId,
    title: "Local Monthly",
    description: "A local three-card event.",
    location: "Tali",
    scheduledAt: "2026-06-01T12:00:00.000Z",
    organizerName,
    scoresheetUrl: "",
    status: "draft",
    participants: [{ displayName: "Alpha" }, { displayName: "Beta" }, { displayName: "Gamma" }],
  };
}

describe("API authorization", () => {
  it("promotes the first verified user to admin", async () => {
    const account = await registerAndVerify("Admin", "admin@example.com");

    expect(account.user.emailVerified).toBe(true);
    expect(account.user.roles).toContain("admin");
  });

  it("blocks unverified users from creating competitions", async () => {
    const admin = await registerAndVerify("Admin", "admin@example.com");
    const tour = await createTour(admin.token);

    const unverifiedResponse = await request(app).post("/api/auth/register").send({
      name: "Organizer",
      email: "organizer@example.com",
      password: "password123",
    });

    expect(unverifiedResponse.status).toBe(201);

    const createCompetitionResponse = await request(app)
      .post("/api/competitions")
      .set("Authorization", `Bearer ${unverifiedResponse.body.token}`)
      .send(competitionPayload(tour.id, "Organizer"));

    expect(createCompetitionResponse.status).toBe(403);
  });

  it("allows organizers to edit their own competitions and blocks other users", async () => {
    const admin = await registerAndVerify("Admin", "admin@example.com");
    const tour = await createTour(admin.token);
    const organizer = await registerAndVerify("Organizer One", "organizer1@example.com");
    const otherOrganizer = await registerAndVerify("Organizer Two", "organizer2@example.com");

    const createCompetitionResponse = await request(app)
      .post("/api/competitions")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send(competitionPayload(tour.id, "Organizer One"));

    expect(createCompetitionResponse.status).toBe(201);

    const competition = createCompetitionResponse.body.competition as { id: string };

    const forbiddenUpdateResponse = await request(app)
      .patch(`/api/competitions/${competition.id}`)
      .set("Authorization", `Bearer ${otherOrganizer.token}`)
      .send({
        ...competitionPayload(tour.id, "Organizer One"),
        title: "Unauthorized edit",
      });

    expect(forbiddenUpdateResponse.status).toBe(403);

    const ownerUpdateResponse = await request(app)
      .patch(`/api/competitions/${competition.id}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        ...competitionPayload(tour.id, "Organizer One"),
        title: "Updated by owner",
      });

    expect(ownerUpdateResponse.status).toBe(200);
    expect(ownerUpdateResponse.body.competition.title).toBe("Updated by owner");
  });
});
