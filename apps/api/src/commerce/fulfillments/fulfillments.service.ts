import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { UpdateFulfillmentInput } from '@korva/validation';
import { FulfillmentsRepository } from './fulfillments.repository';
import { FulfillmentDocument } from './schemas/fulfillment.schema';

@Injectable()
export class FulfillmentsService {
  constructor(
    private readonly fulfillmentsRepository: FulfillmentsRepository,
  ) {}

  createForOrder(
    organizationId: string,
    orderId: string,
  ): Promise<FulfillmentDocument> {
    return this.fulfillmentsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      orderId: new Types.ObjectId(orderId),
      status: 'pending',
    });
  }

  getForOrder(
    organizationId: string,
    orderId: string,
  ): Promise<FulfillmentDocument | null> {
    return this.fulfillmentsRepository.findByOrderId(organizationId, orderId);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateFulfillmentInput,
  ): Promise<FulfillmentDocument> {
    const updated = await this.fulfillmentsRepository.update(
      organizationId,
      id,
      {
        status: input.status,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        shippedAt: input.status === 'shipped' ? new Date() : undefined,
        deliveredAt: input.status === 'delivered' ? new Date() : undefined,
      },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'FULFILLMENT_NOT_FOUND',
        message: 'Fulfillment not found',
      });
    }
    return updated;
  }
}
