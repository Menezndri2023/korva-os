import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  AddBlockedSlotInput,
  CreateResourceInput,
  UpdateResourceInput,
} from '@korva/validation';
import { ResourcesRepository } from './resources.repository';
import { ResourceDocument } from './schemas/resource.schema';

@Injectable()
export class ResourcesService {
  constructor(private readonly resourcesRepository: ResourcesRepository) {}

  create(
    organizationId: string,
    input: CreateResourceInput,
  ): Promise<ResourceDocument> {
    return this.resourcesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      type: input.type,
      capacity: input.capacity,
      description: input.description,
      active: input.active,
      weeklyAvailability: input.weeklyAvailability,
    });
  }

  list(
    organizationId: string,
    activeOnly: boolean,
  ): Promise<ResourceDocument[]> {
    return this.resourcesRepository.findAll(organizationId, activeOnly);
  }

  async getById(organizationId: string, id: string): Promise<ResourceDocument> {
    const resource = await this.resourcesRepository.findById(
      organizationId,
      id,
    );
    if (!resource) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return resource;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateResourceInput,
  ): Promise<ResourceDocument> {
    const updated = await this.resourcesRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return updated;
  }

  async addBlockedSlot(
    organizationId: string,
    id: string,
    input: AddBlockedSlotInput,
  ): Promise<ResourceDocument> {
    const updated = await this.resourcesRepository.addBlockedSlot(
      organizationId,
      id,
      {
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        reason: input.reason,
      },
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return updated;
  }

  async removeBlockedSlot(
    organizationId: string,
    id: string,
    slotId: string,
  ): Promise<ResourceDocument> {
    const updated = await this.resourcesRepository.removeBlockedSlot(
      organizationId,
      id,
      slotId,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return updated;
  }
}
