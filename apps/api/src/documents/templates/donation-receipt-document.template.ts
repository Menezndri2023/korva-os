import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';
import type { DonationReceiptData } from '../../commerce/orders/donation-receipt.service';
import { documentWords } from './document-words';
import { organizationIssuer } from './document-issuer';

/**
 * An acknowledgement that a gift was received — explicitly not a tax receipt (see
 * DonationReceiptService for why). The last paragraph says so, so a donor never files it
 * believing otherwise; an association entitled to issue tax receipts issues its own.
 */
export function buildDonationReceiptDocumentManifest(
  receipt: DonationReceiptData,
  organization: OrganizationDocument,
  contact: ContactDocument,
): DocumentTemplate {
  const donorName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.company ||
    contact.email ||
    '—';
  const { t, date, money } = documentWords(organization.language);
  const issuer = organization.legalName || organization.name;
  const amount = money(receipt.total, receipt.currency);
  const day = date(receipt.receivedAt);

  return {
    documentType: 'donation_receipt',
    title: t(
      `Reçu de don n° ${receipt.number}`,
      `Donation receipt no. ${receipt.number}`,
    ),
    organizationHeader: organizationIssuer(organization),
    metadata: [
      { label: t('Donateur', 'Donor'), value: donorName },
      { label: t('Reçu le', 'Received on'), value: day },
      { label: t('Montant', 'Amount'), value: amount },
    ],
    table: {
      columns: [t('Don', 'Gift'), t('Montant', 'Amount')],
      rows: receipt.lines.map((line) => [
        line.description,
        money(line.amount, receipt.currency),
      ]),
      totals: [{ label: t('Total', 'Total'), value: amount }],
    },
    body: {
      paragraphs: [
        t(
          `${issuer} atteste avoir reçu de ${donorName} un don de ${amount} le ${day}. Merci pour votre générosité.`,
          `${issuer} confirms it received a gift of ${amount} from ${donorName} on ${day}. Thank you for your generosity.`,
        ),
        t(
          "Ce reçu confirme la réception de votre don. Il ne constitue pas un reçu fiscal et n'ouvre droit à aucune réduction d'impôt.",
          'This receipt confirms your gift was received. It is not a tax receipt and gives no entitlement to a tax deduction.',
        ),
      ],
    },
    footer: t('Reçu non fiscal', 'Not a tax receipt'),
  };
}
