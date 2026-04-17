import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

let app: Express;
let clearData: (() => Promise<void>) | undefined;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.ENABLE_RATE_LIMITING = "false";
  process.env.BOOTSTRAP_ADMIN_EMAILS =
    "admin@example.com,admin-signup@example.com,admin-draft@example.com,admin-started@example.com";

  const [{ connectToDatabase }, { createApp }, { clearFirestoreCollectionsForTests }] = await Promise.all([
    import("./db.js"),
    import("./app.js"),
    import("./models.js"),
  ]);
  await connectToDatabase();
  clearData = clearFirestoreCollectionsForTests;
  app = createApp();
});

afterEach(async () => {
  if (clearData) {
    await clearData();
  }
});

afterAll(async () => {
  if (clearData) {
    await clearData();
  }
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
    user: verifyResponse.body.user as { id: string; name: string; roles: string[]; emailVerified: boolean },
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

function publishedCompetitionPayload(tourId: string, organizerName: string, scheduledAt = "2026-06-01T12:00:00.000Z") {
  return {
    ...competitionPayload(tourId, organizerName),
    status: "published",
    scheduledAt,
  };
}

describe("API authorization", () => {
  it("promotes only allowlisted verified users to admin", async () => {
    const account = await registerAndVerify("Admin", "admin@example.com");
    const regularUser = await registerAndVerify("Player", "player@example.com");

    expect(account.user.emailVerified).toBe(true);
    expect(account.user.roles).toContain("admin");
    expect(regularUser.user.roles).toEqual(["user"]);
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

describe("competition self-signup", () => {
  it("allows logged-in users to sign up and unenroll before start", async () => {
    const admin = await registerAndVerify("Admin", "admin-signup@example.com");
    const tour = await createTour(admin.token);
    const organizer = await registerAndVerify("Organizer", "organizer-signup@example.com");
    const player = await registerAndVerify("Player", "player-signup@example.com");

    const createCompetitionResponse = await request(app)
      .post("/api/competitions")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send(publishedCompetitionPayload(tour.id, "Organizer"));

    expect(createCompetitionResponse.status).toBe(201);
    const competitionId = createCompetitionResponse.body.competition.id as string;

    const signupResponse = await request(app)
      .post(`/api/competitions/${competitionId}/signup`)
      .set("Authorization", `Bearer ${player.token}`)
      .send();

    expect(signupResponse.status).toBe(200);
    expect(
      signupResponse.body.competition.participants.some((participant: { displayName: string }) =>
        participant.displayName.includes("Player"),
      ),
    ).toBe(true);

    const duplicateSignupResponse = await request(app)
      .post(`/api/competitions/${competitionId}/signup`)
      .set("Authorization", `Bearer ${player.token}`)
      .send();

    expect(duplicateSignupResponse.status).toBe(409);

    const unenrollResponse = await request(app)
      .delete(`/api/competitions/${competitionId}/signup`)
      .set("Authorization", `Bearer ${player.token}`)
      .send();

    expect(unenrollResponse.status).toBe(200);
    expect(
      unenrollResponse.body.competition.participants.some((participant: { displayName: string }) =>
        participant.displayName.includes("Player"),
      ),
    ).toBe(false);
  });

  it("blocks signup when competition is not published", async () => {
    const admin = await registerAndVerify("Admin", "admin-draft@example.com");
    const tour = await createTour(admin.token);
    const organizer = await registerAndVerify("Organizer", "organizer-draft@example.com");
    const player = await registerAndVerify("Player", "player-draft@example.com");

    const draftCompetitionResponse = await request(app)
      .post("/api/competitions")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send(competitionPayload(tour.id, "Organizer"));

    expect(draftCompetitionResponse.status).toBe(201);
    const draftCompetitionId = draftCompetitionResponse.body.competition.id as string;

    const draftSignupResponse = await request(app)
      .post(`/api/competitions/${draftCompetitionId}/signup`)
      .set("Authorization", `Bearer ${player.token}`)
      .send();

    expect(draftSignupResponse.status).toBe(400);
  });

  it("blocks signup and unenroll after competition start time", async () => {
    const admin = await registerAndVerify("Admin", "admin-started@example.com");
    const tour = await createTour(admin.token);
    const organizer = await registerAndVerify("Organizer", "organizer-started@example.com");
    const player = await registerAndVerify("Player", "player-started@example.com");

    const startedCompetitionResponse = await request(app)
      .post("/api/competitions")
      .set("Authorization", `Bearer ${organizer.token}`)
      .send(
        publishedCompetitionPayload(
          tour.id,
          "Organizer",
          new Date(Date.now() + 60_000).toISOString(),
        ),
      );

    expect(startedCompetitionResponse.status).toBe(201);
    const startedCompetitionId = startedCompetitionResponse.body.competition.id as string;

    const startedWithPlayerResponse = await request(app)
      .patch(`/api/competitions/${startedCompetitionId}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        ...publishedCompetitionPayload(
          tour.id,
          "Organizer",
          new Date(Date.now() + 60_000).toISOString(),
        ),
        participants: [{ displayName: "Alpha" }, { displayName: "Beta" }, { displayName: player.user.name }],
      });

    expect(startedWithPlayerResponse.status).toBe(200);

    const setBackToStartedResponse = await request(app)
      .patch(`/api/competitions/${startedCompetitionId}`)
      .set("Authorization", `Bearer ${organizer.token}`)
      .send({
        ...publishedCompetitionPayload(
          tour.id,
          "Organizer",
          new Date(Date.now() - 60_000).toISOString(),
        ),
        participants: [{ displayName: "Alpha" }, { displayName: "Beta" }, { displayName: player.user.name }],
      });

    expect(setBackToStartedResponse.status).toBe(200);

    const signupResponse = await request(app)
      .post(`/api/competitions/${startedCompetitionId}/signup`)
      .set("Authorization", `Bearer ${player.token}`)
      .send();

    expect(signupResponse.status).toBe(400);

    const unenrollResponse = await request(app)
      .delete(`/api/competitions/${startedCompetitionId}/signup`)
      .set("Authorization", `Bearer ${player.token}`)
      .send();

    expect(unenrollResponse.status).toBe(400);
  });
});
