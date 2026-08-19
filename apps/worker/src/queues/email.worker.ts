import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES } from "./names";

interface EmailJobData {
  to: string;
  template: string;
  variables?: Record<string, unknown>;
}

/** Placeholder processor — real sending is wired up in Phase 8 (Communication) via EmailProvider. */
export function createEmailWorker(connection: IORedis): Worker<EmailJobData> {
  return new Worker<EmailJobData>(
    QUEUE_NAMES.EMAIL,
    async (job: Job<EmailJobData>) => {
      console.log(`[email.worker] processing job ${job.id} -> ${job.data.to} (${job.data.template})`);
    },
    { connection },
  );
}
