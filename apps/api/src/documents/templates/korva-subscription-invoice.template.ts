import {
  KORVA_SUPPORT,
  LEGAL_ENTITY,
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
 * No VAT line on purpose: whether VIT GLOBAL charges Moroccan VAT, and how a service sold to a
 * business abroad is treated, is for the company's accountant to settle — printing a rate KORVA
 * does not actually apply would be worse than printing none. See the audit of 2026-11-27.
 */
export function buildKorvaSubscriptionInvoiceManifest(
  invoice: SubscriptionInvoiceDocument,
  plan: PlanDocument,
  organization: Pick<
    OrganizationDocument,
    'name' | 'legalName' | 'contactAddress' | 'legalIdentifiers' | 'language'
  >,
): DocumentTemplate {
  const { t, date, money } = documentWords(organization.language);
  const interval = normalizePlanInterval(plan.interval);
  const en = organization.language === 'en';
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
        `RC ${LEGAL_ENTITY.rc} (${LEGAL_ENTITY.rcCourt}) · ICE ${LEGAL_ENTITY.ice} · ${t('Capital', 'Share capital')} ${LEGAL_ENTITY.capital}`,
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
      totals: [
        {
          label: t('Total à payer', 'Total due'),
          value: money(invoice.amount, invoice.currency),
        },
      ],
    },
    footer: t(
      `Abonnement payé d'avance pour la période indiquée. Conditions : korvasuite.com/conditions/generales. Contact : ${KORVA_SUPPORT.email}.`,
      `Subscription paid in advance for the period shown. Terms: korvasuite.com/en/terms. Contact: ${KORVA_SUPPORT.email}.`,
    ),
  };
}
