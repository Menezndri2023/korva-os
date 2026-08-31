import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Course, CourseDocument } from './schemas/course.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindCoursesOptions {
  page: number;
  limit: number;
  status?: string;
}

@Injectable()
export class CoursesRepository {
  constructor(
    @InjectModel(Course.name) private readonly model: Model<CourseDocument>,
  ) {}

  create(data: Partial<Course>): Promise<CourseDocument> {
    return this.model.create(data);
  }

  findById(organizationId: string, id: string): Promise<CourseDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindCoursesOptions,
  ): Promise<Paginated<CourseDocument>> {
    const filter: FilterQuery<Course> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;

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
    data: Partial<Course>,
  ): Promise<CourseDocument | null> {
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
