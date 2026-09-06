import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Segment, SegmentSchema } from './segments/schemas/segment.schema';
import { Campaign, CampaignSchema } from './campaigns/schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientSchema,
} from './campaigns/schemas/campaign-recipient.schema';
// Registered locally (not by importing CrmModule's own MongooseModule.forFeature, which it
// doesn't re-export anyway) so SegmentsRepository can build raw Contact queries without a
// circular module dependency — same "register a schema locally" pattern CrmModule itself
// already uses for Order/Booking/Invoice/etc. it doesn't own. See crm.module.ts's own comment.
import { Contact, ContactSchema } from '../crm/contacts/schemas/contact.schema';

import { SegmentsRepository } from './segments/segments.repository';
import { SegmentsService } from './segments/segments.service';
import { SegmentsController } from './segments/segments.controller';

import { CampaignsRepository } from './campaigns/campaigns.repository';
import { CampaignRecipientsRepository } from './campaigns/campaign-recipients.repository';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignSendWorkerService } from './campaigns/campaign-send-worker.service';
import { CampaignsController } from './campaigns/campaigns.controller';

import { CrmModule } from '../crm/crm.module';
import { CommunicationModule } from '../communication/communication.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Segment.name, schema: SegmentSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignRecipient.name, schema: CampaignRecipientSchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
    CrmModule,
    CommunicationModule,
    CustomFieldsModule,
    AuditModule,
  ],
  controllers: [SegmentsController, CampaignsController],
  providers: [
    SegmentsRepository,
    SegmentsService,
    CampaignsRepository,
    CampaignRecipientsRepository,
    CampaignsService,
    CampaignSendWorkerService,
  ],
})
export class MarketingModule {}
