import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { connectToDatabase } from "./db.js";

async function start() {
  await connectToDatabase();

  const server = createServer(createApp());

  server.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exitCode = 1;
});
