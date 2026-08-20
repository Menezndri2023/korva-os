import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { KorvaModule } from '@korva/types';
import type { PlanInterval } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type PlanDocument = HydratedDocument<Plan>;

@Schema({ timestamps: true, collection: 'plans', toJSON: idToJson })
export class Plan {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  priceAmount!: number;

  @Prop({ required: true })
  priceCurrency!: string;

  @Prop({ type: String, required: true })
  interval!: PlanInterval;

  @Prop({ type: [String], default: [] })
  modules!: KorvaModule[];

  @Prop({ type: Object, default: {} })
  limits!: Record<string, number>;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
