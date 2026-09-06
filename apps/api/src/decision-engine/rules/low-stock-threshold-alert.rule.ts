import { Injectable } from '@nestjs/common';
import type { SystemEvent } from '@korva/types';
import { DecisionRule, RecommendationDraft } from './rule.interface';

/**
 * Reacts to `offer.low_stock` (InventoryService.reserveStock, whenever a decrement leaves stock
 * at or below the offer's own configured lowStockThreshold) — distinct from LowStockAlertRule's
 * `offer.stock_depleted`, which only ever fires at exactly 0 regardless of any threshold. This
 * one only exists for offers that actually opted into a real reorder point above zero, so staff
 * get a heads-up before the shelf is empty, not just after.
 */
@Injectable()
export class LowStockThresholdAlertRule implements DecisionRule {
  readonly key = 'low_stock_threshold_alert';
  readonly eventName: SystemEvent = 'offer.low_stock';

  evaluate(
    _organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<RecommendationDraft | null> {
    const offerId = payload.offerId;
    if (typeof offerId !== 'string') return Promise.resolve(null);

    const stockOnHand =
      typeof payload.stockOnHand === 'number' ? payload.stockOnHand : '?';
    const threshold =
      typeof payload.lowStockThreshold === 'number'
        ? payload.lowStockThreshold
        : '?';

    return Promise.resolve({
      entityType: 'offer',
      entityId: offerId,
      title: 'Stock bas',
      description: `Il reste ${stockOnHand} unité(s) en stock, en dessous du seuil configuré (${threshold}). Pensez à réapprovisionner.`,
      // A heads-up before the shelf is actually empty — one tier below LowStockAlertRule's
      // 'urgent' (genuine stockout), since sales aren't lost yet.
      severity: 'attention',
      impact:
        typeof stockOnHand === 'number'
          ? `${stockOnHand} unité(s) restante(s)`
          : undefined,
    });
  }
}
