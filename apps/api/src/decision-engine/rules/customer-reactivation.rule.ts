import { Injectable } from '@nestjs/common';
import type { SystemEvent } from '@korva/types';
import { DecisionRule, RecommendationDraft } from './rule.interface';
import type { Translate } from '../../shared/i18n';

/**
 * The brief's own canonical "fidélisation" example, reused verbatim across §1/§8/§18/§19: a
 * customer who went quiet is something KORVA should notice and recommend acting on — a
 * reactivation outreach — rather than silently letting churn happen unobserved.
 */
@Injectable()
export class CustomerReactivationRule implements DecisionRule {
  readonly key = 'customer_reactivation';
  readonly eventName: SystemEvent = 'customer.inactive';

  evaluate(
    _organizationId: string,
    payload: Record<string, unknown>,
    t: Translate,
  ): Promise<RecommendationDraft | null> {
    const contactId = payload.contactId;
    if (typeof contactId !== 'string') return Promise.resolve(null);

    const inactiveDays =
      typeof payload.inactiveDays === 'number' ? payload.inactiveDays : null;

    return Promise.resolve({
      entityType: 'contact',
      entityId: contactId,
      title: t('Client inactif à relancer', 'Inactive customer to win back'),
      description:
        inactiveDays !== null
          ? t(
              `Ce client n'a montré aucune activité depuis ${inactiveDays} jours. Nous recommandons une campagne de réactivation.`,
              `This customer has shown no activity for ${inactiveDays} days. We recommend a win-back campaign.`,
            )
          : t(
              "Ce client n'a montré aucune activité récente. Nous recommandons une campagne de réactivation.",
              'This customer has shown no recent activity. We recommend a win-back campaign.',
            ),
      // No revenue is actively at risk (unlike an overdue invoice or a depleted product) — this
      // is a growth opportunity, not something bleeding money right now.
      severity: 'opportunity',
      impact:
        inactiveDays !== null
          ? t(
              `${inactiveDays} jours d'inactivité`,
              `${inactiveDays} days inactive`,
            )
          : undefined,
    });
  }
}
