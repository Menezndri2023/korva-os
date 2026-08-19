import type { SchemaOptions } from '@nestjs/mongoose';

/**
 * Shared toJSON behavior for all schemas: expose `id` (string) instead of Mongo's `_id`/`__v`,
 * so the API and frontend types (@korva/types) agree on a single `id` field everywhere.
 */
export const idToJson: SchemaOptions['toJSON'] = {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
};
