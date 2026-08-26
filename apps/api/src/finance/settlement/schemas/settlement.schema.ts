import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SettlementStatus } from '@korva/types';
import { SETTLEMENT_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type SettlementDocument = HydratedDocument<Settlement>;

/**
 * Stage 1 domain shape for split settlement (Flow B, Merchant of Record — see
 * docs/architecture/integrations-platform.md §4 "Split settlement"). Not wired into the real
 * payment-completion flow yet; see SettlementService for the standalone domain logic this
 * schema backs.
 */
@Schema({ timestamps: true, collection: 'settlements', toJSON: idToJson })
export class Settlement {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  /** Source reference this settlement was computed from — a Payment id. */
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, index: true })
  paymentId!: Types.ObjectId;

  /**
   * Full amount KORVA collected from the customer. Integer minor units (e.g. cents) — never
   * floating point — matching this repo's Payment/Invoice money convention.
   */
  @Prop({ required: true })
  grossAmount!: number;

  @Prop({ required: true })
  currency!: string;

  /**
   * The commission rate actually applied when this settlement was computed, in basis points
   * (1/100th of a percent). Persisted per-record so a historical settlement's split stays
   * explainable even if commission configuration changes later. See SettlementService for where
   * this is configured — Stage-1 scaffolding, not a decided business rate.
   */
  @Prop({ required: true })
  commissionRateBasisPoints!: number;

  /** KORVA's retained amount. Integer minor units. */
  @Prop({ required: true })
  commissionAmount!: number;

  /**
   * Amount owed to the tenant. Integer minor units. Invariant enforced by
   * SettlementService.computeCommission: commissionAmount + tenantAmount === grossAmount, always.
   */
  @Prop({ required: true })
  tenantAmount!: number;

  @Prop({ type: String, enum: SETTLEMENT_STATUSES, default: 'pending' })
  status!: SettlementStatus;

  @Prop()
  settledAt?: Date;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);
SettlementSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
