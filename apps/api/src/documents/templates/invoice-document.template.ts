import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { InvoiceDocument } from '../../finance/invoices/schemas/invoice.schema';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';

export function buildInvoiceDocumentManifest(
  invoice: InvoiceDocument,
  organization: OrganizationDocument,
  contact: ContactDocument,
): DocumentTemplate {
  const contactName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.company ||
    contact.email ||
    '—';

  return {
    documentType: 'invoice',
    title: `Facture ${invoice.number}`,
    organizationHeader: { name: organization.name },
    metadata: [
      { label: 'Client', value: contactName },
      { label: 'Statut', value: invoice.status },
      ...(invoice.issuedAt
        ? [
            {
              label: 'Émise le',
              value: invoice.issuedAt.toLocaleDateString('fr-FR'),
            },
          ]
        : []),
      ...(invoice.dueDate
        ? [
            {
              label: 'Échéance',
              value: invoice.dueDate.toLocaleDateString('fr-FR'),
            },
          ]
        : []),
    ],
    table: {
      columns: ['Description', 'Qté', 'Prix unitaire', 'Total'],
      rows: invoice.items.map((item) => [
        item.description,
        String(item.quantity),
        formatMoney(item.unitPrice, invoice.currency),
        formatMoney(item.quantity * item.unitPrice, invoice.currency),
      ]),
      totals: [
        {
          label: 'Sous-total',
          value: formatMoney(invoice.subtotal, invoice.currency),
        },
        {
          label: 'TVA',
          value: formatMoney(invoice.taxTotal, invoice.currency),
        },
        { label: 'Total', value: formatMoney(invoice.total, invoice.currency) },
      ],
    },
    footer: invoice.notes,
  };
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(
    amount,
  );
}
