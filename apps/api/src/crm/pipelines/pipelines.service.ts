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

  /**
   * Used by the public lead-capture endpoint (public.service.ts#createLead): an external
   * website visitor submitting the embeddable widget can't be expected to know a pipeline/
   * stage id, and may be the very first lead this organization ever receives. Mirrors the
   * frontend's own lazy "Ventes" pipeline seed (apps/web's CRM leads page) exactly, so a lead
   * captured this way lands in the same pipeline a human would have created by hand.
   */
  async getOrCreateDefault(organizationId: string): Promise<PipelineDocument> {
    const pipelines =
      await this.pipelinesRepository.findAllForOrganization(organizationId);
    const existing =
      pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0];
    if (existing) return existing;

    return this.pipelinesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: 'Ventes',
      isDefault: true,
      stages: [
        { name: 'Nouveau', order: 0 },
        { name: 'Gagné', order: 1 },
      ],
    });
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
