/**
 * One-time, idempotent migration splitting Lead's overloaded pipeline/value/probability fields
 * into a dedicated Deal entity (KORVA OS V2 Phase D1 — see docs/KORVA_OS_V2_AUDIT.md and the
 * approved plan for "Decouple Deal from Lead").
 *
 * Every existing Lead document still carries `pipelineId`/`stageId`/`estimatedValue`/
 * `probability` and an old-shape `status` ("open"|"won"|"lost") even though the Lead *class*
 * (lead.schema.ts) has already dropped those fields and moved to the new 5-value status enum —
 * this script must run against the RAW collections (via getModelToken, `.lean()` reads, and
 * `insertOne`/`updateOne` writes) rather than through LeadsService/DealsService, for two reasons:
 *   1. Reads work regardless of what the current Lead *class* declares — the old fields are read
 *      off the raw document, not off a typed Mongoose document.
 *   2. A live WorkflowEngine reacting to a backfilled `deal.created`/`lead.converted` event for
 *      years-old data would be a real, avoidable hazard — this script writes directly to the
 *      collections and publishes no events, exactly like backfill-website-module.ts's own
 *      precedent of calling `.save()`/raw writes rather than going through a service.
 *
 * Status mapping (old Lead.status -> new Deal.status / new Lead.status):
 *   open  -> Deal: open,  Lead: qualified
 *   won   -> Deal: won  (closedAt = lead.updatedAt), Lead: converted
 *   lost  -> Deal: lost (closedAt = lead.updatedAt), Lead: disqualified
 *
 * Deal.createdAt/updatedAt are copied verbatim from the source Lead (via a raw `insertOne`,
 * bypassing Mongoose's timestamps plugin entirely, which would otherwise overwrite updatedAt to
 * "now" even when createdAt is explicitly supplied) — letting them auto-stamp would silently
 * destroy pipeline-age fidelity for any future forecast reporting built on this history.
 *
 * Idempotent: a Lead is skipped if a Deal with {organizationId, leadId} already exists. Every
 * field written onto a Deal comes verbatim from the one Lead document being processed — never a
 * second unscoped lookup — so processing all organizations in one sweep carries no cross-tenant
 * risk despite not grouping by organizationId up front.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/backfill-leads-to-deals.ts            (dry run, default)
 *   pnpm --filter @korva/api exec ts-node -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register scripts/backfill-leads-to-deals.ts --apply    (writes changes)
 */
import { NestFactory } from '@nestjs/core';

// Set BEFORE the application context is built: every scheduler and queue worker checks
// this in its own onModuleInit, so without it this script would start 26 BullMQ blocking
// loops, register repeatable job definitions in Redis, and briefly run real background
// work — a dry-run print could trigger a payment-reconciliation sweep. See
// src/core/background/background-workers.ts.
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { Lead, LeadDocument } from '../src/crm/leads/schemas/lead.schema';
import { Deal, DealDocument } from '../src/crm/deals/schemas/deal.schema';

type RawLead = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  contactId: Types.ObjectId;
  ownerId?: Types.ObjectId;
  pipelineId?: Types.ObjectId;
  stageId?: Types.ObjectId;
  estimatedValue?: number;
  probability?: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

interface StatusMapping {
  dealStatus: 'open' | 'won' | 'lost';
  leadStatus: string;
  closes: boolean;
}

const DEFAULT_MAPPING: StatusMapping = {
  dealStatus: 'open',
  leadStatus: 'qualified',
  closes: false,
};

const OLD_STATUS_MAP: Record<string, StatusMapping> = {
  open: DEFAULT_MAPPING,
  won: { dealStatus: 'won', leadStatus: 'converted', closes: true },
  lost: { dealStatus: 'lost', leadStatus: 'disqualified', closes: true },
};

function mapStatus(status: string): StatusMapping {
  return OLD_STATUS_MAP[status] ?? DEFAULT_MAPPING;
}

async function run() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const leadModel = app.get<Model<LeadDocument>>(getModelToken(Lead.name));
    const dealModel = app.get<Model<DealDocument>>(getModelToken(Deal.name));

    const leads = (await leadModel
      .find({ pipelineId: { $exists: true } })
      .lean()
      .exec()) as unknown as RawLead[];

    let migrated = 0;
    let skippedAlready = 0;
    let skippedNoPipeline = 0;

    console.log(
      `${apply ? 'APPLY' : 'DRY RUN'} — inspecting ${leads.length} lead(s) with a legacy pipeline field`,
    );

    for (const lead of leads) {
      const alreadyMigrated = await dealModel.exists({
        organizationId: lead.organizationId,
        leadId: lead._id,
      });
      if (alreadyMigrated) {
        skippedAlready++;
        continue;
      }

      if (!lead.pipelineId || !lead.stageId) {
        skippedNoPipeline++;
        console.log(`  SKIP  lead ${lead._id.toString()} — no pipeline/stage on record`);
        continue;
      }

      const mapping = mapStatus(lead.status);

      console.log(
        `  ${apply ? 'MIGRATE' : 'WOULD MIGRATE'} lead ${lead._id.toString()} ` +
          `(org ${lead.organizationId.toString()}) status "${lead.status}" -> ` +
          `deal.status "${mapping.dealStatus}", lead.status "${mapping.leadStatus}"`,
      );

      if (apply) {
        const dealId = new Types.ObjectId();
        await dealModel.collection.insertOne({
          _id: dealId,
          organizationId: lead.organizationId,
          contactId: lead.contactId,
          leadId: lead._id,
          pipelineId: lead.pipelineId,
          stageId: lead.stageId,
          estimatedValue: lead.estimatedValue,
          probability: lead.probability,
          status: mapping.dealStatus,
          ownerId: lead.ownerId,
          customFields: {},
          closedAt: mapping.closes ? lead.updatedAt : undefined,
          createdAt: lead.createdAt,
          updatedAt: lead.updatedAt,
        });

        await leadModel.updateOne(
          { _id: lead._id },
          {
            $set: { status: mapping.leadStatus },
            $unset: {
              pipelineId: '',
              stageId: '',
              estimatedValue: '',
              probability: '',
            },
          },
        );

        migrated++;
      }
    }

    // Defensive second pass: any lead with no pipelineId at all (shouldn't exist today since it
    // was `required: true`, but handled anyway) just needs its status normalized to the new enum.
    const legacyOpenLeads = await leadModel
      .find({ pipelineId: { $exists: false }, status: { $in: ['open', 'won', 'lost'] } })
      .lean()
      .exec();
    for (const lead of legacyOpenLeads as unknown as RawLead[]) {
      const mapping = mapStatus(lead.status);
      console.log(
        `  ${apply ? 'NORMALIZE' : 'WOULD NORMALIZE'} lead ${lead._id.toString()} status "${lead.status}" -> "${mapping.leadStatus}" (no pipeline to migrate)`,
      );
      if (apply) {
        await leadModel.updateOne(
          { _id: lead._id },
          { $set: { status: mapping.leadStatus } },
        );
      }
    }

    console.log('---');
    console.log(`Total leads scanned:               ${leads.length}`);
    console.log(`Already migrated (skipped):        ${skippedAlready}`);
    console.log(`Skipped (no pipeline/stage):       ${skippedNoPipeline}`);
    console.log(
      apply
        ? `Migrated:                          ${migrated}`
        : `Would migrate:                     ${leads.length - skippedAlready - skippedNoPipeline} (dry run — pass --apply to write)`,
    );
  } finally {
    await app.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
