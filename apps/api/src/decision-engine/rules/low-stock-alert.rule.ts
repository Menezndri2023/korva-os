import { Injectable } from '@nestjs/common';
import type { SystemEvent } from '@korva/types';
import { DecisionRule, RecommendationDraft } from './rule.interface';

/**
 * Reacts to `offer.stock_depleted` (already published by InventoryService.reserveStock whenever
 * a decrement brings an offer's stockOnHand to exactly 0 — see that service's own doc) so a
 * depleted product is something staff gets flagged to restock, not something they discover only
 * when a customer complains it's unavailable.
 */
@Injectable()
export class LowStockAlertRule implements DecisionRule {
  readonly key = 'low_stock_alert';
  readonly eventName: SystemEvent = 'offer.stock_depleted';

  evaluate(
    _organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<RecommendationDraft | null> {
    const offerId = payload.offerId;
    if (typeof offerId !== 'string') return Promise.resolve(null);

    return Promise.resolve({
      entityType: 'offer',
      entityId: offerId,
      title: 'Stock épuisé',
      description:
        'Cette offre est en rupture de stock. Nous recommandons un réapprovisionnement pour éviter de perdre des ventes.',
    });
  }
}
