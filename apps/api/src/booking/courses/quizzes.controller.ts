import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createQuizSchema, type CreateQuizInput } from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { QuizzesService } from './quizzes.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('quizzes')
@RequireModule('booking')
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @RequirePermissions('bookings.read')
  @Get()
  listByCourse(
    @CurrentTenant() tenant: TenantContext,
    @Query('courseId') courseId: string,
  ) {
    return this.quizzesService.listByCourse(tenant.organizationId, courseId);
  }

  @RequirePermissions('bookings.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.quizzesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('bookings.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createQuizSchema)) body: CreateQuizInput,
  ) {
    return this.quizzesService.create(tenant.organizationId, body);
  }
}
