import "dotenv/config";

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const defaultConfigValues = {
  mongoUri: "mongodb://127.0.0.1:27017/frolf-tour-manager",
  jwtSecret: "frolf-tour-manager-dev-secret",
  clientOrigin: "http://localhost:5173",
};

function resolveJwtSecret(): string {
  const jwtSecret = process.env.JWT_SECRET?.trim();

  if (jwtSecret) {
    return jwtSecret;
  }

  if (process.env.NODE_ENV === "test") {
    return "frolf-tour-manager-test-secret";
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be explicitly set in production.");
  }

  return defaultConfigValues.jwtSecret;
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  const raw = value?.trim();
  if (!raw) {
    return process.env.NODE_ENV === "production" ? 1 : false;
  }

  if (raw === "false" || raw === "0") {
    return false;
  }

  if (raw === "true") {
    return true;
  }

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  return raw;
}

export const config = {
  port: parsePort(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI ?? defaultConfigValues.mongoUri,
  jwtSecret: resolveJwtSecret(),
  clientOrigin: process.env.CLIENT_ORIGIN ?? defaultConfigValues.clientOrigin,
  exposeDevTokens: process.env.NODE_ENV !== "production",
  enableRateLimiting: process.env.ENABLE_RATE_LIMITING !== "false",
  rateLimitStorage: process.env.RATE_LIMIT_STORAGE === "memory" ? "memory" : "mongo",
  rateLimitWindowMs: parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitAuthMax: parsePositiveInteger(process.env.RATE_LIMIT_AUTH_MAX, 20),
  rateLimitPublicMax: parsePositiveInteger(process.env.RATE_LIMIT_PUBLIC_MAX, 120),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  bootstrapAdminEmails: (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
};

function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const errors: string[] = [];

  if (config.mongoUri === defaultConfigValues.mongoUri) {
    errors.push("MONGODB_URI must be explicitly set in production.");
  }

  if (config.jwtSecret.trim().length < 32) {
    errors.push("JWT_SECRET must be set to a strong value (at least 32 characters) in production.");
  }

  if (config.clientOrigin === defaultConfigValues.clientOrigin) {
    errors.push("CLIENT_ORIGIN must be explicitly set in production.");
  }

  try {
    const url = new URL(config.clientOrigin);
    if (url.protocol !== "https:") {
      errors.push("CLIENT_ORIGIN must use HTTPS in production.");
    }
  } catch {
    errors.push("CLIENT_ORIGIN must be a valid URL.");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production configuration:\n- ${errors.join("\n- ")}`);
  }
}

validateProductionConfig();

/** In dev/test, allow both localhost and 127.0.0.1 — browsers treat them as different Origins. */
export function getCorsAllowedOrigins(): string | string[] {
  if (process.env.NODE_ENV === "production") {
    return config.clientOrigin;
  }

  const origins = new Set<string>([config.clientOrigin]);
  try {
    const url = new URL(config.clientOrigin);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (url.hostname === "localhost") {
      origins.add(`${url.protocol}//127.0.0.1:${port}`);
    } else if (url.hostname === "127.0.0.1") {
      origins.add(`${url.protocol}//localhost:${port}`);
    }
  } catch {
    // keep single configured origin
  }

  return [...origins];
}
