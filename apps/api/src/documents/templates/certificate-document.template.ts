import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { BookingDocument } from '../../booking/bookings/schemas/booking.schema';
import type { OfferDocument } from '../../catalog/offers/schemas/offer.schema';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';

/**
 * A personalized completion confirmation — explicitly not a generated/stored, templated
 * "official-looking" diploma. Same scope discipline as the rest of the Formation vertical's
 * attendance feature: deliver the useful capability now, leave a richer certificate design as a
 * fast-follow.
 */
export function buildCertificateDocumentManifest(
  booking: BookingDocument,
  offer: OfferDocument,
  organization: OrganizationDocument,
  contact: ContactDocument,
): DocumentTemplate {
  const contactName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.company ||
    contact.email ||
    '—';

  return {
    documentType: 'certificate',
    title: 'Certificat de participation',
    organizationHeader: { name: organization.name },
    metadata: [
      { label: 'Participant', value: contactName },
      { label: 'Formation', value: offer.name },
      { label: 'Date', value: booking.startAt.toLocaleDateString('fr-FR') },
    ],
    body: {
      paragraphs: [
        `${organization.name} certifie que ${contactName} a participé à la formation « ${offer.name} » le ${booking.startAt.toLocaleDateString('fr-FR')}.`,
      ],
    },
  };
}
