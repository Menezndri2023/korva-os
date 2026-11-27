import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { InvoiceDocument } from '../../finance/invoices/schemas/invoice.schema';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';
import { documentWords } from './document-words';
import { organizationIssuer } from './document-issuer';

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
  const { t, date, money, status } = documentWords(organization.language);

  return {
    documentType: 'invoice',
    title: t(`Facture ${invoice.number}`, `Invoice ${invoice.number}`),
    organizationHeader: organizationIssuer(organization),
    metadata: [
      { label: t('Client', 'Customer'), value: contactName },
      { label: t('Statut', 'Status'), value: status(invoice.status) },
      ...(invoice.issuedAt
        ? [
            {
              label: t('Émise le', 'Issued on'),
              value: date(invoice.issuedAt),
            },
          ]
        : []),
      ...(invoice.dueDate
        ? [
            {
              label: t('Échéance', 'Due date'),
              value: date(invoice.dueDate),
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
      rows: invoice.items.map((item) => [
        item.description,
        String(item.quantity),
        money(item.unitPrice, invoice.currency),
        money(item.quantity * item.unitPrice, invoice.currency),
      ]),
      totals: [
        {
          label: t('Sous-total', 'Subtotal'),
          value: money(invoice.subtotal, invoice.currency),
        },
        {
          label: t('TVA', 'VAT'),
          value: money(invoice.taxTotal, invoice.currency),
        },
        {
          label: t('Total', 'Total'),
          value: money(invoice.total, invoice.currency),
        },
      ],
    },
    footer: invoice.notes,
  };
}
