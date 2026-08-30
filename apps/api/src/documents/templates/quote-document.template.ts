import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { QuoteDocument } from '../../finance/quotes/schemas/quote.schema';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';

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

  return {
    documentType: 'quote',
    title: `Devis ${quote.number}`,
    organizationHeader: { name: organization.name },
    metadata: [
      { label: 'Client', value: contactName },
      { label: 'Statut', value: quote.status },
      ...(quote.validUntil
        ? [
            {
              label: "Valable jusqu'au",
              value: quote.validUntil.toLocaleDateString('fr-FR'),
            },
          ]
        : []),
    ],
    table: {
      columns: ['Description', 'Qté', 'Prix unitaire', 'Total'],
      rows: quote.items.map((item) => [
        item.description,
        String(item.quantity),
        formatMoney(item.unitPrice, quote.currency),
        formatMoney(item.quantity * item.unitPrice, quote.currency),
      ]),
      totals: [
        {
          label: 'Sous-total',
          value: formatMoney(quote.subtotal, quote.currency),
        },
        { label: 'TVA', value: formatMoney(quote.taxTotal, quote.currency) },
        { label: 'Total', value: formatMoney(quote.total, quote.currency) },
      ],
    },
    footer: quote.notes,
  };
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(
    amount,
  );
}
