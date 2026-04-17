import bcrypt from "bcryptjs";
import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "./db.js";
import {
  CompetitionModel,
  CompetitorProfileModel,
  TourModel,
  UserModel,
  type EmbeddedScoringConfig,
} from "./models.js";

const TEST_TOUR_NAME = "Test Tour";
const TEST_TOUR_SEASON = "2026 Test";
const TEST_USER_PASSWORD = "password123";
const TEST_USER_PASSWORD_HASH = await bcrypt.hash(TEST_USER_PASSWORD, 10);

type SeedUser = {
  name: string;
  email: string;
};

const seedUsers: SeedUser[] = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const suffix = String(number).padStart(2, "0");
  return {
    name: `Test Player ${suffix}`,
    email: `test.player.${suffix}@frolf.local`,
  };
});

const scoringConfig: EmbeddedScoringConfig = {
  pointsTable: [
    { place: 1, points: 15 },
    { place: 2, points: 12 },
    { place: 3, points: 10 },
    { place: 4, points: 8 },
    { place: 5, points: 6 },
    { place: 6, points: 4 },
    { place: 7, points: 2 },
    { place: 8, points: 1 },
  ],
  countedResultsLimit: 6,
  resultOrder: "lower-is-better",
};

type CompetitionSeed = {
  title: string;
  description: string;
  location: string;
  scheduledAt: string;
  participantIndexes: number[];
};

const competitionSeeds: CompetitionSeed[] = [
  {
    title: "Test Tour - Event 1",
    description: "Early season opener for seeded test data.",
    location: "Central Park Layout",
    scheduledAt: "2026-03-10T16:00:00.000Z",
    participantIndexes: [0, 1, 2, 3, 4, 5],
  },
  {
    title: "Test Tour - Event 2",
    description: "Woods-heavy layout with narrow lines.",
    location: "Pine Ridge",
    scheduledAt: "2026-03-24T16:00:00.000Z",
    participantIndexes: [2, 3, 4, 6, 7, 8],
  },
  {
    title: "Test Tour - Event 3",
    description: "High wind, open fairways, and OB pressure.",
    location: "Bay Front Open",
    scheduledAt: "2026-04-14T16:00:00.000Z",
    participantIndexes: [1, 5, 6, 7, 9, 10],
  },
  {
    title: "Test Tour - Event 4",
    description: "Mixed layout designed for tie-break testing.",
    location: "Riverside",
    scheduledAt: "2026-05-05T16:00:00.000Z",
    participantIndexes: [0, 4, 8, 9, 10, 11],
  },
  {
    title: "Test Tour - Event 5",
    description: "Mid-season scoring test with new players.",
    location: "North Loop",
    scheduledAt: "2026-05-26T16:00:00.000Z",
    participantIndexes: [3, 5, 11, 12, 13, 14],
  },
  {
    title: "Test Tour - Event 6",
    description: "Late-season grinder on technical holes.",
    location: "Cedar Grove",
    scheduledAt: "2026-06-16T16:00:00.000Z",
    participantIndexes: [6, 7, 12, 13, 15, 16],
  },
  {
    title: "Test Tour - Event 7",
    description: "Featured event with broad participant mix.",
    location: "Highland Meadows",
    scheduledAt: "2026-07-07T16:00:00.000Z",
    participantIndexes: [8, 9, 14, 15, 17, 18],
  },
  {
    title: "Test Tour - Event 8",
    description: "Season closer with standings implications.",
    location: "Summit Course",
    scheduledAt: "2026-07-28T16:00:00.000Z",
    participantIndexes: [10, 11, 16, 17, 18, 19],
  },
];

function pointsForPlace(place: number): number {
  return scoringConfig.pointsTable.find((entry) => entry.place === place)?.points ?? 0;
}

async function seed() {
  await connectToDatabase();

  const tour = await TourModel.findOneAndUpdate(
    { name: TEST_TOUR_NAME, seasonLabel: TEST_TOUR_SEASON },
    {
      $set: {
        name: TEST_TOUR_NAME,
        seasonLabel: TEST_TOUR_SEASON,
        description: "Generated test data tour for local development and UI checks.",
        scoring: scoringConfig,
      },
    },
    { upsert: true, new: true },
  );

  if (!tour) {
    throw new Error("Failed to create or load test tour.");
  }

  const seededUserIds: Types.ObjectId[] = [];
  for (const [index, user] of seedUsers.entries()) {
    const normalizedEmail = user.email.toLowerCase();
    const roles: Array<"user" | "admin"> = index === 0 ? ["user", "admin"] : ["user"];
    const updated = await UserModel.findOneAndUpdate(
      { normalizedEmail },
      {
        $set: {
          name: user.name,
          email: user.email,
          normalizedEmail,
          passwordHash: TEST_USER_PASSWORD_HASH,
          roles,
          emailVerified: true,
          verificationToken: null,
        },
      },
      { upsert: true, new: true },
    );
    seededUserIds.push(updated._id);
  }

  const competitorByUserIndex = new Map<number, { id: Types.ObjectId; displayName: string }>();
  for (const [index, user] of seedUsers.entries()) {
    const normalizedName = user.name.toLowerCase();
    const competitor = await CompetitorProfileModel.findOneAndUpdate(
      { tourId: tour._id, normalizedName },
      {
        $set: {
          tourId: tour._id,
          displayName: user.name,
          normalizedName,
          aliases: [],
          linkedUserId: seededUserIds[index],
        },
      },
      { upsert: true, new: true },
    );
    competitorByUserIndex.set(index, { id: competitor._id, displayName: competitor.displayName });
  }

  await CompetitionModel.deleteMany({
    tourId: tour._id,
    title: { $regex: /^Test Tour - Event \d+$/ },
  });

  const organizerUserId = seededUserIds[0];
  const organizerSeedUser = seedUsers[0];
  if (!organizerUserId || !organizerSeedUser) {
    throw new Error("At least one seeded user is required to create competitions.");
  }
  const organizerName = organizerSeedUser.name;

  for (const [eventIndex, event] of competitionSeeds.entries()) {
    if (event.participantIndexes.length < 3) {
      throw new Error(`Competition "${event.title}" must have at least 3 participants.`);
    }

    const participants = event.participantIndexes.map((participantIndex) => {
      const competitor = competitorByUserIndex.get(participantIndex);
      if (!competitor) {
        throw new Error(`Missing competitor for participant index ${participantIndex}.`);
      }
      return {
        competitorId: competitor.id,
        displayName: competitor.displayName,
      };
    });

    const results = participants.map((participant, position) => {
      const placement = position + 1;
      // Slightly varied deterministic values to make standings and ties realistic.
      const resultValue = 49 + eventIndex * 2 + position;
      return {
        competitorId: participant.competitorId,
        displayName: participant.displayName,
        placement,
        resultValue,
        tieBreakRank: null,
        tieBreakNote: null,
        awardedPoints: pointsForPlace(placement),
      };
    });

    await CompetitionModel.create({
      tourId: tour._id,
      organizerUserId,
      organizerName,
      title: event.title,
      description: event.description,
      location: event.location,
      scheduledAt: new Date(event.scheduledAt),
      scoresheetUrl: null,
      status: "finalized",
      participants,
      results,
      scoringSnapshot: scoringConfig,
      auditLog: [
        {
          actorUserId: organizerUserId,
          action: "seeded",
          at: new Date(),
          note: "Generated by seed-test-tour script.",
        },
      ],
    });
  }

  console.log(`Seeded "${TEST_TOUR_NAME}" with ${seedUsers.length} users and ${competitionSeeds.length} competitions.`);
  console.log(`Test account password for seeded users: ${TEST_USER_PASSWORD}`);
}

seed()
  .catch((error) => {
    console.error("Failed to seed test tour data.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
