import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { Permission, SystemRole } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ timestamps: true, collection: 'roles', toJSON: idToJson })
export class Role {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  /** Set for the six seeded system roles (OWNER, ADMIN, ...), undefined for organization-defined custom roles. */
  @Prop()
  systemKey?: SystemRole;

  @Prop({ type: [String], default: [] })
  permissions!: Permission[];

  @Prop({ default: false })
  isSystem!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
RoleSchema.index({ organizationId: 1, name: 1 }, { unique: true });
