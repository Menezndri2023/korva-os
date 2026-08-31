import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCourseSchema,
  listCoursesQuerySchema,
  updateCourseSchema,
  type CreateCourseInput,
  type ListCoursesQuery,
  type UpdateCourseInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { CoursesService } from './courses.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('courses')
@RequireModule('booking')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @RequirePermissions('bookings.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listCoursesQuerySchema))
    query: ListCoursesQuery,
  ) {
    return this.coursesService.list(tenant.organizationId, query);
  }

  @RequirePermissions('bookings.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.coursesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('bookings.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createCourseSchema)) body: CreateCourseInput,
  ) {
    return this.coursesService.create(tenant.organizationId, body);
  }

  @RequirePermissions('bookings.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCourseSchema)) body: UpdateCourseInput,
  ) {
    return this.coursesService.update(tenant.organizationId, id, body);
  }
}
