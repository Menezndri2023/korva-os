import IORedis from "ioredis";
import { config } from "./config";
import { createEmailWorker } from "./queues/email.worker";

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

const workers = [createEmailWorker(connection)];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} in queue "${worker.name}" failed:`, err);
  });
}

console.log(`[worker] started, listening on ${workers.map((w) => w.name).join(", ")}`);

async function shutdown() {
  console.log("[worker] shutting down...");
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
