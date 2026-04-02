import { describe, expect, it } from "vitest";
import { calculateStandings, canCreateCompetition, canManageCompetition, type CompetitionSummary } from "./index.js";

const scoring = {
  pointsTable: [
    { place: 1, points: 15 },
    { place: 2, points: 12 },
    { place: 3, points: 10 },
  ],
  countedResultsLimit: 2,
  resultOrder: "lower-is-better" as const,
};

function competition(
  id: string,
  scheduledAt: string,
  results: CompetitionSummary["results"],
): CompetitionSummary {
  return {
    id,
    tourId: "tour-1",
    title: `Competition ${id}`,
    description: "Test competition",
    location: "Local course",
    scheduledAt,
    organizerUserId: "organizer-1",
    organizerName: "Organizer",
    status: "finalized",
    participants: results.map((result) => ({
      competitorId: result.competitorId,
      displayName: result.displayName,
    })),
    results,
    auditLog: [],
  };
}

describe("calculateStandings", () => {
  it("counts only a competitor's best N results", () => {
    const standings = calculateStandings(scoring, [
      competition("c1", "2026-01-01T12:00:00.000Z", [
        { competitorId: "alpha", displayName: "Alpha", placement: 1, resultValue: 2, awardedPoints: 15 },
        { competitorId: "beta", displayName: "Beta", placement: 2, resultValue: 4, awardedPoints: 12 },
      ]),
      competition("c2", "2026-01-08T12:00:00.000Z", [
        { competitorId: "alpha", displayName: "Alpha", placement: 2, resultValue: 3, awardedPoints: 12 },
        { competitorId: "beta", displayName: "Beta", placement: 1, resultValue: 2, awardedPoints: 15 },
      ]),
      competition("c3", "2026-01-15T12:00:00.000Z", [
        { competitorId: "alpha", displayName: "Alpha", placement: 3, resultValue: 5, awardedPoints: 10 },
        { competitorId: "beta", displayName: "Beta", placement: 3, resultValue: 6, awardedPoints: 10 },
      ]),
    ]);

    const alpha = standings.find((entry) => entry.competitorId === "alpha");
    const beta = standings.find((entry) => entry.competitorId === "beta");

    expect(alpha?.totalPoints).toBe(27);
    expect(alpha?.countedResults).toHaveLength(2);
    expect(alpha?.droppedResults).toHaveLength(1);
    expect(beta?.totalPoints).toBe(27);
  });

  it("breaks season ties using aggregate counted results", () => {
    const standings = calculateStandings(scoring, [
      competition("c1", "2026-02-01T12:00:00.000Z", [
        { competitorId: "alpha", displayName: "Alpha", placement: 1, resultValue: 2, awardedPoints: 15 },
        { competitorId: "beta", displayName: "Beta", placement: 1, resultValue: 3, awardedPoints: 15 },
      ]),
      competition("c2", "2026-02-08T12:00:00.000Z", [
        { competitorId: "alpha", displayName: "Alpha", placement: 2, resultValue: 5, awardedPoints: 12 },
        { competitorId: "beta", displayName: "Beta", placement: 2, resultValue: 6, awardedPoints: 12 },
      ]),
    ]);

    expect(standings[0]?.competitorId).toBe("alpha");
    expect(standings[0]?.aggregateResultValue).toBe(7);
    expect(standings[1]?.aggregateResultValue).toBe(9);
  });
});

describe("permission helpers", () => {
  it("requires a verified account to create competitions", () => {
    expect(canCreateCompetition({ id: "u1", roles: ["user"], emailVerified: false })).toBe(false);
    expect(canCreateCompetition({ id: "u1", roles: ["user"], emailVerified: true })).toBe(true);
  });

  it("allows admins or organizers to manage competitions", () => {
    const competitionSummary = competition("c4", "2026-03-01T12:00:00.000Z", []);

    expect(
      canManageCompetition({ id: "organizer-1", roles: ["user"], emailVerified: true }, competitionSummary),
    ).toBe(true);
    expect(canManageCompetition({ id: "admin-1", roles: ["admin"], emailVerified: true }, competitionSummary)).toBe(
      true,
    );
    expect(canManageCompetition({ id: "other-user", roles: ["user"], emailVerified: true }, competitionSummary)).toBe(
      false,
    );
  });
});
