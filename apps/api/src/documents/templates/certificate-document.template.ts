import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { BookingDocument } from '../../booking/bookings/schemas/booking.schema';
import type { OfferDocument } from '../../catalog/offers/schemas/offer.schema';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';
import { documentWords } from './document-words';

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
  const { t, date } = documentWords(organization.language);
  const day = date(booking.startAt);

  return {
    documentType: 'certificate',
    title: t('Certificat de participation', 'Certificate of attendance'),
    organizationHeader: { name: organization.name },
    metadata: [
      { label: t('Participant', 'Participant'), value: contactName },
      { label: t('Formation', 'Course'), value: offer.name },
      { label: t('Date', 'Date'), value: day },
    ],
    body: {
      paragraphs: [
        t(
          `${organization.name} certifie que ${contactName} a participé à la formation « ${offer.name} » le ${day}.`,
          `${organization.name} certifies that ${contactName} attended the course “${offer.name}” on ${day}.`,
        ),
      ],
    },
  };
}
