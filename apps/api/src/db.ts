import mongoose from "mongoose";
import { config } from "./config.js";

let connectionPromise: Promise<typeof mongoose> | null = null;

export function connectToDatabase() {
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.mongoUri);
  }

  return connectionPromise;
}
