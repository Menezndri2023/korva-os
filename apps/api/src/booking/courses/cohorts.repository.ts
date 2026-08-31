import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Cohort,
  CohortDocument,
  CohortSession,
  CohortSessionDocument,
} from './schemas/cohort.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindCohortsOptions {
  page: number;
  limit: number;
  courseId?: string;
  status?: string;
  enrolledContactId?: string;
}

@Injectable()
export class CohortsRepository {
  constructor(
    @InjectModel(Cohort.name)
    private readonly cohortModel: Model<CohortDocument>,
    @InjectModel(CohortSession.name)
    private readonly cohortSessionModel: Model<CohortSessionDocument>,
  ) {}

  create(data: Partial<Cohort>): Promise<CohortDocument> {
    return this.cohortModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<CohortDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.cohortModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindCohortsOptions,
  ): Promise<Paginated<CohortDocument>> {
    const filter: FilterQuery<Cohort> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.courseId)
      filter.courseId = new Types.ObjectId(options.courseId);
    if (options.status) filter.status = options.status;
    if (options.enrolledContactId) {
      filter.enrolledContactIds = new Types.ObjectId(options.enrolledContactId);
    }

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.cohortModel
        .find(filter)
        .sort({ startDate: 1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.cohortModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Cohort>,
  ): Promise<CohortDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.cohortModel
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

  createSession(data: Partial<CohortSession>): Promise<CohortSessionDocument> {
    return this.cohortSessionModel.create(data);
  }

  findSessionsByCohort(
    organizationId: string,
    cohortId: string,
  ): Promise<CohortSessionDocument[]> {
    return this.cohortSessionModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        cohortId: new Types.ObjectId(cohortId),
      })
      .sort({ startAt: 1 })
      .exec();
  }

  findSessionByCohortAndModule(
    organizationId: string,
    cohortId: string,
    moduleIndex: number,
  ): Promise<CohortSessionDocument | null> {
    return this.cohortSessionModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        cohortId: new Types.ObjectId(cohortId),
        moduleIndex,
      })
      .exec();
  }
}
