import "dotenv/config";

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: parsePort(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/frolf-tour-manager",
  jwtSecret: process.env.JWT_SECRET ?? "frolf-tour-manager-dev-secret",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  exposeDevTokens: process.env.NODE_ENV !== "production",
  bootstrapAdminEmails: (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
};
