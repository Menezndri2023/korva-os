import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type {
  CreateCohortInput,
  ScheduleCohortSessionInput,
  UpdateCohortInput,
} from '@korva/validation';
import { CohortsRepository, FindCohortsOptions } from './cohorts.repository';
import { CohortDocument, CohortSessionDocument } from './schemas/cohort.schema';
import { CoursesService } from './courses.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { ResourcesService } from '../resources/resources.service';
import { BookingsService } from '../bookings/bookings.service';

@Injectable()
export class CohortsService {
  constructor(
    private readonly cohortsRepository: CohortsRepository,
    private readonly coursesService: CoursesService,
    private readonly contactsService: ContactsService,
    private readonly resourcesService: ResourcesService,
    private readonly bookingsService: BookingsService,
  ) {}

  async create(
    organizationId: string,
    input: CreateCohortInput,
  ): Promise<CohortDocument> {
    const courseExists = await this.coursesService.existsById(
      organizationId,
      input.courseId,
    );
    if (!courseExists) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: 'Course not found',
      });
    }
    for (const contactId of input.enrolledContactIds) {
      const exists = await this.contactsService.existsById(
        organizationId,
        contactId,
      );
      if (!exists) {
        throw new NotFoundException({
          code: 'CONTACT_NOT_FOUND',
          message: `Contact not found: ${contactId}`,
        });
      }
    }

    return this.cohortsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      courseId: new Types.ObjectId(input.courseId),
      name: input.name,
      startDate: new Date(input.startDate),
      status: 'upcoming',
      enrolledContactIds: input.enrolledContactIds.map(
        (id) => new Types.ObjectId(id),
      ),
    });
  }

  async getById(organizationId: string, id: string): Promise<CohortDocument> {
    const cohort = await this.cohortsRepository.findById(organizationId, id);
    if (!cohort) {
      throw new NotFoundException({
        code: 'COHORT_NOT_FOUND',
        message: 'Cohort not found',
      });
    }
    return cohort;
  }

  async list(
    organizationId: string,
    query: FindCohortsOptions,
  ): Promise<{ data: CohortDocument[]; pagination: Pagination }> {
    const { data, total } = await this.cohortsRepository.findAll(
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
    input: UpdateCohortInput,
  ): Promise<CohortDocument> {
    if (input.enrolledContactIds) {
      for (const contactId of input.enrolledContactIds) {
        const exists = await this.contactsService.existsById(
          organizationId,
          contactId,
        );
        if (!exists) {
          throw new NotFoundException({
            code: 'CONTACT_NOT_FOUND',
            message: `Contact not found: ${contactId}`,
          });
        }
      }
    }

    const updated = await this.cohortsRepository.update(organizationId, id, {
      name: input.name,
      status: input.status,
      enrolledContactIds: input.enrolledContactIds?.map(
        (contactId) => new Types.ObjectId(contactId),
      ),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'COHORT_NOT_FOUND',
        message: 'Cohort not found',
      });
    }
    return updated;
  }

  async listSessions(
    organizationId: string,
    cohortId: string,
  ): Promise<CohortSessionDocument[]> {
    await this.getById(organizationId, cohortId);
    return this.cohortsRepository.findSessionsByCohort(
      organizationId,
      cohortId,
    );
  }

  /**
   * Schedules one module's class meeting for every enrolled learner — creates one real Booking
   * per enrolled contact, all sharing the same resource+time slot, reusing the existing
   * multi-attendee group-booking capacity model exactly (BookingsService already treats "N
   * Bookings on one resource+slot" as one group session — see availability.service.ts's own
   * capacity-counting logic). The module's own `instructorMembershipId` (multi-instructor) is
   * carried through if the course defined one for this module.
   *
   * NOT wrapped in a single cross-booking transaction: each BookingsService.create() call is
   * independently atomic (guards its own resource capacity), but creating N bookings here is
   * still N separate calls — a failure partway through (e.g. capacity exhausted by a concurrent
   * booking mid-loop) leaves whatever succeeded before it as real, valid Bookings with no
   * CohortSession recording them yet. The capacity pre-check below eliminates the common case
   * (enrolling more learners than the room holds) but is a courtesy check, not a hard guarantee
   * under concurrency — an accepted v1 gap, documented rather than solved with a bigger
   * refactor of BookingsService.create() to accept an externally-managed session.
   */
  async scheduleSession(
    organizationId: string,
    userId: string,
    cohortId: string,
    input: ScheduleCohortSessionInput,
  ): Promise<CohortSessionDocument> {
    const cohort = await this.getById(organizationId, cohortId);
    const course = await this.coursesService.getById(
      organizationId,
      cohort.courseId.toString(),
    );
    const module = course.modules[input.moduleIndex];
    if (!module) {
      throw new BadRequestException({
        code: 'COURSE_MODULE_NOT_FOUND',
        message: `Course has no module at index ${input.moduleIndex}`,
      });
    }

    const existingSession =
      await this.cohortsRepository.findSessionByCohortAndModule(
        organizationId,
        cohortId,
        input.moduleIndex,
      );
    if (existingSession) {
      throw new BadRequestException({
        code: 'COHORT_SESSION_ALREADY_SCHEDULED',
        message: 'This module has already been scheduled for this cohort',
      });
    }

    const resource = await this.resourcesService.getById(
      organizationId,
      input.resourceId,
    );
    if (cohort.enrolledContactIds.length > resource.capacity) {
      throw new BadRequestException({
        code: 'COHORT_EXCEEDS_RESOURCE_CAPACITY',
        message: `This cohort has ${cohort.enrolledContactIds.length} enrolled learners, more than resource capacity (${resource.capacity})`,
      });
    }

    if (module.instructorMembershipId) {
      const overlapping = await this.cohortsRepository.findSessionsByInstructor(
        organizationId,
        module.instructorMembershipId.toString(),
        { startAt: new Date(input.startAt), endAt: new Date(input.endAt) },
      );
      if (overlapping.length > 0) {
        throw new BadRequestException({
          code: 'INSTRUCTOR_ALREADY_BOOKED',
          message:
            'This instructor is already teaching another session that overlaps this time slot',
        });
      }
    }

    const bookingIds: string[] = [];
    for (const contactId of cohort.enrolledContactIds) {
      const booking = await this.bookingsService.create(
        organizationId,
        userId,
        {
          resourceId: input.resourceId,
          offerId: course.offerId.toString(),
          contactId: contactId.toString(),
          startAt: input.startAt,
          endAt: input.endAt,
        },
      );
      bookingIds.push(booking.id as string);
    }

    return this.cohortsRepository.createSession({
      organizationId: new Types.ObjectId(organizationId),
      cohortId: new Types.ObjectId(cohortId),
      moduleIndex: input.moduleIndex,
      resourceId: new Types.ObjectId(input.resourceId),
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      instructorMembershipId: module.instructorMembershipId,
      bookingIds: bookingIds.map((id) => new Types.ObjectId(id)),
    });
  }

  /** One instructor's full teaching schedule across every cohort/course — the visibility
   *  counterpart to scheduleSession's own conflict guard above. */
  async listInstructorSessions(
    organizationId: string,
    instructorMembershipId: string,
  ): Promise<CohortSessionDocument[]> {
    return this.cohortsRepository.findSessionsByInstructor(
      organizationId,
      instructorMembershipId,
    );
  }
}
