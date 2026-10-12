import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { idToJson } from '../../mongoose/schema-options';

export type MigrationDocument = HydratedDocument<Migration>;

/**
 * One row per migration that has run against this database. The unique index on `name` is what
 * makes the runner safe to invoke repeatedly: a migration already recorded cannot be inserted a
 * second time, so re-running the runner is a no-op rather than a replay.
 *
 * Not organization-scoped, unlike almost everything else in this codebase — a migration is a
 * property of the DATABASE, not of a tenant, so there is deliberately no `organizationId`.
 */
@Schema({ timestamps: true, collection: 'migrations', toJSON: idToJson })
export class Migration {
  @Prop({ required: true, unique: true })
  name!: string;

  @Prop({ required: true })
  appliedAt!: Date;

  /** How long it took, in ms — the one number worth having when a later migration hangs. */
  @Prop({ required: true })
  durationMs!: number;
}

export const MigrationSchema = SchemaFactory.createForClass(Migration);
