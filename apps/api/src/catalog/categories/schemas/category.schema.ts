import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../../core/mongoose/schema-options';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true, collection: 'categories', toJSON: idToJson })
export class Category {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  /** Suggested attribute keys for offers filed under this category — a catalog-UI hint, never
   *  enforced/validated against Offer.attributes. `default: undefined`, same array-default
   *  reasoning as Organization.storefrontSections. */
  @Prop({ type: [String], default: undefined })
  attributeKeys?: string[];
}

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ organizationId: 1, name: 1 }, { unique: true });
