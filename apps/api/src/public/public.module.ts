import { Module } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingModule } from '../booking/booking.module';
import { CommerceModule } from '../commerce/commerce.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    OrganizationsModule,
    CatalogModule,
    BookingModule,
    CommerceModule,
    CrmModule,
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
