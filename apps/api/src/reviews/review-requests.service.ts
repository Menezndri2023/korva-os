import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { BusinessModel, ReviewEntity } from '@korva/types';
import { Organization } from '../organizations/schemas/organization.schema';
import { ConversationsService } from '../communication/conversations/conversations.service';
import { sendWithChannelFallback } from '../communication/notify-contact-with-fallback';
import { ContactsService } from '../crm/contacts/contacts.service';
import {
  signReviewInvitation,
  verifyReviewInvitation,
  type ReviewInvitationClaims,
} from './review-invitation-token';

export interface ReviewInvitationContext {
  organizationName: string;
  businessModel?: BusinessModel;
  /** Absent when the business switched review requests off. */
  link?: string;
}

/**
 * Asks the customer for a review once the purchase is really over — an order marked delivered,
 * a booking marked completed — through the same WhatsApp-then-email path as every other
 * system message (sendWithChannelFallback), so it also lands in the business's conversations.
 *
 * Called directly by OrdersService#fulfill and BookingsService#complete rather than from an
 * event: both transitions happen exactly once per order/booking, so there is nothing to
 * deduplicate, and a sweep would add one more permanent Redis poller (see the BullMQ cost note).
 * Always best-effort: a failed send never fails the transition that triggered it.
 */
@Injectable()
export class ReviewRequestsService {
  private readonly logger = new Logger(ReviewRequestsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  linkFor(
    slug: string,
    claims: {
      organizationId: string;
      entity: ReviewEntity;
      entityId: string;
      contactId: string;
    },
  ): string {
    const storefrontUrl =
      this.configService.get<string>('STOREFRONT_URL') ??
      'http://localhost:3001';
    const token = signReviewInvitation(
      this.configService.getOrThrow<string>('JWT_SECRET'),
      claims,
    );
    return `${storefrontUrl}/${slug}/avis?t=${token}`;
  }

  verify(token: string): ReviewInvitationClaims | null {
    return verifyReviewInvitation(
      this.configService.getOrThrow<string>('JWT_SECRET'),
      token,
    );
  }

  /** Null when the organization is gone or suspended — nothing should be sent in its name. */
  async invitation(
    organizationId: string,
    entity: ReviewEntity,
    entityId: string,
    contactId: string,
  ): Promise<ReviewInvitationContext | null> {
    const organization = await this.organizationModel
      .findById(organizationId, {
        name: 1,
        slug: 1,
        businessModel: 1,
        reviewRequestsEnabled: 1,
        suspendedAt: 1,
      })
      .lean()
      .exec();
    if (!organization || organization.suspendedAt) return null;
    return {
      organizationName: organization.name,
      businessModel: organization.businessModel,
      link:
        organization.reviewRequestsEnabled === false
          ? undefined
          : this.linkFor(organization.slug, {
              organizationId,
              entity,
              entityId,
              contactId,
            }),
    };
  }

  async requestForOrder(
    organizationId: string,
    order: { id: string; number: string; contactId: { toString(): string } },
  ): Promise<void> {
    const contactId = order.contactId.toString();
    try {
      const context = await this.invitation(
        organizationId,
        'order',
        order.id,
        contactId,
      );
      if (!context?.link) return;
      const contact = await this.contactsService.getById(
        organizationId,
        contactId,
      );
      const hello = contact.firstName
        ? `Bonjour ${contact.firstName}`
        : 'Bonjour';
      const body =
        `${hello}, votre commande ${order.number} chez ${context.organizationName} est terminée. ` +
        `Merci pour votre confiance ! Votre avis compte, il ne prend que 30 secondes : ${context.link}`;
      await sendWithChannelFallback(
        this.conversationsService,
        this.logger,
        organizationId,
        contactId,
        body,
        'Review request',
      );
    } catch (error) {
      this.logger.error(
        `Review request: failed for order ${order.id}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
