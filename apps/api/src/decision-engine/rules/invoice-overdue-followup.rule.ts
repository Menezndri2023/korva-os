import { Injectable } from '@nestjs/common';
import type { SystemEvent } from '@korva/types';
import { DecisionRule, RecommendationDraft } from './rule.interface';
import type { Translate } from '../../shared/i18n';

/**
 * The Business OS brief's own canonical deterministic-rule example (§7): "SI facture impayée
 * depuis plus de 7 jours ALORS créer une tâche de suivi" — here as a Decision Engine
 * recommendation (human reviews/approves) rather than an auto-executed action, consistent with
 * the brief's insistence that the AI/engine never acts unsupervised by default (§6).
 */
@Injectable()
export class InvoiceOverdueFollowupRule implements DecisionRule {
  readonly key = 'invoice_overdue_followup';
  readonly eventName: SystemEvent = 'invoice.overdue';

  evaluate(
    _organizationId: string,
    payload: Record<string, unknown>,
    t: Translate,
  ): Promise<RecommendationDraft | null> {
    const invoiceId = payload.invoiceId;
    if (typeof invoiceId !== 'string') return Promise.resolve(null);

    const total = typeof payload.total === 'number' ? payload.total : 0;
    const amountPaid =
      typeof payload.amountPaid === 'number' ? payload.amountPaid : 0;
    const outstanding = Math.max(0, total - amountPaid);

    return Promise.resolve({
      entityType: 'invoice',
      entityId: invoiceId,
      title: t('Facture en retard de paiement', 'Invoice overdue'),
      description: t(
        `Cette facture est en retard de paiement, avec ${outstanding} restant à encaisser. Nous recommandons une relance auprès du client.`,
        `This invoice is overdue, with ${outstanding} still to collect. We recommend reminding the customer.`,
      ),
      severity: 'urgent',
      impact:
        outstanding > 0
          ? t(
              `${outstanding} en attente d'encaissement`,
              `${outstanding} waiting to be collected`,
            )
          : undefined,
    });
  }
}
