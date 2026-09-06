import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateSegmentInput, UpdateSegmentInput } from '@korva/validation';
import type { Pagination, SegmentCriteria } from '@korva/types';
import { FindSegmentsOptions, SegmentsRepository } from './segments.repository';
import { SegmentDocument } from './schemas/segment.schema';
import { CustomFieldsService } from '../../custom-fields/custom-fields.service';

@Injectable()
export class SegmentsService {
  constructor(
    private readonly segmentsRepository: SegmentsRepository,
    private readonly customFieldsService: CustomFieldsService,
  ) {}

  /** A typo'd customField:<key> rule would otherwise silently produce a permanently-empty
   *  segment — validated against the org's real custom-field definitions up front instead. */
  private async assertCriteriaFieldsExist(
    organizationId: string,
    criteria: SegmentCriteria,
  ): Promise<void> {
    const customFieldKeys = criteria.rules
      .map((rule) => rule.field)
      .filter((field) => field.startsWith('customField:'))
      .map((field) => field.slice('customField:'.length));
    if (customFieldKeys.length === 0) return;

    const definitions = await this.customFieldsService.list(
      organizationId,
      'contacts',
    );
    const knownKeys = new Set(definitions.map((d) => d.key));
    const unknown = customFieldKeys.filter((key) => !knownKeys.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_SEGMENT_FIELD',
        message: `Unknown custom field(s) referenced in segment criteria: ${unknown.join(', ')}`,
      });
    }
  }

  async create(
    organizationId: string,
    input: CreateSegmentInput,
  ): Promise<SegmentDocument> {
    await this.assertCriteriaFieldsExist(organizationId, input.criteria);
    return this.segmentsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      description: input.description,
      criteria: input.criteria,
    });
  }

  async getById(organizationId: string, id: string): Promise<SegmentDocument> {
    const segment = await this.segmentsRepository.findById(organizationId, id);
    if (!segment) {
      throw new NotFoundException({
        code: 'SEGMENT_NOT_FOUND',
        message: 'Segment not found',
      });
    }
    return segment;
  }

  async list(
    organizationId: string,
    query: FindSegmentsOptions,
  ): Promise<{ data: SegmentDocument[]; pagination: Pagination }> {
    const { data, total } = await this.segmentsRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateSegmentInput,
  ): Promise<SegmentDocument> {
    if (input.criteria) {
      await this.assertCriteriaFieldsExist(organizationId, input.criteria);
    }
    const updated = await this.segmentsRepository.update(organizationId, id, {
      name: input.name,
      description: input.description,
      criteria: input.criteria,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'SEGMENT_NOT_FOUND',
        message: 'Segment not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const deleted = await this.segmentsRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'SEGMENT_NOT_FOUND',
        message: 'Segment not found',
      });
    }
  }

  async preview(
    organizationId: string,
    criteria: SegmentCriteria,
  ): Promise<{ count: number }> {
    await this.assertCriteriaFieldsExist(organizationId, criteria);
    const count = await this.segmentsRepository.countMatchingContacts(
      organizationId,
      criteria,
    );
    return { count };
  }

  matchContactIds(
    organizationId: string,
    criteria: SegmentCriteria,
  ): Promise<string[]> {
    return this.segmentsRepository.matchContactIds(organizationId, criteria);
  }
}
