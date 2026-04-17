import crypto from "node:crypto";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { getDb } from "./db.js";

export type ObjectId = string;

export type EmbeddedScoringConfig = {
  pointsTable: Array<{ place: number; points: number }>;
  countedResultsLimit: number | null;
  resultOrder: "lower-is-better";
};

export type AuditEntryRecord = {
  actorUserId: ObjectId;
  action: string;
  at: Date;
  note?: string | null;
};

export type ParticipantRecord = {
  competitorId: ObjectId;
  displayName: string;
};

export type CompetitionResultRecord = {
  competitorId: ObjectId;
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
  firebaseUid?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TourRecord = {
  name: string;
  seasonLabel: string;
  description: string;
  rulesText: string;
  isCurrent: boolean;
  scoring: EmbeddedScoringConfig;
  createdAt: Date;
  updatedAt: Date;
};

export type CompetitorProfileRecord = {
  tourId: ObjectId;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  linkedUserId?: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AnnouncementRecord = {
  title: string;
  body: string;
  tourId?: ObjectId | null;
  pinned: boolean;
  publishedAt: Date;
  createdByUserId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type CompetitionRecord = {
  tourId: ObjectId;
  organizerUserId: ObjectId;
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

export type RateLimitBucketRecord = {
  key: string;
  count: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type Filter = Record<string, unknown>;
type SortSpec = Record<string, 1 | -1>;
type UpdateSpec = {
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
  $inc?: Record<string, number>;
};
type UpsertOptions = { upsert?: boolean; new?: boolean };
type TimestampedRecord = { createdAt: Date; updatedAt: Date };
const useMemoryStore = process.env.NODE_ENV === "test";
const memoryCollections = new Map<string, Map<string, DocumentData>>();

function now() {
  return new Date();
}

function generateObjectId(): string {
  return crypto.randomBytes(12).toString("hex");
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (value instanceof Date || value instanceof RegExp) {
    return false;
  }
  return Object.keys(value).some((key) => key.startsWith("$"));
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]));
  }
  return value;
}

function deserializeValue(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate;
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deserializeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deserializeValue(entry)]));
  }
  return value;
}

function getValuesByPath(input: unknown, path: string): unknown[] {
  const segments = path.split(".");
  const walk = (value: unknown, index: number): unknown[] => {
    if (index >= segments.length) {
      return [value];
    }

    const segment = segments[index];
    if (!segment) {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => walk(entry, index));
    }

    if (!value || typeof value !== "object") {
      return [undefined];
    }

    const next = (value as Record<string, unknown>)[segment];
    return walk(next, index + 1);
  };

  return walk(input, 0);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => {
    if (value instanceof Date) {
      return value.getTime();
    }
    return value;
  };
  return normalize(left) === normalize(right);
}

function matchesCondition(values: unknown[], condition: unknown): boolean {
  if (isOperatorObject(condition)) {
    if (Object.hasOwn(condition, "$in")) {
      const expected = (condition.$in as unknown[]) ?? [];
      return values.some((value) => expected.some((entry) => valuesEqual(value, entry)));
    }
    if (Object.hasOwn(condition, "$ne")) {
      return values.every((value) => !valuesEqual(value, condition.$ne));
    }
    if (Object.hasOwn(condition, "$all")) {
      const expected = (condition.$all as unknown[]) ?? [];
      const flattened = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
      return expected.every((entry) => flattened.some((value) => valuesEqual(value, entry)));
    }
    if (Object.hasOwn(condition, "$regex")) {
      const source = condition.$regex;
      const pattern = source instanceof RegExp ? source : new RegExp(String(source));
      return values.some((value) => pattern.test(String(value ?? "")));
    }
  }

  return values.some((value) => valuesEqual(value, condition));
}

function matchesFilter(input: Record<string, unknown>, filter: Filter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      const candidates = (condition as Filter[]) ?? [];
      if (!candidates.some((candidate) => matchesFilter(input, candidate))) {
        return false;
      }
      continue;
    }

    const values = getValuesByPath(input, key);
    if (!matchesCondition(values, condition)) {
      return false;
    }
  }

  return true;
}

function applySort<T>(items: T[], sortSpec: SortSpec | undefined): T[] {
  if (!sortSpec) {
    return [...items];
  }
  const entries = Object.entries(sortSpec);
  return [...items].sort((left, right) => {
    for (const [field, direction] of entries) {
      const leftValue = getValuesByPath(left, field)[0];
      const rightValue = getValuesByPath(right, field)[0];
      const normalizedLeft = leftValue instanceof Date ? leftValue.getTime() : leftValue;
      const normalizedRight = rightValue instanceof Date ? rightValue.getTime() : rightValue;

      if (normalizedLeft === normalizedRight) {
        continue;
      }
      const comparison = normalizedLeft! > normalizedRight! ? 1 : -1;
      return comparison * (direction === -1 ? -1 : 1);
    }
    return 0;
  });
}

function applyUpdate(base: Record<string, unknown>, update: UpdateSpec, isInsert: boolean) {
  const next = { ...base };
  if (update.$setOnInsert && isInsert) {
    for (const [key, value] of Object.entries(update.$setOnInsert)) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) {
      const current = Number((next as Record<string, unknown>)[key] ?? 0);
      (next as Record<string, unknown>)[key] = current + value;
    }
  }
  return next;
}

class QueryMany<TDoc> implements PromiseLike<TDoc[]> {
  private sortSpec: SortSpec | undefined;
  private limitCount: number | undefined;

  constructor(private readonly resolver: () => Promise<TDoc[]>) {}

  sort(spec: SortSpec) {
    this.sortSpec = spec;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private async run() {
    let items = await this.resolver();
    items = applySort(items, this.sortSpec);
    if (this.limitCount !== undefined) {
      items = items.slice(0, this.limitCount);
    }
    return items;
  }

  then<TResult1 = TDoc[], TResult2 = never>(
    onfulfilled?: ((value: TDoc[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

class QueryOne<TDoc> implements PromiseLike<TDoc | null> {
  private sortSpec: SortSpec | undefined;

  constructor(private readonly resolver: () => Promise<TDoc[]>) {}

  sort(spec: SortSpec) {
    this.sortSpec = spec;
    return this;
  }

  private async run() {
    const items = applySort(await this.resolver(), this.sortSpec);
    return items[0] ?? null;
  }

  then<TResult1 = TDoc | null, TResult2 = never>(
    onfulfilled?: ((value: TDoc | null) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

class BaseDoc<TRecord extends TimestampedRecord> {
  _id: string;
  private model: FirestoreModel<TRecord>;

  constructor(model: FirestoreModel<TRecord>, id: string, data: TRecord) {
    this.model = model;
    this._id = id;
    Object.assign(this, data);
  }

  async save() {
    const payload = this.toRecord();
    payload.updatedAt = now();
    Object.assign(this, payload);
    await this.model.write(this._id, payload);
    return this;
  }

  async deleteOne() {
    await this.model.deleteById(this._id);
  }

  toRecord(): TRecord {
    const { _id: _ignored, model: _model, ...rest } = this as unknown as Record<string, unknown>;
    return rest as TRecord;
  }
}

type FirestoreDoc<TRecord extends TimestampedRecord> = BaseDoc<TRecord> & TRecord;

class FirestoreModel<TRecord extends TimestampedRecord> {
  private collection: CollectionReference<DocumentData>;
  private collectionName: string;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
    this.collection = getDb().collection(collectionName);
  }

  private instantiate(id: string, data: TRecord) {
    return new BaseDoc(this, id, data) as FirestoreDoc<TRecord>;
  }

  async all(): Promise<FirestoreDoc<TRecord>[]> {
    if (useMemoryStore) {
      const map = memoryCollections.get(this.collectionName) ?? new Map<string, DocumentData>();
      return [...map.entries()].map(([id, data]) => this.instantiate(id, deserializeValue(data) as TRecord));
    }
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => this.instantiate(doc.id, deserializeValue(doc.data()) as TRecord));
  }

  async write(id: string, data: TRecord) {
    if (useMemoryStore) {
      let map = memoryCollections.get(this.collectionName);
      if (!map) {
        map = new Map<string, DocumentData>();
        memoryCollections.set(this.collectionName, map);
      }
      map.set(id, serializeValue(data) as DocumentData);
      return;
    }
    await this.collection.doc(id).set(serializeValue(data) as DocumentData);
  }

  async deleteById(id: string) {
    if (useMemoryStore) {
      memoryCollections.get(this.collectionName)?.delete(id);
      return;
    }
    await this.collection.doc(id).delete();
  }

  find(filter: Filter = {}) {
    return new QueryMany(async () => {
      const docs = await this.all();
      return docs.filter((doc) => matchesFilter(doc as unknown as Record<string, unknown>, filter));
    });
  }

  findOne(filter: Filter = {}) {
    return new QueryOne(async () => {
      const docs = await this.all();
      return docs.filter((doc) => matchesFilter(doc as unknown as Record<string, unknown>, filter));
    });
  }

  async findById(id: string) {
    if (useMemoryStore) {
      const data = memoryCollections.get(this.collectionName)?.get(id);
      if (!data) {
        return null;
      }
      return this.instantiate(id, deserializeValue(data) as TRecord);
    }
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) {
      return null;
    }
    return this.instantiate(id, deserializeValue(snapshot.data()!) as TRecord);
  }

  async create(payload: Omit<TRecord, "createdAt" | "updatedAt"> & Partial<Pick<TRecord, "createdAt" | "updatedAt">>) {
    const timestamp = now();
    const id = generateObjectId();
    const data = {
      ...payload,
      createdAt: payload.createdAt ?? timestamp,
      updatedAt: payload.updatedAt ?? timestamp,
    } as TRecord;
    await this.write(id, data);
    return this.instantiate(id, data);
  }

  async findOneAndUpdate(filter: Filter, update: UpdateSpec, options: UpsertOptions = {}) {
    const docs = await this.find(filter);
    const existing = (await docs)[0] ?? null;
    if (!existing && !options.upsert) {
      return null;
    }

    const timestamp = now();
    if (!existing) {
      const insertBase = Object.fromEntries(
        Object.entries(filter).filter(([key, value]) => !key.startsWith("$") && !isOperatorObject(value)),
      );
      const next = applyUpdate(
        { ...insertBase, createdAt: timestamp, updatedAt: timestamp },
        update,
        true,
      ) as TRecord;
      if (!next.createdAt) {
        next.createdAt = timestamp;
      }
      next.updatedAt = timestamp;
      const created = await this.create(next);
      return created;
    }

    const updated = applyUpdate(existing.toRecord() as Record<string, unknown>, update, false) as TRecord;
    updated.updatedAt = timestamp;
    await this.write(existing._id, updated);
    return this.instantiate(existing._id, updated);
  }

  async updateMany(filter: Filter, update: UpdateSpec) {
    const docs = await this.find(filter);
    for (const doc of await docs) {
      const updated = applyUpdate(doc.toRecord() as Record<string, unknown>, update, false) as TRecord;
      updated.updatedAt = now();
      await this.write(doc._id, updated);
    }
  }

  async deleteMany(filter: Filter) {
    const docs = await this.find(filter);
    for (const doc of await docs) {
      await this.deleteById(doc._id);
    }
  }

  async countDocuments(filter: Filter) {
    const docs = await this.find(filter);
    return (await docs).length;
  }
}

export type UserDoc = FirestoreDoc<UserRecord>;
export type TourDoc = FirestoreDoc<TourRecord>;
export type CompetitorProfileDoc = FirestoreDoc<CompetitorProfileRecord>;
export type AnnouncementDoc = FirestoreDoc<AnnouncementRecord>;
export type CompetitionDoc = FirestoreDoc<CompetitionRecord>;
export type RateLimitBucketDoc = FirestoreDoc<RateLimitBucketRecord>;

export const UserModel = new FirestoreModel<UserRecord>("users");
export const TourModel = new FirestoreModel<TourRecord>("tours");
export const CompetitorProfileModel = new FirestoreModel<CompetitorProfileRecord>("competitorProfiles");
export const AnnouncementModel = new FirestoreModel<AnnouncementRecord>("announcements");
export const CompetitionModel = new FirestoreModel<CompetitionRecord>("competitions");
export const RateLimitBucketModel = new FirestoreModel<RateLimitBucketRecord>("rateLimitBuckets");

export async function clearFirestoreCollectionsForTests() {
  if (useMemoryStore) {
    memoryCollections.clear();
    return;
  }
  const collections = [
    "users",
    "tours",
    "competitorProfiles",
    "announcements",
    "competitions",
    "rateLimitBuckets",
  ];
  const db = getDb();
  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).get();
    for (const doc of snapshot.docs) {
      await doc.ref.delete();
    }
  }
}
