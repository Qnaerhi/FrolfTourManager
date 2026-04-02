import type { CompetitionResult, CompetitionSummary, ResultOrder, ScoringConfig } from "./domain.js";

type ScoredResult = CompetitionResult & {
  competitionId: string;
  competitionTitle: string;
  scheduledAt: string;
};

export type LeaderboardEntry = {
  competitorId: string;
  displayName: string;
  totalPoints: number;
  countedResults: ScoredResult[];
  droppedResults: ScoredResult[];
  aggregateResultValue: number;
  bestSingleResultValue: number;
  rank: number;
};

export function compareResultValues(a: number, b: number, order: ResultOrder): number {
  return order === "lower-is-better" ? a - b : b - a;
}

function compareResultsForCounting(a: ScoredResult, b: ScoredResult, order: ResultOrder): number {
  if (a.awardedPoints !== b.awardedPoints) {
    return b.awardedPoints - a.awardedPoints;
  }

  const resultComparison = compareResultValues(a.resultValue, b.resultValue, order);

  if (resultComparison !== 0) {
    return resultComparison;
  }

  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
}

export function calculateStandings(
  scoring: ScoringConfig,
  competitions: CompetitionSummary[],
): LeaderboardEntry[] {
  const finalizedCompetitions = competitions.filter((competition) => competition.status === "finalized");
  const resultMap = new Map<string, { displayName: string; results: ScoredResult[] }>();

  for (const competition of finalizedCompetitions) {
    for (const result of competition.results) {
      const current = resultMap.get(result.competitorId) ?? {
        displayName: result.displayName,
        results: [],
      };

      current.displayName = result.displayName;
      current.results.push({
        ...result,
        competitionId: competition.id,
        competitionTitle: competition.title,
        scheduledAt: competition.scheduledAt,
      });
      resultMap.set(result.competitorId, current);
    }
  }

  const leaderboard = Array.from(resultMap.entries()).map(([competitorId, summary]) => {
    const sorted = [...summary.results].sort((a, b) => compareResultsForCounting(a, b, scoring.resultOrder));
    const countedLimit = scoring.countedResultsLimit ?? sorted.length;
    const countedResults = sorted.slice(0, countedLimit);
    const droppedResults = sorted.slice(countedLimit);
    const totalPoints = countedResults.reduce((sum, result) => sum + result.awardedPoints, 0);
    const aggregateResultValue = countedResults.reduce((sum, result) => sum + result.resultValue, 0);
    const bestSingleResultValue = countedResults[0]?.resultValue ?? Number.POSITIVE_INFINITY;

    return {
      competitorId,
      displayName: summary.displayName,
      totalPoints,
      countedResults,
      droppedResults,
      aggregateResultValue,
      bestSingleResultValue,
      rank: 0,
    };
  });

  leaderboard.sort((a, b) => {
    if (a.totalPoints !== b.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }

    const aggregateComparison = compareResultValues(
      a.aggregateResultValue,
      b.aggregateResultValue,
      scoring.resultOrder,
    );

    if (aggregateComparison !== 0) {
      return aggregateComparison;
    }

    const singleComparison = compareResultValues(
      a.bestSingleResultValue,
      b.bestSingleResultValue,
      scoring.resultOrder,
    );

    if (singleComparison !== 0) {
      return singleComparison;
    }

    return a.displayName.localeCompare(b.displayName);
  });

  let previousKey = "";

  for (let index = 0; index < leaderboard.length; index += 1) {
    const entry = leaderboard[index];

    if (!entry) {
      continue;
    }

    const tieKey = `${entry.totalPoints}|${entry.aggregateResultValue}|${entry.bestSingleResultValue}`;

    if (tieKey !== previousKey) {
      entry.rank = index + 1;
      previousKey = tieKey;
      continue;
    }

    entry.rank = leaderboard[index - 1]?.rank ?? index + 1;
  }

  return leaderboard;
}
