import mongoose, { Schema, type HydratedDocument, type Model, type Types } from "mongoose";

export type EmbeddedScoringConfig = {
  pointsTable: Array<{ place: number; points: number }>;
  countedResultsLimit: number | null;
  resultOrder: "lower-is-better" | "higher-is-better";
};

export type AuditEntryRecord = {
  actorUserId: Types.ObjectId;
  action: string;
  at: Date;
  note?: string | null;
};

export type ParticipantRecord = {
  competitorId: Types.ObjectId;
  displayName: string;
};

export type CompetitionResultRecord = {
  competitorId: Types.ObjectId;
  displayName: string;
  placement: number;
  resultValue: number;
  tieBreakRank?: number | null;
  tieBreakNote?: string | null;
  awardedPoints: number;
};

export type UserRecord = {
  name: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
  roles: Array<"user" | "admin">;
  emailVerified: boolean;
  verificationToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TourRecord = {
  name: string;
  seasonLabel: string;
  description: string;
  scoring: EmbeddedScoringConfig;
  createdAt: Date;
  updatedAt: Date;
};

export type CompetitorProfileRecord = {
  tourId: Types.ObjectId;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  linkedUserId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AnnouncementRecord = {
  title: string;
  body: string;
  tourId?: Types.ObjectId | null;
  pinned: boolean;
  publishedAt: Date;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type CompetitionRecord = {
  tourId: Types.ObjectId;
  organizerUserId: Types.ObjectId;
  organizerName: string;
  title: string;
  description: string;
  location: string;
  scheduledAt: Date;
  scoresheetUrl?: string | null;
  status: "draft" | "published" | "finalized";
  participants: ParticipantRecord[];
  results: CompetitionResultRecord[];
  scoringSnapshot?: EmbeddedScoringConfig | null;
  auditLog: AuditEntryRecord[];
  createdAt: Date;
  updatedAt: Date;
};

const scoringConfigSchema = new Schema(
  {
    pointsTable: [
      {
        place: { type: Number, required: true, min: 1 },
        points: { type: Number, required: true, min: 0 },
      },
    ],
    countedResultsLimit: { type: Number, min: 1, default: null },
    resultOrder: {
      type: String,
      enum: ["lower-is-better", "higher-is-better"],
      required: true,
    },
  },
  { _id: false },
);

const auditEntrySchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    at: { type: Date, required: true },
    note: { type: String, default: null },
  },
  { _id: false },
);

const participantSchema = new Schema(
  {
    competitorId: { type: Schema.Types.ObjectId, ref: "CompetitorProfile", required: true },
    displayName: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const resultSchema = new Schema(
  {
    competitorId: { type: Schema.Types.ObjectId, ref: "CompetitorProfile", required: true },
    displayName: { type: String, required: true, trim: true },
    placement: { type: Number, required: true, min: 1 },
    resultValue: { type: Number, required: true },
    tieBreakRank: { type: Number, min: 1, default: null },
    tieBreakNote: { type: String, default: null },
    awardedPoints: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const userSchema = new Schema<UserRecord>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    normalizedEmail: { type: String, required: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    roles: {
      type: [String],
      enum: ["user", "admin"],
      default: ["user"],
    },
    emailVerified: { type: Boolean, default: false },
    verificationToken: { type: String, default: null },
  },
  { timestamps: true },
);

const tourSchema = new Schema<TourRecord>(
  {
    name: { type: String, required: true, trim: true },
    seasonLabel: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    scoring: { type: scoringConfigSchema, required: true },
  },
  { timestamps: true },
);

const competitorProfileSchema = new Schema<CompetitorProfileRecord>(
  {
    tourId: { type: Schema.Types.ObjectId, ref: "Tour", required: true, index: true },
    displayName: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
    linkedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

const announcementSchema = new Schema<AnnouncementRecord>(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    tourId: { type: Schema.Types.ObjectId, ref: "Tour", default: null, index: true },
    pinned: { type: Boolean, default: false },
    publishedAt: { type: Date, required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

const competitionSchema = new Schema<CompetitionRecord>(
  {
    tourId: { type: Schema.Types.ObjectId, ref: "Tour", required: true, index: true },
    organizerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizerName: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    scheduledAt: { type: Date, required: true, index: true },
    scoresheetUrl: { type: String, default: null },
    status: {
      type: String,
      enum: ["draft", "published", "finalized"],
      default: "draft",
      index: true,
    },
    participants: { type: [participantSchema], default: [] },
    results: { type: [resultSchema], default: [] },
    scoringSnapshot: { type: scoringConfigSchema, default: null },
    auditLog: { type: [auditEntrySchema], default: [] },
  },
  { timestamps: true },
);

competitorProfileSchema.index({ tourId: 1, normalizedName: 1 }, { unique: true });

export type UserDoc = HydratedDocument<UserRecord>;
export type TourDoc = HydratedDocument<TourRecord>;
export type CompetitorProfileDoc = HydratedDocument<CompetitorProfileRecord>;
export type AnnouncementDoc = HydratedDocument<AnnouncementRecord>;
export type CompetitionDoc = HydratedDocument<CompetitionRecord>;

export const UserModel: Model<UserRecord> =
  (mongoose.models.User as Model<UserRecord> | undefined) || mongoose.model<UserRecord>("User", userSchema);
export const TourModel: Model<TourRecord> =
  (mongoose.models.Tour as Model<TourRecord> | undefined) || mongoose.model<TourRecord>("Tour", tourSchema);
export const CompetitorProfileModel: Model<CompetitorProfileRecord> =
  (mongoose.models.CompetitorProfile as Model<CompetitorProfileRecord> | undefined) ||
  mongoose.model<CompetitorProfileRecord>("CompetitorProfile", competitorProfileSchema);
export const AnnouncementModel: Model<AnnouncementRecord> =
  (mongoose.models.Announcement as Model<AnnouncementRecord> | undefined) ||
  mongoose.model<AnnouncementRecord>("Announcement", announcementSchema);
export const CompetitionModel: Model<CompetitionRecord> =
  (mongoose.models.Competition as Model<CompetitionRecord> | undefined) ||
  mongoose.model<CompetitionRecord>("Competition", competitionSchema);
