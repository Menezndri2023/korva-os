import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformReview,
  PlatformReviewSchema,
} from './schemas/platform-review.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import { User, UserSchema } from '../identity/schemas/user.schema';
import { PlatformReviewsService } from './platform-reviews.service';
import {
  PlatformReviewsController,
  PublicPlatformReviewsController,
} from './platform-reviews.controller';

/** Reviews of KORVA OS by the businesses using it. Schemas only: no module dependency. The
 *  administration's moderation routes live in PlatformAdminModule, behind its own guard. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformReview.name, schema: PlatformReviewSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PlatformReviewsController, PublicPlatformReviewsController],
  providers: [PlatformReviewsService],
  exports: [PlatformReviewsService],
})
export class PlatformReviewsModule {}
