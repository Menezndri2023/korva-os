import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { QuoteDocument } from '../../finance/quotes/schemas/quote.schema';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';
import { documentWords } from './document-words';
import { organizationIssuer } from './document-issuer';

export function buildQuoteDocumentManifest(
  quote: QuoteDocument,
  organization: OrganizationDocument,
  contact: ContactDocument,
): DocumentTemplate {
  const contactName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.company ||
    contact.email ||
    '—';
  const { t, date, money, status } = documentWords(organization.language);

  return {
    documentType: 'quote',
    title: t(`Devis ${quote.number}`, `Quote ${quote.number}`),
    organizationHeader: organizationIssuer(organization),
    metadata: [
      { label: t('Client', 'Customer'), value: contactName },
      { label: t('Statut', 'Status'), value: status(quote.status) },
      ...(quote.validUntil
        ? [
            {
              label: t("Valable jusqu'au", 'Valid until'),
              value: date(quote.validUntil),
            },
          ]
        : []),
    ],
    table: {
      columns: [
        t('Description', 'Description'),
        t('Qté', 'Qty'),
        t('Prix unitaire', 'Unit price'),
        t('Total', 'Total'),
      ],
      rows: quote.items.map((item) => [
        item.description,
        String(item.quantity),
        money(item.unitPrice, quote.currency),
        money(item.quantity * item.unitPrice, quote.currency),
      ]),
      totals: [
        {
          label: t('Sous-total', 'Subtotal'),
          value: money(quote.subtotal, quote.currency),
        },
        {
          label: t('TVA', 'VAT'),
          value: money(quote.taxTotal, quote.currency),
        },
        {
          label: t('Total', 'Total'),
          value: money(quote.total, quote.currency),
        },
      ],
    },
    footer: quote.notes,
  };
}
