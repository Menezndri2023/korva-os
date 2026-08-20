import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Pipeline, PipelineDocument } from './schemas/pipeline.schema';

@Injectable()
export class PipelinesRepository {
  constructor(
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<PipelineDocument>,
  ) {}

  create(data: Partial<Pipeline>): Promise<PipelineDocument> {
    return this.pipelineModel.create(data);
  }

  findAllForOrganization(organizationId: string): Promise<PipelineDocument[]> {
    return this.pipelineModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<PipelineDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.pipelineModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Pipeline>,
  ): Promise<PipelineDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.pipelineModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }

  async unsetDefaultForOthers(
    organizationId: string,
    exceptId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (exceptId) filter._id = { $ne: new Types.ObjectId(exceptId) };
    await this.pipelineModel.updateMany(filter, { isDefault: false }).exec();
  }

  async hasStage(
    organizationId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(pipelineId) || !Types.ObjectId.isValid(stageId))
      return false;
    const res = await this.pipelineModel
      .exists({
        _id: new Types.ObjectId(pipelineId),
        organizationId: new Types.ObjectId(organizationId),
        'stages._id': new Types.ObjectId(stageId),
      })
      .exec();
    return Boolean(res);
  }
}
