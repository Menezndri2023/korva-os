import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { CreateCourseInput, UpdateCourseInput } from '@korva/validation';
import { CoursesRepository, FindCoursesOptions } from './courses.repository';
import { CourseDocument } from './schemas/course.schema';
import { OffersService } from '../../catalog/offers/offers.service';

@Injectable()
export class CoursesService {
  constructor(
    private readonly coursesRepository: CoursesRepository,
    private readonly offersService: OffersService,
  ) {}

  async create(
    organizationId: string,
    input: CreateCourseInput,
  ): Promise<CourseDocument> {
    await this.offersService.getById(organizationId, input.offerId);

    return this.coursesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      description: input.description,
      status: 'draft',
      offerId: new Types.ObjectId(input.offerId),
      modules: input.modules.map((m) => ({
        title: m.title,
        description: m.description,
        durationMinutes: m.durationMinutes,
        instructorMembershipId: m.instructorMembershipId
          ? new Types.ObjectId(m.instructorMembershipId)
          : undefined,
      })),
    });
  }

  async getById(organizationId: string, id: string): Promise<CourseDocument> {
    const course = await this.coursesRepository.findById(organizationId, id);
    if (!course) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: 'Course not found',
      });
    }
    return course;
  }

  /** Read-only existence check — used by CohortsService without a full getById round trip. */
  async existsById(organizationId: string, id: string): Promise<boolean> {
    const course = await this.coursesRepository.findById(organizationId, id);
    return !!course;
  }

  async list(
    organizationId: string,
    query: FindCoursesOptions,
  ): Promise<{ data: CourseDocument[]; pagination: Pagination }> {
    const { data, total } = await this.coursesRepository.findAll(
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
    input: UpdateCourseInput,
  ): Promise<CourseDocument> {
    const updated = await this.coursesRepository.update(organizationId, id, {
      name: input.name,
      description: input.description,
      status: input.status,
      modules: input.modules?.map((m) => ({
        title: m.title,
        description: m.description,
        durationMinutes: m.durationMinutes,
        instructorMembershipId: m.instructorMembershipId
          ? new Types.ObjectId(m.instructorMembershipId)
          : undefined,
      })),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: 'Course not found',
      });
    }
    return updated;
  }
}
