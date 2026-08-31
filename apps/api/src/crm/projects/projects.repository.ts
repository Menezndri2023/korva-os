import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import type { Paginated } from '../contacts/contacts.repository';

export interface FindProjectsOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectModel(Project.name)
    private readonly model: Model<ProjectDocument>,
  ) {}

  create(data: Partial<Project>): Promise<ProjectDocument> {
    return this.model.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ProjectDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  existsById(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(false);
    return this.model
      .exists({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .then((doc) => doc !== null);
  }

  async findAll(
    organizationId: string,
    options: FindProjectsOptions,
  ): Promise<Paginated<ProjectDocument>> {
    const filter: FilterQuery<Project> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId) {
      filter.contactId = new Types.ObjectId(options.contactId);
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Project>,
  ): Promise<ProjectDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
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
}
