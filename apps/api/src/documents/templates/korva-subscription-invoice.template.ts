import {
  KORVA_SUPPORT,
  KORVA_VAT,
  LEGAL_ENTITY,
  splitVatIncluded,
  PLAN_INTERVAL_LABELS,
  normalizePlanInterval,
} from '@korva/types';
import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { PlanDocument } from '../../subscriptions/schemas/plan.schema';
import type { SubscriptionInvoiceDocument } from '../../subscriptions/schemas/subscription-invoice.schema';
import { documentWords } from './document-words';

/**
 * KORVA's own invoice to a business for its subscription — issued by VIT GLOBAL TECHNOLOGIES
 * GROUP, with the identity printed on the legal notice (LEGAL_ENTITY: RC, ICE, registered
 * office), and the business as the customer. Until 2026-11-27 a business paying KORVA had only a
 * line on its Settings screen, nothing it could hand its accountant.
 *
 * VAT (KORVA_VAT, confirmed by the owner on 2026-11-27): a business established in Morocco pays
 * 20 % included in the price, broken down here as excl. VAT / VAT / incl. VAT; a business abroad
 * is invoiced without VAT, as an export of services, with the exemption printed. The IF is on
 * every invoice, as the DGI bulletin requires.
 */
export function buildKorvaSubscriptionInvoiceManifest(
  invoice: SubscriptionInvoiceDocument,
  plan: PlanDocument,
  organization: Pick<
    OrganizationDocument,
    | 'name'
    | 'legalName'
    | 'contactAddress'
    | 'legalIdentifiers'
    | 'language'
    | 'country'
  >,
): DocumentTemplate {
  const { t, date, money } = documentWords(organization.language);
  const interval = normalizePlanInterval(plan.interval);
  const en = organization.language === 'en';
  const domestic =
    organization.country?.toUpperCase() === KORVA_VAT.domesticCountry;
  const vat = splitVatIncluded(invoice.amount, KORVA_VAT.rate);
  const customer = [
    organization.legalName?.trim() || organization.name,
    organization.contactAddress?.trim(),
    organization.legalIdentifiers?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
  const statusLabel =
    invoice.status === 'paid'
      ? t('Payée', 'Paid')
      : invoice.status === 'void'
        ? t('Annulée', 'Void')
        : t('À payer', 'Due');

  return {
    documentType: 'invoice',
    title: t(`Facture ${invoice.number}`, `Invoice ${invoice.number}`),
    organizationHeader: {
      name: `${LEGAL_ENTITY.name} ${LEGAL_ENTITY.form}`,
      address: LEGAL_ENTITY.address,
      lines: [
        `RC ${LEGAL_ENTITY.rc} (${LEGAL_ENTITY.rcCourt}) · IF ${LEGAL_ENTITY.if} · ICE ${LEGAL_ENTITY.ice} · TP ${LEGAL_ENTITY.tp} · ${t('Capital', 'Share capital')} ${LEGAL_ENTITY.capital}`,
        t(
          'Éditeur de KORVA OS · korvasuite.com',
          'Publisher of KORVA OS · korvasuite.com',
        ),
      ],
    },
    metadata: [
      { label: t('Client', 'Customer'), value: customer },
      { label: t('Émise le', 'Issued on'), value: date(invoice.issuedAt) },
      { label: t('Échéance', 'Due date'), value: date(invoice.dueAt) },
      { label: t('Statut', 'Status'), value: statusLabel },
      ...(invoice.paidAt
        ? [{ label: t('Payée le', 'Paid on'), value: date(invoice.paidAt) }]
        : []),
    ],
    table: {
      columns: [
        t('Description', 'Description'),
        t('Période', 'Period'),
        t('Total', 'Total'),
      ],
      rows: [
        [
          `${t('Abonnement', 'Subscription')} ${plan.name} (${PLAN_INTERVAL_LABELS[en ? 'en' : 'fr'][interval].toLowerCase()})`,
          `${date(invoice.periodStart)} - ${date(invoice.periodEnd)}`,
          money(invoice.amount, invoice.currency),
        ],
      ],
      totals: domestic
        ? [
            {
              label: t('Total HT', 'Total excl. VAT'),
              value: money(vat.net, invoice.currency),
            },
            {
              label: t(`TVA ${KORVA_VAT.rate} %`, `VAT ${KORVA_VAT.rate}%`),
              value: money(vat.vat, invoice.currency),
            },
            {
              label: t('Total TTC', 'Total incl. VAT'),
              value: money(invoice.amount, invoice.currency),
            },
          ]
        : [
            {
              label: t('Total HT', 'Total excl. VAT'),
              value: money(invoice.amount, invoice.currency),
            },
            {
              label: t('Total à payer', 'Total due'),
              value: money(invoice.amount, invoice.currency),
            },
          ],
    },
    footer: [
      ...(domestic ? [] : [KORVA_VAT.exportExemption[en ? 'en' : 'fr']]),
      t(
        `Abonnement payé d'avance pour la période indiquée. Conditions : korvasuite.com/conditions/generales. Contact : ${KORVA_SUPPORT.email}.`,
        `Subscription paid in advance for the period shown. Terms: korvasuite.com/en/terms. Contact: ${KORVA_SUPPORT.email}.`,
      ),
    ].join(' '),
  };
}
