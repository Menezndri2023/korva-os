import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreatePipelineInput,
  UpdatePipelineInput,
} from '@korva/validation';
import { PipelinesRepository } from './pipelines.repository';
import { PipelineDocument } from './schemas/pipeline.schema';

@Injectable()
export class PipelinesService {
  constructor(private readonly pipelinesRepository: PipelinesRepository) {}

  async create(
    organizationId: string,
    input: CreatePipelineInput,
  ): Promise<PipelineDocument> {
    if (input.isDefault) {
      await this.pipelinesRepository.unsetDefaultForOthers(organizationId);
    }
    return this.pipelinesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      isDefault: input.isDefault,
      stages: input.stages,
    });
  }

  list(organizationId: string): Promise<PipelineDocument[]> {
    return this.pipelinesRepository.findAllForOrganization(organizationId);
  }

  async getById(organizationId: string, id: string): Promise<PipelineDocument> {
    const pipeline = await this.pipelinesRepository.findById(
      organizationId,
      id,
    );
    if (!pipeline) {
      throw new NotFoundException({
        code: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }
    return pipeline;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdatePipelineInput,
  ): Promise<PipelineDocument> {
    if (input.isDefault) {
      await this.pipelinesRepository.unsetDefaultForOthers(organizationId, id);
    }
    const updated = await this.pipelinesRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }
    return updated;
  }

  async assertStageExists(
    organizationId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<void> {
    const exists = await this.pipelinesRepository.hasStage(
      organizationId,
      pipelineId,
      stageId,
    );
    if (!exists) {
      throw new NotFoundException({
        code: 'PIPELINE_STAGE_NOT_FOUND',
        message: 'Pipeline or stage not found',
      });
    }
  }
}
