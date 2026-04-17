import crypto from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  announcementInputSchema,
  calculateStandings,
  canCreateCompetition,
  canManageAnnouncements,
  canManageCompetition,
  canManageTours,
  canManageUsers,
  competitionInputSchema,
  loginInputSchema,
  normalizeCompetitorName,
  pointsForPlace,
  registerInputSchema,
  scoringConfigSchema,
  tourInputSchema,
  userUpdateInputSchema,
  verifyEmailInputSchema,
  type CompetitionInput,
  type CompetitionSummary,
  type PublicUser,
  type ScoringConfig,
} from "@frolf-tour/shared";
import { config, getCorsAllowedOrigins } from "./config.js";
import { getFirebaseAuth } from "./db.js";
import {
  AnnouncementModel,
  CompetitionModel,
  CompetitorProfileModel,
  RateLimitBucketModel,
  TourModel,
  UserModel,
  type AnnouncementDoc,
  type CompetitionDoc,
  type CompetitorProfileDoc,
  type EmbeddedScoringConfig,
  type ObjectId,
  type TourDoc,
  type UserDoc,
} from "./models.js";

type AppRequest = Request & { authUser?: UserDoc | null };
type RateLimitState = { count: number; resetAt: number };
const isTestMode = process.env.NODE_ENV === "test";

class HttpError extends Error {
  status: number;

  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const mergeCompetitorsInputSchema = z.object({
  sourceCompetitorId: z.string().trim().min(1),
  targetCompetitorId: z.string().trim().min(1),
});

function createHttpError(status: number, message: string, details?: unknown) {
  return new HttpError(status, message, details);
}

function normalizeScoring(scoring: ScoringConfig): ScoringConfig {
  const parsed = scoringConfigSchema.parse(scoring);
  const seenPlaces = new Set<number>();

  for (const entry of parsed.pointsTable) {
    if (seenPlaces.has(entry.place)) {
      throw createHttpError(400, `Duplicate points entry for place ${entry.place}.`);
    }
    seenPlaces.add(entry.place);
  }

  return {
    ...parsed,
    resultOrder: "lower-is-better",
    pointsTable: [...parsed.pointsTable].sort((a, b) => a.place - b.place),
  };
}

function toObjectId(value: string, label: string): ObjectId {
  if (!/^[a-f0-9]{24}$/i.test(value)) {
    throw createHttpError(400, `${label} is invalid.`);
  }

  return value.toLowerCase();
}

function serializeUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    roles: [...user.roles],
    emailVerified: user.emailVerified,
  };
}

function serializeScoring(scoring: EmbeddedScoringConfig | null | undefined): ScoringConfig {
  if (!scoring) {
    throw createHttpError(500, "Scoring configuration is missing.");
  }

  return {
    pointsTable: scoring.pointsTable.map((entry) => ({
      place: entry.place,
      points: entry.points,
    })),
    countedResultsLimit: scoring.countedResultsLimit,
    resultOrder: "lower-is-better",
  };
}

function serializeCompetition(competition: CompetitionDoc): CompetitionSummary {
  return {
    id: competition._id.toString(),
    tourId: competition.tourId.toString(),
    title: competition.title,
    description: competition.description,
    location: competition.location,
    scheduledAt: competition.scheduledAt.toISOString(),
    organizerUserId: competition.organizerUserId.toString(),
    organizerName: competition.organizerName,
    scoresheetUrl: competition.scoresheetUrl ?? null,
    status: competition.status,
    participants: competition.participants.map((participant) => ({
      competitorId: participant.competitorId.toString(),
      displayName: participant.displayName,
    })),
    results: competition.results.map((result) => {
      const serialized = {
        competitorId: result.competitorId.toString(),
        displayName: result.displayName,
        placement: result.placement,
        resultValue: result.resultValue,
        tieBreakRank: result.tieBreakRank ?? null,
        awardedPoints: result.awardedPoints,
      };

      return result.tieBreakNote
        ? {
            ...serialized,
            tieBreakNote: result.tieBreakNote,
          }
        : serialized;
    }),
    auditLog: competition.auditLog.map((entry) => {
      const serialized = {
        actorUserId: entry.actorUserId.toString(),
        action: entry.action,
        at: entry.at.toISOString(),
      };

      return entry.note
        ? {
            ...serialized,
            note: entry.note,
          }
        : serialized;
    }),
    ...(competition.scoringSnapshot ? { scoringSnapshot: serializeScoring(competition.scoringSnapshot) } : {}),
  };
}

function serializeTour(tour: TourDoc) {
  return {
    id: tour._id.toString(),
    name: tour.name,
    seasonLabel: tour.seasonLabel,
    description: tour.description,
    rulesText: tour.rulesText ?? "",
    isCurrent: Boolean(tour.isCurrent),
    scoring: serializeScoring(tour.scoring),
    createdAt: tour.createdAt.toISOString(),
    updatedAt: tour.updatedAt.toISOString(),
  };
}

function serializeAnnouncement(announcement: AnnouncementDoc) {
  return {
    id: announcement._id.toString(),
    title: announcement.title,
    body: announcement.body,
    pinned: announcement.pinned,
    tourId: announcement.tourId ? announcement.tourId.toString() : null,
    publishedAt: announcement.publishedAt.toISOString(),
  };
}

async function syncUserFromFirebaseUid(uid: string): Promise<UserDoc> {
  const auth = getFirebaseAuth();
  const firebaseUser = await auth.getUser(uid);
  const normalizedEmail = (firebaseUser.email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw createHttpError(401, "Authentication token is invalid.");
  }

  let user = await UserModel.findOne({ firebaseUid: uid });
  if (!user) {
    user = await UserModel.findOne({ normalizedEmail });
  }

  if (!user) {
    user = await UserModel.create({
      name: (firebaseUser.displayName ?? firebaseUser.email ?? "User").trim(),
      email: firebaseUser.email ?? normalizedEmail,
      normalizedEmail,
      passwordHash: "",
      roles: ["user"],
      emailVerified: Boolean(firebaseUser.emailVerified),
      verificationToken: null,
      firebaseUid: uid,
    });
  } else {
    let changed = false;
    if (user.firebaseUid !== uid) {
      user.firebaseUid = uid;
      changed = true;
    }
    if (user.email !== (firebaseUser.email ?? user.email)) {
      user.email = firebaseUser.email ?? user.email;
      user.normalizedEmail = normalizedEmail;
      changed = true;
    }
    const displayName = (firebaseUser.displayName ?? "").trim();
    if (displayName && user.name !== displayName) {
      user.name = displayName;
      changed = true;
    }
    if (user.emailVerified !== Boolean(firebaseUser.emailVerified)) {
      user.emailVerified = Boolean(firebaseUser.emailVerified);
      if (user.emailVerified) {
        user.verificationToken = null;
      }
      changed = true;
    }
    if (changed) {
      await user.save();
    }
  }

  await maybePromoteBootstrapAdmin(user);
  return user;
}

async function signInWithEmailPassword(email: string, password: string): Promise<string | null> {
  if (!config.firebaseWebApiKey) {
    return null;
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.firebaseWebApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { idToken?: string };
  return payload.idToken ?? null;
}

async function getAuthUser(request: AppRequest, required: true): Promise<UserDoc>;
async function getAuthUser(request: AppRequest, required?: false): Promise<UserDoc | null>;
async function getAuthUser(request: AppRequest, required = false): Promise<UserDoc | null> {
  if (request.authUser !== undefined) {
    if (required && !request.authUser) {
      throw createHttpError(401, "Authentication is required.");
    }
    return request.authUser;
  }

  const header = request.headers.authorization;

  if (!header) {
    request.authUser = null;
    if (required) {
      throw createHttpError(401, "Authentication is required.");
    }

    return null;
  }

  const token = header.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw createHttpError(401, "Authentication token is missing.");
  }

  if (isTestMode && token.startsWith("test-")) {
    const user = await UserModel.findById(token.slice("test-".length));
    if (!user) {
      throw createHttpError(401, "Authentication token is invalid.");
    }
    request.authUser = user;
    return user;
  }

  try {
    const payload = await getFirebaseAuth().verifyIdToken(token);
    if (!payload.uid) {
      throw createHttpError(401, "Authentication token is invalid.");
    }
    const user = await syncUserFromFirebaseUid(payload.uid);

    request.authUser = user;
    return user;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw createHttpError(401, "Authentication token is invalid.");
  }
}

function ensurePermission(condition: boolean, message: string) {
  if (!condition) {
    throw createHttpError(403, message);
  }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw createHttpError(400, "Request validation failed.", result.error.flatten());
  }

  return result.data;
}

type RateLimitOptions = {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
  message: string;
  methods?: string[];
};

const rateLimitStore = new Map<string, RateLimitState>();

function escapeRegexPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRateLimitIdentifier(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

async function consumeRateLimit(
  keyPrefix: string,
  identifier: string,
  windowMs: number,
): Promise<{ count: number; resetAt: number }> {
  const now = Date.now();

  if (config.rateLimitStorage === "memory") {
    const key = `${keyPrefix}:${identifier}`;
    const existing = rateLimitStore.get(key);

    if (!existing || now >= existing.resetAt) {
      const next = { count: 1, resetAt: now + windowMs };
      rateLimitStore.set(key, next);
      return next;
    }

    existing.count += 1;
    return existing;
  }

  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const bucketKey = `${keyPrefix}:${identifier}:${windowStart}`;
  const bucket = await RateLimitBucketModel.findOneAndUpdate(
    { key: bucketKey },
    {
      $setOnInsert: {
        expiresAt: new Date(resetAt + windowMs),
      },
      $inc: { count: 1 },
    },
    { upsert: true, new: true },
  );

  if (!bucket) {
    throw createHttpError(500, "Rate limiter storage failure.");
  }

  return {
    count: bucket.count,
    resetAt,
  };
}

function createRateLimiter(options: RateLimitOptions) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    if (!config.enableRateLimiting) {
      next();
      return;
    }

    if (options.methods && !options.methods.includes(request.method.toUpperCase())) {
      next();
      return;
    }

    const identifier = getRateLimitIdentifier(request);
    const state = await consumeRateLimit(options.keyPrefix, identifier, options.windowMs);

    if (state.count > options.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
      throw createHttpError(429, options.message, { retryAfterSeconds });
    }
    next();
  };
}

type CompetitorReference = {
  competitorId?: string | undefined;
  displayName: string;
};

async function resolveCompetitorReference(
  tourId: ObjectId,
  entry: CompetitorReference,
  cache: Map<string, CompetitorProfileDoc>,
): Promise<{ competitorId: ObjectId; displayName: string }> {
  const displayName = entry.displayName.trim();
  const normalizedName = normalizeCompetitorName(displayName);
  const cacheKey = entry.competitorId ? `id:${entry.competitorId}` : `name:${normalizedName}`;

  let competitor: CompetitorProfileDoc | null = cache.get(cacheKey) ?? null;

  if (!competitor && entry.competitorId) {
    competitor = await CompetitorProfileModel.findOne({
      _id: toObjectId(entry.competitorId, "competitorId"),
      tourId,
    });
  }

  if (!competitor && normalizedName) {
    competitor = await CompetitorProfileModel.findOne({ tourId, normalizedName });
  }

  if (!competitor) {
    competitor = await CompetitorProfileModel.create({
      tourId,
      displayName,
      normalizedName,
      aliases: [],
    });
  } else if (displayName !== competitor.displayName && !competitor.aliases.includes(displayName)) {
    competitor.aliases = [...competitor.aliases, displayName];
    await competitor.save();
  }

  cache.set(cacheKey, competitor);
  cache.set(`name:${competitor.normalizedName}`, competitor);
  cache.set(`id:${competitor._id.toString()}`, competitor);

  return {
    competitorId: competitor._id,
    displayName: competitor.displayName,
  };
}

function setEquals(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

async function buildCompetitionData(
  payload: CompetitionInput,
  organizerUserId: ObjectId,
): Promise<Pick<
  CompetitionDoc,
  | "tourId"
  | "organizerName"
  | "organizerUserId"
  | "title"
  | "description"
  | "location"
  | "scheduledAt"
  | "scoresheetUrl"
  | "status"
  | "participants"
  | "results"
  | "scoringSnapshot"
>> {
  const tourId = toObjectId(payload.tourId, "tourId");
  const tour = await TourModel.findById(tourId);

  if (!tour) {
    throw createHttpError(404, "Tour was not found.");
  }

  const resolvedScoring = normalizeScoring(serializeScoring(tour.scoring));
  const participantCache = new Map<string, CompetitorProfileDoc>();
  const participants = [];

  for (const participant of payload.participants) {
    participants.push(await resolveCompetitorReference(tourId, participant, participantCache));
  }

  const participantIds = new Set(participants.map((participant) => participant.competitorId.toString()));

  if (participantIds.size !== participants.length) {
    throw createHttpError(400, "Participants must be unique within a competition.");
  }

  if (payload.status !== "draft" && participants.length < 3) {
    throw createHttpError(400, "A published competition must have at least three participants.");
  }

  const results = [];

  if (payload.results?.length) {
    for (const result of payload.results) {
      const resolvedReference = await resolveCompetitorReference(tourId, result, participantCache);
      results.push({
        ...result,
        competitorId: resolvedReference.competitorId,
        displayName: resolvedReference.displayName,
        tieBreakRank: result.tieBreakRank ?? null,
        tieBreakNote: result.tieBreakNote?.trim() || null,
        awardedPoints: pointsForPlace(resolvedScoring.pointsTable, result.placement),
      });
    }

    const resultIds = new Set(results.map((result) => result.competitorId.toString()));

    if (resultIds.size !== results.length) {
      throw createHttpError(400, "Results must include each participant exactly once.");
    }

    if (!setEquals(participantIds, resultIds)) {
      throw createHttpError(400, "Results must cover the same competitors as the participant list.");
    }
  }

  if (payload.status === "finalized" && results.length !== participants.length) {
    throw createHttpError(400, "A finalized competition must have one result for every participant.");
  }

  return {
    tourId,
    organizerUserId,
    organizerName: payload.organizerName.trim(),
    title: payload.title.trim(),
    description: payload.description.trim(),
    location: payload.location.trim(),
    scheduledAt: new Date(payload.scheduledAt),
    scoresheetUrl: payload.scoresheetUrl?.trim() || null,
    status: payload.status,
    participants,
    results: results.sort((a, b) => {
      if (a.placement !== b.placement) {
        return a.placement - b.placement;
      }

      return (a.tieBreakRank ?? Number.MAX_SAFE_INTEGER) - (b.tieBreakRank ?? Number.MAX_SAFE_INTEGER);
    }),
    scoringSnapshot: payload.status === "finalized" ? resolvedScoring : null,
  };
}

function ensureCompetitionAllowsSelfSignup(competition: CompetitionDoc) {
  if (competition.status !== "published") {
    throw createHttpError(400, "Signup is only available for published competitions.");
  }

  if (competition.scheduledAt.getTime() <= Date.now()) {
    throw createHttpError(400, "Signup is closed because the competition has started.");
  }
}

async function resolveSelfSignupCompetitor(
  tourId: ObjectId,
  user: UserDoc,
): Promise<{ competitorId: ObjectId; displayName: string }> {
  const normalizedName = normalizeCompetitorName(user.name);
  let competitor = await CompetitorProfileModel.findOne({ tourId, linkedUserId: user._id });

  if (!competitor) {
    competitor = await CompetitorProfileModel.findOne({ tourId, normalizedName });
  }

  if (!competitor) {
    competitor = await CompetitorProfileModel.create({
      tourId,
      displayName: user.name,
      normalizedName,
      aliases: [],
      linkedUserId: user._id,
    });
  } else {
    const linkedUserId = competitor.linkedUserId?.toString();
    if (linkedUserId && linkedUserId !== user._id.toString()) {
      throw createHttpError(409, "Unable to sign up with this profile.");
    }

    let changed = false;
    if (!competitor.linkedUserId) {
      competitor.linkedUserId = user._id;
      changed = true;
    }

    if (user.name !== competitor.displayName && !competitor.aliases.includes(user.name)) {
      competitor.aliases = [...competitor.aliases, user.name];
      changed = true;
    }

    if (changed) {
      await competitor.save();
    }
  }

  return {
    competitorId: competitor._id,
    displayName: competitor.displayName,
  };
}

function removeParticipantAndResultsByCompetitorId(
  competition: CompetitionDoc,
  competitorId: ObjectId,
): { participantRemoved: boolean; resultsRemoved: number } {
  const competitorIdText = competitorId.toString();
  const previousParticipants = competition.participants.length;
  const previousResults = competition.results.length;

  competition.participants = competition.participants.filter(
    (participant) => participant.competitorId.toString() !== competitorIdText,
  );
  competition.results = competition.results.filter((result) => result.competitorId.toString() !== competitorIdText);

  return {
    participantRemoved: competition.participants.length !== previousParticipants,
    resultsRemoved: previousResults - competition.results.length,
  };
}

async function maybePromoteBootstrapAdmin(user: UserDoc) {
  const shouldBootstrap = config.bootstrapAdminEmails.includes(user.normalizedEmail.toLowerCase());

  if (!shouldBootstrap || user.roles.includes("admin")) {
    return;
  }

  user.roles = Array.from(new Set([...user.roles, "admin"]));
  await user.save();
}

async function setCurrentTour(nextCurrentTourId: ObjectId) {
  await TourModel.updateMany({ _id: { $ne: nextCurrentTourId }, isCurrent: true }, { $set: { isCurrent: false } });
}

export function createApp() {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  const authRateLimiter = createRateLimiter({
    keyPrefix: "auth",
    maxRequests: config.rateLimitAuthMax,
    windowMs: config.rateLimitWindowMs,
    message: "Too many authentication attempts. Please try again shortly.",
    methods: ["POST"],
  });
  const publicReadRateLimiter = createRateLimiter({
    keyPrefix: "public-read",
    maxRequests: config.rateLimitPublicMax,
    windowMs: config.rateLimitWindowMs,
    message: "Too many requests from this IP. Please try again shortly.",
    methods: ["GET"],
  });

  app.use(
    cors({
      origin: getCorsAllowedOrigins(),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/auth/login", authRateLimiter);
  app.use("/api/auth/register", authRateLimiter);
  app.use("/api/home", publicReadRateLimiter);
  app.use("/api/tours", publicReadRateLimiter);
  app.use("/api/competitions", publicReadRateLimiter);

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/auth/register", async (request, response) => {
    const payload = parseBody(registerInputSchema, request.body);
    const normalizedEmail = payload.email.toLowerCase();
    const existingUser = await UserModel.findOne({ normalizedEmail });

    if (existingUser) {
      throw createHttpError(409, "An account with that email already exists.");
    }

    if (isTestMode) {
      const verificationToken = crypto.randomUUID();
      const user = await UserModel.create({
        name: payload.name.trim(),
        email: payload.email.trim(),
        normalizedEmail,
        passwordHash: payload.password,
        roles: ["user"],
        emailVerified: false,
        verificationToken,
        firebaseUid: null,
      });

      response.status(201).json({
        token: `test-${user._id}`,
        user: serializeUser(user),
        verificationToken,
      });
      return;
    }

    let firebaseUid: string;
    try {
      const firebaseUser = await getFirebaseAuth().createUser({
        email: payload.email.trim(),
        password: payload.password,
        displayName: payload.name.trim(),
        emailVerified: false,
      });
      firebaseUid = firebaseUser.uid;
    } catch {
      throw createHttpError(409, "An account with that email already exists.");
    }

    const user = await UserModel.create({
      name: payload.name.trim(),
      email: payload.email.trim(),
      normalizedEmail,
      passwordHash: "",
      roles: ["user"],
      emailVerified: false,
      verificationToken: null,
      firebaseUid,
    });

    const idToken = await signInWithEmailPassword(payload.email.trim(), payload.password);
    const token = idToken ?? (await getFirebaseAuth().createCustomToken(firebaseUid));

    response.status(201).json({
      token,
      user: serializeUser(user),
    });
  });

  app.post("/api/auth/verify-email", async (request, response) => {
    const payload = parseBody(verifyEmailInputSchema, request.body);

    if (isTestMode) {
      const user = await UserModel.findOne({ verificationToken: payload.token });
      if (!user) {
        throw createHttpError(404, "Verification token was not found.");
      }
      user.emailVerified = true;
      user.verificationToken = null;
      await maybePromoteBootstrapAdmin(user);
      await user.save();
      response.json({
        token: `test-${user._id}`,
        user: serializeUser(user),
      });
      return;
    }

    const decoded = await getFirebaseAuth().verifyIdToken(payload.token);
    const firebaseUser = await getFirebaseAuth().getUser(decoded.uid);
    if (!firebaseUser.emailVerified) {
      throw createHttpError(400, "Email is not verified in Firebase Auth.");
    }
    const user = await syncUserFromFirebaseUid(decoded.uid);

    response.json({
      token: payload.token,
      user: serializeUser(user),
    });
  });

  app.post("/api/auth/login", async (request, response) => {
    const payload = parseBody(loginInputSchema, request.body);

    if (isTestMode) {
      const user = await UserModel.findOne({ normalizedEmail: payload.email.toLowerCase() });
      if (!user || user.passwordHash !== payload.password) {
        throw createHttpError(401, "Email or password is incorrect.");
      }
      response.json({
        token: `test-${user._id}`,
        user: serializeUser(user),
        verificationToken: !user.emailVerified ? user.verificationToken : undefined,
      });
      return;
    }

    const idToken = await signInWithEmailPassword(payload.email.trim(), payload.password);
    if (!idToken) {
      throw createHttpError(401, "Email or password is incorrect.");
    }
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);
    const user = await syncUserFromFirebaseUid(decoded.uid);

    response.json({
      token: idToken,
      user: serializeUser(user),
    });
  });

  app.get("/api/auth/me", async (request, response) => {
    const user = await getAuthUser(request, true);
    response.json({ user: serializeUser(user) });
  });

  app.get("/api/home", async (_request, response) => {
    const [announcements, tours, competitions] = await Promise.all([
      AnnouncementModel.find().sort({ pinned: -1, publishedAt: -1 }).limit(8),
      TourModel.find().sort({ createdAt: -1 }),
      CompetitionModel.find({ status: { $in: ["published", "finalized"] } }).sort({ scheduledAt: -1 }).limit(8),
    ]);

    response.json({
      announcements: announcements.map((announcement) => serializeAnnouncement(announcement)),
      tours: tours.map((tour) => serializeTour(tour)),
      competitions: competitions.map((competition) => serializeCompetition(competition)),
    });
  });

  app.get("/api/announcements", async (request, response) => {
    const filter = request.query.tourId ? { tourId: toObjectId(String(request.query.tourId), "tourId") } : {};
    const announcements = await AnnouncementModel.find(filter).sort({ pinned: -1, publishedAt: -1 });

    response.json({
      announcements: announcements.map((announcement) => serializeAnnouncement(announcement)),
    });
  });

  app.post("/api/announcements", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageAnnouncements(serializeUser(user)), "Only admins can manage announcements.");
    const payload = parseBody(announcementInputSchema, request.body);

    const announcement = await AnnouncementModel.create({
      title: payload.title.trim(),
      body: payload.body.trim(),
      pinned: payload.pinned,
      tourId: payload.tourId ? toObjectId(payload.tourId, "tourId") : null,
      publishedAt: new Date(),
      createdByUserId: user._id,
    });

    response.status(201).json({ announcement: serializeAnnouncement(announcement) });
  });

  app.patch("/api/announcements/:announcementId", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageAnnouncements(serializeUser(user)), "Only admins can manage announcements.");
    const payload = parseBody(announcementInputSchema, request.body);
    const announcement = await AnnouncementModel.findById(toObjectId(request.params.announcementId, "announcementId"));

    if (!announcement) {
      throw createHttpError(404, "Announcement was not found.");
    }

    announcement.title = payload.title.trim();
    announcement.body = payload.body.trim();
    announcement.pinned = payload.pinned;
    announcement.tourId = payload.tourId ? toObjectId(payload.tourId, "tourId") : null;
    await announcement.save();

    response.json({ announcement: serializeAnnouncement(announcement) });
  });

  app.get("/api/tours", async (_request, response) => {
    const tours = await TourModel.find().sort({ createdAt: -1 });
    response.json({ tours: tours.map((tour) => serializeTour(tour)) });
  });

  app.get("/api/tours/current", async (_request, response) => {
    const tour =
      (await TourModel.findOne({ isCurrent: true }).sort({ updatedAt: -1 })) ||
      (await TourModel.findOne().sort({ createdAt: -1 }));

    if (!tour) {
      throw createHttpError(404, "Tour was not found.");
    }

    response.json({ tour: serializeTour(tour) });
  });

  app.post("/api/tours", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageTours(serializeUser(user)), "Only admins can manage tours.");
    const payload = parseBody(tourInputSchema, request.body);

    const tour = await TourModel.create({
      name: payload.name.trim(),
      seasonLabel: payload.seasonLabel.trim(),
      description: payload.description.trim(),
      rulesText: payload.rulesText.trim(),
      isCurrent: payload.isCurrent,
      scoring: normalizeScoring(payload.scoring),
    });

    if (payload.isCurrent) {
      await setCurrentTour(tour._id);
    }

    response.status(201).json({ tour: serializeTour(tour) });
  });

  app.patch("/api/tours/:tourId", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageTours(serializeUser(user)), "Only admins can manage tours.");
    const payload = parseBody(tourInputSchema, request.body);
    const tour = await TourModel.findById(toObjectId(request.params.tourId, "tourId"));

    if (!tour) {
      throw createHttpError(404, "Tour was not found.");
    }

    tour.name = payload.name.trim();
    tour.seasonLabel = payload.seasonLabel.trim();
    tour.description = payload.description.trim();
    tour.rulesText = payload.rulesText.trim();
    tour.isCurrent = payload.isCurrent;
    tour.scoring = normalizeScoring(payload.scoring);

    if (payload.isCurrent) {
      await setCurrentTour(tour._id);
    }

    await tour.save();

    response.json({ tour: serializeTour(tour) });
  });

  app.get("/api/tours/:tourId", async (request, response) => {
    const tourId = toObjectId(request.params.tourId, "tourId");
    const tour = await TourModel.findById(tourId);

    if (!tour) {
      throw createHttpError(404, "Tour was not found.");
    }

    const [competitions, announcements, competitorCount] = await Promise.all([
      CompetitionModel.find({ tourId, status: { $in: ["published", "finalized"] } }).sort({ scheduledAt: -1 }),
      AnnouncementModel.find({
        $or: [{ tourId: null }, { tourId }],
      }).sort({ pinned: -1, publishedAt: -1 }),
      CompetitorProfileModel.countDocuments({ tourId }),
    ]);

    const serializedCompetitions = competitions.map((competition) => serializeCompetition(competition));
    const standings = calculateStandings(serializeScoring(tour.scoring), serializedCompetitions);

    response.json({
      tour: serializeTour(tour),
      competitorCount,
      competitions: serializedCompetitions,
      announcements: announcements.map((announcement) => serializeAnnouncement(announcement)),
      standings,
    });
  });

  app.get("/api/tours/:tourId/competitors", async (request, response) => {
    const tourId = toObjectId(request.params.tourId, "tourId");
    const query = String(request.query.query ?? "").trim().slice(0, 64);
    const escapedQuery = escapeRegexPattern(normalizeCompetitorName(query));
    const filter = query
      ? {
          tourId,
          normalizedName: {
            $regex: escapedQuery,
            $options: "i",
          },
        }
      : { tourId };
    const competitors = await CompetitorProfileModel.find(filter).sort({ displayName: 1 }).limit(15);

    response.json({
      competitors: competitors.map((competitor) => ({
        id: competitor._id.toString(),
        tourId: competitor.tourId.toString(),
        displayName: competitor.displayName,
        aliases: [...competitor.aliases],
      })),
    });
  });

  app.post("/api/tours/:tourId/competitors/merge", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageTours(serializeUser(user)), "Only admins can merge competitors.");
    const tourId = toObjectId(request.params.tourId, "tourId");
    const payload = parseBody(mergeCompetitorsInputSchema, request.body);

    if (payload.sourceCompetitorId === payload.targetCompetitorId) {
      throw createHttpError(400, "Source and target competitors must be different.");
    }

    const [sourceCompetitor, targetCompetitor] = await Promise.all([
      CompetitorProfileModel.findOne({
        _id: toObjectId(payload.sourceCompetitorId, "sourceCompetitorId"),
        tourId,
      }),
      CompetitorProfileModel.findOne({
        _id: toObjectId(payload.targetCompetitorId, "targetCompetitorId"),
        tourId,
      }),
    ]);

    if (!sourceCompetitor || !targetCompetitor) {
      throw createHttpError(404, "Both competitors must exist in the same tour.");
    }

    const conflictingCompetition = await CompetitionModel.findOne({
      tourId,
      "participants.competitorId": { $all: [sourceCompetitor._id, targetCompetitor._id] },
    });

    if (conflictingCompetition) {
      throw createHttpError(
        409,
        "Competitors cannot be merged because they already appear together in the same competition.",
      );
    }

    const competitions = await CompetitionModel.find({
      tourId,
      $or: [
        { "participants.competitorId": sourceCompetitor._id },
        { "results.competitorId": sourceCompetitor._id },
      ],
    });

    for (const competition of competitions) {
      let changed = false;

      for (const participant of competition.participants) {
        if (participant.competitorId.toString() === sourceCompetitor._id.toString()) {
          participant.competitorId = targetCompetitor._id;
          participant.displayName = targetCompetitor.displayName;
          changed = true;
        }
      }

      for (const result of competition.results) {
        if (result.competitorId.toString() === sourceCompetitor._id.toString()) {
          result.competitorId = targetCompetitor._id;
          result.displayName = targetCompetitor.displayName;
          changed = true;
        }
      }

      if (changed) {
        competition.auditLog.push({
          actorUserId: user._id,
          action: "competitor-merged",
          at: new Date(),
          note: `${sourceCompetitor.displayName} merged into ${targetCompetitor.displayName}`,
        });
        await competition.save();
      }
    }

    await sourceCompetitor.deleteOne();

    response.json({
      competitor: {
        id: targetCompetitor._id.toString(),
        displayName: targetCompetitor.displayName,
      },
    });
  });

  app.get("/api/competitions", async (request, response) => {
    const filter: Record<string, unknown> = {
      status: { $in: ["published", "finalized"] },
    };

    if (request.query.tourId) {
      filter.tourId = toObjectId(String(request.query.tourId), "tourId");
    }

    const competitions = await CompetitionModel.find(filter).sort({ scheduledAt: -1 });
    response.json({ competitions: competitions.map((competition) => serializeCompetition(competition)) });
  });

  app.get("/api/competitions/:competitionId", async (request, response) => {
    const competition = await CompetitionModel.findById(toObjectId(request.params.competitionId, "competitionId"));

    if (!competition) {
      throw createHttpError(404, "Competition was not found.");
    }

    if (competition.status === "draft") {
      const user = await getAuthUser(request, false);
      ensurePermission(
        canManageCompetition(user ? serializeUser(user) : null, serializeCompetition(competition)),
        "Draft competitions are only visible to the organizer or an admin.",
      );
    }

    response.json({ competition: serializeCompetition(competition) });
  });

  app.get("/api/my/competitions", async (request, response) => {
    const user = await getAuthUser(request, true);
    const competitions = await CompetitionModel.find({ organizerUserId: user._id }).sort({ updatedAt: -1 });
    response.json({ competitions: competitions.map((competition) => serializeCompetition(competition)) });
  });

  app.post("/api/competitions", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canCreateCompetition(serializeUser(user)), "Only verified users can create competitions.");
    const payload = parseBody(competitionInputSchema, request.body);
    const competitionData = await buildCompetitionData(payload, user._id);

    const competition = await CompetitionModel.create({
      ...competitionData,
      auditLog: [
        {
          actorUserId: user._id,
          action: "created",
          at: new Date(),
          note: `Competition created as ${competitionData.status}.`,
        },
      ],
    });

    response.status(201).json({ competition: serializeCompetition(competition) });
  });

  app.patch("/api/competitions/:competitionId", async (request, response) => {
    const user = await getAuthUser(request, true);
    const competition = await CompetitionModel.findById(toObjectId(request.params.competitionId, "competitionId"));

    if (!competition) {
      throw createHttpError(404, "Competition was not found.");
    }

    ensurePermission(
      canManageCompetition(serializeUser(user), serializeCompetition(competition)),
      "You can only edit your own competitions unless you are an admin.",
    );

    const payload = parseBody(competitionInputSchema, request.body);
    const competitionData = await buildCompetitionData(payload, competition.organizerUserId);

    competition.tourId = competitionData.tourId;
    competition.organizerName = competitionData.organizerName;
    competition.title = competitionData.title;
    competition.description = competitionData.description;
    competition.location = competitionData.location;
    competition.scheduledAt = competitionData.scheduledAt;
    competition.scoresheetUrl = competitionData.scoresheetUrl ?? null;
    competition.status = competitionData.status;
    competition.participants = competitionData.participants;
    competition.results = competitionData.results;
    competition.scoringSnapshot = competitionData.scoringSnapshot ?? null;
    competition.auditLog.push({
      actorUserId: user._id,
      action: "updated",
      at: new Date(),
      note: `Competition updated as ${competitionData.status}.`,
    });
    await competition.save();

    response.json({ competition: serializeCompetition(competition) });
  });

  app.post("/api/competitions/:competitionId/signup", async (request, response) => {
    const user = await getAuthUser(request, true);
    const competition = await CompetitionModel.findById(toObjectId(request.params.competitionId, "competitionId"));

    if (!competition) {
      throw createHttpError(404, "Competition was not found.");
    }

    ensureCompetitionAllowsSelfSignup(competition);

    const competitor = await resolveSelfSignupCompetitor(competition.tourId, user);
    const isAlreadySignedUp = competition.participants.some(
      (participant) => participant.competitorId.toString() === competitor.competitorId.toString(),
    );

    if (isAlreadySignedUp) {
      throw createHttpError(409, "You are already signed up for this competition.");
    }

    competition.participants.push({
      competitorId: competitor.competitorId,
      displayName: competitor.displayName,
    });
    competition.auditLog.push({
      actorUserId: user._id,
      action: "self-signed-up",
      at: new Date(),
      note: `${user.name} joined this competition.`,
    });
    await competition.save();

    response.json({ competition: serializeCompetition(competition) });
  });

  app.delete("/api/competitions/:competitionId/signup", async (request, response) => {
    const user = await getAuthUser(request, true);
    const competition = await CompetitionModel.findById(toObjectId(request.params.competitionId, "competitionId"));

    if (!competition) {
      throw createHttpError(404, "Competition was not found.");
    }

    ensureCompetitionAllowsSelfSignup(competition);

    const competitor = await resolveSelfSignupCompetitor(competition.tourId, user);
    const { participantRemoved } = removeParticipantAndResultsByCompetitorId(competition, competitor.competitorId);

    if (!participantRemoved) {
      throw createHttpError(404, "You are not signed up for this competition.");
    }

    competition.auditLog.push({
      actorUserId: user._id,
      action: "self-withdrew",
      at: new Date(),
      note: `${user.name} left this competition.`,
    });
    await competition.save();

    response.json({ competition: serializeCompetition(competition) });
  });

  app.get("/api/users", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageUsers(serializeUser(user)), "Only admins can manage users.");
    const users = await UserModel.find().sort({ createdAt: -1 });
    response.json({ users: users.map((entry) => serializeUser(entry)) });
  });

  app.patch("/api/users/:userId", async (request, response) => {
    const user = await getAuthUser(request, true);
    ensurePermission(canManageUsers(serializeUser(user)), "Only admins can manage users.");
    const payload = parseBody(userUpdateInputSchema, request.body);
    const userToUpdate = await UserModel.findById(toObjectId(request.params.userId, "userId"));

    if (!userToUpdate) {
      throw createHttpError(404, "User was not found.");
    }

    if (payload.roles) {
      userToUpdate.roles = payload.roles;
    }

    if (payload.emailVerified !== undefined) {
      userToUpdate.emailVerified = payload.emailVerified;
      if (payload.emailVerified) {
        userToUpdate.verificationToken = null;
      }
    }

    await userToUpdate.save();

    response.json({ user: serializeUser(userToUpdate) });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      response.status(error.status).json({
        error: error.message,
        details: error.details,
      });
      return;
    }

    if (error instanceof Error) {
      console.error(error);
      response.status(500).json({
        error: "Unexpected server error.",
        ...(process.env.NODE_ENV !== "production" ? { details: error.message } : {}),
      });
      return;
    }

    response.status(500).json({
      error: "Unexpected server error.",
    });
  });

  return app;
}
