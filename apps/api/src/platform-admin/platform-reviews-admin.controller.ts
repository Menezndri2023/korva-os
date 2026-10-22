import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listPlatformReviewsQuerySchema,
  moderatePlatformReviewSchema,
  type ListPlatformReviewsQuery,
  type ModeratePlatformReviewInput,
} from '@korva/validation';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformReviewsService } from '../platform-reviews/platform-reviews.service';

/** The administration reads every review of KORVA OS and decides which reach korvasuite.com. */
@ApiTags('platform')
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform/reviews')
export class PlatformReviewsAdminController {
  constructor(private readonly reviews: PlatformReviewsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listPlatformReviewsQuerySchema))
    query: ListPlatformReviewsQuery,
  ) {
    return this.reviews.adminList(query.status);
  }

  @Get('stats')
  stats() {
    return this.reviews.adminStats();
  }

  @Post(':id/moderate')
  @HttpCode(200)
  moderate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moderatePlatformReviewSchema))
    body: ModeratePlatformReviewInput,
  ) {
    return this.reviews.moderate(id, body);
  }
}
