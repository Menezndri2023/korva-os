import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { RecommendationsRepository } from './recommendations.repository';
import { DecisionRule } from './rules/rule.interface';
import { InvoiceOverdueFollowupRule } from './rules/invoice-overdue-followup.rule';
import { CustomerReactivationRule } from './rules/customer-reactivation.rule';
import { LowStockAlertRule } from './rules/low-stock-alert.rule';
import { LowStockThresholdAlertRule } from './rules/low-stock-threshold-alert.rule';
import { AuditService } from '../audit/audit.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';
import { translator } from '../shared/i18n';

/**
 * The Decision Engine (docs/BUSINESS_OS_AUDIT.md §9, item #3): a small, deterministic rules
 * layer consuming the same event stream the Workflow Engine does (see
 * workflow/events.processor.ts, which calls this service's handleEvent alongside
 * WorkflowEngineService.handleEvent for every event) — but system-authored, business-health
 * rules rather than user-configured automation, writing `Recommendation` records for a human
 * to review/dismiss/resolve instead of executing anything. Deliberately not an LLM standing in
 * for these decisions (Business OS brief §7): every rule here is a plain, auditable, testable
 * condition against real data.
 */
@Injectable()
export class DecisionEngineService {
  private readonly logger = new Logger(DecisionEngineService.name);
  private readonly rules: DecisionRule[];

  constructor(
    invoiceOverdueFollowupRule: InvoiceOverdueFollowupRule,
    customerReactivationRule: CustomerReactivationRule,
    lowStockAlertRule: LowStockAlertRule,
    lowStockThresholdAlertRule: LowStockThresholdAlertRule,
    private readonly recommendationsRepository: RecommendationsRepository,
    private readonly auditService: AuditService,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {
    this.rules = [
      invoiceOverdueFollowupRule,
      customerReactivationRule,
      lowStockAlertRule,
      lowStockThresholdAlertRule,
    ];
  }

  /**
   * Each matching rule is evaluated independently — one rule throwing must never prevent
   * another from running, same isolation rationale as WorkflowEngineService.handleEvent's own
   * per-workflow try/catch. Rules are read-only plus one idempotent create, so there is nothing
   * here that benefits from BullMQ's retry the way Workflow actions do — failures are logged,
   * not re-thrown, so a single misbehaving rule can never turn into a permanently-failed event
   * job (which would also block this same job's WorkflowEngineService handling on retry).
   */
  async handleEvent(
    organizationId: string,
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const matchingRules = this.rules.filter(
      (rule) => rule.eventName === eventName,
    );
    if (matchingRules.length === 0) return;

    // Recommendations are stored as text, so they are written once, in the business's language.
    const organization = await this.organizationModel
      .findById(organizationId, { language: 1 })
      .lean<{ language?: string }>()
      .exec()
      .catch(() => null);
    const t = translator(organization?.language);

    for (const rule of matchingRules) {
      try {
        const draft = await rule.evaluate(organizationId, payload, t);
        if (!draft) continue;

        const created = await this.recommendationsRepository.createIfNotExists({
          organizationId: new Types.ObjectId(organizationId),
          ruleKey: rule.key,
          title: draft.title,
          description: draft.description,
          entityType: draft.entityType,
          entityId: new Types.ObjectId(draft.entityId),
          severity: draft.severity,
          impact: draft.impact,
          confidence: draft.confidence,
        });
        if (!created) continue; // already recommended for this entity — not an error

        await this.auditService.record({
          organizationId,
          action: 'CREATE',
          entity: 'recommendation',
          entityId: created.id as string,
          metadata: { ruleKey: rule.key, sourceEvent: eventName },
        });
      } catch (error) {
        this.logger.error(
          `Decision Engine rule "${rule.key}" failed for event "${eventName}"`,
          error,
        );
      }
    }
  }
}
