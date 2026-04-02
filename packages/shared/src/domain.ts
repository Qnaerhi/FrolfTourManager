import { z } from "zod";

export const roleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof roleSchema>;

export const competitionStatusSchema = z.enum(["draft", "published", "finalized"]);
export type CompetitionStatus = z.infer<typeof competitionStatusSchema>;

export const resultOrderSchema = z.enum(["lower-is-better", "higher-is-better"]);
export type ResultOrder = z.infer<typeof resultOrderSchema>;

export const objectIdSchema = z.string().trim().min(1).max(64);
export const emailSchema = z.string().trim().email().max(320);

export const pointsTableEntrySchema = z.object({
  place: z.number().int().min(1),
  points: z.number().min(0),
});
export type PointsTableEntry = z.infer<typeof pointsTableEntrySchema>;

export const scoringConfigSchema = z.object({
  pointsTable: z.array(pointsTableEntrySchema).min(1),
  countedResultsLimit: z.number().int().min(1).nullable(),
  resultOrder: resultOrderSchema,
});
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const participantInputSchema = z.object({
  competitorId: objectIdSchema.optional(),
  displayName: z.string().trim().min(1).max(80),
});
export type ParticipantInput = z.infer<typeof participantInputSchema>;

export const competitionResultInputSchema = z.object({
  competitorId: objectIdSchema.optional(),
  displayName: z.string().trim().min(1).max(80),
  placement: z.number().int().min(1),
  resultValue: z.number(),
  tieBreakRank: z.number().int().min(1).nullable().optional(),
  tieBreakNote: z.string().trim().max(200).optional(),
  awardedPoints: z.number().min(0).optional(),
});
export type CompetitionResultInput = z.infer<typeof competitionResultInputSchema>;

export const registerInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: z.string().min(8).max(128),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const verifyEmailInputSchema = z.object({
  token: z.string().trim().min(1).max(128),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;

export const announcementInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(4000),
  tourId: objectIdSchema.nullish(),
  pinned: z.boolean().default(false),
});
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export const userUpdateInputSchema = z.object({
  roles: z.array(roleSchema).min(1).optional(),
  emailVerified: z.boolean().optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateInputSchema>;

export const tourInputSchema = z.object({
  name: z.string().trim().min(3).max(120),
  seasonLabel: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(2000),
  scoring: scoringConfigSchema,
});
export type TourInput = z.infer<typeof tourInputSchema>;

export const competitionInputSchema = z.object({
  tourId: objectIdSchema,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(4000),
  location: z.string().trim().min(2).max(200),
  scheduledAt: z.string().datetime(),
  organizerName: z.string().trim().min(2).max(80),
  scoresheetUrl: z.string().trim().url().optional().or(z.literal("")),
  status: competitionStatusSchema.default("draft"),
  participants: z.array(participantInputSchema).min(1),
  results: z.array(competitionResultInputSchema).optional(),
});
export type CompetitionInput = z.infer<typeof competitionInputSchema>;

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  emailVerified: boolean;
};

export type TourSummary = {
  id: string;
  name: string;
  seasonLabel: string;
  description: string;
  scoring: ScoringConfig;
};

export type CompetitorProfile = {
  id: string;
  tourId: string;
  displayName: string;
  aliases: string[];
  linkedUserId?: string | null;
  mergedIntoCompetitorId?: string | null;
};

export type CompetitionResult = CompetitionResultInput & {
  competitorId: string;
  awardedPoints: number;
};

export type CompetitionSummary = {
  id: string;
  tourId: string;
  title: string;
  description: string;
  location: string;
  scheduledAt: string;
  organizerUserId: string;
  organizerName: string;
  scoresheetUrl?: string | null;
  status: CompetitionStatus;
  participants: Array<ParticipantInput & { competitorId: string }>;
  results: CompetitionResult[];
  auditLog: AuditEntry[];
  scoringSnapshot?: ScoringConfig;
};

export type AnnouncementSummary = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tourId?: string | null;
  publishedAt: string;
};

export type AuditEntry = {
  actorUserId: string;
  action: string;
  at: string;
  note?: string;
};

export function normalizeCompetitorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function pointsForPlace(pointsTable: PointsTableEntry[], place: number): number {
  return pointsTable.find((entry) => entry.place === place)?.points ?? 0;
}
